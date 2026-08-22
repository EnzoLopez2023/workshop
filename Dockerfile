# Built and pushed to Azure Container Registry by GitHub Actions on every
# push to main. Persistent data and recovery bundles live under /home/data.
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .

# Vite bakes these into the JS bundle at build time.
# Values come from the host .env via docker-compose build args.
ARG VITE_AZURE_CLIENT_ID
ARG VITE_AZURE_AUTHORITY_TENANT_ID
ARG VITE_AZURE_HOME_TENANT_ID
ARG VITE_AZURE_TENANT_ID
ARG VITE_SHOPKEEP_URL
ARG VITE_TABLOOM_API_BASE_URL
ARG VITE_TABLOOM_CLIENT_ID
ENV VITE_AZURE_CLIENT_ID=$VITE_AZURE_CLIENT_ID
ENV VITE_AZURE_AUTHORITY_TENANT_ID=$VITE_AZURE_AUTHORITY_TENANT_ID
ENV VITE_AZURE_HOME_TENANT_ID=$VITE_AZURE_HOME_TENANT_ID
ENV VITE_AZURE_TENANT_ID=$VITE_AZURE_TENANT_ID
ENV VITE_SHOPKEEP_URL=$VITE_SHOPKEEP_URL
ENV VITE_TABLOOM_API_BASE_URL=$VITE_TABLOOM_API_BASE_URL
ENV VITE_TABLOOM_CLIENT_ID=$VITE_TABLOOM_CLIENT_ID

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY server.js      ./
COPY recovery.js    ./
COPY offhost-export.js ./
COPY deployment-info.js ./
COPY scripts/recovery.mjs ./scripts/recovery.mjs
COPY package.json   ./
COPY version.json   ./

# Production starts Node directly; package managers and their unused dependency
# trees are excluded from the runtime image and its vulnerability surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx

ENV NODE_ENV=production
ENV PORT=3006
ENV DATA_ROOT=/home/data
ENV DB_PATH=/home/data/workshop.db
ENV UPLOADS_PATH=/home/data/uploads

ARG BUILD_SHA
ARG APP_VERSION
ARG BUILD_ID
RUN echo "$BUILD_SHA" | grep -Eq '^[0-9a-f]{40}$' \
    && echo "$APP_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\+build\.[0-9]+$' \
    && echo "$BUILD_ID" | grep -Eq '^[0-9]+-[0-9]+$' \
    && printf '{"sha":"%s","version":"%s","buildId":"%s"}\n' "$BUILD_SHA" "$APP_VERSION" "$BUILD_ID" > /app/build-info.json
LABEL org.opencontainers.image.revision=$BUILD_SHA
LABEL org.opencontainers.image.version=$BUILD_ID
LABEL com.workshop.app-version=$APP_VERSION

EXPOSE 3006

# App Service mounts persistent storage at /home. A nested image VOLUME here
# would shadow that platform mount; local Docker uses docker-compose.yml instead.

CMD ["node", "server.js"]

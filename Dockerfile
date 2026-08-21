# Built and pushed to Azure Container Registry by GitHub Actions on every
# push to main. Persistent data and recovery bundles live under /home/data.
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm install
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
COPY scripts/recovery.mjs ./scripts/recovery.mjs
COPY package.json   ./

ENV NODE_ENV=production
ENV PORT=3006
ENV DATA_ROOT=/home/data
ENV DB_PATH=/home/data/workshop.db
ENV UPLOADS_PATH=/home/data/uploads

EXPOSE 3006

VOLUME ["/home/data"]

CMD ["node", "server.js"]

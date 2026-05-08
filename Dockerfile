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
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY server.js      ./
COPY package.json   ./

ENV NODE_ENV=production
ENV PORT=3006
ENV DB_PATH=/data/workshop.db
ENV UPLOADS_PATH=/data/uploads

EXPOSE 3006

VOLUME ["/data"]

CMD ["node", "server.js"]

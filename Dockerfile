FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS server
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm install
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3010
ENV DATA_DIR=/data
ENV PUBLIC_DIR=/app/public
COPY --from=server /app/node_modules ./node_modules
COPY --from=server /app/dist ./dist
COPY --from=server /app/package.json ./package.json
COPY --from=web /web/dist ./public
EXPOSE 3010
CMD ["node", "dist/index.js"]

# syntax=docker/dockerfile:1
# Ảnh dùng chung cho api, worker, migrate. Remotion/Chromium sẽ thêm ở epic E6/E10 (ảnh worker-media riêng).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# curl cho healthcheck. FFmpeg/Chromium sẽ thêm ở ảnh worker-media riêng (epic E10/E12) để ảnh api/worker nhẹ.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Mã biên dịch tìm schemas/ và db/ tương đối với dist/src.
COPY schemas ./dist/schemas
COPY db ./dist/db
RUN mkdir -p /data/media && chown -R node:node /data /app
USER node
EXPOSE 3000
CMD ["node", "dist/src/server.js"]

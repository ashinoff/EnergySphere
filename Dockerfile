FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY apps ./apps
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 WEB_PATH=/app/dist/web STORAGE_PATH=/data/storage TZ=Europe/Moscow
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY db/migrations ./db/migrations
EXPOSE 3000
CMD ["node","dist/api/server.js"]

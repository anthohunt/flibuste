# Flibuste : serveur + client web dans une seule image.
#   docker build -t flibuste . && docker run -p 8787:8787 -v flibuste-data:/data flibuste
FROM node:22-bookworm AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @flibuste/web build

FROM node:22-bookworm-slim
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
ENV PORT=8787 DATA_DIR=/data WEB_DIST=/app/apps/web/dist
VOLUME /data
EXPOSE 8787
CMD ["pnpm", "--filter", "@flibuste/server", "start"]

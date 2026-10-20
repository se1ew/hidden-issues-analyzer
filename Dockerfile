FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
RUN npm run db:generate && npm run build

FROM node:24-bookworm-slim AS production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/assets ./apps/api/assets
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/docs/fixtures ./docs/fixtures
RUN mkdir -p /app/apps/api/reports_output /app/apps/api/uploads /app/models_cache \
    && chown node:node /app/apps/api/reports_output /app/apps/api/uploads /app/models_cache
ENV NODE_ENV=production WEB_DIST_DIR=/app/apps/web/dist
USER node
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/index.js"]

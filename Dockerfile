# ~140 MB image, no native deps, runs anywhere Docker does.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.web.json vite.config.ts ./
COPY src ./src
COPY web ./web
RUN pnpm build && pnpm prune --prod

FROM node:22-alpine
ENV NODE_ENV=production
ENV COVALLABY_DB=/data/covallaby.db
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY package.json ./
VOLUME /data
EXPOSE 8080
USER node
# /data must be writable by the node user when using a bind mount.
CMD ["node", "dist/index.js"]

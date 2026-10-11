# syntax=docker/dockerfile:1
# ---- build ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    CONFIG_DIR=/app/config
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/seed ./seed
COPY --from=build /app/config ./config.default
# data = sessions (SQLite in dev), uploads = media, config = services.yaml (all volumes)
RUN mkdir -p data uploads config && chown -R node:node /app
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/
USER node
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "./dist/server/entry.mjs"]

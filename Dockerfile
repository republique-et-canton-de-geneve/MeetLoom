FROM node:25-bookworm-slim AS build
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci --no-audit
COPY . .
RUN npm run build

FROM node:25-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/app/data SQLITE_PATH=/app/data/meetloom.sqlite
WORKDIR /app
COPY package*.json .npmrc ./
# npm is needed to install dependencies, but the runtime starts with node directly.
RUN npm ci --omit=dev --ignore-scripts --no-audit \
    && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    && mkdir -p /app/data \
    && chgrp -R 0 /app/data \
    && chmod -R g=u /app/data
COPY --from=build /app/dist ./dist
# Set by the release workflow; shown to signed-in users and administrators.
ARG APP_VERSION=""
ARG APP_REVISION=""
ENV APP_VERSION=$APP_VERSION APP_REVISION=$APP_REVISION
USER 10001:0
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]

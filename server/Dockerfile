# Build from the repository root:  docker build -f server/Dockerfile -t lk-token-importer .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY extension/package.json extension/
RUN npm ci --workspace server --include-workspace-root --ignore-scripts
COPY shared shared
COPY server server
RUN npm run build -w server

# The bundle has no runtime dependencies.
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/server/dist/server.mjs /app/server/dist/server.mjs.map ./
ENV NODE_ENV=production LKTI_TOKEN_DIR=/data/tokens
VOLUME /data
USER node
EXPOSE 8787
CMD ["node", "--enable-source-maps", "server.mjs"]

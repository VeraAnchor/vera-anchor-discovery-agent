# ./Dockerfile

FROM node:20-alpine AS deps

WORKDIR /repo

RUN apk add --no-cache \
  libc6-compat \
  python3 \
  make \
  g++ \
  openssl

COPY package.json package-lock.json ./
COPY apps/agent-api/package.json ./apps/agent-api/package.json
COPY packages/hashing-core/package.json ./packages/hashing-core/package.json
COPY packages/proof-core/package.json ./packages/proof-core/package.json

RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-factor 2 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm ci --workspaces --include-workspace-root=false --no-audit --no-fund


FROM deps AS build

WORKDIR /repo

COPY apps/agent-api/tsconfig.json ./apps/agent-api/tsconfig.json
COPY apps/agent-api/src ./apps/agent-api/src

COPY packages/hashing-core/tsconfig.json ./packages/hashing-core/tsconfig.json
COPY packages/hashing-core ./packages/hashing-core

COPY packages/proof-core/tsconfig.json ./packages/proof-core/tsconfig.json
COPY packages/proof-core/src ./packages/proof-core/src

RUN npm run build --workspace packages/hashing-core \
  && npm run build --workspace packages/proof-core \
  && npm run build --workspace apps/agent-api


FROM node:20-alpine AS runtime

WORKDIR /repo

ENV NODE_ENV=production
ENV TZ=UTC

RUN apk add --no-cache \
  libc6-compat \
  openssl \
  postgresql-client

RUN addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json ./
COPY apps/agent-api/package.json ./apps/agent-api/package.json
COPY packages/hashing-core/package.json ./packages/hashing-core/package.json
COPY packages/proof-core/package.json ./packages/proof-core/package.json

RUN npm ci \
    --workspaces \
    --include-workspace-root=false \
    --omit=dev \
    --no-audit \
    --no-fund \
  && npm cache clean --force

COPY --from=build /repo/apps/agent-api/dist ./apps/agent-api/dist
COPY --from=build /repo/apps/agent-api/src/db/schemas ./apps/agent-api/src/db/schemas
COPY --from=build /repo/packages/hashing-core/dist ./packages/hashing-core/dist
COPY --from=build /repo/packages/proof-core/dist ./packages/proof-core/dist

COPY apps/agent-api/docker/entrypoint.sh ./apps/agent-api/docker/entrypoint.sh

RUN chmod +x ./apps/agent-api/docker/entrypoint.sh \
  && mkdir -p /repo/logs /repo/tmp \
  && chown -R app:app /repo

USER app

EXPOSE 8787

ENTRYPOINT ["/repo/apps/agent-api/docker/entrypoint.sh"]
CMD ["node", "apps/agent-api/dist/server.js"]
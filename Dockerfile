# syntax=docker/dockerfile:1.7

FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
WORKDIR /app

COPY package.json bun.lock* turbo.json tsconfig.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/api-client/package.json packages/api-client/
COPY packages/auth/package.json packages/auth/
COPY packages/db/package.json packages/db/
COPY packages/utils/package.json packages/utils/
COPY packages/validators/package.json packages/validators/
COPY --from=error_tracker_sdk . /error-tracker/packages/sdk

RUN --mount=type=cache,target=/root/.bun/install/cache \
    mkdir -p apps/web/public \
    && bun install --frozen-lockfile --registry https://registry.npmjs.org

FROM deps AS builder
WORKDIR /app

COPY . .
RUN bun run build --filter=@utils-plane/api --filter=@utils-plane/web

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV WEB_PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/docker/start-all.sh ./docker/start-all.sh

EXPOSE 3000 3001

CMD ["sh", "docker/start-all.sh"]

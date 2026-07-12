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

ARG NEXT_PUBLIC_API_URL=http://202.104.149.204:5006
ARG NEXT_PUBLIC_S3_PUBLIC_URL=http://202.104.149.204:5009
ARG NEXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION=true
ARG NEXT_PUBLIC_ERROR_TRACKER_DSN=
ARG NEXT_PUBLIC_ERROR_TRACKER_TOKEN=
ARG NEXT_PUBLIC_RELEASE=prod

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_S3_PUBLIC_URL=$NEXT_PUBLIC_S3_PUBLIC_URL
ENV NEXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION=$NEXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION
ENV NEXT_PUBLIC_ERROR_TRACKER_DSN=$NEXT_PUBLIC_ERROR_TRACKER_DSN
ENV NEXT_PUBLIC_ERROR_TRACKER_TOKEN=$NEXT_PUBLIC_ERROR_TRACKER_TOKEN
ENV NEXT_PUBLIC_RELEASE=$NEXT_PUBLIC_RELEASE
ENV NODE_ENV=production

COPY . .
RUN bun run build --filter=@utils-plane/api --filter=@utils-plane/web
RUN bun node_modules/typescript/bin/tsc -p packages/db/tsconfig.json --module commonjs --moduleResolution node --outDir packages/db/dist-cjs --declaration false --declarationMap false --sourceMap false \
    && bun node_modules/typescript/bin/tsc -p packages/auth/tsconfig.json --module commonjs --moduleResolution node --outDir packages/auth/dist-cjs --declaration false --declarationMap false --sourceMap false \
    && bun node_modules/typescript/bin/tsc -p packages/validators/tsconfig.json --module commonjs --moduleResolution node --outDir packages/validators/dist-cjs --declaration false --declarationMap false --sourceMap false

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV WEB_PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-writer \
        fonts-dejavu \
        fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/auth/package.json ./packages/auth/package.json
COPY --from=builder /app/packages/auth/node_modules ./packages/auth/node_modules
COPY --from=builder /app/packages/auth/dist-cjs ./packages/auth/dist-cjs
COPY --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder /app/packages/db/dist-cjs ./packages/db/dist-cjs
COPY --from=builder /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=builder /app/packages/validators/package.json ./packages/validators/package.json
COPY --from=builder /app/packages/validators/node_modules ./packages/validators/node_modules
COPY --from=builder /app/packages/validators/dist-cjs ./packages/validators/dist-cjs
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/models ./models
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/public ./public
COPY --from=builder /app/apps/web/.next/static ./.next/static
COPY --from=builder /app/docker/start-all.sh ./docker/start-all.sh

RUN node -e "const fs=require('node:fs'); const patch=(path, fields)=>{const data=JSON.parse(fs.readFileSync(path,'utf8')); Object.assign(data, fields); fs.writeFileSync(path, JSON.stringify(data,null,2));}; patch('packages/db/package.json',{main:'./dist-cjs/index.js',types:'./dist-cjs/index.d.ts',exports:{'.':'./dist-cjs/index.js','./schema':'./dist-cjs/schema/index.js','./client':'./dist-cjs/client.js'}}); patch('packages/auth/package.json',{main:'./dist-cjs/index.js',types:'./dist-cjs/index.d.ts',exports:{'.':'./dist-cjs/index.js','./origins':'./dist-cjs/origins.js'}}); patch('packages/validators/package.json',{main:'./dist-cjs/index.js',types:'./dist-cjs/index.d.ts',exports:{'.':'./dist-cjs/index.js'}});" \
    && rm -f node_modules/next node_modules/react node_modules/react-dom \
    && ln -s .bun/node_modules/next node_modules/next \
    && ln -s .bun/node_modules/react node_modules/react \
    && ln -s .bun/node_modules/react-dom node_modules/react-dom

EXPOSE 3000 3001

CMD ["sh", "docker/start-all.sh"]

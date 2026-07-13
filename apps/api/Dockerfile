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

RUN --mount=type=cache,target=/root/.bun/install/cache \
    mkdir -p apps/web/public \
    && bun install --frozen-lockfile --registry https://registry.npmjs.org

FROM deps AS builder
WORKDIR /app

COPY . .
RUN bun run build --filter=@utils-plane/api
RUN bun node_modules/typescript/bin/tsc -p packages/db/tsconfig.json --module commonjs --moduleResolution node --outDir packages/db/dist-cjs --declaration false --declarationMap false --sourceMap false \
    && bun node_modules/typescript/bin/tsc -p packages/auth/tsconfig.json --module commonjs --moduleResolution node --outDir packages/auth/dist-cjs --declaration false --declarationMap false --sourceMap false \
    && bun node_modules/typescript/bin/tsc -p packages/utils/tsconfig.json --module commonjs --moduleResolution node --outDir packages/utils/dist-cjs --declaration false --declarationMap false --sourceMap false \
    && bun node_modules/typescript/bin/tsc -p packages/validators/tsconfig.json --module commonjs --moduleResolution node --outDir packages/validators/dist-cjs --declaration false --declarationMap false --sourceMap false

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/auth/package.json ./packages/auth/package.json
COPY --from=builder /app/packages/auth/node_modules ./packages/auth/node_modules
COPY --from=builder /app/packages/auth/dist-cjs ./packages/auth/dist-cjs
COPY --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder /app/packages/db/dist-cjs ./packages/db/dist-cjs
COPY --from=builder /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=builder /app/packages/utils/package.json ./packages/utils/package.json
COPY --from=builder /app/packages/utils/dist-cjs ./packages/utils/dist-cjs
COPY --from=builder /app/packages/validators/package.json ./packages/validators/package.json
COPY --from=builder /app/packages/validators/node_modules ./packages/validators/node_modules
COPY --from=builder /app/packages/validators/dist-cjs ./packages/validators/dist-cjs
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist

RUN node -e "const fs=require('node:fs'); const patch=(path, fields)=>{const data=JSON.parse(fs.readFileSync(path,'utf8')); Object.assign(data, fields); fs.writeFileSync(path, JSON.stringify(data,null,2));}; patch('packages/db/package.json',{main:'./dist-cjs/index.js',types:'./dist-cjs/index.d.ts',exports:{'.':'./dist-cjs/index.js','./schema':'./dist-cjs/schema/index.js','./client':'./dist-cjs/client.js'}}); patch('packages/auth/package.json',{main:'./dist-cjs/index.js',types:'./dist-cjs/index.d.ts',exports:{'.':'./dist-cjs/index.js','./origins':'./dist-cjs/origins.js'}}); patch('packages/utils/package.json',{main:'./dist-cjs/index.js',types:'./dist-cjs/index.d.ts',exports:{'.':'./dist-cjs/index.js'}}); patch('packages/validators/package.json',{main:'./dist-cjs/index.js',types:'./dist-cjs/index.d.ts',exports:{'.':'./dist-cjs/index.js'}});"

EXPOSE 3001

CMD ["sh", "-c", "node apps/api/dist/scripts/migrate.js && node apps/api/dist/main.js"]

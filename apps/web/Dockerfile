FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock* turbo.json tsconfig.json ./
COPY apps/web/package.json apps/web/
COPY packages/auth/package.json packages/auth/
COPY packages/api-client/package.json packages/api-client/
COPY packages/validators/package.json packages/validators/
COPY packages/utils/package.json packages/utils/

RUN bun install --frozen-lockfile

COPY . .

# Next.js 需要 standalone 输出模式
RUN bun run build --filter=@utils-plane/web

EXPOSE 3000
CMD ["bun", "apps/web/.next/standalone/server.js"]
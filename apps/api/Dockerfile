FROM oven/bun:1 AS base
WORKDIR /app

# 系统依赖（Sharp 等 native libs）
RUN apt-get update && apt-get install -y \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# 复制 monorepo 配置和 package 信息
COPY package.json bun.lock* turbo.json tsconfig.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/validators/package.json packages/validators/
COPY packages/utils/package.json packages/utils/

# 安装依赖
RUN bun install --frozen-lockfile

# 复制源码
COPY . .

# 构建
RUN bun run build --filter=@utils-plane/api

EXPOSE 3001
CMD ["bun", "apps/api/dist/main.js"]
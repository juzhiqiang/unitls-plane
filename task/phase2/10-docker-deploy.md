# 10 - Docker Compose 生产部署

> 依赖：Phase 2 全部任务
> 预估：1.5h

## 目标

为 apps/api 创建 Dockerfile，扩展 docker-compose.yml 支持生产环境一键部署。

## 步骤

### 10.1 创建 apps/api/Dockerfile

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# 系统依赖（Sharp 等 native libs）
RUN apt-get update && apt-get install -y \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# 复制 monorepo 配置和 package 信息
COPY package.json bun.lock turbo.json ./
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
```

### 10.2 创建 apps/web/Dockerfile

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/
COPY packages/auth/package.json packages/auth/
COPY packages/api-client/package.json packages/api-client/
COPY packages/validators/package.json packages/validators/
COPY packages/utils/package.json packages/utils/

RUN bun install --frozen-lockfile

COPY . .
RUN bun run build --filter=@utils-plane/web

EXPOSE 3000
CMD ["bun", "apps/web/.next/standalone/server.js"]
```

> 注：Next.js 需配置 `output: 'standalone'`。

### 10.3 扩展 docker-compose.yml

在原 dev 服务（postgres / redis / minio）基础上，添加 prod 服务：

```yaml
# docker-compose.prod.yml
services:
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    ports: ["3001:3001"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      minio: { condition: service_healthy }
    environment:
      DATABASE_URL: postgresql://utils:utils@postgres:5432/utils_plane
      REDIS_URL: redis://redis:6379
      S3_ENDPOINT: http://minio:9000
      S3_REGION: us-east-1
      S3_ACCESS_KEY: ${S3_ACCESS_KEY}
      S3_SECRET_KEY: ${S3_SECRET_KEY}
      S3_BUCKET: uploads
      S3_FORCE_PATH_STYLE: "true"
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL}
      CORS_ORIGIN: ${WEB_URL}
      NODE_ENV: production

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports: ["3000:3000"]
    depends_on:
      api: { condition: service_started }
    environment:
      NEXT_PUBLIC_API_URL: ${API_URL}
      NEXT_PUBLIC_S3_PUBLIC_URL: ${S3_PUBLIC_URL}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL}
      NODE_ENV: production

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [api, web]

volumes:
  caddy_data:
  caddy_config:
```

### 10.4 创建 Caddyfile（反向代理 + 自动 HTTPS）

```
{$DOMAIN} {
    handle /api/* {
        reverse_proxy api:3001
    }
    handle {
        reverse_proxy web:3000
    }
}

{$S3_DOMAIN} {
    reverse_proxy minio:9000
}
```

### 10.5 健康检查端点

`apps/api/src/modules/health/health.controller.ts`:
```typescript
@Controller('health')
@Public()
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
```

### 10.6 部署方式

#### 方式 A：单服务器自托管

```bash
# 一台 VPS，复制 repo
git clone <repo>
cd utils-plane

# 配置生产 env
cp .env.example .env.prod
# 编辑 .env.prod 填入生产值

# 启动
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod up -d
```

#### 方式 B：分离部署

- 数据层：Managed PostgreSQL（如 Neon、自托管 PG VPS）
- 对象存储：MinIO 集群 或 Cloudflare R2
- 应用层：Fly.io / Railway 部署 api、web 容器
- Redis：Upstash 或自托管

### 10.7 备份策略

PostgreSQL：
```bash
# 定时备份脚本（cron）
docker exec utils-pg pg_dump -U utils utils_plane | gzip > backup_$(date +%F).sql.gz
```

MinIO：
- 启用 versioning
- 配置异地复制（mirror 到另一个 MinIO 实例或 S3）

## 验收标准

- [ ] `docker compose -f ... up -d` 启动所有服务
- [ ] /health 返回 200
- [ ] /docs 可访问
- [ ] Sharp 处理大图正常（验证 native 依赖）
- [ ] Caddy 自动获取 HTTPS 证书（生产域名）
- [ ] 备份脚本可手动跑通

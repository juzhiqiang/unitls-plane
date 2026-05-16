# 05 - Docker Services（PG + Redis + MinIO）

> 依赖：无（外部基础设施，可最先开始）
> 预估：1.5h
> 可并行：与所有任务并行

## 目标

通过 docker-compose 一键启动本地开发所需的所有外部服务：PostgreSQL、Redis、MinIO。

## 步骤

### 5.1 创建 docker-compose.yml

`<repo-root>/docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: utils-pg
    restart: unless-stopped
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: utils
      POSTGRES_PASSWORD: utils
      POSTGRES_DB: utils_plane
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U utils -d utils_plane"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: utils-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes --maxmemory-policy noeviction
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  minio:
    image: minio/minio:latest
    container_name: utils-minio
    restart: unless-stopped
    ports:
      - "9000:9000"   # S3 API
      - "9001:9001"   # Web Console
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio_data:/data
    command: server /data --console-address ":9001"
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 5

  # 自动创建 MinIO bucket
  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      sh -c "
      mc alias set local http://minio:9000 minioadmin minioadmin;
      mc mb local/uploads --ignore-existing;
      mc anonymous set download local/uploads;
      exit 0;
      "

volumes:
  pg_data:
  redis_data:
  minio_data:
```

### 5.2 启动服务

```bash
docker compose up -d
docker compose ps                # 查看状态
docker compose logs -f postgres  # 查看日志
```

### 5.3 验证各服务

```bash
# PostgreSQL
docker exec -it utils-pg psql -U utils -d utils_plane -c "SELECT version();"

# Redis
docker exec -it utils-redis redis-cli ping
# 期望: PONG

# MinIO
# 浏览器访问 http://localhost:9001
# 登录：minioadmin / minioadmin
# 应看到 uploads bucket 已创建
```

### 5.4 创建 .env.example

`<repo-root>/.env.example`:
```env
# Database
DATABASE_URL=postgresql://utils:utils@localhost:5432/utils_plane

# Redis
REDIS_URL=redis://localhost:6379

# MinIO (S3 兼容)
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=uploads
S3_FORCE_PATH_STYLE=true     # MinIO 必需

# Better-Auth (在 06 任务配置)
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000

# OAuth (可选)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_S3_PUBLIC_URL=http://localhost:9000

# Backend
PORT=3001
CORS_ORIGIN=http://localhost:3000
NODE_ENV=development
```

### 5.5 添加 .gitignore

确保以下条目存在：
```
.env
.env.local
.env.*.local
```

### 5.6 提供启停脚本（可选）

`<repo-root>/package.json` 根 scripts：
```json
{
  "scripts": {
    "services:up": "docker compose up -d",
    "services:down": "docker compose down",
    "services:reset": "docker compose down -v && docker compose up -d",
    "services:logs": "docker compose logs -f"
  }
}
```

## 验收标准

- [ ] `docker compose up -d` 三个服务全部 healthy
- [ ] PostgreSQL 能用 `psql` 连接
- [ ] Redis 返回 PONG
- [ ] MinIO Console 可访问，uploads bucket 已创建
- [ ] `.env.example` 已创建
- [ ] `docker compose down -v` 能彻底清理

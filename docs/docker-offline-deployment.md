# Docker 离线部署与保留数据更新指南

本文档用于服务器已经采用 `utils-plane-offline-all.tar` 和 `docker-compose.prod.yml` 部署 Utils-Plane 后，后续更新镜像、配置字段和数据库结构时使用。

核心原则：**更新镜像和配置，不删除 volume，不重建数据库卷**。PostgreSQL、Redis、MinIO 的历史数据都在 Docker volume 中，正常 `docker load`、`docker compose up -d`、`--force-recreate api web` 不会清空历史数据。

## 相关文件

本地生成并上传：

- `utils-plane-offline-all.tar`：离线镜像总包，包含 `utils-plane:all`、PostgreSQL、Redis、MinIO、MinIO mc。
- `docker-compose.prod.yml`：服务器 compose 配置。
- `.env.prod`：生产环境变量，包含域名、认证、SMTP、S3 等敏感配置，不提交 Git。

服务器建议目录：

```bash
/opt/utils-plane
├── docker-compose.prod.yml
├── .env.prod
└── utils-plane-offline-all.tar
```

生产 compose 默认端口：

| 服务          | 外部端口 | 容器端口 |
| ------------- | -------- | -------- |
| Web           | 5005     | 3000     |
| API           | 5006     | 3001     |
| PostgreSQL    | 5007     | 5432     |
| Redis         | 5008     | 6379     |
| MinIO API     | 5009     | 9000     |
| MinIO Console | 5010     | 9001     |

## 本地打包

在本地项目根目录执行：

```bash
bun run docker:package:offline
```

生成：

```bash
utils-plane-offline-all.tar
```

如果 Docker 构建过程中 Debian apt 源临时失败，但本机已有确认最新的 `utils-plane:all` 镜像，可以只重新导出离线包：

```bash
docker save utils-plane:all postgres:16-alpine redis:7-alpine minio/minio:latest minio/mc:latest -o utils-plane-offline-all.tar
```

导出后建议本地验证：

```bash
docker load -i utils-plane-offline-all.tar
docker images | grep utils-plane
```

## 上传到服务器

```bash
scp utils-plane-offline-all.tar user@server:/opt/utils-plane/
scp docker-compose.prod.yml user@server:/opt/utils-plane/
scp .env.prod user@server:/opt/utils-plane/
```

如果本次只更新应用镜像，不更新 compose 或环境变量，可以只上传 `utils-plane-offline-all.tar`。

如果本次只更新 `.env.prod` 或 `docker-compose.prod.yml`，可以不重新上传镜像包，但仍需要重建读取这些配置的容器。

## 首次部署

服务器执行：

```bash
cd /opt/utils-plane
docker load -i utils-plane-offline-all.tar
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

查看状态：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api web
```

首次启动会创建以下 volume：

- `utils-plane_pg_data`
- `utils-plane_redis_data`
- `utils-plane_minio_data`

实际 volume 名称可能带当前目录前缀，可用 `docker volume ls` 查看。

## 更新应用镜像

当本地重新打包了 `utils-plane-offline-all.tar` 并上传到服务器后：

```bash
cd /opt/utils-plane

docker load -i utils-plane-offline-all.tar

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate api web

docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api web
```

说明：

- `utils-plane:all` 使用固定 tag，`docker load` 后需要 `--force-recreate api web`，否则旧容器可能继续运行旧镜像。
- 只重建 `api` 和 `web`，不会删除 PostgreSQL、Redis、MinIO 的 volume。
- API 容器启动时会执行 `node apps/api/dist/scripts/migrate.js`，用于增量数据库迁移。

## 更新环境变量字段

当 `.env.prod` 中的字段变更，例如：

- `BETTER_AUTH_URL`
- `CORS_ORIGIN`
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_S3_PUBLIC_URL`
- `REQUIRE_EMAIL_VERIFICATION`
- `NEXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION`
- `SMTP_*`
- `S3_*`

上传新的 `.env.prod` 后执行：

```bash
cd /opt/utils-plane

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate api web

docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api web
```

说明：

- 环境变量是在容器创建时注入的，修改 `.env.prod` 后必须重建相关容器才会生效。
- Web 里以 `NEXT_PUBLIC_` 开头的变量有一部分在构建时写入前端包；如果这类值在 Dockerfile 构建参数中已经固化，仅改服务器 `.env.prod` 可能不够，需要本地重新打包镜像后再上传。

## 更新 docker-compose.prod.yml 字段

当 `docker-compose.prod.yml` 中的字段变更，例如：

- 端口映射
- service `environment`
- `command`
- `depends_on`
- volume 挂载
- restart 策略

上传新的 `docker-compose.prod.yml` 后执行：

```bash
cd /opt/utils-plane

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

如果变更影响 `api` 或 `web`，建议明确重建：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate api web
```

如果变更影响数据库、Redis、MinIO 的环境变量或 volume，请先备份数据，再评估是否需要停机维护。不要为了让配置生效而删除 volume。

## 数据库结构更新

项目的 API 容器启动命令包含：

```bash
node apps/api/dist/scripts/migrate.js && node apps/api/dist/main.js
```

因此更新 `api` 容器时会自动执行 migration。migration 应只做增量结构变更，不应清空历史数据。

推荐更新前备份数据库：

```bash
cd /opt/utils-plane

docker exec utils-pg-prod pg_dump -U utils -d utils_plane > backup_$(date +%Y%m%d_%H%M%S).sql
```

如需恢复备份，先确认目标数据库状态，再执行恢复命令。恢复属于高风险操作，不要在未确认备份文件和目标环境前直接覆盖生产库。

## 保留历史数据的安全更新顺序

常规更新推荐：

```bash
cd /opt/utils-plane

# 1. 备份数据库
docker exec utils-pg-prod pg_dump -U utils -d utils_plane > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. 加载新离线镜像包
docker load -i utils-plane-offline-all.tar

# 3. 重建应用容器
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate api web

# 4. 查看状态和日志
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api web
```

如果本次同时更新 `.env.prod` 和 `docker-compose.prod.yml`，先上传文件，再执行同一套命令。

## 禁止操作

以下命令会删除或可能删除历史数据，生产更新时不要执行：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod down -v
docker compose down -v
docker volume rm ...
docker system prune --volumes
```

以下操作也需要谨慎：

- 修改 PostgreSQL、Redis、MinIO 的 volume 名称或挂载路径。
- 修改 `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB` 后直接复用旧 volume。
- 删除 `/opt/utils-plane` 下的备份文件前未确认已有异地备份。

## 常用排查命令

查看服务：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

查看 Web/API 日志：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api web
```

查看数据库日志：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f postgres
```

确认当前镜像：

```bash
docker images | grep utils-plane
```

确认 volume：

```bash
docker volume ls | grep utils
```

进入 API 容器：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api sh
```

## 回滚思路

如果新镜像启动失败：

1. 保留当前 volume，不执行 `down -v`。
2. 重新 `docker load` 上一个可用的 `utils-plane-offline-all.tar`。
3. 执行 `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate api web`。
4. 查看 `api web` 日志确认服务恢复。

数据库 migration 如果已经执行，回滚需要结合备份和 migration 内容判断。上线前备份数据库是最稳妥的保护。

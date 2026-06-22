---
name: debugging-offline-docker-deployments
description: Use when troubleshooting self-hosted or intranet Docker deployments, especially offline tar packages, Docker Compose services, Next.js standalone assets, Bun vs Node runtime errors, build-time NEXT_PUBLIC variables, missing database migrations, or server logs from Linux Docker environments.
---

# Debugging Offline Docker Deployments

## 概览

把内网离线 Docker 部署问题当成“镜像来源”和“运行契约”问题处理。改代码前，先判断故障值或缺失文件来自构建阶段、镜像内容、compose 命令、运行时环境变量、volume 状态，还是浏览器缓存。

## 排查顺序

1. 先读第一段真实异常栈，不要被重复重启日志带偏。
2. 确认服务器运行的是预期镜像和配置：
   ```bash
   docker images <image> --format '{{.ID}} {{.CreatedAt}}'
   grep -n "command:" docker-compose.prod.yml
   docker compose -f docker-compose.prod.yml --env-file .env.prod config
   ```
3. 确认上传后已经重新加载镜像：
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod down
   docker load -i <offline-package>.tar
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate
   ```
4. 按服务查看日志：
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api web
   ```
5. 从容器外验证入口：
   ```bash
   curl -i http://<host>:<web-port>/
   curl -i http://<host>:<api-port>/health
   ```

## 症状对照

| 症状 | 常见原因 | 检查方式 | 修复模式 |
|---|---|---|---|
| `Node.js v22` 下报 `Cannot find module '/app/bun'` | Compose 还在执行 `bun ...`，但镜像运行层已经是 Node | `grep -n "command:" docker-compose.prod.yml` | 把命令改成 `node ...`，上传 compose 文件并重建容器 |
| Bun 下报 `EISDIR reading .../compression` 或 `ENOENT reading /app/node_modules/next` | Linux 镜像里 Bun runtime 对依赖或软链接解析不稳定 | 日志里出现 `Bun v...` | Bun 只用于安装和构建，生产运行层改用 Node 镜像 |
| `Directory import ... packages/db/src/schema is not supported` | 运行时 workspace package 解析到了 TS 源码入口 | 检查镜像内 package exports | 复制编译后的 package 产物，并把 package exports 指向运行时 JS |
| `/_next/static/... 404`，CSS/JS/字体缺失 | Next standalone 静态资源复制位置错误 | `server.js` 在 `/app`，检查 `.next/static` 和 `public` | 复制到 `/app/.next/static` 和 `/app/public`，不要放到源码目录 |
| 浏览器生产环境仍请求 `localhost:3001` | `NEXT_PUBLIC_*` 在 Next build 阶段没有注入 | 搜索构建后的 chunks，不只看 `.env.prod` | Docker build 时传 `--build-arg NEXT_PUBLIC_API_URL=...` 并重新构建镜像 |
| `relation "user" does not exist` | 数据库 volume 没有执行迁移 | API 日志里出现 Postgres `42P01` | 把迁移文件复制进镜像，API 启动前先执行 migration |
| 上传后服务器还是旧行为 | 仍在用旧镜像或旧 compose 文件 | 对比 image ID 和 compose command | 同时上传 `.tar` 和 compose/env 改动，执行 `docker load` 和 `up --force-recreate` |

## 实现模式

### Bun Build, Node Runtime

如果仓库依赖 Bun，可以在构建阶段继续使用 Bun 安装和构建；但 Linux 生产镜像日志出现 Bun 解析问题时，运行阶段改用 Node。

```dockerfile
FROM oven/bun:1 AS builder
RUN bun install --frozen-lockfile
RUN bun run build

FROM node:22-bookworm-slim AS runner
CMD ["node", "apps/api/dist/main.js"]
```

Web/API 组合镜像中，compose 应显式覆盖命令：

```yaml
api:
  command: ['sh', '-c', 'node apps/api/dist/scripts/migrate.js && node apps/api/dist/main.js']
web:
  command: ['node', 'server.js']
```

### Next.js Standalone Static Assets

复制 `.next/standalone ./` 后，生成的 `server.js` 通常以复制目标目录为启动目录。静态资源必须放在这个 server 旁边：

```dockerfile
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/public ./public
COPY --from=builder /app/apps/web/.next/static ./.next/static
```

从 HTML 中提取真实资源路径并请求验证：

```bash
curl -I http://localhost:5005/_next/static/chunks/main-app-*.js
curl -I http://localhost:5005/manifest.json
```

### Build-Time Public Env

Next.js 浏览器变量会被编译进 JS。镜像已经构建后，`docker compose --env-file` 不能再改变浏览器端的 `NEXT_PUBLIC_API_URL`。

```dockerfile
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN bun run build --filter=@scope/web
```

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_URL=http://server:5006 \
  --build-arg NEXT_PUBLIC_S3_PUBLIC_URL=http://server:5009 \
  -t app:all .
```

构建后搜索产物。source map 里可能仍有 fallback 字符串；真正运行的压缩 chunk 比 `.js.map` 更重要。

### 数据库迁移

不要假设新的生产 volume 已经有表。如果应用使用 Drizzle migrations，把迁移文件放进镜像，并在 API 启动前执行一次。

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
await migrate(drizzle(client), { migrationsFolder: '/app/packages/db/drizzle' });
await client.end();
```

迁移命令必须是幂等的。生产普通发包不要使用 `down -v`，除非明确要删除数据库、Redis 和对象存储 volume。

## 离线包规则

- `docker save app:all postgres:... redis:... minio/... -o offline.tar` 会把这些镜像的 layer 一起打包。
- 端口映射不在镜像 tar 里，而是在 `docker-compose.prod.yml` 或 `docker run -p` 里。
- 只要命令、端口、环境变量名或服务依赖有变化，就必须上传匹配的 compose 文件。
- 宿主机 Node/Bun 版本不影响容器；运行时由镜像 base layer 决定。

## 验证清单

声明部署修复前，必须确认：

- [ ] `docker compose ps` 显示 API 和 Web 是 `Up`，不是 restarting。
- [ ] 需要迁移时，API 日志里有 migration success。
- [ ] `GET /health` 返回 200。
- [ ] Web 页面返回 200。
- [ ] 页面引用的 CSS/JS/font/manifest 资源返回 200。
- [ ] 浏览器 bundle 使用生产 API 地址，而不是 localhost。
- [ ] 启动后数据库表存在。
- [ ] 普通发版说明里明确禁止使用 `docker compose down -v`。

## 常见错误

- 镜像已经构建后，以为只改 `.env.prod` 就能改变 `NEXT_PUBLIC_*`。
- 上传了新 tar，但忘记上传变更后的 compose 文件。
- 排查 command 变化时，只执行 `docker compose up -d`，没有加 `--force-recreate`。
- 只检查 source map，把 fallback 字符串误认为实际运行代码。
- 发版时删除 volume，之后把数据丢失归因于 migration。
- 以为单个应用镜像会包含 Postgres/Redis/MinIO 运行镜像；离线服务器需要把这些镜像也一起 `docker save`。

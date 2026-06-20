# Utils-Plane 工具平台

Utils-Plane 是一个基于 Monorepo 的文件处理工具平台，支持图片、PDF、字体、文件管理和异步任务处理。项目包含 Next.js 前端、NestJS API、PostgreSQL、Redis、MinIO 和 BullMQ 队列。

## 技术栈

| 层级         | 技术                                                       |
| ------------ | ---------------------------------------------------------- |
| Runtime      | Bun 1.3.13                                                 |
| Monorepo     | Turborepo + Bun Workspace                                  |
| Web          | Next.js 14 App Router、React 18、Tailwind CSS 4、next-intl |
| API          | NestJS 11、Swagger/OpenAPI、Better-Auth                    |
| Database     | PostgreSQL 16、Drizzle ORM                                 |
| Queue/Cache  | Redis 7、BullMQ                                            |
| Storage      | MinIO (S3 兼容)                                            |
| Client Types | openapi-fetch、openapi-typescript                          |

## 功能概览

### 图片工具

- 图片压缩
- 图片格式转换
- 批量处理与 zip 下载
- 压缩前后对比

### PDF 工具

- 合并、拆分、重排、旋转
- 图片转 PDF、PDF 转图片
- PDF 转文本/Markdown
- 元数据编辑
- 加密、水印、压缩

### 字体工具

- TTF、OTF、WOFF、WOFF2 转换
- 字体预览

### 文件与任务

- 文件上传、签名下载、列表、搜索、回收站、批量操作
- 异步任务历史、进度、失败原因和恢复建议
- 匿名文件 24 小时过期，登录用户文件归入账号

## 项目结构

```text
utils-plane/
├── apps/
│   ├── web/                    # Next.js 前端 (http://localhost:3000)
│   │   └── src/
│   │       ├── app/            # App Router 页面
│   │       ├── components/     # UI、布局、工具组件
│   │       ├── hooks/          # API hooks
│   │       ├── i18n/           # 多语言路由
│   │       └── lib/            # API、auth、processing、tool metadata
│   └── api/                    # NestJS API (http://localhost:3001)
│       └── src/
│           ├── common/         # guards, filters, middleware, errors
│           ├── config/         # BullMQ, throttle
│           ├── modules/        # auth, files, tasks, health
│           └── main.ts
├── packages/
│   ├── api-client/             # OpenAPI schema + typed client
│   ├── auth/                   # Better-Auth config
│   ├── db/                     # Drizzle schema + migrations
│   ├── utils/                  # shared utilities
│   └── validators/             # Zod schemas
├── docs/                       # 设计审计和实现规格
├── task/                       # phase1-phase8 任务文档
├── docker-compose.yml
├── package.json
└── turbo.json
```

## 快速开始

### 环境要求

- Bun 1.3+
- Docker & Docker Compose
- Git

### 安装依赖

```bash
bun install
```

### 启动基础服务

```bash
bun run services:up
docker compose ps
```

### 配置环境变量

```bash
cp .env.example .env.local
```

必要时修改 `.env.local`。本地默认 PostgreSQL 端口是 `5433`，API 端口是 `3001`，Web 端口是 `3000`。

访问队列后台 `/admin/queues` 时，需要额外配置：

```env
ADMIN_USER=<admin user>
ADMIN_PASSWORD=<admin password>
```

### 启动开发服务

```bash
bun run dev
```

或分别启动：

```bash
cd apps/api && bun run dev
cd apps/web && bun run dev
```

## 本地服务地址

| 服务            | 地址                               |
| --------------- | ---------------------------------- |
| Web             | http://localhost:3000              |
| API             | http://localhost:3001              |
| Swagger         | http://localhost:3001/docs         |
| Queue Dashboard | http://localhost:3001/admin/queues |
| PostgreSQL      | localhost:5433                     |
| Redis           | localhost:6379                     |
| MinIO API       | http://localhost:9000              |
| MinIO Console   | http://localhost:9001              |

## Docker 镜像上传服务器部署

项目支持在本地构建 Docker 镜像，导出为 `.tar` 镜像包后上传到自有服务器，再在服务器上直接加载运行，不需要在服务器上重新构建源码。

当前提供两种镜像：

- `utils-plane:all`：Web + API 在同一个容器中运行，暴露 `3000` 和 `3001`。
- `utils-plane-api:latest`：只包含 API，暴露 `3001`。

构建镜像时会通过 Docker BuildKit 的额外 build context 引入本地 Error Tracker SDK，因此本地构建时需要保留 `../error-tracker/packages/sdk` 目录。

### 本地打包镜像

自己执行 Docker 打包时，应用镜像只有两种：

| 应用镜像包            | 打包命令                  | 包含内容                 | 适用场景                                      |
| --------------------- | ------------------------- | ------------------------ | --------------------------------------------- |
| `utils-plane-all.tar` | `bun run docker:package:all` | `utils-plane:all`        | 服务器已有 PostgreSQL、Redis、MinIO，只部署 Web + API |
| `utils-plane-api.tar` | `bun run docker:package:api` | `utils-plane-api:latest` | 服务器已有依赖服务，只部署 API                |

执行命令后会自动构建镜像并导出 `.tar`：

```bash
bun run docker:package:all
bun run docker:package:api
```

另外，内网服务器可以导出一个离线部署总包。它不是第三种应用镜像，而是把 `utils-plane:all` 和 `docker-compose.prod.yml` 依赖的 PostgreSQL、Redis、MinIO 镜像一起打进同一个 `.tar`，方便服务器离线 `docker load`：

```bash
bun run docker:package:offline
```

生成的镜像包只用于本地发布上传，已加入 `.gitignore`，不需要提交到 GitHub：

- `utils-plane-all.tar`
- `utils-plane-api.tar`
- `utils-plane-offline-all.tar`

生产服务器建议使用以下对外端口，避免占用服务器已有的 `5432`、`9000` 等端口：

- Web：`5005 -> 3000`
- API：`5006 -> 3001`
- PostgreSQL：`5007 -> 5432`
- Redis：`5008 -> 6379`
- MinIO API：`5009 -> 9000`
- MinIO Console：`5010 -> 9001`

### 上传到服务器

可以使用 `scp`、SFTP 或服务器面板上传 `.tar` 镜像包和生产环境变量文件。

本地已经使用 `.env.prod` 作为生产环境变量文件。上传前请按服务器域名、数据库、Redis、MinIO 和密钥实际情况检查并修改 `.env.prod`。该文件包含敏感信息，已加入 `.gitignore`，不要提交到 GitHub。

Web + API 组合镜像示例：

```bash
scp utils-plane-all.tar user@server:/opt/utils-plane/
scp .env.prod user@server:/opt/utils-plane/
```

API-only 镜像示例：

```bash
scp utils-plane-api.tar user@server:/opt/utils-plane/
scp .env.prod user@server:/opt/utils-plane/
```

内网服务器使用 compose 部署时，上传离线总包和部署配置：

```bash
scp utils-plane-offline-all.tar user@server:/opt/utils-plane/
scp docker-compose.prod.yml user@server:/opt/utils-plane/
scp .env.prod user@server:/opt/utils-plane/
```

### 服务器加载镜像

```bash
cd /opt/utils-plane
docker load -i utils-plane-all.tar
docker load -i utils-plane-api.tar
```

内网离线总包只需要加载一次：

```bash
cd /opt/utils-plane
docker load -i utils-plane-offline-all.tar
```

### 使用 docker-compose.prod.yml 部署

如果服务器上需要同时启动 PostgreSQL、Redis、MinIO、Web 和 API，可以上传项目里的 `docker-compose.prod.yml` 和 `.env.prod`，然后在服务器执行：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

生产 compose 默认使用以下对外端口：

- Web：`http://202.104.149.204:5005`
- API：`http://202.104.149.204:5006`
- PostgreSQL：`202.104.149.204:5007`
- Redis：`202.104.149.204:5008`
- MinIO API：`http://202.104.149.204:5009`
- MinIO Console：`http://202.104.149.204:5010`

查看服务状态和日志：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f
```

### 运行 Web + API 组合镜像

```bash
docker run -d \
  --name utils-plane-all \
  --restart unless-stopped \
  -p 5005:3000 \
  -p 5006:3001 \
  --env-file .env.prod \
  utils-plane:all
```

### 运行 API-only 镜像

```bash
docker run -d \
  --name utils-plane-api \
  --restart unless-stopped \
  -p 5006:3001 \
  --env-file .env.prod \
  utils-plane-api:latest
```

### 常用服务器命令

```bash
docker ps
docker logs -f utils-plane-all
docker logs -f utils-plane-api
docker stop utils-plane-all
docker stop utils-plane-api
```

API 仍然需要能访问 PostgreSQL、Redis 和 MinIO。请在 `.env.prod` 中配置 `DATABASE_URL`、`REDIS_URL`、`S3_ENDPOINT`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`、`S3_BUCKET`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL` 和 `CORS_ORIGIN` 等变量。

## 常用脚本

```bash
# 开发
bun run dev
bun run build
bun run lint
bun run lint:fix
bun run format
bun run format:check
bun run clean

# Web
bun --cwd apps/web test
bun --cwd apps/web build

# Docker 服务
bun run services:up
bun run services:down
bun run services:reset
bun run services:logs

# 数据库
cd packages/db
bunx drizzle-kit generate
bunx drizzle-kit migrate
bunx drizzle-kit push

# API / Client
cd apps/api && bun run openapi:export
cd packages/api-client && bun run generate
```

## 架构简图

```text
Next.js Web
  ├─ 本地图片处理
  ├─ 工具 UI / 多语言 / PWA
  └─ @utils-plane/api-client
           |
           v
NestJS API
  ├─ AuthModule  -> Better-Auth
  ├─ FilesModule -> MinIO + PostgreSQL
  ├─ TasksModule -> BullMQ processors
  └─ HealthModule
           |
           v
PostgreSQL + Redis + MinIO
```

## 处理策略

- 图片压缩、图片格式转换优先在浏览器本地处理。
- PDF 和字体工具主要走服务端任务队列。
- 匿名用户每分钟 10 次请求，登录用户每分钟 60 次请求。
- 匿名上传单文件上限 10MB，登录用户单文件上限 50MB。
- 匿名文件默认 24 小时过期。

## 开发指南

### 新增 API

1. 在 `apps/api/src/modules/` 添加或扩展 module。
2. 使用 DTO + `class-validator` 定义请求边界。
3. 添加 Swagger 注释。
4. 运行 `cd apps/api && bun run openapi:export`。
5. 必要时运行 `cd packages/api-client && bun run generate`。

### 新增工具页

1. 在 `apps/web/src/lib/tools/tool-metadata.ts` 添加工具元数据。
2. 在 `apps/web/src/app/[locale]/(app)/` 下添加页面。
3. 复用 `ToolPageShell`、`ToolTrustStrip`、`ToolStepRail`、`ResultPanel`、`FailureRecoveryPanel` 等共享组件。
4. 同步维护 `apps/web/messages/zh.json` 和 `apps/web/messages/en.json`。
5. 为关键共享行为补测试。

### 数据库变更

```bash
cd packages/db
bunx drizzle-kit generate
bunx drizzle-kit migrate
```

## 文档

- [PROJECT_SPECS.md](./PROJECT_SPECS.md) - 项目技术规范和当前架构事实
- [AGENTS.md](./AGENTS.md) - 团队开发规范
- [CLAUDE.md](./CLAUDE.md) - AI 开发指南
- [task/](./task/) - phase1-phase8 任务文档

## 当前进度

项目已完成基础 monorepo、认证、数据库、文件模块、任务队列、Web 工具页、文件/任务管理和关键设计原则页面优化。后续开发应以当前代码和 `PROJECT_SPECS.md` 为准，避免引用早期 phase 文档中的过时状态。

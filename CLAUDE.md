# Utils-Plane 项目 AI 开发指南

> 本文件供 Claude Code / AI 助手阅读。完整项目事实见 [PROJECT_SPECS.md](./PROJECT_SPECS.md)，团队规范见 [AGENTS.md](./AGENTS.md)。

## 项目基本信息

- 项目名称：Utils-Plane
- 包管理器：Bun 1.3.13
- Monorepo：Turborepo + Bun Workspace
- 前端：Next.js 14 App Router + React 18 + Tailwind CSS 4
- 后端：NestJS 11 + Bun runtime
- 数据层：PostgreSQL 16 + Drizzle ORM
- 队列/缓存：Redis 7 + BullMQ
- 对象存储：MinIO (S3 兼容)
- 认证：Better-Auth，base path 为 `/api/auth`

## 快速开始

```bash
bun install
bun run services:up
bun run dev
```

常用地址：

| 服务            | 地址                               |
| --------------- | ---------------------------------- |
| Web             | http://localhost:3000              |
| API             | http://localhost:3001              |
| Swagger         | http://localhost:3001/docs         |
| Queue Dashboard | http://localhost:3001/admin/queues |
| MinIO Console   | http://localhost:9001              |

## 环境变量

从模板创建本地环境：

```bash
cp .env.example .env.local
```

关键变量：

```env
DATABASE_URL=postgresql://utils:utils@localhost:5433/utils_plane
REDIS_URL=redis://localhost:6379

S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=uploads
S3_FORCE_PATH_STYLE=true

BETTER_AUTH_SECRET=<通过 openssl rand -base64 32 生成>
BETTER_AUTH_URL=http://localhost:3001

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_S3_PUBLIC_URL=http://localhost:9000
NEXT_PUBLIC_ERROR_TRACKER_DSN=
NEXT_PUBLIC_ERROR_TRACKER_TOKEN=
NEXT_PUBLIC_RELEASE=dev

PORT=3001
CORS_ORIGIN=http://localhost:3000
NODE_ENV=development
ERROR_TRACKER_DSN=
RELEASE=dev

ERROR_TRACKER_API=http://localhost:3002
ERROR_TRACKER_PROJECT_ID=
ERROR_TRACKER_TOKEN=
```

访问队列后台 `/admin/queues` 时，还需要在本地环境中配置：

```env
ADMIN_USER=<admin user>
ADMIN_PASSWORD=<admin password>
```

## 常用命令

```bash
# Docker 服务
bun run services:up
bun run services:down
bun run services:reset
bun run services:logs

# 开发
bun run dev
cd apps/api && bun run dev
cd apps/web && bun run dev

# 测试与构建
bun --cwd apps/web test
bun --cwd apps/web build
bun run build

# 数据库
cd packages/db && bunx drizzle-kit generate
cd packages/db && bunx drizzle-kit migrate
cd packages/db && bunx drizzle-kit push

# API
cd apps/api && bun run openapi:export
cd packages/api-client && bun run generate
```

## 当前程序结构

API 模块：

- `auth` - Better-Auth handler 和 session 集成
- `files` - MinIO 上传、签名下载、文件列表、回收站、批量操作
- `tasks` - 图片/PDF/字体异步处理、BullMQ processors、清理队列
- `health` - 健康检查

前端主要路由：

- `/` - 营销首页和推荐工具入口
- `/dashboard` - 最近文件、任务、失败恢复和快捷工具
- `/image`、`/image/compress`、`/image/convert`
- `/pdf`、`/pdf/merge`、`/pdf/split`、`/pdf/rearrange`、`/pdf/rotate`、`/pdf/from-image`、`/pdf/to-image`、`/pdf/to-text`、`/pdf/metadata`、`/pdf/encrypt`、`/pdf/watermark`、`/pdf/compress`
- `/font`
- `/files`、`/files/trash`
- `/tasks`
- `/settings`
- `/login`、`/register`、`/verify-email`

## 开发约定

- 不要提交 `.env.local`。
- 修改 API 后运行 `cd apps/api && bun run openapi:export`，必要时再运行 `cd packages/api-client && bun run generate`。
- 修改数据库 schema 后运行 `bunx drizzle-kit generate` 和 `bunx drizzle-kit migrate`。
- 前端新增文案必须同时更新中文和英文 message。
- Windows PowerShell 访问 `apps/web/src/app/[locale]/(app)` 等路径时使用 `-LiteralPath` 或 Git literal pathspec。
- 仓库存在历史格式化差异，避免无关全仓格式化；优先只格式化本次触碰的文件。

## 参考文档

- [PROJECT_SPECS.md](./PROJECT_SPECS.md)
- [AGENTS.md](./AGENTS.md)
- [task/](./task/)

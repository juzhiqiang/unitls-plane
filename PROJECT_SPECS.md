# Utils-Plane 项目规范

> 本文档是 `CLAUDE.md`、`AGENTS.md` 和 `README.md` 的共享事实源。

## 项目概述

Utils-Plane 是一个全栈文件处理工具平台，覆盖图片、PDF、字体、文件管理和异步任务管理。前端提供本地优先与服务端处理并存的工具体验，后端负责认证、文件存储、任务队列、处理器和 API 文档。

## 技术栈

| 层级      | 技术                                                       |
| --------- | ---------------------------------------------------------- |
| 包管理器  | Bun 1.3.13                                                 |
| Monorepo  | Turborepo + Bun Workspace                                  |
| 前端      | Next.js 14 App Router、React 18、Tailwind CSS 4、next-intl |
| 后端      | NestJS 11、Bun runtime                                     |
| 认证      | Better-Auth                                                |
| 数据库    | PostgreSQL 16 + Drizzle ORM                                |
| 缓存/队列 | Redis 7 + BullMQ                                           |
| 对象存储  | MinIO (S3 兼容)                                            |
| API 类型  | Swagger/OpenAPI + openapi-fetch                            |
| 监控      | 可选 Error Tracker SDK                                     |

## 项目结构

```text
utils-plane/
├── apps/
│   ├── api/                    # NestJS API, port 3001
│   │   └── src/
│   │       ├── common/         # guards, filters, middleware, errors
│   │       ├── config/         # BullMQ, throttling
│   │       ├── modules/        # auth, files, tasks, health
│   │       └── main.ts
│   └── web/                    # Next.js web, port 3000
│       └── src/
│           ├── app/            # locale-aware App Router pages
│           ├── components/     # UI, layout, tool components
│           ├── hooks/          # API hooks
│           ├── i18n/           # locale routing
│           └── lib/            # API client, auth, processing, tools
├── packages/
│   ├── api-client/             # generated OpenAPI schema + client
│   ├── auth/                   # Better-Auth config and origin helpers
│   ├── db/                     # Drizzle schema, migrations, client
│   ├── utils/                  # shared utilities
│   └── validators/             # Zod schemas
├── docs/                       # audits and generated specs
├── task/                       # phase1-phase8 task docs
├── docker-compose.yml
├── package.json
├── turbo.json
└── tsconfig.json
```

## 环境配置

从模板创建本地环境：

```bash
cp .env.example .env.local
```

`.env.local` 关键变量：

```env
# Database
DATABASE_URL=postgresql://utils:utils@localhost:5433/utils_plane

# Redis
REDIS_URL=redis://localhost:6379

# MinIO
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=uploads
S3_FORCE_PATH_STYLE=true

# Better-Auth
BETTER_AUTH_SECRET=<通过 openssl rand -base64 32 生成>
BETTER_AUTH_URL=http://localhost:3001

# OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_S3_PUBLIC_URL=http://localhost:9000
NEXT_PUBLIC_ERROR_TRACKER_DSN=
NEXT_PUBLIC_ERROR_TRACKER_TOKEN=
NEXT_PUBLIC_RELEASE=dev

# Backend
PORT=3001
CORS_ORIGIN=http://localhost:3000
NODE_ENV=development
ERROR_TRACKER_DSN=
RELEASE=dev

# Error Tracker sourcemap upload
ERROR_TRACKER_API=http://localhost:3002
ERROR_TRACKER_PROJECT_ID=
ERROR_TRACKER_TOKEN=
```

访问队列后台 `/admin/queues` 还需要：

```env
ADMIN_USER=<admin user>
ADMIN_PASSWORD=<admin password>
```

## 本地服务

```bash
bun run services:up
docker compose ps
```

| 服务            | 地址                               |
| --------------- | ---------------------------------- |
| Web             | http://localhost:3000              |
| API             | http://localhost:3001              |
| Swagger UI      | http://localhost:3001/docs         |
| Queue Dashboard | http://localhost:3001/admin/queues |
| PostgreSQL      | localhost:5433                     |
| Redis           | localhost:6379                     |
| MinIO API       | http://localhost:9000              |
| MinIO Console   | http://localhost:9001              |

## 常用命令

```bash
# 安装依赖
bun install

# 开发
bun run dev
cd apps/api && bun run dev
cd apps/web && bun run dev

# 测试/构建
bun --cwd apps/web test
bun --cwd apps/web build
bun run build

# Lint/Format
bun run lint
bun run lint:fix
bun run format
bun run format:check

# Docker
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

## 数据库

### 连接信息

- PostgreSQL: `postgresql://utils:utils@localhost:5433/utils_plane`
- Redis: `redis://localhost:6379`
- 容器名: `utils-pg`, `utils-redis`, `utils-minio`

### 业务表

| 表名    | 说明                                                               |
| ------- | ------------------------------------------------------------------ |
| `files` | 文件记录，包含 MinIO key、mime、大小、过期时间、软删除时间         |
| `tasks` | 异步任务，包含任务类型、状态、输入文件、配置、输出文件、进度、错误 |

### Auth 表

| 表名           | 说明                                           |
| -------------- | ---------------------------------------------- |
| `user`         | 用户，包含 Better-Auth 字段以及 `plan`、`role` |
| `session`      | 会话                                           |
| `account`      | OAuth 或密码账户                               |
| `verification` | 邮箱验证                                       |

### Task 类型

`compress`、`convert`、`pdf_merge`、`pdf_split`、`pdf_to_image`、`pdf_to_text`、`image_to_pdf`、`font_convert`、`pdf_rotate`、`pdf_watermark`、`pdf_encrypt`、`pdf_compress`、`pdf_metadata`、`pdf_rearrange`。

## API 服务

当前 API 模块：

- `auth` - Better-Auth handler 和认证集成。
- `files` - 上传、下载、签名 URL、文件列表、回收站、恢复、永久删除、批量操作。
- `tasks` - 任务创建、查询、图片/PDF/字体处理、cleanup scheduler。
- `health` - 健康检查。

全局能力：

- CORS 使用 `@utils-plane/auth` 的 trusted origin 逻辑。
- `AuthGuard` 和 `CustomThrottlerGuard` 为全局 guard。
- 匿名用户每分钟 10 次请求，登录用户每分钟 60 次请求。
- BullMQ 队列：`image-queue`、`pdf-queue`、`font-queue`、`cleanup-queue`。
- `/admin/queues` 使用 Basic Auth 保护。

## Web 页面与工具

主要页面：

- `/` - 工具优先的营销首页。
- `/dashboard` - 最近文件、任务、失败恢复、快捷工具。
- `/image` - 图片工具入口。
- `/pdf` - PDF 工具入口。
- `/font` - 字体转换工具。
- `/files`、`/files/trash` - 文件管理和回收站。
- `/tasks` - 任务历史和任务详情。
- `/settings` - 用户设置。
- `/login`、`/register`、`/verify-email` - 认证页面。

工具清单：

- 图片：压缩、格式转换、批量压缩/打包、压缩前后对比。
- PDF：合并、拆分、重排、旋转、图片转 PDF、PDF 转图片、PDF 转文本/Markdown、元数据、加密、水印、压缩。
- 字体：TTF/OTF/WOFF/WOFF2 转换。

## 文件与任务策略

- 匿名上传单文件上限 10MB，登录用户单文件上限 50MB。
- 匿名文件默认 24 小时过期，登录用户文件归入账号文件。
- 图片压缩和图片格式转换支持浏览器本地处理；PDF 和字体工具主要走服务端任务。
- 任务状态：`pending`、`processing`、`completed`、`failed`。
- 文件支持软删除、恢复、永久删除和清空回收站。

## 包依赖关系

```text
@utils-plane/api
├── @utils-plane/auth
├── @utils-plane/db
├── @utils-plane/validators
└── better-auth

@utils-plane/web
├── @utils-plane/api-client
├── @utils-plane/auth
└── next-intl / react-query / tool processing libs

@utils-plane/auth
└── @utils-plane/db

@utils-plane/db
├── drizzle-orm
└── postgres
```

## 代码规范

| 类型       | 规则           | 示例               |
| ---------- | -------------- | ------------------ |
| React 组件 | PascalCase.tsx | `UserProfile.tsx`  |
| 工具函数   | camelCase.ts   | `formatDate.ts`    |
| DTO/验证   | \*.dto.ts      | `CreateUserDto.ts` |
| 类型定义   | \*.type.ts     | `api.response.ts`  |

Git 提交前缀：

```text
feat, fix, update, refactor, docs, test, chore
```

## 注意事项

1. 不要提交 `.env.local`。
2. 修改 schema 后执行 migration。
3. API 修改后重新导出 OpenAPI，并同步 api-client 类型。
4. 前端新增文案时同时维护中英文。
5. Windows 开发中，包含 `[locale]` 或 `(app)` 的路径需要 literal path。

# Utils-Plane 项目规范

> 本文档是 `CLAUDE.md`、`AGENTS.md` 和 `README.md` 的共享事实源。

## 项目概述

Utils-Plane 是一个全栈文件处理工具平台，覆盖图片、PDF、字体、文件管理和异步任务管理。前端提供本地优先与服务端处理并存的工具体验，后端负责认证、文件存储、任务队列、处理器和 API 文档。当前已包含长图拼接、GIF/APNG 动图工具、证件照生成、Markdown
/ Word 转 PDF 等面向后续扩展的工具能力。

## 公开公测边界

- 当前产品定位为免费受限公测；登录增强能力包括账号文件管理、任务历史、账号数据导出和注销，不代表付费权益已经上线。
- 服务不提供分析、错误追踪或会话回放，当前不启用遥测。
- 匿名文件保留 24 小时后永久删除；回收站文件保留 30 天后永久删除。
- 账号数据可导出为 ZIP；注销账号会立即永久删除账号及其文件和任务记录，不能恢复。
- `/health/live` 仅检查进程状态和版本信息。`/health/ready`
  检查 PostgreSQL、Redis、MinIO、四个任务队列和 LibreOffice；核心依赖失败返回
  `503`，仅 LibreOffice 缺失时返回 `degraded` 和 `200`。
- 支持邮箱必须是可从公网联系的有效地址，且不能使用 `.local` 域名。组合镜像构建必须传入两个 Docker
  build 参数：`NEXT_PUBLIC_APP_URL` 和
  `NEXT_PUBLIC_SUPPORT_EMAIL`；其中邮箱值来自当前 Shell 环境变量。
- 发布前先停止占用 `3000` 端口的 Web dev server，设置 `NEXT_PUBLIC_SUPPORT_EMAIL`，再运行
  `bun run release:verify`。该命令执行 10 步，覆盖增量格式检查、lint、packages/API/Web 三类测试、OpenAPI 与 client 漂移检查、构建和 7 项 Playwright 测试。
- 当前部署仍存在
  `IP + HTTP`、默认凭据、匿名桶和公开任务状态风险。本次不为匿名文件或任务新增访问令牌，也不改变
  `/tasks/:id/status`。
- HTTPS、支付、Team、存储/每日任务/并发配额和云 CI 不在本次范围内；上述风险未改变前，不得称为安全的公网正式生产版。

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
| 监控      | 无分析、错误追踪、会话回放或其他遥测                       |

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
REQUIRE_EMAIL_VERIFICATION=false
EMAIL_VERIFICATION_CALLBACK_URL=http://localhost:3000/zh/login?verified=1
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

# OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_S3_PUBLIC_URL=http://localhost:9000
NEXT_PUBLIC_SUPPORT_EMAIL=support@example.com
NEXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION=false
NEXT_PUBLIC_RELEASE=dev

# Backend
PORT=3001
CORS_ORIGIN=http://localhost:3000
NODE_ENV=development
RELEASE=dev
BUILD_COMMIT=dev
BUILD_TIME=

# ID photo AI cutout (optional, OpenAI-compatible)
# chat_mask: /v1/chat/completions returns {"mask":"data:image/png;base64,..."}
# image_result: /v1/images/edits uses the uploaded image as a reference
ID_PHOTO_AI_SEGMENTATION_BASE_URL=
ID_PHOTO_AI_SEGMENTATION_API_KEY=
ID_PHOTO_AI_SEGMENTATION_MODEL=gpt-4o-mini
ID_PHOTO_AI_SEGMENTATION_PROVIDER=chat_mask
ID_PHOTO_AI_IMAGE_SIZE=1024x1024
ID_PHOTO_AI_IMAGE_QUALITY=high
ID_PHOTO_AI_IMAGE_BACKGROUND=opaque
ID_PHOTO_AI_RESPONSE_FORMAT=url
```

访问队列后台 `/admin/queues` 还需要：

```env
ADMIN_USER=<admin user>
ADMIN_PASSWORD=<admin password>
```

证件照生成默认使用服务器本地模型。若需要启用页面里的 AI 精修模式，需要配置 OpenAI 兼容接口：

```env
ID_PHOTO_AI_SEGMENTATION_BASE_URL=https://example.com/v1
ID_PHOTO_AI_SEGMENTATION_API_KEY=<api key>
ID_PHOTO_AI_SEGMENTATION_MODEL=<vision model>
ID_PHOTO_AI_SEGMENTATION_PROVIDER=chat_mask
ID_PHOTO_AI_IMAGE_SIZE=1024x1024
ID_PHOTO_AI_IMAGE_QUALITY=high
ID_PHOTO_AI_IMAGE_BACKGROUND=opaque
ID_PHOTO_AI_RESPONSE_FORMAT=url
```

`ID_PHOTO_AI_SEGMENTATION_PROVIDER=chat_mask` 时调用 `/v1/chat/completions`，适合能返回 JSON
mask 的视觉模型；`image_result` 时调用 `/v1/images/edits`，按 OpenAI `images.createEdit`
兼容格式上传参考图并返回最终证件照。

## 本地服务

```bash
bun run services:up
docker compose ps
```

本地 Docker Compose 只管理 PostgreSQL、Redis、MinIO 和 MinIO
bucket 初始化。开发态 API 在宿主机本地启动，执行
`cd apps/api && bun run dev`；前端开发服务也在宿主机本地启动。

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
bun run services:up
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

### 认证流程

- Better-Auth 挂载在 API 的 `/api/auth/*`，前端通过 `NEXT_PUBLIC_API_URL` 访问。
- `REQUIRE_EMAIL_VERIFICATION` 控制邮箱验证；未设置时生产环境默认启用，开发环境默认关闭。
- 启用邮箱验证后，SMTP 变量
  `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM` 必须可用。
- 验证邮件链接使用 API 地址 `/api/auth/verify-email`，验证成功后跳转到
  `EMAIL_VERIFICATION_CALLBACK_URL`；未配置时默认使用允许的 Web origin 并跳到
  `/zh/login?verified=1`。
- 找回密码使用 Better-Auth `/api/auth/request-password-reset` 和
  `/api/auth/reset-password`，复用同一套 SMTP；重置链接先经过 API token 校验，再跳到前端
  `/reset-password?token=...` 页面。
- 已验证邮箱重复注册会返回
  `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`；未验证邮箱重复注册会重新发送验证邮件并返回
  `EMAIL_VERIFICATION_RESENT`。
- 前端通过 `apps/web/src/lib/auth-error.ts` 将 Better-Auth 和后端认证错误码映射到中英文文案。

### Task 类型

`compress`、`convert`、`image_watermark`、`image_id_photo`、`pdf_merge`、`pdf_split`、`pdf_to_image`、`pdf_to_text`、`image_to_pdf`、`font_convert`、`pdf_rotate`、`pdf_watermark`、`pdf_encrypt`、`pdf_compress`、`pdf_metadata`、`pdf_rearrange`、`pdf_from_document`。

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
- 生产 Docker compose 默认暴露 Web `5005`、API `5006`、PostgreSQL `5007`、Redis `5008`、MinIO API
  `5009`、MinIO Console `5010`。

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
- `/login`、`/register`、`/verify-email`、`/forgot-password`、`/reset-password` - 认证页面。

工具清单：

- 图片：压缩、格式转换、水印、长图拼接、GIF/APNG 制作与 GIF 压缩、证件照生成、批量处理、压缩前后对比。
- PDF：合并、拆分、重排、旋转、图片转 PDF、Markdown /
  Word 转 PDF、PDF 转图片、PDF 转文本/Markdown、元数据、加密、水印、压缩。
- 字体：TTF/OTF/WOFF/WOFF2 转换。

## 文件与任务策略

- 匿名上传单文件上限 10MB，登录用户单文件上限 50MB。
- 匿名文件保留 24 小时后永久删除，登录用户文件归入账号文件；回收站文件保留 30 天后永久删除。
- 图片压缩、图片格式转换、长图拼接、GIF/APNG 制作优先支持浏览器本地处理。
- Markdown 转 PDF 支持在线编辑、预览和本地导出；登录后可选择服务端导出。Word/DOCX 转 PDF 走服务端任务。
- 服务端 Markdown / Word 转 PDF 优先使用 LibreOffice；生产组合镜像内置 `libreoffice-writer`
  和 CJK 字体，服务端仍保留 PDF fallback。
- PDF 和字体的重型处理主要走服务端任务。
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
6. 本地核对截图、Playwright 截图和页面视觉对比图统一放在
   `artifacts/screenshots/`；调用截图工具时显式使用
   `artifacts/screenshots/<name>.png`，不要直接散落在项目根目录，该目录不提交到 Git。Playwright
   MCP 的 `.playwright-mcp/` 输出也属于本地验证产物，不提交到 Git。

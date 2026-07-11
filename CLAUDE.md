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
REQUIRE_EMAIL_VERIFICATION=false
EMAIL_VERIFICATION_CALLBACK_URL=http://localhost:3000/zh/login?verified=1
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_S3_PUBLIC_URL=http://localhost:9000
NEXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION=false
NEXT_PUBLIC_ERROR_TRACKER_DSN=
NEXT_PUBLIC_ERROR_TRACKER_TOKEN=
NEXT_PUBLIC_RELEASE=dev

ID_PHOTO_AI_SEGMENTATION_BASE_URL=
ID_PHOTO_AI_SEGMENTATION_API_KEY=
ID_PHOTO_AI_SEGMENTATION_MODEL=gpt-4o-mini
ID_PHOTO_AI_SEGMENTATION_PROVIDER=chat_mask
ID_PHOTO_AI_IMAGE_SIZE=1024x1024
ID_PHOTO_AI_IMAGE_QUALITY=high
ID_PHOTO_AI_IMAGE_BACKGROUND=opaque
ID_PHOTO_AI_RESPONSE_FORMAT=url

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

# Docker 发布包
bun run docker:package:all
bun run docker:package:api
bun run docker:package:offline
```

## 当前程序结构

API 模块：

- `auth` - Better-Auth handler 和 session 集成
- `files` - MinIO 上传、签名下载、文件列表、回收站、批量操作
- `tasks` - 图片/PDF/字体异步处理、BullMQ processors、清理队列、PDF 文档转换
- `health` - 健康检查

前端主要路由：

- `/` - 营销首页和推荐工具入口
- `/dashboard` - 最近文件、任务、失败恢复和快捷工具
- `/image`、`/image/compress`、`/image/convert`、`/image/animation`、`/image/stitch`、`/image/watermark`、`/image/id-photo`
- `/pdf`、`/pdf/merge`、`/pdf/split`、`/pdf/rearrange`、`/pdf/rotate`、`/pdf/from-image`、`/pdf/from-document`、`/pdf/to-image`、`/pdf/to-text`、`/pdf/metadata`、`/pdf/encrypt`、`/pdf/watermark`、`/pdf/compress`
- `/font`
- `/files`、`/files/trash`
- `/tasks`
- `/settings`
- `/login`、`/register`、`/verify-email`、`/forgot-password`、`/reset-password`

当前工具处理边界：

- 图片压缩、格式转换、长图拼接、GIF/APNG 制作优先走浏览器本地处理。
- GIF 制作免费可用；APNG、高级压缩和更高限制按“登录商业版”权益判断，未来收费复用同一层。
- 证件照生成走服务端任务，需要登录；AI 精修依赖 OpenAI 兼容配置。
- Markdown / Word 转 PDF 页面免费进入。Markdown 支持在线编辑、实时预览和本地导出；登录后可选择服务端导出。DOCX 走服务端任务。
- 服务端 Markdown / Word 转 PDF 优先使用 LibreOffice；Docker 组合镜像已安装 `libreoffice-writer` 和 CJK 字体，本地宿主机运行 API 时可安装 LibreOffice 或设置 `LIBREOFFICE_BIN`。
- 当前任务类型包含 `compress`、`convert`、`image_watermark`、`image_id_photo`、`pdf_merge`、`pdf_split`、`pdf_to_image`、`font_convert`、`pdf_to_text`、`image_to_pdf`、`pdf_rotate`、`pdf_watermark`、`pdf_encrypt`、`pdf_compress`、`pdf_metadata`、`pdf_rearrange`、`pdf_from_document`。

## 开发约定

- 项目文档默认使用中文；除非第三方协议、API 名称、代码标识或用户明确要求，新增或更新文档时不要改用英文。
- Git 提交信息必须使用中文描述变更内容；允许保留 `feat`、`fix`、`docs` 等约定式提交前缀和 scope。
- 不要提交 `.env.local`。
- 本地 Docker Compose 只运行 PostgreSQL、Redis、MinIO 等依赖服务；API 开发态在宿主机本地执行 `cd apps/api && bun run dev`，不要放进 Docker 容器运行。
- 修改 API 后运行 `cd apps/api && bun run openapi:export`，必要时再运行 `cd packages/api-client && bun run generate`。
- 修改数据库 schema 后运行 `bunx drizzle-kit generate` 和 `bunx drizzle-kit migrate`。
- 前端新增文案必须同时更新中文和英文 message。
- Windows PowerShell 访问 `apps/web/src/app/[locale]/(app)` 等路径时使用 `-LiteralPath` 或 Git literal pathspec。
- 仓库存在历史格式化差异，避免无关全仓格式化；优先只格式化本次触碰的文件。
- 修改工具清单时同步检查 `apps/web/src/lib/tools/tool-metadata.ts`、`apps/web/messages/zh.json`、`apps/web/messages/en.json`、任务类型和 README/PROJECT_SPECS。
- Docker 组合镜像构建依赖 `../error-tracker/packages/sdk` 额外 build context，并内置 LibreOffice；如果 apt 源临时失败，先确认本地镜像和 tar 产物时间，再决定是否仅重新 `docker save`。

## 参考文档

- [PROJECT_SPECS.md](./PROJECT_SPECS.md)
- [AGENTS.md](./AGENTS.md)
- [task/](./task/)

### 日志文件规范

- 本地运行产生的 `.log` 和 `.err` 文件统一放在项目根目录 `log/` 下；`log/` 不提交到 Git。

# Utils-Plane 项目 AI 开发指南

@AGENTS.md

> 本文件是 Claude Code 的项目入口。公共协作规则以 `AGENTS.md` 为准，项目事实以
> [PROJECT_SPECS.md](./PROJECT_SPECS.md) 为准；本文件只补充 Claude 使用时的快速开始和代码导航。

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
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_S3_PUBLIC_URL=http://localhost:9000
NEXT_PUBLIC_SUPPORT_EMAIL=support@example.com
NEXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION=false
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
RELEASE=dev
BUILD_COMMIT=dev
BUILD_TIME=
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
- `/image`、`/image/compress`、`/image/convert`、`/image/animation`、`/image/stitch`、`/image/watermark`、`/image/id-photo`、`/image/cutout`
- `/pdf`、`/pdf/merge`、`/pdf/split`、`/pdf/rearrange`、`/pdf/rotate`、`/pdf/from-image`、`/pdf/from-document`、`/pdf/to-image`、`/pdf/to-text`、`/pdf/metadata`、`/pdf/encrypt`、`/pdf/watermark`、`/pdf/compress`
- `/font`
- `/files`、`/files/trash`
- `/tasks`
- `/settings`
- `/login`、`/register`、`/verify-email`、`/forgot-password`、`/reset-password`

当前工具处理边界：

- 图片压缩、格式转换、长图拼接、GIF/APNG 制作优先走浏览器本地处理。
- AI 抠图（/image/cutout）全程本地推理，图片不上传；模型资产自托管在 MinIO。
- GIF 制作免费可用；APNG、高级压缩和更高限制属于登录增强能力，当前不涉及付费。
- 证件照生成走服务端任务，需要登录；AI 精修依赖 OpenAI 兼容配置。
- Markdown /
  Word 转 PDF 页面免费进入。Markdown 支持在线编辑、实时预览和本地导出；登录后可选择服务端导出。DOCX 走服务端任务。
- 服务端 Markdown / Word 转 PDF 优先使用 LibreOffice；Docker 组合镜像已安装 `libreoffice-writer`
  和 CJK 字体，本地宿主机运行 API 时可安装 LibreOffice 或设置 `LIBREOFFICE_BIN`。
- 当前任务类型包含
  `compress`、`convert`、`image_watermark`、`image_id_photo`、`pdf_merge`、`pdf_split`、`pdf_to_image`、`font_convert`、`pdf_to_text`、`image_to_pdf`、`pdf_rotate`、`pdf_watermark`、`pdf_encrypt`、`pdf_compress`、`pdf_metadata`、`pdf_rearrange`、`pdf_from_document`。

## 参考文档

- [AGENTS.md](./AGENTS.md) - Codex 与 Claude 共用的公共协作规则
- [PROJECT_SPECS.md](./PROJECT_SPECS.md) - 项目技术规范和当前架构事实
- [README.md](./README.md) - 项目介绍、启动方式和完整文档导航
- [task/](./task/) - phase1-phase8 任务文档

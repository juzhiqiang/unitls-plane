# Utils-Plane 工具平台

Utils-Plane 是一个基于 Monorepo 的文件处理工具平台，支持图片、PDF、字体、文件管理和异步任务处理。项目包含 Next.js 前端、NestJS
API、PostgreSQL、Redis、MinIO 和 BullMQ 队列。

## 文档关系与维护入口

| 文档               | 负责内容                                             | 何时修改                               |
| ------------------ | ---------------------------------------------------- | -------------------------------------- |
| `AGENTS.md`        | Codex 与 Claude 共用的编码、验证、提交和产物管理规则 | 修改公共 AI 协作规则时只改这里         |
| `CLAUDE.md`        | Claude Code 入口、快速开始和代码导航                 | 只补充 Claude 专属导航，不复制公共规则 |
| `PROJECT_SPECS.md` | 当前架构、技术栈、产品边界和部署事实                 | 项目事实发生变化时修改这里             |
| `README.md`        | 面向开发者和部署人员的项目介绍、启动方式和文档导航   | 项目入口或使用流程发生变化时修改       |

Codex 会直接读取 `AGENTS.md`；Claude Code 通过 `CLAUDE.md` 中的 `@AGENTS.md`
导入同一份公共规则。普通 Markdown 链接只用于导航，不会替代规则导入。公共规则与项目事实发生冲突时，以
`AGENTS.md` 的协作规则和 `PROJECT_SPECS.md` 的事实内容为准。

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
- GIF/APNG 制作与压缩
- 长图拼接
- 图片加水印
- 图片旋转、水平/垂直翻转、自动方向校正
- 证件照生成与背景处理
- AI 生图（/image/generate）：文字描述生成图片，或上传参考图做图生图，需要登录，每日限张数。内置提示词模板由服务端下发（`image_generate_presets`
  表 + MinIO `presets` 桶），可动态增删改，后台管理界面待后续。
- 批量处理与 zip 下载
- 压缩前后对比

### PDF 工具

- 合并、拆分、重排、旋转
- 图片转 PDF、PDF 转图片
- Markdown / Word 转 PDF，支持 Markdown 在线编辑、预览和本地导出
- PDF 转文本/Markdown
- 元数据编辑
- 加密、水印、压缩

### 字体工具

- TTF、OTF、WOFF、WOFF2 转换
- 字体预览

### 文件与任务

- 文件上传、签名下载、列表、搜索、回收站、批量操作
- 异步任务历史、进度、失败原因和恢复建议
- 匿名文件保留 24 小时后永久删除，登录用户文件归入账号

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

### 启动后端依赖服务

```bash
bun run services:up
docker compose ps
```

本地 Docker Compose 只启动 PostgreSQL、Redis、MinIO 和 MinIO
bucket 初始化。开发态 API 在宿主机本地启动，执行 `cd apps/api && bun run dev`，不要把 API
dev 服务放进 Docker 容器。

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

证件照生成默认使用服务器本地模型。页面里的 AI 精修模式需要 OpenAI 兼容接口配置：

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

`ID_PHOTO_AI_SEGMENTATION_PROVIDER` 支持两种模式：

- `chat_mask`：调用 `/v1/chat/completions`，要求视觉模型返回
  `{"mask":"data:image/png;base64,..."}`。
- `image_result`：调用 `/v1/images/edits`，按 OpenAI `images.createEdit`
  兼容格式上传参考图并返回最终证件照结果图。

AI 生图使用独立的 OpenAI 兼容配置，与证件照 AI 精修互不影响，并支持配置多个来源：

```env
AI_IMAGE_PROVIDERS='[{"id":"openai","label":"OpenAI","baseUrl":"https://api.openai.com","apiKey":"sk-xxx","model":"gpt-image-1"},{"id":"kmage","label":"KMage","baseUrl":"https://image.dddd.zone","apiKey":"kmage_xxx","model":"gpt-image-2","editTransport":"generations_ref"}]'
```

- `AI_IMAGE_PROVIDERS`：JSON 数组，数组第一项是默认来源。新增兼容 OpenAI 格式的来源只需加一项，不改代码；JSON 或字段不合法时 API 启动失败，不静默降级。
- 每项字段：`id`、`label`（必填，展示名，会下发前端）、`baseUrl`（必填）、`apiKey`（可选）、`model`（默认
  `gpt-image-1`）、`capabilities`（默认 `["generate","edit"]`，只支持文生图写
  `["generate"]`）、`editTransport`（`multipart` 默认 / `generations_ref`）、`refImagesField`（默认
  `reference_images`）、`refImageEncoding`（`data_url` 默认 /
  `base64`）、`responseFormat`（`b64_json` 默认 / `url`）。
- 未配置 `AI_IMAGE_PROVIDERS` 时回退到单来源变量
  `AI_IMAGE_BASE_URL`、`AI_IMAGE_API_KEY`、`AI_IMAGE_MODEL`、`AI_IMAGE_RESPONSE_FORMAT`、`AI_IMAGE_LABEL`，等价于一个
  `id: default` 的来源。两者都没配置时 `/image/generate` 入口仍然可见，生图任务会以
  `AI_IMAGE_NOT_CONFIGURED` 失败，页面提示未配置。
- 尺寸与质量不走 env——由前端选择传入、schema 提供默认。

当前支持文生图（所有来源统一
`POST /v1/images/generations`）与图生图（页面上传一张参考图并可预览）；图生图按来源分支：`multipart`
走 `POST /v1/images/edits`，`generations_ref` 也走 `POST /v1/images/generations` 并把参考图以 data
URL 放进 `reference_images` 数组（`image.dddd.zone`
一类网关没有 edits 端点）。局部重绘尚未实现。页面在配置了多个来源时展示来源选择器，选中的来源随
`inputConfig.providerId` 提交；来源不支持图生图时该模式被禁用。无论来源返回 `b64_json` 还是
`url`，产物都会落到 MinIO，用户拿到的始终是本站文件地址。每日生成张数上限是全局的（不按来源区分），在
`packages/utils/src/entitlements.ts` 的 `LIMITS['image.generate.dailyCount']` 中按 plan 配置。

### 启动前端开发服务

```bash
cd apps/web && bun run dev
```

前端访问本地 API：`http://localhost:3001`。

Markdown / Word 转 PDF 的服务端导出会优先调用 LibreOffice。Docker 组合镜像已安装
`libreoffice-writer`
和 CJK 字体；宿主机本地运行 API 时，如果需要更高保真服务端转换，可安装 LibreOffice 或设置
`LIBREOFFICE_BIN`。Markdown 本地导出不依赖服务端。

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

## 认证与邮箱验证

项目使用 Better-Auth，并在 API 层对邮箱注册做了额外拦截：

- 开发环境默认
  `REQUIRE_EMAIL_VERIFICATION=false`，注册后可直接登录；需要在本地模拟正式流程时，把它改成 `true`
  并配置 SMTP。
- 生产环境默认 `REQUIRE_EMAIL_VERIFICATION=true`，必须通过邮箱验证后才能登录。
- 新邮箱注册时，系统会发送验证邮件；用户点击邮件中的 `/api/auth/verify-email` 链接后，默认跳回
  `/zh/login?verified=1`。
- 登录页提供“忘记密码”入口，用户提交邮箱后会通过同一套 SMTP 发送密码重置邮件；邮件链接先经过
  `/api/auth/reset-password/:token` 校验，再跳回 `/zh/reset-password?token=...` 设置新密码。
- 已验证的邮箱再次注册会返回 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`，前端会显示对应的国际化提示。
- 已存在但未验证的邮箱再次注册不会创建新用户，而是重新发送验证邮件，并返回
  `EMAIL_VERIFICATION_RESENT`。

本地或生产启用邮箱验证、找回密码邮件时，需要配置：

```env
REQUIRE_EMAIL_VERIFICATION=true
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=Utils Plane <no-reply@example.com>
EMAIL_VERIFICATION_CALLBACK_URL=http://localhost:3000/zh/login?verified=1
```

生产环境还要保持以下地址一致：

- `BETTER_AUTH_URL` 指向 API 外部访问地址，例如 `http://202.104.149.204:5006`。
- `CORS_ORIGIN` 指向 Web 外部访问地址，例如 `http://202.104.149.204:5005`。
- `NEXT_PUBLIC_API_URL` 指向 API 外部访问地址。
- `NEXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION=true`，让前端展示邮箱验证相关提示。
- 密码重置复用 SMTP 配置，不需要额外的环境变量。

## Docker 镜像上传服务器部署

项目支持在本地构建 Docker 镜像，导出为 `.tar`
镜像包后上传到自有服务器，再在服务器上直接加载运行，不需要在服务器上重新构建源码。

离线部署、更新镜像、更新 `.env.prod` / `docker-compose.prod.yml` 并保留历史数据的详细流程见
[Docker 离线部署与保留数据更新指南](./docs/docker-offline-deployment.md)。

当前提供两种镜像：

- `utils-plane:all`：Web + API 在同一个容器中运行，暴露 `3000` 和 `3001`。
- `utils-plane-api:latest`：只包含 API，暴露 `3001`。

### 本地打包镜像

自己执行 Docker 打包时，应用镜像只有两种：

| 应用镜像包            | 打包命令                     | 包含内容                 | 适用场景                                              |
| --------------------- | ---------------------------- | ------------------------ | ----------------------------------------------------- |
| `utils-plane-all.tar` | `bun run docker:package:all` | `utils-plane:all`        | 服务器已有 PostgreSQL、Redis、MinIO，只部署 Web + API |
| `utils-plane-api.tar` | `bun run docker:package:api` | `utils-plane-api:latest` | 服务器已有依赖服务，只部署 API                        |

执行命令后会自动构建镜像并导出 `.tar`：

```bash
bun run docker:package:all
bun run docker:package:api
```

另外，内网服务器可以导出一个离线部署总包。它不是第三种应用镜像，而是把 `utils-plane:all` 和
`docker-compose.prod.yml` 依赖的 PostgreSQL、Redis、MinIO 镜像一起打进同一个 `.tar`，方便服务器离线
`docker load`：

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

本地已经使用 `.env.prod`
作为生产环境变量文件。上传前请按服务器域名、数据库、Redis、MinIO 和密钥实际情况检查并修改
`.env.prod`。该文件包含敏感信息，已加入 `.gitignore`，不要提交到 GitHub。

生产 `.env.prod` 至少需要检查：

```env
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://202.104.149.204:5006
CORS_ORIGIN=http://202.104.149.204:5005
NEXT_PUBLIC_API_URL=http://202.104.149.204:5006
NEXT_PUBLIC_S3_PUBLIC_URL=http://202.104.149.204:5009
REQUIRE_EMAIL_VERIFICATION=true
NEXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION=true
EMAIL_VERIFICATION_CALLBACK_URL=http://202.104.149.204:5005/zh/login?verified=1
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=Utils Plane <no-reply@example.com>
RELEASE=prod
BUILD_COMMIT=<git commit SHA>
BUILD_TIME=<UTC ISO 8601 timestamp>
```

`docker run --env-file .env.prod` 必须在 `.env.prod` 中显式提供 `RELEASE`、`BUILD_COMMIT` 和
`BUILD_TIME`，否则 `/health/live` 会回退到开发态版本值。只有 Compose 部署会使用 `prod`、`unknown`
和空字符串默认值。

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

如果服务器上需要同时启动 PostgreSQL、Redis、MinIO、Web 和 API，可以上传项目里的
`docker-compose.prod.yml` 和 `.env.prod`，然后在服务器执行：

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

API 仍然需要能访问 PostgreSQL、Redis 和 MinIO。请在 `.env.prod` 中配置
`DATABASE_URL`、`REDIS_URL`、`S3_ENDPOINT`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`、`S3_BUCKET`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`
和 `CORS_ORIGIN` 等变量。组合镜像内置 LibreOffice 和 CJK 字体，用于 Markdown /
Word 转 PDF 的服务端导出。

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
  ├─ 本地图片处理 / 长图拼接 / GIF 制作
  ├─ Markdown 编辑预览与本地 PDF 导出
  ├─ 工具 UI / 多语言 / PWA
  └─ @utils-plane/api-client
           |
           v
NestJS API
  ├─ AuthModule  -> Better-Auth
  ├─ FilesModule -> MinIO + PostgreSQL
  ├─ TasksModule -> BullMQ processors / PDF 文档转换
  └─ HealthModule
           |
           v
PostgreSQL + Redis + MinIO
```

## 处理策略

- 图片压缩、图片格式转换、长图拼接、GIF/APNG 制作优先在浏览器本地处理。
- Markdown 转 PDF 默认支持本地编辑、预览和浏览器导出；登录后也可选择服务端导出。
- Word/DOCX 转 PDF 走服务端任务队列；Docker 生产镜像内置 LibreOffice，服务端仍保留 PDF fallback。
- PDF 和字体的重型处理主要走服务端任务队列。
- AI 生图走服务端任务队列（独立
  `ai-queue`），必须登录，受每日张数配额限制；产物写入隐式来源标识，不加可见水印。可通过
  `AI_IMAGE_PROVIDERS`
  配置多个 OpenAI 兼容来源，由用户在页面上手动选择，不做自动切换。提示词模板走 DB + MinIO `presets`
  匿名只读桶，通过公开端点 `GET /tasks/image-generate/presets` 按语言下发。
- 匿名用户每分钟 10 次请求，登录用户每分钟 60 次请求。
- 单文件额度为：匿名用户 10MB、普通登录用户 50MB、Pro 100MB、Team 150MB、Private 250MB；显式
  `pro_preview` 账号使用与 Private 相同的顶额权益，普通 `plan: free` 登录账号仍为 50MB。
- 图片压缩的本地和服务端处理共同遵守当前账号的单文件额度，处理位置不会绕过套餐限制。
- 匿名文件保留 24 小时后永久删除，登录用户文件归入账号；回收站文件保留 30 天后永久删除。

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
3. 复用 `ToolPageShell`、`ToolTrustStrip`、`ToolStepRail`、`ResultPanel`、`FailureRecoveryPanel`
   等共享组件。
4. 同步维护 `apps/web/messages/zh.json` 和 `apps/web/messages/en.json`。
5. 为关键共享行为补测试。

### 数据库变更

```bash
cd packages/db
bunx drizzle-kit generate
bunx drizzle-kit migrate
```

## 文档

- [AGENTS.md](./AGENTS.md) - Codex 与 Claude 共用的公共协作规则入口
- [CLAUDE.md](./CLAUDE.md) - Claude Code 专属入口和快速开发导航
- [PROJECT_SPECS.md](./PROJECT_SPECS.md) - 项目技术规范和当前架构事实
- [docs/build-verification.md](./docs/build-verification.md) - 构建验证说明（Windows 开发机 vs
  Linux）
- [task/](./task/) - phase1-phase8 任务文档

## 当前版本与更新日志

当前统一版本为 `v0.5.0`，根包、Web、API 和所有共享包使用同一版本号。面向用户的精选更新日志位于
`/{locale}/changelog`，营销页页脚和登录/注册页版本号均提供入口。日志只记录对用户有意义的新功能、体验改进和问题修复，不逐条复制 Git 提交；新增公开版本时同步维护
`apps/web/messages/zh.json` 与 `apps/web/messages/en.json` 中的
`PublicSite.changelog`。套餐额度公开页位于 `/{locale}/plans`，展示各套餐的单文件上传额度，数据来源于
`packages/utils` 的 `entitlements`。

## 当前进度

项目已完成基础 monorepo、认证、数据库、文件模块、任务队列、Web 工具页、文件/任务管理、图片长图拼接、GIF/APNG 动图工具、Markdown
/ Word 转 PDF 和关键设计原则页面优化。后续开发应以当前代码和 `PROJECT_SPECS.md`
为准，避免引用早期 phase 文档中的过时状态。

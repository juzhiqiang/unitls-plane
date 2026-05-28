# Utils-Plane 工具平台架构设计

> Monorepo + React 19 + NestJS + Bun + 全本地化

> **🎨 UI 设计风格**：**未来感 · 暗黑 · 极简 · 拒绝 AI 通货审美 · 日夜切换**。
> 所有 UI 任务必须遵循 [`design-system.md`](./design-system.md) 并调用 **`frontend-design`** skill 完成视觉方案。

---

## 一、技术选型

### Monorepo 架构

| 类别   | 选型          | 理由                                          |
| ------ | ------------- | --------------------------------------------- |
| 工具   | **Turborepo** | 增量构建、任务编排、缓存最优                  |
| 包管理 | **Bun**       | 内建 workspace 支持、安装速度最快、统一运行时 |

### 前端 (apps/web)

| 类别 | 选型                           | 理由                                |
| ---- | ------------------------------ | ----------------------------------- |
| 框架 | **Next.js 15 (App Router)**    | React 19 原生支持 Server Components |
| UI   | **Tailwind CSS 4 + shadcn/ui** | 高定制性                            |
| 状态 | **Zustand**                    | 轻量                                |
| 部署 | **自托管 (Docker)**            | 灵活、无 vendor lock-in             |

### 后端 (apps/api)

| 类别      | 选型                            | 理由                                 |
| --------- | ------------------------------- | ------------------------------------ |
| 框架      | **NestJS**                      | 模块化、DI、Guards、Swagger 自动生成 |
| 运行时    | **Bun**                         | 启动快 4-5x、原生 TS、内建测试       |
| ORM       | **Drizzle ORM**                 | 轻量、类型安全                       |
| 数据库    | **PostgreSQL 16 (本地 Docker)** | 自托管、零成本、完全可控             |
| 认证      | **Better-Auth**                 | TS 原生、内建 OAuth、Drizzle 适配    |
| 文件存储  | **MinIO (本地 Docker)**         | S3 兼容、自托管、可与 SDK 复用       |
| 任务队列  | **Bull/BullMQ**                 | NestJS 原生集成                      |
| 缓存/限流 | **Redis 7 (本地 Docker)**       | 自托管、零成本                       |
| API 文档  | **Swagger**                     | NestJS 自动生成                      |
| 部署      | **Docker Compose**              | 一键启停、生产可用                   |

### 文件处理引擎

| 功能     | 客户端                    | 服务端                      |
| -------- | ------------------------- | --------------------------- |
| 图片压缩 | browser-image-compression | Sharp                       |
| 图片转换 | Canvas API                | Sharp                       |
| 字体转换 | opentype.js + wawoff2     | fonteditor-core             |
| PDF 预览 | pdfjs-dist                | —                           |
| PDF 操作 | pdf-lib（合并/拆分）      | pdf-lib + @pdfium.js/pdfium |

---

## 二、Monorepo 目录结构

```
utils-plane/
├── apps/
│   ├── web/                        # Next.js 15 前端
│   │   └── src/
│   │       ├── app/
│   │       │   ├── (marketing)/        # 落地页（SEO）
│   │       │   ├── (app)/              # 工具功能页
│   │       │   │   ├── image/
│   │       │   │   ├── pdf/
│   │       │   │   ├── font/
│   │       │   │   └── dashboard/
│   │       │   ├── (auth)/             # 登录/注册
│   │       │   └── api/auth/[...all]/  # Better-Auth handler
│   │       ├── components/
│   │       ├── lib/
│   │       │   ├── auth.ts             # Better-Auth client
│   │       │   ├── api-client.ts       # 后端 API 封装
│   │       │   └── processing/         # 客户端文件处理
│   │       └── hooks/
│   │
│   └── api/                        # NestJS 后端 (Bun)
│       └── src/
│           ├── main.ts
│           ├── app.module.ts
│           ├── common/
│           │   ├── guards/auth.guard.ts
│           │   └── filters/http-exception.filter.ts
│           ├── modules/
│           │   ├── auth/               # Better-Auth handler 路由
│           │   ├── files/              # 文件 + MinIO
│           │   │   ├── files.controller.ts
│           │   │   ├── files.service.ts
│           │   │   └── minio.service.ts
│           │   ├── tasks/              # 任务 + BullMQ
│           │   │   ├── tasks.service.ts
│           │   │   └── processors/
│           │   ├── users/
│           │   └── health/
│           └── config/
│               ├── auth.config.ts      # Better-Auth 配置
│               ├── bull.config.ts
│               └── throttle.config.ts
│
├── packages/
│   ├── db/                         # Drizzle Schema + migrations
│   ├── auth/                       # Better-Auth 配置共享
│   ├── validators/                 # Zod schemas
│   ├── api-client/                 # 类型安全 API 客户端
│   └── utils/                      # 通用工具
│
├── docker-compose.yml              # 本地 PG + Redis + MinIO
├── turbo.json
└── package.json                    # workspaces 字段
```

---

## 三、系统架构图

```
┌─────────────────────────────────────────────────────────┐
│              Next.js 15 (Docker / Vercel)                │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Server Components — 页面渲染、SEO                 │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Client Components — 工具 UI、客户端处理（< 5MB）  │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Better-Auth Client (cookie-based session)        │  │
│  └───────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────┘
                         │ packages/api-client (类型安全)
                         ▼
┌─────────────────────────────────────────────────────────┐
│              NestJS + Bun (Docker)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ Auth Guard  │  │ Throttler   │  │ CORS        │    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Modules: Auth / Files / Tasks / Users / Health │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Services: Sharp, pdf-lib, fonteditor-core      │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Bull/BullMQ Processors                          │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Swagger (自动 API 文档)                          │    │
│  └─────────────────────────────────────────────────┘    │
└──────┬──────────────┬─────────────────┬─────────────────┘
       │              │                  │
       ▼              ▼                  ▼
┌────────────┐  ┌────────────┐  ┌────────────┐
│ PostgreSQL │  │  Redis 7   │  │   MinIO    │
│  16 (Docker│  │  (Docker)  │  │  (Docker)  │
│  Volume)   │  │  限流+队列 │  │ S3 兼容存储│
└────────────┘  └────────────┘  └────────────┘
```

---

## 四、核心功能设计

### 1. 文件处理策略

| 文件大小 | 处理方式       | 优势                         |
| -------- | -------------- | ---------------------------- |
| < 5MB    | **客户端优先** | 即时响应、无需上传、隐私保护 |
| 5-50MB   | **用户选择**   | 客户端省流量 vs 服务端更专业 |
| > 50MB   | **强制服务端** | 浏览器内存限制、稳定性       |

### 2. 任务队列设计 (Bull/BullMQ + 本地 Redis)

```
用户上传文件 → 客户端切片/压缩 →
  ├─ 小文件: 本地处理 → 完成
  └─ 大文件: 上传至 MinIO →
              创建 Bull Job (image/pdf/font queue) →
              Processor 处理 →
              进度上报 (job.progress()) →
              前端轮询状态 →
              处理完成 → 用户下载

队列配置：
- 每种工具独立 Queue：image-queue, pdf-queue, font-queue
- 重试策略：3 次，指数退避 (1s, 4s, 16s)
- 并发控制：每个 Processor 最多 3 个并发 job
- 定时清理：Repeatable Job 每小时清理过期文件
```

### 3. 认证方案 (Better-Auth)

```
- Email/Password 注册 + 邮箱验证
- OAuth: Google, GitHub
- 会话存储：cookie (httpOnly, secure)
- 会话数据：本地 PostgreSQL（与业务数据同库）
- 前端：useSession hook
- 后端：JWT 或 session cookie 验证（Guard 拦截）
```

### 4. Rate Limiting

```
- @nestjs/throttler + 本地 Redis 存储
- 匿名用户：10 次/分钟，单文件 ≤ 10MB
- 登录用户：60 次/分钟，单文件 ≤ 50MB
- 按 IP + User ID 双维度限流
```

### 5. 文件清理策略

```
- 匿名上传：expires_at = created_at + 24h
- 登录用户：永久保存（除非手动删除）
- Bull Repeatable Job：每小时扫描 expires_at < now()
  → 删除 MinIO 对象 + 更新 DB 记录
```

---

## 五、数据模型

```typescript
// packages/db/schema.ts (Drizzle ORM)

// 用户表（Better-Auth 管理）
users: {
  id: text (PK, cuid)
  email: text (UNIQUE, NOT NULL)
  emailVerified: boolean
  name: text
  image: text?
  plan: 'free' | 'pro'              // 业务字段
  role: 'user' | 'admin'
  createdAt: timestamp
  updatedAt: timestamp
}

// Better-Auth 还会自动创建：sessions, accounts, verifications 表

// 文件表
files: {
  id: uuid (PK)
  user_id: text? (FK → users)       // 匿名上传为 null
  filename: string (NOT NULL)
  original_size: bigint
  storage_key: string (NOT NULL)     // MinIO object key
  bucket: string (DEFAULT 'uploads')
  mime_type: string (NOT NULL)
  metadata: jsonb
  expires_at: timestamp?
  deleted_at: timestamp?
  created_at: timestamp
  updated_at: timestamp
}
// INDEX: (user_id, created_at DESC)
// INDEX: (expires_at) WHERE expires_at IS NOT NULL

// 任务表
tasks: {
  id: uuid (PK)
  user_id: text? (FK → users)
  type: 'compress' | 'convert' | 'pdf_merge' | 'pdf_split' | 'font_convert'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  input_file_ids: uuid[]
  input_config: jsonb
  output_file_id: uuid? (FK → files)
  progress: smallint (0-100)
  error_code: string?
  error_message: string?
  retry_count: smallint DEFAULT 0
  created_at: timestamp
  completed_at: timestamp?
}
// INDEX: (user_id, created_at DESC)
// INDEX: (status) WHERE status IN ('pending', 'processing')
```

---

## 六、本地开发环境（docker-compose.yml）

```yaml
services:
  postgres:
    image: postgres:16-alpine
    ports: ['5432:5432']
    environment:
      POSTGRES_USER: utils
      POSTGRES_PASSWORD: utils
      POSTGRES_DB: utils_plane
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U utils']

  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

  minio:
    image: minio/minio:latest
    ports:
      - '9000:9000' # S3 API
      - '9001:9001' # Console
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio_data:/data
    command: server /data --console-address ":9001"

volumes:
  pg_data:
  redis_data:
  minio_data:
```

启停命令：

```bash
docker compose up -d           # 启动
docker compose down            # 停止
docker compose down -v         # 停止并清除数据
```

---

## 七、实施计划

### Phase 1: Monorepo + 基础设施 (2天)

- [ ] 初始化 Turborepo + Bun workspace
- [ ] 配置共享 TypeScript、ESLint、Prettier
- [ ] 创建 packages/db — Drizzle Schema + migration
- [ ] 创建 packages/validators — Zod schemas
- [ ] 配置 docker-compose（PG + Redis + MinIO）
- [ ] 配置 Better-Auth + packages/auth

### Phase 2: 后端服务搭建 (3-4天)

- [ ] 搭建 apps/api（NestJS + Bun）
- [ ] 配置 Swagger
- [ ] 实现 Better-Auth 集成 (Guard + session 校验)
- [ ] 实现文件模块（MinIO SDK）
- [ ] 集成 BullMQ（本地 Redis）
- [ ] 配置 Throttler（本地 Redis）
- [ ] CORS + Exception Filters
- [ ] Dockerfile + docker-compose 集成
- [ ] 生成 packages/api-client

### Phase 3: 前端基础搭建 (2-3天) 🎨 frontend-design

- [ ] 搭建 apps/web（Next.js 15 + Tailwind 4 + shadcn/ui）
- [ ] Layout（侧边栏导航 + 响应式）
- [ ] Better-Auth 前端集成（登录/注册/OAuth）
- [ ] 对接 packages/api-client
- [ ] **遵循 [`design-system.md`](./design-system.md)**

### Phase 4: 图片工具 MVP (3天) 🎨 frontend-design

- [ ] 客户端图片压缩
- [ ] 服务端 Sharp 处理
- [ ] 图片格式转换
- [ ] UI：拖拽 + 配置 + 预览对比
- [ ] 任务进度轮询

### Phase 5: PDF + 字体工具 (4-5天) 🎨 frontend-design

- [ ] PDF 合并/拆分
- [ ] PDF 预览
- [ ] 字体格式转换
- [ ] 字体预览

### Phase 6: 用户功能 + 打磨 (3天) 🎨 frontend-design

- [ ] 文件管理（我的文件 + 回收站）
- [ ] 任务历史 + Bull Board
- [ ] 双主题系统（日夜切换，未来感暗黑极简）
- [ ] 响应式适配审计
- [ ] PWA 配置

### Phase 7: 监控 + 优化 (1-2天)

- [ ] Sentry 错误追踪
- [ ] 性能优化（懒加载、代码分割）
- [ ] 生产 Docker Compose（含反向代理）

### Phase 8: PDF 模块全面扩展 (3-4天)

> 详细任务文件见 `task/phase8/`

- [ ] 00 — Schema / Validators / DTO 扩展（前置，必须先完成）
- [ ] 01 — PDF → Markdown / Text（mupdf + turndown）
- [ ] 02 — 图片 → PDF（pdf-lib embed）
- [ ] 03 — PDF 页面旋转（pdf-lib setRotation）
- [ ] 04 — PDF 加水印（pdf-lib drawText）
- [ ] 05 — PDF 加密（mupdf saveToBuffer）
- [ ] 06 — PDF 压缩（mupdf + pdf-lib 重建）
- [ ] 07 — PDF 元数据编辑（pdf-lib get/set）
- [ ] 08 — PDF 页面重排 / 删除（pdf-lib copyPages）
- [ ] 09 — PDF 首页 UI + 国际化 + 预览组件（收尾）

**总计：21-26天**

---

## 八、技术栈汇总

| 层级      | 技术                              |
| --------- | --------------------------------- |
| Monorepo  | Turborepo + Bun workspaces        |
| 前端框架  | Next.js 15 + React 19             |
| UI        | Tailwind CSS 4 + shadcn/ui        |
| 状态管理  | Zustand                           |
| 后端框架  | NestJS                            |
| 运行时    | Bun                               |
| 数据库    | **PostgreSQL 16（Docker）**       |
| ORM       | Drizzle ORM                       |
| 认证      | **Better-Auth**                   |
| 文件存储  | **MinIO（Docker，S3 兼容）**      |
| 任务队列  | Bull/BullMQ                       |
| 缓存/限流 | **Redis 7（Docker）**             |
| API 文档  | Swagger                           |
| 图片处理  | Sharp + browser-image-compression |
| PDF 处理  | pdf-lib + @pdfium.js/pdfium       |
| 字体处理  | fonteditor-core + opentype.js     |
| 本地开发  | Docker Compose                    |
| 监控      | Sentry + Bull Board               |

---

## 九、关键架构决策记录

### 为什么独立后端而非 Next.js API Routes？

- Serverless 执行时间/内存限制，文件处理易超时/OOM
- 前后端独立扩缩容（文件处理是 CPU 密集型）
- 未来多端复用（移动端、第三方 API）

### 为什么 NestJS 而非 Hono？

- 模块系统适合按工具类型拆分
- Guards/Pipes/Interceptors 比手写中间件更结构化
- Bull/BullMQ 原生集成
- Swagger 自动生成

### 为什么 Bun 而非 Node.js？

- 启动速度快 4-5x
- 原生 TypeScript 支持
- 风险：Sharp 等 native addon 偶有兼容问题

### 为什么全本地化（PG + Redis + MinIO）而非 Supabase？

- 零成本（无 SaaS 费用）
- 完全可控（数据主权、配置自由）
- 一键启停（docker compose up）
- 生产可继续用同套 Docker 部署
- 离线开发友好

### 为什么 Better-Auth 而非 NextAuth/Lucia？

- Lucia 已停止维护，作者推荐 Better-Auth
- TypeScript 原生，类型推断完整
- Drizzle ORM 一等公民支持
- 内建 OAuth、邮箱验证、2FA、组织、impersonation
- NestJS/Next.js 双端友好

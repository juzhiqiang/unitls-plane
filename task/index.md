# Utils-Plane 工具平台架构设计

> Monorepo + React 19 + NestJS + Bun

---

## 一、技术选型

### Monorepo 架构

| 类别 | 选型 | 理由 |
|------|------|------|
| 工具 | **Turborepo** | 增量构建、任务编排、缓存最优 |
| 包管理 | **Bun** | 内建 workspace 支持、安装速度最快、统一运行时 |

### 前端 (apps/web)

| 类别 | 选型 | 理由 |
|------|------|------|
| 框架 | **Next.js 15 (App Router)** | React 19 原生支持 Server Components |
| UI | **Tailwind CSS 4 + shadcn/ui** | 高定制性 |
| 状态 | **Zustand** | 轻量 |
| 部署 | **Vercel** | Next.js 原生支持 |

### 后端 (apps/api)

| 类别 | 选型 | 理由 |
|------|------|------|
| 框架 | **NestJS** | 模块化、DI、Guards、Swagger 自动生成 |
| 运行时 | **Bun** | 启动快 4-5x、原生 TS、内建测试 |
| ORM | **Drizzle ORM** | 轻量、类型安全 |
| 数据库 | **PostgreSQL (Supabase)** | 免费 tier + 存储 |
| 认证 | **Supabase Auth** | OAuth 支持 |
| 文件存储 | **Supabase Storage** | S3 兼容、CDN 加速 |
| 任务队列 | **Bull/BullMQ** | NestJS 原生集成、自托管 Redis |
| 缓存/限流 | **Upstash Redis** | Serverless Redis、免费 tier |
| API 文档 | **Swagger** | NestJS 自动生成 |
| 部署 | **Railway** | 长驻进程、Docker 支持、无执行时间限制 |

### 文件处理引擎

| 功能 | 客户端 | 服务端 |
|------|--------|--------|
| 图片压缩 | browser-image-compression | Sharp |
| 图片转换 | Canvas API | Sharp |
| 字体转换 | opentype.js + wawoff2 | fonteditor-core |
| PDF 预览 | pdfjs-dist | — |
| PDF 操作 | pdf-lib（合并/拆分） | pdf-lib + @pdfium.js/pdfium |

---

## 二、Monorepo 目录结构

```
utils-plane/
├── apps/
│   ├── web/                        # Next.js 15 前端 (Vercel)
│   │   └── src/
│   │       ├── app/
│   │       │   ├── (marketing)/        # 落地页（SEO）
│   │       │   ├── (app)/              # 工具功能页
│   │       │   │   ├── image/
│   │       │   │   ├── pdf/
│   │       │   │   ├── font/
│   │       │   │   └── dashboard/
│   │       │   └── api/auth/           # Auth callback
│   │       ├── components/
│   │       │   ├── ui/                 # shadcn 组件
│   │       │   ├── tools/              # 工具专用组件
│   │       │   └── layout/
│   │       ├── lib/
│   │       │   ├── supabase.ts         # Supabase 客户端
│   │       │   ├── api-client.ts       # 后端 API 封装
│   │       │   └── processing/         # 客户端文件处理
│   │       └── hooks/
│   │
│   └── api/                        # NestJS 后端 (Bun, Railway)
│       └── src/
│           ├── main.ts                 # Bun 入口
│           ├── app.module.ts           # 根模块
│           ├── common/
│           │   ├── guards/auth.guard.ts
│           │   ├── interceptors/
│           │   └── filters/http-exception.filter.ts
│           ├── modules/
│           │   ├── files/              # 文件模块
│           │   │   ├── files.module.ts
│           │   │   ├── files.controller.ts
│           │   │   ├── files.service.ts
│           │   │   └── dto/
│           │   ├── tasks/              # 任务模块
│           │   │   ├── tasks.module.ts
│           │   │   ├── tasks.controller.ts
│           │   │   ├── tasks.service.ts
│           │   │   └── processors/     # Bull 处理器
│           │   │       ├── image.processor.ts
│           │   │       ├── pdf.processor.ts
│           │   │       └── font.processor.ts
│           │   ├── users/              # 用户模块
│           │   └── health/             # 健康检查
│           └── config/
│               ├── supabase.config.ts
│               ├── bull.config.ts
│               └── throttle.config.ts
│
├── packages/
│   ├── db/                         # Drizzle Schema + migrations
│   ├── validators/                 # Zod schemas（前后端共享）
│   ├── api-client/                 # 类型安全 API 客户端（openapi-fetch）
│   └── utils/                      # 通用工具函数
│
├── turbo.json
└── package.json                # workspaces 字段定义 monorepo 结构
```

---

## 三、系统架构图

```
┌─────────────────────────────────────────────────────────┐
│              Next.js 15 (Vercel)                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Server Components — 页面渲染、SEO、数据预取       │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Client Components — 工具 UI、客户端处理（< 5MB）  │  │
│  └───────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────┘
                         │ packages/api-client (类型安全)
                         ▼
┌─────────────────────────────────────────────────────────┐
│              NestJS + Bun (Railway)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ Auth Guard  │  │ Throttler   │  │ CORS        │    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Modules: Files / Tasks / Users / Health        │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Services: Sharp, pdf-lib, fonteditor-core      │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Bull/BullMQ Processors (异步重计算)             │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Swagger (自动 API 文档)                         │    │
│  └─────────────────────────────────────────────────┘    │
└───────────┬──────────────┬──────────────┬───────────────┘
            │              │              │
            ▼              ▼              ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  Supabase   │  │  Supabase   │  │  Upstash    │
│  Auth       │  │  DB + Store │  │  Redis      │
│  (OAuth)    │  │  (PG + S3)  │  │(限流+队列) │
└─────────────┘  └─────────────┘  └─────────────┘
```

---

## 四、核心功能设计

### 1. 文件处理策略

| 文件大小 | 处理方式 | 优势 |
|----------|----------|------|
| < 5MB | **客户端优先** | 即时响应、无需上传、隐私保护 |
| 5-50MB | **用户选择** | 客户端省流量 vs 服务端更专业压缩 |
| > 50MB | **强制服务端** | 浏览器内存限制、稳定性 |

### 2. 任务队列设计 (Bull/BullMQ)

```
用户上传文件 → 客户端切片/压缩 →
  ├─ 小文件: 本地处理 → 完成
  └─ 大文件: 上传至 Supabase Storage →
              创建 Bull Job (image-queue / pdf-queue / font-queue) →
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

### 3. Rate Limiting

```
- @nestjs/throttler + Upstash Redis 存储
- 匿名用户：10 次/分钟，单文件 ≤ 10MB
- 登录用户：60 次/分钟，单文件 ≤ 50MB
- 按 IP + User ID 双维度限流
```

### 4. 文件清理策略

```
- 匿名上传：expires_at = created_at + 24h
- 登录用户：永久保存（除非手动删除）
- Bull Repeatable Job：每小时扫描 expires_at < now()
  → 删除 Supabase Storage 文件 + 更新 DB 记录
```

---

## 五、数据模型

```typescript
// packages/db/schema.ts (Drizzle ORM)

// 用户表
users: {
  id: uuid (PK)
  email: string (UNIQUE, NOT NULL)
  name: string
  avatar_url: string?
  plan: 'free' | 'pro'              // 预留付费
  created_at: timestamp
  updated_at: timestamp
}

// 文件表
files: {
  id: uuid (PK)
  user_id: uuid? (FK → users)       // 匿名上传为 null
  filename: string (NOT NULL)
  original_size: bigint
  storage_key: string (NOT NULL)     // Supabase Storage 路径
  mime_type: string (NOT NULL)
  metadata: jsonb                    // 图片尺寸、PDF页数等
  expires_at: timestamp?             // 匿名文件过期时间 (24h)
  deleted_at: timestamp?             // 软删除
  created_at: timestamp
  updated_at: timestamp
}
// INDEX: (user_id, created_at DESC)
// INDEX: (expires_at) WHERE expires_at IS NOT NULL

// 任务表
tasks: {
  id: uuid (PK)
  user_id: uuid? (FK → users)
  type: 'compress' | 'convert' | 'pdf_merge' | 'pdf_split' | 'font_convert'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  input_file_ids: uuid[]             // 支持多文件输入（PDF合并等）
  input_config: jsonb                // 处理参数
  output_file_id: uuid? (FK → files)
  progress: smallint (0-100)
  error_code: string?                // 结构化错误码（前端可国际化）
  error_message: string?
  retry_count: smallint DEFAULT 0
  created_at: timestamp
  completed_at: timestamp?
}
// INDEX: (user_id, created_at DESC)
// INDEX: (status) WHERE status IN ('pending', 'processing')
```

---

## 六、实施计划

### Phase 1: Monorepo + 基础设施 (2天)
- [ ] 初始化 Turborepo + Bun workspace
- [ ] 创建 packages/db — Drizzle Schema + migration
- [ ] 创建 packages/validators — Zod schemas
- [ ] 配置共享 TypeScript、ESLint、Prettier
- [ ] 配置 Supabase 项目（Auth + Database + Storage）
- [ ] 配置 Upstash Redis

### Phase 2: 后端服务搭建 (3-4天)
- [ ] 搭建 apps/api（NestJS + Bun）
- [ ] 配置 Swagger（@nestjs/swagger）
- [ ] 实现 Auth Guard（验证 Supabase JWT）
- [ ] 实现文件上传/下载模块（FilesModule）
- [ ] 集成 BullMQ 任务队列（@nestjs/bullmq）
- [ ] 配置 Throttler 限流（@nestjs/throttler）
- [ ] 配置 CORS + Exception Filters
- [ ] 部署到 Railway
- [ ] 生成 packages/api-client（openapi-fetch）

### Phase 3: 前端基础搭建 (2-3天)
- [ ] 搭建 apps/web（Next.js 15 + Tailwind 4 + shadcn/ui）
- [ ] 实现 Layout（侧边栏导航 + 响应式）
- [ ] 集成 Supabase Auth（登录/注册/OAuth）
- [ ] 对接 packages/api-client 调用后端

### Phase 4: 图片工具 MVP (3天)
- [ ] 客户端图片压缩（browser-image-compression）
- [ ] 服务端 Sharp 压缩（image.processor.ts）
- [ ] 图片格式转换（PNG/JPEG/WebP/AVIF）
- [ ] UI：拖拽上传 + 参数配置 + 预览对比
- [ ] 任务进度轮询（Bull progress events）

### Phase 5: PDF + 字体工具 (4-5天)
- [ ] PDF 合并/拆分（pdf-lib）
- [ ] PDF 页面预览（pdfjs-dist）
- [ ] 字体格式转换（TTF/OTF/WOFF/WOFF2）
- [ ] 字体预览

### Phase 6: 用户功能 + 打磨 (3天)
- [ ] 文件管理（我的文件 + 回收站）
- [ ] 任务历史 + Bull Board 集成
- [ ] 暗色模式 + 响应式适配
- [ ] PWA 配置

### Phase 7: 监控 + 优化 (1-2天)
- [ ] Sentry 错误追踪（NestJS + Next.js）
- [ ] Vercel Analytics
- [ ] 性能优化（图片懒加载、代码分割）

**总计：18-22天**

---

## 七、技术栈汇总

| 层级 | 技术 |
|------|------|
| Monorepo | Turborepo + Bun workspaces |
| 前端框架 | Next.js 15 + React 19 |
| UI | Tailwind CSS 4 + shadcn/ui |
| 状态管理 | Zustand |
| 后端框架 | NestJS |
| 运行时 | Bun |
| 数据库 | PostgreSQL (Supabase) |
| ORM | Drizzle ORM |
| 认证 | Supabase Auth |
| 存储 | Supabase Storage |
| 任务队列 | Bull/BullMQ |
| 缓存/限流 | Upstash Redis |
| API 文档 | Swagger (自动生成) |
| 图片处理 | Sharp (服务端) + browser-image-compression (客户端) |
| PDF 处理 | pdf-lib + @pdfium.js/pdfium |
| 字体处理 | fonteditor-core + opentype.js |
| 部署 | Vercel (前端) + Railway (后端) |
| 监控 | Sentry + Bull Board + Vercel Analytics |

---

## 八、关键架构决策记录

### 为什么独立后端而非 Next.js API Routes？
- Serverless 执行时间限制（10s/60s），文件处理易超时
- 内存限制 1024MB，Sharp 处理大图可能 OOM
- 前后端独立扩缩容（文件处理是 CPU 密集型）
- 未来多端复用（移动端、第三方 API）

### 为什么 NestJS 而非 Hono？
- 模块系统适合按工具类型拆分
- Guards/Pipes/Interceptors 比手写中间件更结构化
- Bull/BullMQ 原生集成，无需第三方任务队列服务费
- Swagger 自动生成，API 文档零成本维护

### 为什么 Bun 而非 Node.js？
- 启动速度快 4-5x，开发体验好
- 原生 TypeScript 支持
- 风险：Sharp 等 native addon 偶有兼容问题，备选回退 Node.js

### 为什么 Bull/BullMQ 而非 Inngest？
- NestJS 原生集成（@nestjs/bullmq）
- 自托管 Redis，无额外 SaaS 费用
- 更成熟，社区更大
- Bull Board 提供可视化监控面板

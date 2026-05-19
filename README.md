# Utils-Plane 工具平台

> 基于 Monorepo 架构的现代化文件处理工具平台，支持图片压缩、PDF 操作、字体转换等功能

## 🚀 技术栈与版本

### 核心框架
- **运行时**: Bun 1.3+
- **构建工具**: Turborepo 2.x
- **语言**: TypeScript 5.7+

### 前端 (apps/web)
- **框架**: Next.js 14.x (App Router)
- **UI**: React 18.x + Tailwind CSS 4
- **类型检查**: TypeScript

### 后端 (apps/api)
- **框架**: NestJS 11.x
- **运行时**: Bun
- **ORM**: Drizzle ORM 0.45.x
- **数据库**: PostgreSQL 16 (Docker)
- **认证**: Better-Auth 1.4.x
- **任务队列**: BullMQ 5.x + Redis 7
- **文件存储**: MinIO (S3 兼容)
- **API 文档**: Swagger (NestJS)

### 包 (packages/)
- **db**: Drizzle ORM + postgres
- **auth**: Better-Auth 配置
- **validators**: Zod 3.x
- **api-client**: 类型安全 API 客户端
- **utils**: 通用工具函数

### 开发工具
- **代码检查**: ESLint 10.x + Prettier 3.x
- **容器化**: Docker Compose

## 📁 项目结构

```
utils-plane/
├── apps/
│   ├── web/                    # Next.js 14 前端应用 (Port 3000)
│   │   ├── app/                # App Router 页面
│   │   ├── components/         # React 组件
│   │   └── lib/                # 工具库
│   │
│   └── api/                    # NestJS 11 后端 API (Port 3001)
│       ├── src/
│       │   ├── common/         # 公共模块 (guards, decorators, filters)
│       │   ├── modules/        # 功能模块 (auth, tasks, files)
│       │   ├── config/         # 配置文件
│       │   └── main.ts         # 入口文件
│       └── nest-cli.json
│
├── packages/
│   ├── db/                     # Drizzle ORM Schema + Migrations
│   │   ├── src/
│   │   │   ├── schema/         # 数据库表定义 (files, tasks)
│   │   │   ├── client.ts       # 数据库连接
│   │   │   └── index.ts        # 导出
│   │   ├── drizzle/            # 迁移文件
│   │   └── drizzle.config.ts
│   │
│   ├── auth/                   # Better-Auth 配置
│   │   └── src/
│   │       └── index.ts        # auth 实例导出
│   │
│   ├── validators/             # Zod 数据验证 schemas
│   │   └── src/
│   │       └── index.ts
│   │
│   ├── api-client/             # 类型安全 API 客户端
│   │   └── src/
│   │       └── index.ts
│   │
│   └── utils/                  # 通用工具函数
│       └── src/
│           └── index.ts
│
├── task/                       # 项目任务文档
│   ├── phase1/                 # Phase 1: 基础设施
│   ├── phase2/                 # Phase 2: 后端服务
│   └── ...
│
├── docker-compose.yml          # 本地开发环境
├── turbo.json                  # Turborepo 配置
├── package.json                # Root workspace 配置
└── tsconfig.json               # TypeScript 基础配置
```

## 🛠️ 核心功能

### 文件处理策略

- **< 5MB**: 客户端优先处理（即时响应、隐私保护）
- **5-50MB**: 用户可选择处理方式
- **> 50MB**: 强制服务端处理（稳定性保障）

### 支持的工具类型

- 📸 **图片处理**: 压缩、格式转换、尺寸调整
- 📄 **PDF 操作**: 合并、拆分、预览
- 🔤 **字体转换**: 多种字体格式互转
- 🔄 **任务队列**: 大文件异步处理，实时进度反馈

## 🚦 快速开始

### 环境要求

- **运行时**: Bun 1.3+ (推荐) 或 Node.js 18+
- **容器**: Docker & Docker Compose
- **Git**: 已安装

### 1. 克隆项目

```bash
git clone <repository-url>
cd utils-plane
```

### 2. 安装依赖

```bash
# 使用 Bun (推荐)
bun install

# 或使用 npm
npm install
```

### 3. 启动基础服务

```bash
# 启动 PostgreSQL + Redis + MinIO
bun run services:up

# 查看服务状态
docker compose ps
```

### 4. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env.local

# 编辑 .env.local 配置必要的环境变量
```

### 5. 启动开发服务器

```bash
# 启动所有应用 (Web + API)
bun run dev

# 或分别启动
bun run dev --filter=@utils-plane/web    # 前端 http://localhost:3000
bun run dev --filter=@utils-plane/api    # 后端 http://localhost:3001
```

### 6. 数据库迁移 (首次)

```bash
cd packages/db

# 生成迁移文件
bun run db:generate

# 应用迁移
bun run db:migrate

# 或者直接推送 schema
bun run db:push
```

### 访问服务

| 服务 | 地址 | 说明 |
|------|------|------|
| 前端 | http://localhost:3000 | Next.js 应用 |
| API | http://localhost:3001 | NestJS 后端 |
| API 文档 | http://localhost:3001/docs | Swagger API 文档 |
| MinIO Console | http://localhost:9001 | 文件存储管理 (minioadmin/minioadmin) |
| Queue Dashboard | http://localhost:3001/admin/queues | BullMQ 任务队列管理 |

## 📋 可用脚本

### 开发脚本
```bash
bun run dev              # 启动所有应用的开发模式 (并行)
bun run build            # 构建所有应用
bun run lint             # 代码检查
bun run lint:fix         # 自动修复代码问题
bun run format           # 代码格式化
bun run format:check     # 检查代码格式
bun run clean            # 清理构建产物
```

### 服务管理脚本
```bash
bun run services:up      # 启动基础服务 (PostgreSQL, Redis, MinIO)
bun run services:down    # 停止基础服务
bun run services:reset   # 重置服务数据 (清除 volumes)
bun run services:logs    # 查看服务日志
```

### 数据库脚本 (packages/db)
```bash
cd packages/db
bun run db:generate      # 生成数据库迁移文件
bun run db:migrate       # 应用数据库迁移
bun run db:push          # 推送 schema 到数据库 (开发用)
```

### API 服务脚本 (apps/api)
```bash
cd apps/api
bun run dev              # 启动 API 开发服务器 (热重载)
bun run build            # 构建 API 应用
bun run start            # 生产环境启动
```

## 🏗️ 架构设计

### 系统架构图

```
┌─────────────────────────────────────────────────────────┐
│              Next.js 14 (App Router)                    │
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
                         │ @utils-plane/api-client
                         ▼
┌─────────────────────────────────────────────────────────┐
│              NestJS 11 + Bun Runtime                     │
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
│  │  BullMQ Processors (Redis 7)                     │    │
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

### 数据流设计

```
用户上传文件 → 客户端切片/压缩 →
  ├─ 小文件: 本地处理 → 完成
  └─ 大文件: 上传至 MinIO →
              创建 Bull Job (image/pdf/font queue) →
              Processor 处理 →
              进度上报 (job.progress()) →
              前端轮询状态 →
              处理完成 → 用户下载
```

## 🔐 认证与权限

- **认证方案**: Better-Auth (Email/Password + OAuth)
- **会话管理**: Cookie-based (httpOnly, secure)
- **权限控制**:
  - 匿名用户: 10次/分钟，单文件 ≤ 10MB
  - 登录用户: 60次/分钟，单文件 ≤ 50MB
- **数据清理**: 匿名文件24小时自动清理

## 🔧 开发指南

### 添加新的工具模块

1. 在 `apps/api/src/modules/` 创建新模块
2. 在 `apps/web/src/app/(app)/` 添加前端页面
3. 在 `packages/validators/` 定义数据验证规则
4. 更新 `packages/api-client/` 的类型定义

### 数据库迁移

```bash
# 生成迁移文件
cd packages/db
bun run generate

# 应用迁移
bun run migrate
```

### 环境变量配置

复制 `.env.example` 到 `.env.local` 并配置相应的环境变量：

```bash
cp .env.example .env.local
```

## 📈 开发进度

项目采用分阶段开发模式，详细的开发计划和任务分解请查看 `task/` 目录：

- ✅ **Phase 1**: Monorepo + 基础设施搭建
  - ✅ 01 - Monorepo 初始化 (Turborepo + Bun)
  - ✅ 02 - 共享配置 (TypeScript/ESLint/Prettier)
  - ✅ 03 - 数据库 Drizzle Schema + Migration
  - ✅ 04 - Validators (Zod)
  - ✅ 05 - Docker Services (PostgreSQL + Redis + MinIO)
  - ✅ 06 - Better-Auth 配置

- 🚧 **Phase 2**: 后端服务开发
  - ✅ 01 - NestJS 初始化
  - ✅ 02 - CORS + Exception Filters
  - ✅ 03 - Swagger 自动文档
  - ✅ 04 - Better-Auth Guard + Handler
  - ⏳ 05 - Throttler (Rate Limiting)
  - ⏳ 06 - BullMQ 集成
  - ⏳ 07 - Files Module (MinIO)
  - ⏳ 08 - Tasks Module
  - ⏳ 09 - API Client
  - ⏳ 10 - Docker Deploy

- ⏳ **Phase 3**: 前端基础搭建
- ⏳ **Phase 4**: 图片工具 MVP
- ⏳ **Phase 5**: PDF + 字体工具
- ⏳ **Phase 6**: 用户功能完善
- ⏳ **Phase 7**: 监控与优化

## 🤝 贡献指南

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 🙋‍♂️ 支持

如果您在使用过程中遇到问题，请：

1. 查看 [Issues](../../issues) 中是否有类似问题
2. 创建新的 Issue 描述您的问题
3. 提供详细的错误信息和复现步骤

---

**Utils-Plane** - 让文件处理变得简单高效 🚀

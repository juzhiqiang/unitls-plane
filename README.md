# Utils-Plane 工具平台

> 基于 Monorepo 架构的现代化文件处理工具平台，支持图片压缩、PDF 操作、字体转换等功能

## 🚀 技术栈

- **架构**: Turborepo + Bun Workspaces
- **前端**: Next.js 15 + React 19 + Tailwind CSS 4 + shadcn/ui
- **后端**: NestJS + Bun Runtime
- **数据库**: PostgreSQL 16 + Drizzle ORM
- **认证**: Better-Auth
- **文件存储**: MinIO (S3 兼容)
- **任务队列**: Bull/BullMQ + Redis 7
- **容器化**: Docker Compose

## 📁 项目结构

```
utils-plane/
├── apps/
│   ├── web/                    # Next.js 15 前端应用
│   └── api/                    # NestJS 后端 API
├── packages/
│   ├── db/                     # Drizzle Schema + migrations
│   ├── auth/                   # Better-Auth 配置共享
│   ├── validators/             # Zod schemas
│   ├── api-client/             # 类型安全 API 客户端
│   └── utils/                  # 通用工具函数
├── task/                       # 项目任务和开发计划
├── docker-compose.yml          # 本地开发环境
└── turbo.json                  # Turborepo 配置
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

- Node.js 18+ 或 Bun 1.3+
- Docker & Docker Compose
- Git

### 安装依赖

```bash
# 使用 Bun (推荐)
bun install

# 或使用 npm
npm install
```

### 启动本地服务

```bash
# 启动数据库、Redis、MinIO 等基础服务
bun run services:up

# 启动开发服务器
bun run dev
```

### 访问应用

- 🌐 **前端应用**: http://localhost:3000
- 🔧 **API 文档**: http://localhost:3001/api/docs
- 🗄️ **MinIO 控制台**: http://localhost:9001 (minioadmin/minioadmin)

## 📋 可用脚本

```bash
# 开发
bun run dev              # 启动所有应用的开发模式
bun run build            # 构建所有应用
bun run lint             # 代码检查
bun run clean            # 清理构建产物

# 服务管理
bun run services:up      # 启动基础服务 (PostgreSQL, Redis, MinIO)
bun run services:down    # 停止基础服务
bun run services:reset   # 重置服务数据
bun run services:logs    # 查看服务日志
```

## 🏗️ 架构设计

### 系统架构图

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
- 🚧 **Phase 2**: 后端服务开发
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

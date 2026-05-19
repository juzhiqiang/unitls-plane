# Utils-Plane 项目规范

## 项目概述

Utils-Plane 是一个工具平台，支持文件处理（压缩、转换、PDF 操作、字体转换）等功能的全栈应用。

## 技术栈

- **包管理器**: Bun 1.3.13
- **前端**: Next.js (App Router)
- **后端**: NestJS + Better-Auth
- **数据库**: PostgreSQL + Drizzle ORM
- **缓存/队列**: Redis + BullMQ
- **对象存储**: MinIO (S3 兼容)
- **Monorepo**: Turborepo

## 项目结构

```
utils-plane/
├── apps/
│   ├── api/          # NestJS 后端 API
│   └── web/          # Next.js 前端
├── packages/
│   ├── auth/         # Better-Auth 认证配置
│   ├── db/           # Drizzle ORM Schema
│   ├── utils/        # 工具函数
│   ├── validators/   # Zod 验证器
│   └── api-client/   # API 客户端类型
├── task/             # 任务文档 (phase1-7)
├── docker-compose.yml
└── turbo.json
```

## 环境配置

### 必需的环境变量 (.env.local)

```env
# Database
DATABASE_URL=postgresql://utils:utils@localhost:5432/utils_plane

# Redis
REDIS_URL=redis://localhost:6379

# MinIO
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=uploads

# Better-Auth
BETTER_AUTH_SECRET=<生成>
BETTER_AUTH_URL=http://localhost:3000

# OAuth (可选)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3001

# Backend
PORT=3001
CORS_ORIGIN=http://localhost:3000
NODE_ENV=development
```

### 启动服务

```bash
# 启动 Docker 服务 (PG + Redis + MinIO)
bun run services:up

# 开发模式
bun run dev
```

## 已完成的配置

### 1. Better-Auth (packages/auth)

- Email/Password 认证
- Google/GitHub OAuth
- Session 管理 (7天过期)
- 自定义字段: plan, role
- 开发环境邮件日志输出

### 2. Database Schema (packages/db)

- **auth.ts**: user, session, account, verification 表
- **files.ts**: 文件存储表 (含 user FK)
- **tasks.ts**: 任务表 (含 user FK, 包含 taskType/taskStatus 枚举)

### 3. Swagger (apps/api)

- 访问 http://localhost:3001/docs
- 自动生成 openapi.json
- Bearer Auth 支持
- ValidationPipe 配置 (whitelist, forbidNonWhitelisted)

## 开发规范

### 代码规范

- 使用 ESLint + Prettier
- TypeScript strict 模式
- 使用 Zod 进行运行时验证
- DTO 使用 class-validator

### Git 提交规范

```
feat: 新功能
fix: 修复
update: 更新现有功能
refactor: 重构
docs: 文档
test: 测试
```

### 数据库变更

```bash
# 生成 migration
cd packages/db
bunx drizzle-kit generate

# 执行 migration
bunx drizzle-kit migrate
```

## 包导出规范

### packages/db

```typescript
// 主入口
export * from './client';  // db 实例
export * from './schema';  // 所有 schema

// 类型
export type { File, NewFile, Task, NewTask } from './schema';
```

### packages/auth

```typescript
export const auth;          // Better-Auth 实例
export type { Auth, Session, User };
export async function verifySession(headers: Headers);
```

## 常用命令

```bash
# 安装依赖
bun install

# 开发
bun run dev

# 构建
bun run build

# Lint
bun run lint
bun run lint:fix

# 格式化
bun run format
```

## 注意事项

1. **环境变量**: 确保 .env.local 存在且配置正确
2. **Docker**: 启动前确保 docker compose 服务运行
3. **数据库**: 首次运行需执行 migration
4. **Auth**: BETTER_AUTH_SECRET 必须使用 `openssl rand -base64 32` 生成
# Utils-Plane 项目规范

> 本文档由 CLAUDE.md 和 AGENTS.md 共享引用

## 项目概述

Utils-Plane 是一个工具平台，支持文件处理（压缩、转换、PDF 操作、字体转换）等功能的全栈应用。

## 技术栈

| 层级 | 技术 |
|------|------|
| 包管理器 | Bun 1.3.13 |
| 前端 | Next.js 14 (App Router) |
| 后端 | NestJS 11 |
| 认证 | Better-Auth |
| 数据库 | PostgreSQL 16 + Drizzle ORM |
| 缓存/队列 | Redis 7 + BullMQ |
| 对象存储 | MinIO (S3 兼容) |
| Monorepo | Turborepo + Bun Workspace |

## 项目结构

```
utils-plane/
├── apps/
│   ├── api/          # NestJS 后端 (端口 3001)
│   └── web/          # Next.js 前端 (端口 3000)
├── packages/
│   ├── auth/         # Better-Auth 认证配置
│   ├── db/           # Drizzle ORM Schema
│   ├── utils/        # 工具函数
│   ├── validators/   # Zod 验证器
│   └── api-client/   # API 客户端类型
├── task/             # 任务文档 (phase1-7)
├── docker-compose.yml
├── turbo.json
└── .env.local
```

## 环境配置

### 必须设置的环境变量 (.env.local)

```env
# Database
DATABASE_URL=postgresql://utils:utils@localhost:5432/utils_plane

# Redis
REDIS_URL=redis://localhost:6379

# MinIO (S3 兼容)
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=uploads
S3_FORCE_PATH_STYLE=true

# Better-Auth
BETTER_AUTH_SECRET=<通过 openssl rand -base64 32 生成>
BETTER_AUTH_URL=http://localhost:3000

# OAuth (开发环境留空)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_S3_PUBLIC_URL=http://localhost:9000

# Backend
PORT=3001
CORS_ORIGIN=http://localhost:3000
NODE_ENV=development
```

### 启动服务

```bash
# 启动 Docker 服务 (PG + Redis + MinIO)
bun run services:up

# 验证服务状态
docker compose ps
```

## 常用命令

```bash
# 安装依赖
bun install

# 开发
bun run dev                        # 并行启动所有 apps
cd apps/api && bun run dev         # 仅后端
cd apps/web && bun run dev         # 仅前端

# 构建
bun run build
cd packages/db && bun run build

# Lint & Format
bun run lint
bun run lint:fix
bun run format

# Docker
bun run services:up       # 启动
bun run services:down     # 停止
bun run services:reset    # 重置
bun run services:logs     # 查看日志

# 数据库
cd packages/db
bunx drizzle-kit generate   # 生成 migration
bunx drizzle-kit migrate    # 执行 migration
bunx drizzle-kit push       # push schema

# API
cd apps/api
bun run openapi:export      # 导出 OpenAPI JSON
```

## 数据库

### 连接信息

- **PostgreSQL**: `postgresql://utils:utils@localhost:5432/utils_plane`
- **Redis**: `redis://localhost:6379`
- **容器名**: utils-pg, utils-redis, utils-minio

### Schema

#### 业务表 (packages/db/src/schema/)

| 表名 | 说明 |
|------|------|
| `files` | 文件存储，含 userId FK |
| `tasks` | 任务表，含 userId FK、taskType/taskStatus 枚举 |

#### Auth 表 (Better-Auth 生成)

| 表名 | 说明 |
|------|------|
| `user` | 用户 (含 plan, role 额外字段) |
| `session` | 会话 |
| `account` | OAuth 账户 |
| `verification` | 邮箱验证 |

### 调试命令

```bash
# 测试数据库
docker exec -it utils-pg psql -U utils -d utils_plane -c "SELECT 1"

# 测试 Redis
docker exec -it utils-redis redis-cli ping

# 查看表
docker exec -it utils-pg psql -U utils -d utils_plane -c "\dt"

# 查看日志
docker compose logs -f postgres
```

## 依赖关系

```
@utils-plane/api
├── @utils-plane/auth (workspace)
├── @utils-plane/db (workspace)
├── @utils-plane/validators (workspace)
└── better-auth

@utils-plane/auth
└── @utils-plane/db (workspace)

@utils-plane/db
├── drizzle-orm
└── postgres
```

## 包导出规范

### packages/db/src/index.ts

```typescript
export * from './client';
export * from './schema';
export type { File, NewFile, Task, NewTask } from './schema';
```

### packages/auth/src/index.ts

```typescript
export const auth;
export type { Auth, Session, User };
export async function verifySession(headers: Headers);
```

## API 服务

- **端口**: 3001
- **Swagger UI**: http://localhost:3001/docs
- **OpenAPI JSON**: `apps/api/openapi.json`

### 导出 OpenAPI

```bash
cd apps/api && bun run openapi:export
```

## 代码规范

### 文件命名

| 类型 | 规则 | 示例 |
|------|------|------|
| React 组件 | PascalCase.tsx | `UserProfile.tsx` |
| 工具函数 | camelCase.ts | `formatDate.ts` |
| DTO/验证 | *.dto.ts | `CreateUserDto.ts` |
| 类型定义 | *.type.ts | `api.response.ts` |

### Git 提交规范

```
feat:     新功能
fix:      修复 bug
update:   更新现有功能
refactor: 重构
docs:     文档
test:     测试
chore:    构建/工具
```

### TypeScript

- 启用 strict 模式
- 使用 ES2020+ 语法
- 优先使用类型推断

## 已完成的配置

### 1. Better-Auth (packages/auth)

- Email/Password 认证
- Google/GitHub OAuth
- Session 管理 (7天过期)
- 自定义字段: plan, role
- 开发环境邮件日志输出

### 2. Database Schema (packages/db)

- auth.ts: user, session, account, verification 表
- files.ts: 文件存储表 (含 user FK)
- tasks.ts: 任务表 (含 user FK, taskType/taskStatus 枚举)

### 3. Swagger (apps/api)

- 访问 http://localhost:3001/docs
- 自动生成 openapi.json
- Bearer Auth 支持
- ValidationPipe 配置 (whitelist, forbidNonWhitelisted)

## 注意事项

1. **不要提交 .env.local** - 已配置 .gitignore
2. **修改 schema 后执行 migration** - `bunx drizzle-kit migrate`
3. **API 修改后重新导出 OpenAPI** - `bun run openapi:export`
4. **Windows 开发** - 使用 Git Bash 或 WSL
5. **BETTER_AUTH_SECRET** - 必须使用 `openssl rand -base64 32` 生成
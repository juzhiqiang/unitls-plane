# Utils-Plane 项目 AI 开发指南

> 本文件供 Claude Code (AI 助手) 阅读和使用

## 项目基本信息

- **项目名称**: Utils-Plane (工具平台)
- **包管理器**: Bun 1.3.13
- **Monorepo**: Turborepo + Bun Workspace
- **代码规范**: ESLint + Prettier + TypeScript strict

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 14 (App Router) |
| 后端 | NestJS 11 |
| 认证 | Better-Auth |
| 数据库 | PostgreSQL 16 + Drizzle ORM |
| 缓存/队列 | Redis 7 + BullMQ |
| 对象存储 | MinIO |

## 项目结构

```
apps/
├── api/          # NestJS 后端 (端口 3001)
└── web/          # Next.js 前端 (端口 3000)

packages/
├── auth/         # Better-Auth 配置
├── db/           # Drizzle Schema
├── utils/        # 工具函数
├── validators/   # Zod 验证器
└── api-client/   # API 客户端
```

## 快速开始

```bash
# 1. 安装依赖
bun install

# 2. 启动 Docker 服务
bun run services:up

# 3. 开发模式 (并行启动 api + web)
bun run dev
```

## 环境配置

### 必须设置的环境变量

在 `.env.local` 中配置:

```env
DATABASE_URL=postgresql://utils:utils@localhost:5432/utils_plane
REDIS_URL=redis://localhost:6379
BETTER_AUTH_SECRET=<通过 openssl rand -base64 32 生成>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## 关键配置

### 数据库

- PostgreSQL: 端口 5432
- 连接字符串: `postgresql://utils:utils@localhost:5432/utils_plane`
- 管理工具: `docker exec -it utils-pg psql -U utils -d utils_plane`

### API 服务

- 端口: 3001
- Swagger: http://localhost:3001/docs
- OpenAPI JSON: `apps/api/openapi.json`

## 常用命令

```bash
# Docker 服务
bun run services:up       # 启动
bun run services:down     # 停止
bun run services:reset    # 重置

# 开发
bun run dev               # 并行开发
cd apps/api && bun run dev
cd apps/web && bun run dev

# 构建
bun run build
cd packages/db && bun run build

# 数据库
cd packages/db && bunx drizzle-kit generate  # 生成 migration
cd packages/db && bunx drizzle-kit migrate   # 执行 migration

# API
cd apps/api && bun run openapi:export         # 导出 OpenAPI
```

## 依赖关系

```
@utils-plane/api
├── @utils-plane/auth (workspace)
├── @utils-plane/db (workspace)
└── better-auth

@utils-plane/auth
└── @utils-plane/db (workspace)

@utils-plane/db
├── drizzle-orm
└── postgres
```

## 数据库 Schema

### 业务表

- **files**: 文件存储 (userId FK → user.id)
- **tasks**: 任务表 (userId FK → user.id, taskType/taskStatus 枚举)

### Auth 表 (Better-Auth)

- **user**: 用户 (含 plan, role 额外字段)
- **session**: 会话
- **account**: OAuth 账户
- **verification**: 邮箱验证

## 开发规范

### 文件命名

- React 组件: `PascalCase.tsx`
- 工具函数: `camelCase.ts`
- DTO/验证: `*.dto.ts`, `*.validator.ts`

### 导出规范

```typescript
// packages/db/src/index.ts
export * from './client';
export * from './schema';
export type { File, NewFile, Task, NewTask } from './schema';

// packages/auth/src/index.ts
export const auth;
export type { Auth, Session, User };
export async function verifySession(headers: Headers);
```

### Git 提交风格

```
feat: 新功能
fix: 修复 bug
update: 更新现有功能
refactor: 重构
docs: 文档
test: 测试
```

## 注意事项

1. **不要提交 .env.local** - 已配置 .gitignore
2. **修改 schema 后执行 migration** - `bunx drizzle-kit migrate`
3. **API 修改后重新导出 OpenAPI** - `bun run openapi:export`
4. **Windows 开发** - 使用 Git Bash 或 WSL

## 调试技巧

```bash
# 查看 Docker 日志
docker compose logs -f postgres
docker compose logs -f redis
docker compose logs -f minio

# 测试数据库连接
docker exec -it utils-pg psql -U utils -d utils_plane -c "SELECT 1"

# 测试 Redis
docker exec -it utils-redis redis-cli ping

# 查看 API 日志
cd apps/api && bun run dev
```

## 参考文档

- [设计文档](./design-system.md)
- [任务文档](./task/)
- [Better-Auth 文档](https://www.better-auth.com/)
- [Drizzle ORM 文档](https://orm.drizzle.team/)
# Utils-Plane 项目 AI 开发指南

> 本文件供 Claude Code (AI 助手) 阅读和使用

## 项目基本信息

- **项目名称**: Utils-Plane (工具平台)
- **包管理器**: Bun 1.3.13
- **Monorepo**: Turborepo + Bun Workspace
- **代码规范**: ESLint + Prettier + TypeScript strict

详细技术栈、项目结构、环境配置请参考 **[PROJECT_SPECS.md](./PROJECT_SPECS.md)**

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

## 注意事项

1. **不要提交 .env.local** - 已配置 .gitignore
2. **修改 schema 后执行 migration** - `bunx drizzle-kit migrate`
3. **API 修改后重新导出 OpenAPI** - `bun run openapi:export`
4. **Windows 开发** - 使用 Git Bash 或 WSL

## 参考文档

- [PROJECT_SPECS.md](./PROJECT_SPECS.md) - 完整项目规范
- [design-system.md](./design-system.md) - 设计系统
- [任务文档](./task/) - phase1-7 任务说明
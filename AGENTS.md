# Utils-Plane 项目规范

> 本文档定义团队编码规范和开发约定。项目事实以 [PROJECT_SPECS.md](./PROJECT_SPECS.md) 为准。

## 文档结构

- [PROJECT_SPECS.md](./PROJECT_SPECS.md) - 项目技术规范和当前架构事实
- [README.md](./README.md) - 项目介绍、启动方式和功能概览
- [CLAUDE.md](./CLAUDE.md) - AI 助手开发指南
- [task/](./task/) - phase1-phase8 任务文档

## 项目概述

Utils-Plane 是一个全栈文件处理工具平台，支持图片压缩/转换、PDF 合并/拆分/转换/加密/水印/压缩/元数据/重排、字体转换、文件管理和异步任务管理。

## 当前应用结构

- `apps/web` - Next.js 14 App Router 前端，包含营销页、Dashboard、工具入口、具体工具页、文件/回收站、任务、设置和认证页面。
- `apps/api` - NestJS 11 API，当前模块包括 `auth`、`files`、`tasks`、`health`。
- `packages/db` - Drizzle ORM schema、migration 和数据库客户端。
- `packages/auth` - Better-Auth 配置、session 校验和可信 origin 工具。
- `packages/validators` - Zod 请求验证 schema。
- `packages/api-client` - OpenAPI 类型和 typed API client。
- `packages/utils` - 通用工具函数。

## 开发规范

### 代码规范

- 使用 ESLint + Prettier。
- TypeScript 使用 strict 模式。
- API DTO 使用 `class-validator` + Swagger 注释。
- 共享校验优先放在 `packages/validators`，运行时边界使用 Zod。
- 前端文案需要同时维护 `apps/web/messages/zh.json` 和 `apps/web/messages/en.json`。

### 文件命名规范

| 类型       | 规则           | 示例               |
| ---------- | -------------- | ------------------ |
| React 组件 | PascalCase.tsx | `UserProfile.tsx`  |
| 工具函数   | camelCase.ts   | `formatDate.ts`    |
| DTO/验证   | \*.dto.ts      | `CreateUserDto.ts` |
| 类型定义   | \*.type.ts     | `api.response.ts`  |

### 包导出规范

```typescript
// packages/db/src/index.ts
export * from './schema';
export * from './client';
export type { File, NewFile, Task, NewTask } from './schema';

// packages/auth/src/index.ts
export const auth;
export type { Auth, Session, User };
export async function verifySession(headers: Headers);
export {
  getAllowedCorsOrigins,
  getTrustedOrigins,
  isOriginAllowed,
  normalizeOrigin,
};
```

## Git 提交规范

```text
feat:     新功能
fix:      修复 bug
update:   更新现有功能
refactor: 重构
docs:     文档
test:     测试
chore:    构建/工具
```

提交示例：

```text
feat(auth): 添加邮箱验证功能
fix(api): 修复文件上传大小限制
update(db): 添加任务状态枚举
```

## 数据库变更规范

```bash
cd packages/db
bunx drizzle-kit generate
bunx drizzle-kit migrate
```

Schema 更新流程：

1. 修改 `packages/db/src/schema/`。
2. 运行 `bunx drizzle-kit generate` 生成 migration。
3. 运行 `bunx drizzle-kit migrate` 执行 migration。
4. 更新 `packages/db/src/index.ts` 或相关类型导出。

## API 开发规范

新增 API 时：

1. 在对应 module 下创建 Controller/Service/DTO。
2. DTO 使用 `class-validator` 定义请求边界。
3. 添加 Swagger 注释，例如 `@ApiTags`、`@ApiOperation`。
4. 更新 OpenAPI：`cd apps/api && bun run openapi:export`。
5. 更新或生成 `packages/api-client` 类型。

## 环境配置规范

```bash
cp .env.example .env.local
```

本地默认端口：

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

关键环境变量见 `.env.example` 和 [PROJECT_SPECS.md](./PROJECT_SPECS.md)。访问 `/admin/queues` 还需要设置 `ADMIN_USER` 和 `ADMIN_PASSWORD`。

## 注意事项

1. 不要提交 `.env.local`。
2. 修改 schema 后执行 migration。
3. API 修改后重新导出 OpenAPI。
4. Windows 开发优先使用 Git Bash 或 WSL；PowerShell 路径中包含 `[locale]`、`(app)` 时要使用 literal path。
5. `BETTER_AUTH_SECRET` 必须使用 `openssl rand -base64 32` 生成。

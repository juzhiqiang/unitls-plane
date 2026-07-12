# Utils-Plane 项目规范

> 本文档定义团队编码规范和开发约定。项目事实以 [PROJECT_SPECS.md](./PROJECT_SPECS.md) 为准。

## 文档结构

- [PROJECT_SPECS.md](./PROJECT_SPECS.md) - 项目技术规范和当前架构事实
- [README.md](./README.md) - 项目介绍、启动方式和功能概览
- [CLAUDE.md](./CLAUDE.md) - AI 助手开发指南
- [task/](./task/) - phase1-phase8 任务文档

## 项目概述

Utils-Plane 是一个全栈文件处理工具平台，支持图片压缩/转换/水印/长图拼接/GIF 与 APNG 动图/证件照，PDF 合并/拆分/转换/加密/水印/压缩/元数据/重排/Markdown 与 Word 转 PDF，字体转换、文件管理和异步任务管理。

## 当前应用结构

- `apps/web` - Next.js 14 App Router 前端，包含营销页、Dashboard、工具入口、具体工具页、文件/回收站、任务、设置和认证页面。
- `apps/api` - NestJS 11 API，当前模块包括 `auth`、`files`、`tasks`、`health`，任务处理覆盖图片、PDF、字体、证件照和文档转 PDF。
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
- 项目文档默认使用中文；除非第三方协议、API 名称、代码标识或用户明确要求，新增或更新文档时不要改用英文。
- 新增或调整工具页时，同步检查 `apps/web/src/lib/tools/tool-metadata.ts`、中英文 messages、任务类型、README 和 `PROJECT_SPECS.md`。
- 本地优先工具优先在浏览器完成处理；服务端任务才进入文件上传、任务队列和登录/存储流程。

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

提交信息必须使用中文描述变更内容；允许保留 `feat`、`fix`、`docs` 等约定式提交前缀和 scope，但冒号后的标题与正文默认使用中文。

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

本地 Docker Compose 只运行 PostgreSQL、Redis、MinIO 等依赖服务；API 开发态在宿主机本地执行 `cd apps/api && bun run dev`，不要放进 Docker 容器运行。

Markdown / Word 转 PDF 的服务端导出优先使用 LibreOffice。生产组合镜像已安装 `libreoffice-writer` 和 CJK 字体；宿主机本地运行 API 时，如果要验证服务端 DOCX/Markdown 高保真转换，请安装 LibreOffice 或设置 `LIBREOFFICE_BIN`。Markdown 本地导出不依赖服务端。

## 注意事项

1. 不要提交 `.env.local`。
2. 修改 schema 后执行 migration。
3. API 修改后重新导出 OpenAPI。
4. Windows 开发优先使用 Git Bash 或 WSL；PowerShell 路径中包含 `[locale]`、`(app)` 时要使用 literal path。
5. `BETTER_AUTH_SECRET` 必须使用 `openssl rand -base64 32` 生成。
6. Docker 发布包只用于本地上传服务器，`utils-plane-all.tar`、`utils-plane-api.tar`、`utils-plane-offline-all.tar` 不提交到 Git。

### 日志文件规范

- 本地运行产生的 `.log` 和 `.err` 文件统一放在项目根目录 `log/` 下；`log/` 不提交到 Git。

### 核对截图规范

- 本地核对截图、Playwright 截图和页面视觉对比图统一放在 `artifacts/screenshots/` 下；不要直接保存到项目根目录。
- 调用截图工具时显式使用 `artifacts/screenshots/<name>.png` 作为输出路径。
- `artifacts/screenshots/` 只作为本地验证产物目录，不提交到 Git。
- Playwright MCP 自动生成的 `.playwright-mcp/` 目录也属于本地验证产物，不提交到 Git。

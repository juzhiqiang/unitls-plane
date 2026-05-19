# Utils-Plane 项目规范

> 本文档定义团队的编码规范和开发约定

## 文档结构

- **[PROJECT_SPECS.md](./PROJECT_SPECS.md)** - 项目技术规范（共享文档）
- 本文档 - 团队开发规范和约定

## 项目概述

Utils-Plane 是一个工具平台，支持文件处理（压缩、转换、PDF 操作、字体转换）等功能的全栈应用。

详细技术栈、项目结构、环境配置请参考 **[PROJECT_SPECS.md](./PROJECT_SPECS.md)**

## 开发规范

### 代码规范

- 使用 ESLint + Prettier
- TypeScript strict 模式
- 使用 Zod 进行运行时验证
- DTO 使用 class-validator

### 文件命名规范

| 类型 | 规则 | 示例 |
|------|------|------|
| React 组件 | PascalCase.tsx | `UserProfile.tsx` |
| 工具函数 | camelCase.ts | `formatDate.ts` |
| DTO/验证 | *.dto.ts | `CreateUserDto.ts` |
| 类型定义 | *.type.ts | `api.response.ts` |

### 包导出规范

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

## Git 提交规范

```
feat:     新功能
fix:      修复 bug
update:   更新现有功能
refactor: 重构
docs:     文档
test:     测试
chore:    构建/工具
```

### 提交示例

```
feat(auth): 添加邮箱验证功能
fix(api): 修复文件上传大小限制
update(db): 添加任务状态枚举
```

## 数据库变更规范

```bash
# 生成 migration
cd packages/db
bunx drizzle-kit generate

# 执行 migration
bunx drizzle-kit migrate
```

### Schema 更新流程

1. 修改 `packages/db/src/schema/` 下的文件
2. 运行 `bunx drizzle-kit generate` 生成 migration
3. 运行 `bunx drizzle-kit migrate` 执行
4. 更新相关类型导出

## API 开发规范

### 新增 API 步骤

1. 在对应的 Module 下创建 Controller/Service
2. 使用 class-validator 定义 DTO
3. 添加 Swagger 注释 (@ApiTags, @ApiOperation 等)
4. 更新 OpenAPI: `bun run openapi:export`
5. 在 api-client 中添加对应的类型

### DTO 示例

```typescript
import { IsString, IsEmail, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(8)
  password: string;
}
```

## 环境配置规范

### 开发环境

```bash
# 复制环境变量模板
cp .env.example .env.local

# 编辑 .env.local，填入必要配置
```

### 必须配置的环境变量

| 变量 | 说明 | 生成方式 |
|------|------|----------|
| DATABASE_URL | PostgreSQL 连接 | 本地默认已配置 |
| REDIS_URL | Redis 连接 | 本地默认已配置 |
| BETTER_AUTH_SECRET | Auth 密钥 | `openssl rand -base64 32` |
| BETTER_AUTH_URL | Auth 基础 URL | `http://localhost:3000` |

## 注意事项

1. **不要提交 .env.local** - 已配置 .gitignore
2. **修改 schema 后执行 migration** - `bunx drizzle-kit migrate`
3. **API 修改后重新导出 OpenAPI** - `bun run openapi:export`
4. **Windows 开发** - 使用 Git Bash 或 WSL
5. **BETTER_AUTH_SECRET** - 必须使用 `openssl rand -base64 32` 生成

## 参考链接

- [PROJECT_SPECS.md](./PROJECT_SPECS.md) - 完整项目规范
- [design-system.md](./design-system.md) - 设计系统
- [Better-Auth 文档](https://www.better-auth.com/)
- [Drizzle ORM 文档](https://orm.drizzle.team/)
- [NestJS 文档](https://docs.nestjs.com/)
- [Next.js 文档](https://nextjs.org/docs)
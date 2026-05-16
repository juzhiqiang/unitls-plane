# 04 - packages/validators (Zod Schemas)

> 依赖：02-shared-config
> 预估：1.5h
> 可并行：与 03-db 同时执行

## 目标

创建前后端共享的 Zod 验证 schemas，确保 API 请求/响应类型一致。

## 步骤

### 4.1 安装依赖

```bash
cd packages/validators
bun add zod
```

### 4.2 package.json

```json
{
  "name": "@utils-plane/validators",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc",
    "lint": "eslint src/"
  },
  "dependencies": {
    "zod": "^3"
  }
}
```

### 4.3 创建 Schema 文件结构

```
packages/validators/src/
├── index.ts            # 统一导出
├── files.ts            # 文件相关验证
├── tasks.ts            # 任务相关验证
└── users.ts            # 用户相关验证
```

### 4.4 files.ts

```typescript
import { z } from 'zod';

export const uploadFileSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string(),
  size: z.number().positive(),
});

export const fileQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type UploadFileInput = z.infer<typeof uploadFileSchema>;
export type FileQuery = z.infer<typeof fileQuerySchema>;
```

### 4.5 tasks.ts

```typescript
import { z } from 'zod';

export const taskTypeEnum = z.enum([
  'compress',
  'convert',
  'pdf_merge',
  'pdf_split',
  'font_convert',
]);

export const createTaskSchema = z.object({
  type: taskTypeEnum,
  inputFileIds: z.array(z.string().uuid()).min(1),
  inputConfig: z.record(z.unknown()),
});

export const taskStatusEnum = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
]);

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type TaskType = z.infer<typeof taskTypeEnum>;
export type TaskStatus = z.infer<typeof taskStatusEnum>;
```

### 4.6 users.ts

```typescript
import { z } from 'zod';

export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
```

### 4.7 index.ts 统一导出

```typescript
export * from './files';
export * from './tasks';
export * from './users';
```

## 验收标准

- [ ] `bun run build` 无报错
- [ ] 其他 workspace 能 import `@utils-plane/validators`
- [ ] 类型推断正确（z.infer 导出可用）

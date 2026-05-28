# 00 - PDF Schema / Validators / DTO 扩展

> 依赖：Phase 5 完成
> 预估：1h
> 可并行：无（必须先完成，后续 01-08 依赖此任务）

## 目标

为所有 PDF 新功能添加 task type 到数据库枚举、Zod validators 和 API DTO。

## 步骤

### 0.1 数据库枚举扩展

`packages/db/src/schema/tasks.ts` — `taskTypeEnum` 添加：

```typescript
export const taskTypeEnum = pgEnum('task_type', [
  'compress',
  'convert',
  'pdf_merge',
  'pdf_split',
  'pdf_to_image',
  'font_convert',
  // Phase 8 新增
  'pdf_to_text',
  'image_to_pdf',
  'pdf_rotate',
  'pdf_watermark',
  'pdf_encrypt',
  'pdf_compress',
  'pdf_metadata',
  'pdf_rearrange',
]);
```

### 0.2 生成 Drizzle migration

```bash
cd packages/db
bun drizzle-kit generate
bun drizzle-kit migrate
```

Migration SQL 大致为：
```sql
ALTER TYPE task_type ADD VALUE 'pdf_to_text';
ALTER TYPE task_type ADD VALUE 'image_to_pdf';
ALTER TYPE task_type ADD VALUE 'pdf_rotate';
ALTER TYPE task_type ADD VALUE 'pdf_watermark';
ALTER TYPE task_type ADD VALUE 'pdf_encrypt';
ALTER TYPE task_type ADD VALUE 'pdf_compress';
ALTER TYPE task_type ADD VALUE 'pdf_metadata';
ALTER TYPE task_type ADD VALUE 'pdf_rearrange';
```

### 0.3 Validators 同步

`packages/validators/src/tasks.ts`:

```typescript
export const taskTypeEnum = z.enum([
  'compress',
  'convert',
  'pdf_merge',
  'pdf_split',
  'pdf_to_image',
  'font_convert',
  'pdf_to_text',
  'image_to_pdf',
  'pdf_rotate',
  'pdf_watermark',
  'pdf_encrypt',
  'pdf_compress',
  'pdf_metadata',
  'pdf_rearrange',
]);
```

### 0.4 API DTO 同步

`apps/api/src/modules/tasks/dto/tasks.dto.ts` — `CreateTaskDto.type` 和 `TaskQueryDto.type` 枚举添加所有新类型。

### 0.5 任务路由

`apps/api/src/modules/tasks/tasks.service.ts` — `getQueue()` 添加路由：

```typescript
private getQueue(type: TaskType): Queue {
  switch (type) {
    case 'compress':
    case 'convert':
      return this.imageQueue;
    case 'pdf_merge':
    case 'pdf_split':
    case 'pdf_to_image':
    case 'pdf_to_text':
    case 'image_to_pdf':
    case 'pdf_rotate':
    case 'pdf_watermark':
    case 'pdf_encrypt':
    case 'pdf_compress':
    case 'pdf_metadata':
    case 'pdf_rearrange':
      return this.pdfQueue;
    case 'font_convert':
      return this.fontQueue;
  }
}
```

## 验收标准

- [ ] Migration 成功执行，`task_type` 枚举包含所有新值
- [ ] `packages/validators` 类型正确导出
- [ ] API DTO 枚举包含新类型
- [ ] `getQueue()` 路由覆盖所有新类型
- [ ] TypeScript 编译无错误

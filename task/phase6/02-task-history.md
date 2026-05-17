# 02 - 任务历史页面

> 依赖：Phase 4 完成
> 预估：2h

> **🎨 UI 设计要求**：任务历史是数据密集页面，**必须**：
> 1. 先读 [`task/design-system.md`](../design-system.md)
> 2. 调用 `frontend-design` skill 产出方案
> 3. 状态徽章用"1px 边框 + mono 字体 + 全大写"风格，**禁止圆角填充 pill**
>    - completed: `[ DONE ]` accent 色
>    - processing: `[ ... ]` accent 色 + 闪烁
>    - failed: `[ FAIL ]` destructive 色
>    - pending: `[ WAIT ]` muted-foreground
> 4. 进度用 2px 高水平条，宽度填充对应单元格
> 5. 时间戳用 mono 字体（`2026-05-17 14:23`）
> 6. 展开详情用 1px 顶部分隔线扩展同一行下方区域，不要弹 Modal

## 目标

展示用户所有任务的历史记录，支持过滤、重试、查看详情。

## 步骤

### 2.1 后端 API

`apps/api/src/modules/tasks/tasks.controller.ts` 扩展：
- `GET /tasks` 已存在，确保支持 query：status、type、createdAt 范围
- `POST /tasks/:id/retry` — 失败任务重试（创建新任务）

### 2.2 前端页面

`src/app/(app)/dashboard/tasks/page.tsx`:
- 表格展示：类型、状态、创建时间、耗时、操作
- 顶部过滤：状态 (全部/失败/完成)、类型 (图片/PDF/字体)
- 每行点击展开详情：输入文件、输出文件、错误信息

### 2.3 任务行组件

`src/components/dashboard/task-row.tsx`:
- 状态徽章（pending: 灰、processing: 蓝带动画、completed: 绿、failed: 红）
- 操作菜单：
  - 完成的任务：下载结果、重新处理
  - 失败的任务：重试、查看错误
  - 处理中的任务：取消（可选）

### 2.4 数据获取

```typescript
export function useTasks(query: TaskQuery) {
  return useQuery({
    queryKey: ['tasks', query],
    queryFn: async () => { ... },
    refetchInterval: 5000, // 自动刷新
  });
}

export function useRetryTask() { ... }
```

### 2.5 错误信息友好化

`src/lib/error-codes.ts`:
```typescript
const ERROR_CODE_MESSAGES: Record<string, string> = {
  IMAGE_PROCESSING_FAILED: '图片处理失败，请检查文件是否损坏',
  INVALID_FONT: '字体文件格式无效',
  // ...
};

export function translateErrorCode(code: string): string {
  return ERROR_CODE_MESSAGES[code] ?? code;
}
```

### 2.6 实时更新

任务状态变化时（pending → processing → completed），列表自动刷新（refetchInterval 或 manual invalidate）。

## 验收标准

- [ ] 任务列表正确显示
- [ ] 过滤按状态/类型工作
- [ ] 失败任务重试创建新任务
- [ ] 错误信息友好显示
- [ ] 实时刷新工作（处理中任务进度变化）
- [ ] 分页/排序正常

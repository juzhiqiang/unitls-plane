# 01 - 文件管理（我的文件 + 回收站）

> 依赖：Phase 4 完成
> 预估：3h

## 目标

实现用户文件管理页面：列表、搜索、过滤、删除、批量操作、回收站。

## 步骤

### 1.1 后端 API 扩展

`apps/api/src/modules/files/files.controller.ts` 新增：
- `GET /files` — 分页列表，支持过滤（mimeType、createdAt 范围）
- `GET /files/trash` — 已软删除文件列表
- `DELETE /files/:id` — 软删除（设置 deleted_at）
- `POST /files/:id/restore` — 恢复
- `DELETE /files/:id/permanent` — 永久删除（删 Storage + DB 行）
- `POST /files/batch-delete` — 批量软删除

### 1.2 前端页面

`src/app/(app)/dashboard/files/page.tsx`:
- 顶部：搜索框、类型过滤、视图切换（网格/列表）
- 中部：文件卡片网格
- 右上：批量操作菜单（删除、下载）

`src/app/(app)/dashboard/files/trash/page.tsx`:
- 类似列表，每项有 "恢复" / "永久删除" 按钮
- 顶部提示："文件将在 30 天后永久删除"

### 1.3 文件卡片组件

`src/components/dashboard/file-card.tsx`:
- 缩略图（图片直接显示，PDF 显示首页，字体显示字体名）
- 文件名（可重命名）
- 元信息（大小、上传时间、类型）
- 操作菜单（下载、删除、获取分享链接）

### 1.4 数据获取

```typescript
// src/hooks/api/use-files.ts 扩展
export function useFiles(query?: FileQuery) { ... }
export function useTrashedFiles() { ... }
export function useDeleteFile() { ... }
export function useRestoreFile() { ... }
export function usePermanentDeleteFile() { ... }
```

### 1.5 批量选择

使用 `useState<Set<string>>` 管理选中集合，shift+click 范围选择。

### 1.6 拖拽上传到文件管理

允许直接在文件管理页拖拽文件上传，自动归入 "我的文件"。

## 验收标准

- [ ] 列表分页正常（10/页）
- [ ] 按类型过滤工作
- [ ] 搜索按文件名匹配
- [ ] 删除 → 移到回收站，DB 中 deleted_at 有值
- [ ] 回收站 "恢复" 功能正常
- [ ] 永久删除清理 Storage 文件
- [ ] 批量删除工作

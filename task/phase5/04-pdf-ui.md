# 04 - PDF 工具 UI

> 依赖：01-pdf-merge、02-pdf-split、03-pdf-preview
> 预估：4h

> **🎨 UI 设计要求**：PDF 操作复杂，需 UI 引导，**必须**：
>
> 1. 先读 [`task/design-system.md`](../design-system.md)
> 2. 调用 `frontend-design` skill 产出方案
> 3. 文件排序：拖拽手柄使用 1px 线条图标，拖拽中显示 ghost 轮廓（不要 scale）
> 4. PDF 页面缩略图网格：1px 边框、轻微 muted 背景，选中态左侧 2px accent 竖线
> 5. 拆分模式切换：tab 设计，下方 1px underline 标识当前 tab
> 6. 不要使用大圆角卡片堆叠，缩略图直接平铺在网格中

## 目标

实现 PDF 合并/拆分的完整 UI，支持拖拽排序、可视化选择。

## 步骤

### 4.1 页面路由

```
src/app/(app)/pdf/
├── page.tsx              # 工具选择
├── merge/page.tsx        # 合并工具
└── split/page.tsx        # 拆分工具
```

### 4.2 合并 UI (merge/page.tsx)

功能：

1. 多文件上传（FileDropzone，multiple=true）
2. 文件列表 + 缩略图预览（每个 PDF 显示第一页）
3. 拖拽排序（dnd-kit Sortable）
4. 删除单个 PDF
5. 输出文件名输入
6. "开始合并" 按钮

```tsx
'use client';
export default function MergePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [outputFilename, setOutputFilename] = useState('merged.pdf');
  const uploadFiles = useUploadFiles();
  const createTask = useCreateTask();
  const [taskId, setTaskId] = useState<string | null>(null);
  const { data: progress } = useTaskProgress(taskId);

  const handleMerge = async () => {
    const uploaded = await Promise.all(
      files.map(f => uploadFiles.mutateAsync(f))
    );
    const task = await createTask.mutateAsync({
      type: 'pdf_merge',
      inputFileIds: uploaded.map(u => u.id),
      inputConfig: { outputFilename },
    });
    setTaskId(task.id);
  };

  return (
    <div>
      <FileDropzone
        accept={{ 'application/pdf': [] }}
        multiple
        onDrop={f => setFiles([...files, ...f])}
      />

      <SortableFileList
        files={files}
        onReorder={setFiles}
        onRemove={i => setFiles(files.filter((_, idx) => idx !== i))}
      />

      <Input
        value={outputFilename}
        onChange={e => setOutputFilename(e.target.value)}
      />

      <Button onClick={handleMerge} disabled={files.length < 2}>
        合并 PDF
      </Button>

      {progress && progress.status === 'processing' && (
        <Progress value={progress.progress} />
      )}

      {progress?.status === 'completed' && (
        <DownloadButton fileId={progress.outputFileId!} />
      )}
    </div>
  );
}
```

### 4.3 SortableFileList 组件

`src/components/tools/sortable-file-list.tsx`:

- 使用 @dnd-kit/sortable
- 每项显示：PDF 缩略图（第一页）+ 文件名 + 删除按钮
- 拖拽时显示拖拽手柄

### 4.4 拆分 UI (split/page.tsx)

功能：

1. 单文件上传
2. PDF 全页预览（PdfPreview 组件）
3. 三种拆分模式选择：
   - **按范围**：可视化拖拽选择起止页
   - **按页**：复选框选择要提取的页
   - **每 N 页**：输入数字
4. "开始拆分" 按钮

```tsx
const [mode, setMode] = useState<'ranges' | 'pages' | 'every'>('ranges');
const [selection, setSelection] = useState<any>({});

// 根据 mode 渲染不同的选择 UI
```

### 4.5 工具首页

`src/app/(app)/pdf/page.tsx`:

- 卡片：合并、拆分
- 预留：旋转、加密（未来）

### 4.6 错误处理

- 非 PDF 上传 → Toast 错误
- 文件 > 50MB → Toast 错误（提示登录或缩小文件）
- 任务失败 → 显示 error_message + 重试按钮

## 验收标准

- [ ] 合并：上传 3 个 PDF，拖拽排序，合并成功
- [ ] 拆分按范围：选择 1-3 页，输出 1 个 3 页 PDF
- [ ] 拆分按页：勾选 [1, 3, 5]，输出 1 个 3 页 PDF
- [ ] 拆分每 N 页：100 页 PDF，每 25 页 → 4 个 ZIP 内 PDF
- [ ] 进度条正确更新
- [ ] 下载结果正常

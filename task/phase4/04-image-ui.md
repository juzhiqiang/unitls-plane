# 04 - 图片工具 UI

> 依赖：01-client-compress、03-format-convert、05-progress-poll
> 预估：4h

> **🎨 UI 设计要求**：工具操作界面，**必须**：
>
> 1. 先读 [`task/design-system.md`](../design-system.md)
> 2. 调用 `frontend-design` skill 产出工具页方案（含 dropzone、配置面板、对比预览）
> 3. Dropzone：1px 虚线边框 + 极大内 padding，hover 时变 muted 背景
> 4. 参数面板：左对齐表单、mono 字体显示数值（如 `1920px / 80%`）
> 5. 进度条：2px 高水平线条，**禁止 spinning circle**
> 6. 预览对比：水平/垂直拖拽 slider，文件大小用 mono 字体显示
> 7. 双主题适配

## 目标

实现图片工具的完整 UI：拖拽上传、参数配置、本地/服务端切换、预览对比、下载。

## 步骤

### 4.1 页面路由

```
src/app/(app)/image/
├── page.tsx              # 工具首页（选择压缩/转换）
├── compress/page.tsx     # 压缩工具
└── convert/page.tsx      # 格式转换工具
```

### 4.2 拖拽上传组件

`src/components/tools/file-dropzone.tsx`:

```tsx
'use client';
import { useDropzone } from 'react-dropzone';

export function FileDropzone({ accept, maxSize, onDrop }: Props) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept,
    maxSize,
    onDrop,
  });

  return (
    <div
      {...getRootProps()}
      className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:bg-muted/50"
    >
      <input {...getInputProps()} />
      {isDragActive ? '放开以上传' : '点击或拖拽图片到此处'}
    </div>
  );
}
```

```bash
bun add react-dropzone
```

### 4.3 参数配置面板

`src/components/tools/image-compress-options.tsx`:

- 质量 Slider (1-100)
- 最大尺寸 Input
- 输出格式 Select
- "本地处理 / 服务端处理" 切换（< 5MB 默认本地，可手动切换）

### 4.4 预览对比组件

`src/components/tools/image-compare.tsx`:

- 左右分栏：原图 vs 处理后
- 显示文件大小、尺寸、压缩比
- 可选：滑动对比（react-compare-slider）

```bash
bun add react-compare-slider
```

### 4.5 实现 compress/page.tsx

```tsx
'use client';
export default function CompressPage() {
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [resultFile, setResultFile] = useState<File | null>(null);
  const [options, setOptions] = useState<CompressOptions>({
    quality: 80,
    format: 'jpeg',
  });
  const [mode, setMode] = useState<'local' | 'server'>('local');

  const handleProcess = async () => {
    if (!originalFile) return;

    if (mode === 'local' || shouldProcessLocally(originalFile)) {
      // 本地处理
      const result = await compressImage(originalFile, options);
      setResultFile(result);
    } else {
      // 服务端处理：上传 → 创建任务 → 轮询
      const uploadRes = await uploadFile.mutateAsync(originalFile);
      const task = await createTask.mutateAsync({
        type: 'compress',
        inputFileIds: [uploadRes.id],
        inputConfig: options,
      });
      // 进度轮询...
      const completed = await waitForTaskCompletion(task.id);
      const result = await downloadFile(completed.outputFileId);
      setResultFile(result);
    }
  };

  return (
    <div>
      <FileDropzone
        accept={{ 'image/*': [] }}
        onDrop={files => setOriginalFile(files[0])}
      />
      <ImageCompressOptions value={options} onChange={setOptions} />
      <ModeToggle value={mode} onChange={setMode} />
      <Button onClick={handleProcess}>开始压缩</Button>
      {resultFile && (
        <ImageCompare original={originalFile!} result={resultFile} />
      )}
      {resultFile && <DownloadButton file={resultFile} />}
    </div>
  );
}
```

### 4.6 实现 convert/page.tsx

类似 compress，但 options 是目标格式选择。

### 4.7 工具首页

`src/app/(app)/image/page.tsx`:

- 卡片列表：压缩、格式转换
- 点击卡片跳转对应子页面

### 4.8 Loading & Error 状态

- 处理中显示 Progress（本地用 onProgress 回调，服务端用 useTaskProgress）
- 失败显示 Toast + 重试按钮
- 处理成功显示 Confetti（可选）

## 验收标准

- [ ] 拖拽上传图片正常
- [ ] 本地压缩瞬时完成（< 5MB）
- [ ] 服务端压缩进度正确显示
- [ ] 预览对比正常
- [ ] 下载结果文件
- [ ] 格式转换 PNG → WebP 正常
- [ ] 移动端响应式正常

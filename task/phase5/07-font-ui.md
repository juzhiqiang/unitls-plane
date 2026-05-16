# 07 - 字体工具 UI

> 依赖：06-font-preview
> 预估：2h

## 目标

实现字体工具页面：上传 → 预览 → 选择目标格式 → 转换 → 下载。

## 步骤

### 7.1 页面路由

```
src/app/(app)/font/
├── page.tsx              # 字体工具首页（合并入口）
└── (实现可以单页面集成所有功能，因为字体工具相对简单)
```

### 7.2 实现 font/page.tsx

```tsx
'use client';
import { FontPreview } from '@/components/tools/font-preview';
import { FileDropzone } from '@/components/tools/file-dropzone';

export default function FontPage() {
  const [file, setFile] = useState<File | null>(null);
  const [toFormat, setToFormat] = useState<'ttf' | 'otf' | 'woff' | 'woff2'>('woff2');
  const [subsetText, setSubsetText] = useState('');
  const [enableSubset, setEnableSubset] = useState(false);

  const uploadFile = useUploadFile();
  const createTask = useCreateTask();
  const [taskId, setTaskId] = useState<string | null>(null);
  const { data: progress } = useTaskProgress(taskId);

  const handleConvert = async () => {
    if (!file) return;
    const uploaded = await uploadFile.mutateAsync(file);
    const task = await createTask.mutateAsync({
      type: 'font_convert',
      inputFileIds: [uploaded.id],
      inputConfig: {
        toFormat,
        subsetText: enableSubset ? subsetText : undefined,
      },
    });
    setTaskId(task.id);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">字体转换</h1>

      {!file && (
        <FileDropzone
          accept={{
            'font/ttf': ['.ttf'],
            'font/otf': ['.otf'],
            'font/woff': ['.woff'],
            'font/woff2': ['.woff2'],
            'application/octet-stream': ['.ttf', '.otf', '.woff', '.woff2'],
          }}
          onDrop={(files) => setFile(files[0])}
        />
      )}

      {file && (
        <>
          <FontPreview file={file} />

          <Card>
            <CardHeader><CardTitle>转换设置</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>目标格式</Label>
                <Select value={toFormat} onValueChange={(v) => setToFormat(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ttf">TTF</SelectItem>
                    <SelectItem value="otf">OTF</SelectItem>
                    <SelectItem value="woff">WOFF</SelectItem>
                    <SelectItem value="woff2">WOFF2 (推荐)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox checked={enableSubset} onCheckedChange={(v) => setEnableSubset(!!v)} />
                  <Label>启用子集化（仅保留指定字符）</Label>
                </div>
                {enableSubset && (
                  <Textarea
                    placeholder="输入要保留的字符，例如：你好世界 ABC 123"
                    value={subsetText}
                    onChange={(e) => setSubsetText(e.target.value)}
                  />
                )}
              </div>

              <Button onClick={handleConvert} disabled={!file || createTask.isPending}>
                开始转换
              </Button>
            </CardContent>
          </Card>

          {progress && progress.status !== 'completed' && (
            <Progress value={progress.progress} />
          )}

          {progress?.status === 'completed' && (
            <Card>
              <CardContent className="pt-6">
                <DownloadButton fileId={progress.outputFileId!} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
```

### 7.3 添加字体管理功能（可选）

侧栏添加 "我的字体" 入口，列出用户上传过的字体：
- 字体名 + 缩略预览
- 收藏/取消收藏
- 删除

### 7.4 LocalFont API 支持（可选）

在支持的浏览器中，允许选择系统已安装字体：
```typescript
if ('queryLocalFonts' in window) {
  const fonts = await (window as any).queryLocalFonts();
  // 显示系统字体列表
}
```

## 验收标准

- [ ] 上传 TTF 后 FontPreview 正常显示
- [ ] 选择 WOFF2 转换成功，文件变小
- [ ] 子集化后文件显著变小
- [ ] 中文字体转换不丢失字形
- [ ] 进度条工作
- [ ] 下载结果可用（在 CSS @font-face 中能加载）

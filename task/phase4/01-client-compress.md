# 01 - 客户端图片压缩 lib

> 依赖：Phase 3 完成
> 预估：2h
> 可并行：与 02/05 同时执行

## 目标

封装 browser-image-compression，提供统一的客户端图片处理 API。

## 步骤

### 1.1 安装依赖

```bash
cd apps/web
bun add browser-image-compression
```

### 1.2 创建客户端处理 lib

`src/lib/processing/image-client.ts`:
```typescript
import imageCompression from 'browser-image-compression';

export interface CompressOptions {
  maxSizeMB?: number;            // 目标大小
  maxWidthOrHeight?: number;     // 最大边长
  quality?: number;              // 0-1
  outputType?: 'image/jpeg' | 'image/webp' | 'image/png';
  onProgress?: (progress: number) => void;
}

export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: options.maxSizeMB ?? 1,
    maxWidthOrHeight: options.maxWidthOrHeight ?? 1920,
    initialQuality: options.quality ?? 0.8,
    fileType: options.outputType,
    useWebWorker: true,
    onProgress: options.onProgress,
  });
}

export function shouldProcessLocally(file: File): boolean {
  return file.size < 5 * 1024 * 1024;  // < 5MB 优先本地
}

export interface ImageMeta {
  width: number;
  height: number;
  size: number;
  type: string;
}

export async function getImageMeta(file: File): Promise<ImageMeta> {
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      size: file.size,
      type: file.type,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

### 1.3 创建格式转换工具

`src/lib/processing/image-convert-client.ts`:
```typescript
export async function convertImageFormat(
  file: File,
  toType: 'image/jpeg' | 'image/webp' | 'image/png',
  quality = 0.9,
): Promise<File> {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Conversion failed'));
        const ext = toType.split('/')[1];
        const newName = file.name.replace(/\.[^.]+$/, `.${ext}`);
        resolve(new File([blob], newName, { type: toType }));
      },
      toType,
      quality,
    );
  });
}

async function loadImage(file: File): Promise<HTMLImageElement> { ... }
```

### 1.4 单元测试

`src/lib/processing/__tests__/image-client.test.ts`:
- 测试 shouldProcessLocally 边界
- 测试 getImageMeta 返回正确元数据

```bash
bun test
```

## 验收标准

- [ ] 上传 2MB JPG → 压缩后 < 500KB
- [ ] 进度回调能触发
- [ ] WebWorker 使用，不阻塞主线程
- [ ] getImageMeta 正确返回尺寸
- [ ] 格式转换正常（PNG → WebP 等）

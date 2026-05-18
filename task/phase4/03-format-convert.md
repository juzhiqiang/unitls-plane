# 03 - 服务端图片格式转换

> 依赖：02-server-processor
> 预估：2h

## 目标

扩展 ImageService 和 ImageProcessor，支持 PNG/JPEG/WebP/AVIF/BMP 之间互转。

## 步骤

### 3.1 扩展 ImageService

`apps/api/src/modules/tasks/services/image.service.ts`:

```typescript
async convert(input: Buffer, opts: ConvertOptions): Promise<Buffer> {
  const pipeline = sharp(input, { failOn: 'truncated' });

  switch (opts.toFormat) {
    case 'jpeg':
      return pipeline.jpeg({
        quality: opts.quality ?? 90,
        mozjpeg: true,
        chromaSubsampling: '4:4:4',
      }).toBuffer();

    case 'png':
      return pipeline.png({
        compressionLevel: 9,
        palette: opts.palette ?? false,
      }).toBuffer();

    case 'webp':
      return pipeline.webp({
        quality: opts.quality ?? 90,
        lossless: opts.lossless ?? false,
      }).toBuffer();

    case 'avif':
      return pipeline.avif({
        quality: opts.quality ?? 70,
        effort: 4,
      }).toBuffer();

    case 'bmp':
      // Sharp 不直接支持 BMP 输出，转 PNG 后用 jimp 或类似库
      throw new Error('BMP output not supported yet');

    default:
      throw new BadRequestException({
        code: 'UNSUPPORTED_FORMAT',
        message: `Format ${opts.toFormat} not supported`,
      });
  }
}

export interface ConvertOptions {
  toFormat: 'jpeg' | 'png' | 'webp' | 'avif' | 'bmp';
  quality?: number;
  lossless?: boolean;
  palette?: boolean;
}
```

### 3.2 扩展 ImageProcessor

在 `image.processor.ts` 中根据 task.type 分发：

```typescript
async process(job: Job<{ taskId: string }>): Promise<unknown> {
  const task = await this.tasksService.getById(job.data.taskId);

  switch (task.type) {
    case 'compress':
      return this.handleCompress(task, job);
    case 'convert':
      return this.handleConvert(task, job);
    default:
      throw new Error(`Unknown image task type: ${task.type}`);
  }
}

private async handleConvert(task: Task, job: Job): Promise<unknown> {
  // 类似 handleCompress，调用 imageService.convert
}
```

### 3.3 输入格式检测

在处理前检测输入是否为支持的图片：

```typescript
const meta = await this.imageService.getMetadata(inputBuffer);
if (!meta.format) {
  throw new BadRequestException({
    code: 'INVALID_IMAGE',
    message: 'File is not a valid image',
  });
}
```

### 3.4 批量转换（可选）

如果 input_file_ids 是多个，循环处理后打包成 ZIP：

```bash
bun add archiver
```

```typescript
if (task.input_file_ids.length > 1) {
  const archive = archiver('zip');
  for (const fileId of task.input_file_ids) {
    const buffer = await this.processOne(fileId, task.input_config);
    archive.append(buffer, { name: `converted-${fileId}.${format}` });
  }
  // 上传 ZIP
}
```

## 验收标准

- [ ] PNG → JPEG 转换成功，文件变小
- [ ] JPEG → WebP 转换成功，质量保留
- [ ] AVIF 输出文件比 JPEG 小约 50%
- [ ] 透明 PNG → JPEG 时背景为白色
- [ ] 不支持的格式返回明确错误码

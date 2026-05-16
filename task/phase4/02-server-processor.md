# 02 - Sharp Image Processor + Service

> 依赖：Phase 2 完成
> 预估：3h
> 可并行：与 01/05 同时执行

## 目标

实现服务端图片处理逻辑，作为 image-queue 的 Processor。

## 步骤

### 2.1 安装依赖

```bash
cd apps/api
bun add sharp
```

> 注：Bun + Sharp 偶有兼容问题，如遇 native binary 错误，可切换到 Node.js 适配器或使用 `sharp-cjs`。

### 2.2 创建 ImageService

`apps/api/src/modules/tasks/services/image.service.ts`:
```typescript
import sharp from 'sharp';

@Injectable()
export class ImageService {
  async compress(input: Buffer, opts: CompressOptions): Promise<Buffer> {
    let pipeline = sharp(input, { failOn: 'truncated' });

    if (opts.maxWidth || opts.maxHeight) {
      pipeline = pipeline.resize({
        width: opts.maxWidth,
        height: opts.maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    switch (opts.format ?? 'jpeg') {
      case 'jpeg':
        return pipeline.jpeg({ quality: opts.quality ?? 80, mozjpeg: true }).toBuffer();
      case 'webp':
        return pipeline.webp({ quality: opts.quality ?? 80 }).toBuffer();
      case 'avif':
        return pipeline.avif({ quality: opts.quality ?? 60 }).toBuffer();
      case 'png':
        return pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
      default:
        throw new Error(`Unsupported format: ${opts.format}`);
    }
  }

  async getMetadata(input: Buffer) {
    return sharp(input).metadata();
  }
}

export interface CompressOptions {
  format?: 'jpeg' | 'webp' | 'avif' | 'png';
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
}
```

### 2.3 实现 ImageProcessor

`apps/api/src/modules/tasks/processors/image.processor.ts`:
```typescript
@Processor('image-queue', { concurrency: 3 })
export class ImageProcessor extends WorkerHost {
  constructor(
    private readonly imageService: ImageService,
    private readonly filesService: FilesService,
    private readonly tasksService: TasksService,
  ) { super(); }

  async process(job: Job<{ taskId: string }>): Promise<unknown> {
    const { taskId } = job.data;
    const task = await this.tasksService.getById(taskId);

    try {
      await this.tasksService.markProcessing(taskId);

      // 1. 下载输入文件
      const inputFile = await this.filesService.getById(task.input_file_ids[0]);
      const inputBuffer = await this.filesService.download(inputFile.storage_key);
      await job.updateProgress(20);

      // 2. 处理
      const outputBuffer = await this.imageService.compress(
        inputBuffer,
        task.input_config,
      );
      await job.updateProgress(70);

      // 3. 上传结果
      const outputFile = await this.filesService.upload(outputBuffer, {
        filename: `compressed-${inputFile.filename}`,
        mimeType: getMimeType(task.input_config.format),
        size: outputBuffer.length,
      }, task.user_id);
      await job.updateProgress(95);

      // 4. 更新任务
      await this.tasksService.markCompleted(taskId, outputFile.id);
      await job.updateProgress(100);

      return { outputFileId: outputFile.id };
    } catch (err) {
      await this.tasksService.markFailed(
        taskId,
        'IMAGE_PROCESSING_FAILED',
        (err as Error).message,
      );
      throw err;  // 让 Bull 重试
    }
  }
}
```

### 2.4 注册到 TasksModule

```typescript
@Module({
  providers: [
    TasksService,
    FilesService,
    ImageService,
    ImageProcessor,
  ],
})
export class TasksModule {}
```

### 2.5 配置内存限制

Sharp 处理大图时设置：
```typescript
sharp.cache(false);
sharp.concurrency(1); // 限制单图并发，配合 Processor concurrency
```

## 验收标准

- [ ] 5MB JPG 压缩后 < 1MB
- [ ] PNG 处理透明度正常
- [ ] 进度回调（20/70/95/100）正确上报
- [ ] 失败后任务 status = failed，error_code 正确
- [ ] Bull Board 中能看到 job 历史

# 07 - Files Module（MinIO + 上传/下载）

> 依赖：04-auth-guard、Phase 1 / 05-docker-services
> 预估：3h

## 目标

实现文件上传到 MinIO、生成签名 URL 下载、查询、删除接口。

## 步骤

### 7.1 安装依赖

```bash
cd apps/api
bun add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

> MinIO 完全兼容 S3 协议，所以直接使用 AWS SDK。

### 7.2 创建 MinioService

`apps/api/src/modules/files/minio.service.ts`:
```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

@Injectable()
export class MinioService implements OnModuleInit {
  private client: S3Client;
  private bucket = process.env.S3_BUCKET ?? 'uploads';

  constructor() {
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
      },
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    });
  }

  async onModuleInit() {
    // 自动创建 bucket
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async upload(key: string, body: Buffer, mimeType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
    }));
  }

  async download(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    return Buffer.from(await response.Body!.transformToByteArray());
  }

  async getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  async getSignedUploadUrl(key: string, expiresIn = 600): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }
}
```

### 7.3 创建 FilesModule

`apps/api/src/modules/files/files.module.ts`:
```typescript
@Module({
  controllers: [FilesController],
  providers: [FilesService, MinioService],
  exports: [FilesService, MinioService],
})
export class FilesModule {}
```

### 7.4 实现 FilesService

`apps/api/src/modules/files/files.service.ts` 方法：
- `upload(file: Buffer, meta: UploadMeta, userId?: string): Promise<File>`
  - 生成 storage_key：`{userId ?? 'anonymous'}/{fileId}/{filename}`
  - 上传到 MinIO
  - 写 DB 记录
- `getById(id, userId?)`
- `getSignedUrl(id, userId?)` 返回 MinIO 签名 URL
- `listByUser(userId, query)`
- `softDelete(id, userId)`
- `permanentDelete(id, userId)` 删 MinIO + DB

### 7.5 实现 FilesController

`apps/api/src/modules/files/files.controller.ts`:
```typescript
@Controller('files')
@ApiTags('files')
export class FilesController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 50 * 1024 * 1024 },
  }))
  upload(@UploadedFile() file: Express.Multer.File, @CurrentUser() user?: User) { ... }

  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user?: User) { ... }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response, @CurrentUser() user?: User) {
    const url = await this.filesService.getSignedUrl(id, user?.id);
    return res.redirect(url);
  }

  @Get()
  list(@Query() query: FileQueryDto, @CurrentUser() user: User) { ... }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: User) { ... }
}
```

### 7.6 文件大小/类型校验

- 允许的 MIME: `image/*`, `application/pdf`, `font/*`, `application/octet-stream`
- 匿名 ≤ 10MB，登录 ≤ 50MB
- 不符合抛 `BadRequestException` with `INVALID_FILE_TYPE` / `FILE_TOO_LARGE`

### 7.7 公共 URL（可选）

如果 bucket 设为公开（docker-compose 中 `mc anonymous set download local/uploads`），可直接通过：
```
http://localhost:9000/uploads/{storage_key}
```
访问，无需签名。生产环境建议保留签名机制。

## 验收标准

- [ ] 上传图片 → MinIO Console 可见
- [ ] DB files 表有对应记录
- [ ] 匿名上传 expires_at = +24h
- [ ] /files/:id/download 返回签名 URL 重定向
- [ ] 越权访问 → 403
- [ ] 删除文件后 MinIO 中对应对象也删除

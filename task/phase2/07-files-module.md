# 07 - Files Module (上传/下载)

> 依赖：04-auth-guard、Phase 1 / 05-supabase
> 预估：3h

## 目标

实现文件上传到 Supabase Storage、下载、查询、删除接口。

## 步骤

### 7.1 创建 FilesModule

`apps/api/src/modules/files/files.module.ts`:
```typescript
@Module({
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
```

### 7.2 实现 FilesService

`apps/api/src/modules/files/files.service.ts` 提供方法：
- `upload(file: Buffer, meta: UploadMeta, userId?: string): Promise<File>`
- `getById(id: string, userId?: string): Promise<File>`
- `getSignedUrl(id: string, userId?: string): Promise<string>` (返回临时签名 URL)
- `listByUser(userId: string, query: FileQuery): Promise<File[]>`
- `softDelete(id: string, userId: string): Promise<void>`

文件存储路径规则：
- 登录用户：`uploads/{userId}/{fileId}/{filename}`
- 匿名：`uploads/anonymous/{fileId}/{filename}`

匿名文件设置 `expires_at = now() + 24h`。

### 7.3 实现 FilesController

`apps/api/src/modules/files/files.controller.ts`:
```typescript
@Controller('files')
@ApiTags('files')
@ApiBearerAuth()
export class FilesController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  }))
  upload(@UploadedFile() file: Express.Multer.File, @CurrentUser() user?: User) {
    return this.filesService.upload(file.buffer, {
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    }, user?.id);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user?: User) { ... }

  @Get(':id/download')
  download(@Param('id') id: string, @CurrentUser() user?: User) {
    // 重定向到 Supabase Signed URL
  }

  @Get()
  list(@Query() query: FileQueryDto, @CurrentUser() user: User) { ... }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: User) { ... }
}
```

### 7.4 创建 DTOs

`apps/api/src/modules/files/dto/`:
- `upload-file.dto.ts`
- `file-query.dto.ts`
- `file-response.dto.ts`

使用 class-validator + @ApiProperty，确保 Swagger 自动生成。

### 7.5 文件类型/大小校验

在 service 层校验：
- 允许的 MIME types: `image/*`, `application/pdf`, `font/*`, `application/octet-stream` (字体)
- 匿名上传 ≤ 10MB
- 登录用户 ≤ 50MB

不符合则抛 `BadRequestException` with `ErrorCodes.INVALID_FILE_TYPE` / `FILE_TOO_LARGE`。

### 7.6 权限检查

`getById` / `download` / `remove` 必须验证：
- 文件 owner 与 currentUser 一致
- 或文件是匿名上传（user_id 为 null）的 owner（通过短时 session 标识）

## 验收标准

- [ ] 上传图片成功，能在 Supabase Storage 中看到文件
- [ ] DB 中 files 表有对应记录
- [ ] 匿名上传 expires_at = +24h
- [ ] 越权访问 → 403
- [ ] Swagger UI 中接口完整可测

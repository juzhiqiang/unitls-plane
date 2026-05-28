# 05 - PDF 加密

> 依赖：00-pdf-schema-update
> 预估：2h
> 可并行：与 01/02/03/04/06/07/08 同时执行

## 目标

为 PDF 设置打开密码和权限密码，控制打印/复制/修改权限。

## 技术方案

`mupdf` 的 `PDFDocument.saveToBuffer()` 支持加密选项：
- `userPassword` — 打开密码
- `ownerPassword` — 权限密码
- `permissions` — 权限控制

注意：`pdf-lib` 不支持加密输出，需使用 `mupdf`。

## 步骤

### 5.1 扩展 PdfService

`apps/api/src/modules/tasks/services/pdf.service.ts`:

```typescript
export interface EncryptOptions {
  userPassword?: string;     // 打开密码（为空则不设打开密码）
  ownerPassword: string;     // 权限密码（必填）
  permissions?: {
    print?: boolean;         // 默认 true
    copy?: boolean;          // 默认 false
    modify?: boolean;        // 默认 false
    annotate?: boolean;      // 默认 false
  };
}

async encrypt(input: Buffer, opts: EncryptOptions): Promise<Buffer> {
  const doc = mupdf.Document.openDocument(input, 'application/pdf') as mupdf.PDFDocument;

  // 构建权限字符串
  // mupdf saveToBuffer options: "user-password=X,owner-password=Y,permissions=N"
  const perms = opts.permissions ?? {};
  // mupdf 使用 permission bits
  let permBits = 0;
  if (perms.print !== false) permBits |= 0b000000000100;  // bit 3: print
  if (perms.copy !== false) permBits |= 0b000000010000;   // bit 5: copy
  if (perms.modify !== false) permBits |= 0b000000001000; // bit 4: modify
  if (perms.annotate !== false) permBits |= 0b000000100000; // bit 6: annotate

  const saveOpts: Record<string, any> = {
    userPassword: opts.userPassword ?? '',
    ownerPassword: opts.ownerPassword,
    permissions: permBits,
  };

  const result = doc.saveToBuffer(saveOpts);
  return Buffer.from(result.asUint8Array());
}
```

### 5.2 扩展 PdfProcessor

```typescript
case 'pdf_encrypt':
  return await this.handleEncrypt(task, job);
```

```typescript
private async handleEncrypt(task: any, job: Job): Promise<unknown> {
  const fileId = task.inputFileIds?.[0];
  if (!fileId) throw new Error('No input file specified');

  const inputFile = await this.filesService.getById(fileId);
  if (inputFile.mimeType !== 'application/pdf') {
    throw new Error(`INVALID_FILE_TYPE`);
  }

  const inputBuffer = await this.filesService.download(inputFile.storageKey);
  await this.reportProgress(task.id, job, 20);

  const config = task.inputConfig as EncryptOptions;
  if (!config.ownerPassword) {
    throw new Error('Owner password is required');
  }

  const result = await this.pdfService.encrypt(inputBuffer, config);
  await this.reportProgress(task.id, job, 85);

  const outputFile = await this.filesService.upload(
    result,
    { filename: `encrypted-${inputFile.filename}`, mimeType: 'application/pdf', size: result.length },
    task.userId ?? undefined,
  );

  await this.tasksService.markCompleted(task.id, outputFile.id);
  await this.reportProgress(task.id, job, 100);
  return { outputFileId: outputFile.id };
}
```

### 5.3 前端页面

`apps/web/src/app/[locale]/(app)/pdf/encrypt/page.tsx`:

1. **文件上传** — FileDropzone
2. **配置项**：
   - 打开密码（password input，可选）
   - 权限密码（password input，必填）
   - 权限复选框：允许打印 / 允许复制 / 允许修改 / 允许注释
3. **安全提示** — 页面上显示说明：密码不会存储在服务器
4. **处理 + 下载**

## 验收标准

- [ ] 设置打开密码后，PDF 阅读器要求输入密码
- [ ] 权限控制生效（禁止复制时无法选中文字）
- [ ] 仅设权限密码不设打开密码时可正常打开
- [ ] 密码不持久化存储

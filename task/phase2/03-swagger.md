# 03 - Swagger 自动文档

> 依赖：01-nestjs-init
> 预估：1h
> 可并行：与 02/04/05/06/08 同时执行

## 目标

集成 @nestjs/swagger 自动生成 OpenAPI 文档，作为前后端类型契约的来源。

## 步骤

### 3.1 安装依赖

```bash
cd apps/api
bun add @nestjs/swagger
```

### 3.2 配置 Swagger

`apps/api/src/main.ts`:
```typescript
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const config = new DocumentBuilder()
  .setTitle('Utils-Plane API')
  .setDescription('工具平台 API 文档')
  .setVersion('1.0')
  .addBearerAuth()
  .build();

const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('docs', app, document);

// 导出 OpenAPI JSON（供 packages/api-client 生成使用）
if (process.env.NODE_ENV !== 'production') {
  const fs = await import('fs');
  fs.writeFileSync('./openapi.json', JSON.stringify(document, null, 2));
}
```

### 3.3 配置全局 ValidationPipe

```bash
bun add class-validator class-transformer
```

`apps/api/src/main.ts`:
```typescript
import { ValidationPipe } from '@nestjs/common';

app.useGlobalPipes(new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
}));
```

### 3.4 配置 DTO Schema 自动推断

```bash
bun add -d @nestjs/swagger/plugin
```

修改 `nest-cli.json`:
```json
{
  "compilerOptions": {
    "plugins": [{
      "name": "@nestjs/swagger",
      "options": {
        "introspectComments": true
      }
    }]
  }
}
```

### 3.5 添加导出脚本

`apps/api/package.json`:
```json
{
  "scripts": {
    "openapi:export": "bun src/scripts/export-openapi.ts"
  }
}
```

`apps/api/src/scripts/export-openapi.ts`:
```typescript
// 仅启动应用、生成文档、写入文件、退出
```

## 验收标准

- [ ] 访问 `http://localhost:3001/docs` 看到 Swagger UI
- [ ] `openapi.json` 文件被生成
- [ ] DTO 类型在 Swagger 中正确显示

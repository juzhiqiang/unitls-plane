// 必须是第一个 import:加载仓库根目录 .env.local(详见 env-loader 注释)。
import '../env-loader';

import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { ApiAppModule } from '../api-app.module';
import { buildSwaggerConfig } from '../config/swagger';

async function exportOpenAPI() {
  const app = await NestFactory.create(ApiAppModule, { logger: false });

  try {
    const document = SwaggerModule.createDocument(app, buildSwaggerConfig());

    const fs = await import('node:fs');
    fs.writeFileSync('./openapi.json', JSON.stringify(document, null, 2));

    console.log('OpenAPI spec exported to openapi.json');
  } finally {
    await app.close();
  }
  process.exit(0);
}

exportOpenAPI().catch(error => {
  console.error('[openapi] 导出失败', error);
  process.exit(1);
});

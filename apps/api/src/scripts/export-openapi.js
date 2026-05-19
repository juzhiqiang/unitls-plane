import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';
async function exportOpenAPI() {
    const app = await NestFactory.create(AppModule, { logger: false });
    const config = new DocumentBuilder()
        .setTitle('Utils-Plane API')
        .setDescription('工具平台 API 文档')
        .setVersion('1.0')
        .addBearerAuth()
        .build();
    const document = SwaggerModule.createDocument(app, config);
    const fs = await import('fs');
    fs.writeFileSync('./openapi.json', JSON.stringify(document, null, 2));
    console.log('OpenAPI spec exported to openapi.json');
    await app.close();
    process.exit(0);
}
exportOpenAPI();
//# sourceMappingURL=export-openapi.js.map
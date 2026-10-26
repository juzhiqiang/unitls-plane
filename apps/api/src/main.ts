// 必须是第一个 import:加载仓库根目录 .env.local(详见 env-loader 注释)。
import './env-loader';

import { NestFactory } from '@nestjs/core';
import { parseProcessRole } from './config/process-role';

async function bootstrapHttp(role: 'all' | 'api') {
  const { buildSwaggerConfig, parseSwaggerEnabled } =
    await import('./config/swagger');
  const swaggerEnabled = parseSwaggerEnabled(
    process.env.SWAGGER_ENABLED,
    process.env.NODE_ENV
  );
  const appModule =
    role === 'api'
      ? (await import('./api-app.module')).ApiAppModule
      : (await import('./app.module')).AppModule;
  const { default: compression } = await import('compression');
  const { ValidationPipe } = await import('@nestjs/common');
  const { isOriginAllowed } = await import('@utils-plane/auth');
  const { AllExceptionsFilter } =
    await import('./common/filters/http-exception.filter');
  const app = await NestFactory.create(appModule);

  try {
    app.enableShutdownHooks();
    app.use(compression());

    app.enableCors({
      origin: (
        origin: string | undefined,
        callback: (error: Error | null, allow?: boolean) => void
      ) => {
        if (!origin || isOriginAllowed(origin)) {
          callback(null, true);
          return;
        }

        callback(null, false);
      },
      credentials: true,
    });

    app.useGlobalFilters(new AllExceptionsFilter());

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    );

    if (swaggerEnabled) {
      const { SwaggerModule } = await import('@nestjs/swagger');
      const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
      SwaggerModule.setup('docs', app, document);

      if (process.env.NODE_ENV !== 'production') {
        const fs = await import('node:fs');
        fs.writeFileSync('./openapi.json', JSON.stringify(document, null, 2));
      }
    }

    await app.listen(process.env.PORT ?? 3001);
  } catch (error) {
    await app.close();
    throw error;
  }
}

async function bootstrapWorker() {
  const { WorkerAppModule } = await import('./worker-app.module');
  const app = await NestFactory.createApplicationContext(WorkerAppModule);
  app.enableShutdownHooks();
}

async function bootstrap() {
  const role = parseProcessRole(process.env.PROCESS_ROLE);

  if (role === 'worker') {
    await bootstrapWorker();
    return;
  }

  await bootstrapHttp(role);
}

bootstrap().catch(error => {
  console.error('[bootstrap] 启动失败', error);
  process.exit(1);
});

import { DocumentBuilder, type OpenAPIObject } from '@nestjs/swagger';

/**
 * Swagger 运行时开关。生产默认关闭，开发默认开启；显式 true/false
 * 覆盖默认值，其它值在启动阶段报错。
 */
export function parseSwaggerEnabled(
  value: string | undefined,
  nodeEnv: string | undefined
): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return nodeEnv?.trim().toLowerCase() !== 'production';
  }

  if (normalized === 'true') return true;
  if (normalized === 'false') return false;

  throw new Error(
    `SWAGGER_ENABLED must be "true" or "false" (received "${value}")`
  );
}

export function buildSwaggerConfig(): Omit<OpenAPIObject, 'paths'> {
  return new DocumentBuilder()
    .setTitle('Utils-Plane API')
    .setDescription('工具平台 API 文档')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
}

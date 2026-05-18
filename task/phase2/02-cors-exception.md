# 02 - CORS + Exception Filters

> 依赖：01-nestjs-init
> 预估：1h
> 可并行：与 03/04/05/06/08 同时执行

## 目标

配置 CORS 允许前端跨域访问，实现全局异常过滤器统一错误格式。

## 步骤

### 2.1 启用 CORS

`apps/api/src/main.ts`:

```typescript
app.enableCors({
  origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'],
  credentials: true,
});
```

### 2.2 创建全局异常过滤器

`apps/api/src/common/filters/http-exception.filter.ts`:

```typescript
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : 500;
    const errorResponse = isHttp ? exception.getResponse() : null;

    const body = {
      code:
        typeof errorResponse === 'object'
          ? ((errorResponse as any).code ?? 'INTERNAL_ERROR')
          : 'INTERNAL_ERROR',
      message:
        typeof errorResponse === 'string'
          ? errorResponse
          : ((errorResponse as any)?.message ?? 'Internal server error'),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (!isHttp) {
      this.logger.error(
        `Unhandled exception: ${exception}`,
        (exception as Error).stack
      );
    }

    response.status(status).json(body);
  }
}
```

### 2.3 注册全局过滤器

`apps/api/src/main.ts`:

```typescript
app.useGlobalFilters(new AllExceptionsFilter());
```

### 2.4 创建错误码常量

`apps/api/src/common/errors/error-codes.ts`:

```typescript
export const ErrorCodes = {
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  TASK_FAILED: 'TASK_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
} as const;
```

## 验收标准

- [ ] 前端跨域请求成功
- [ ] 未捕获异常返回统一格式 JSON
- [ ] 错误日志输出到 console

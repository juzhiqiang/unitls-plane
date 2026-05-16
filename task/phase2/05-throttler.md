# 05 - Rate Limiting (Throttler)

> 依赖：01-nestjs-init、Phase 1 / 06-upstash
> 预估：1.5h
> 可并行：与 02/03/04/06/08 同时执行

## 目标

使用 @nestjs/throttler + Upstash Redis 实现 API 限流，按 IP + User ID 双维度。

## 步骤

### 5.1 安装依赖

```bash
cd apps/api
bun add @nestjs/throttler @nest-lab/throttler-storage-redis ioredis
```

### 5.2 配置 ThrottlerModule

`apps/api/src/config/throttle.config.ts`:
```typescript
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';

export const throttleConfig = ThrottlerModule.forRootAsync({
  useFactory: () => ({
    throttlers: [
      { name: 'anonymous', ttl: 60_000, limit: 10 },
      { name: 'authenticated', ttl: 60_000, limit: 60 },
    ],
    storage: new ThrottlerStorageRedisService(
      new Redis(process.env.UPSTASH_REDIS_URL!, {
        tls: {},
        maxRetriesPerRequest: 3,
      }),
    ),
  }),
});
```

### 5.3 自定义 Throttler Guard

`apps/api/src/common/guards/custom-throttler.guard.ts`:
```typescript
import { ThrottlerGuard } from '@nestjs/throttler';
import { Injectable, ExecutionContext } from '@nestjs/common';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: any): Promise<string> {
    // 优先用 User ID，匿名用 IP
    return req.user?.id ?? req.ip;
  }

  protected getThrottlerName(context: ExecutionContext): string {
    const req = context.switchToHttp().getRequest();
    return req.user ? 'authenticated' : 'anonymous';
  }
}
```

### 5.4 注册全局 Guard

`apps/api/src/app.module.ts`:
```typescript
import { APP_GUARD } from '@nestjs/core';
import { throttleConfig } from './config/throttle.config';
import { CustomThrottlerGuard } from './common/guards/custom-throttler.guard';

@Module({
  imports: [throttleConfig],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },        // 先 Auth
    { provide: APP_GUARD, useClass: CustomThrottlerGuard }, // 再 Throttle
  ],
})
export class AppModule {}
```

### 5.5 返回 RateLimit Headers

确认中间件输出 `X-RateLimit-Limit`、`X-RateLimit-Remaining`、`Retry-After`。

## 验收标准

- [ ] 匿名超过 10 次/分钟 → 429
- [ ] 登录用户超过 60 次/分钟 → 429
- [ ] 限流 Header 正确返回
- [ ] Upstash Redis 中能看到限流 key

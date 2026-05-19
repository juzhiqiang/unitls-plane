import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { ExecutionContext } from '@nestjs/common';

export const throttleConfig = ThrottlerModule.forRootAsync({
  useFactory: () => ({
    throttlers: [
      {
        name: 'default',
        ttl: 60_000,
        limit: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          return req.user ? 60 : 10;
        },
      },
    ],
    storage: new ThrottlerStorageRedisService(
      new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
        maxRetriesPerRequest: 3,
      })
    ),
    getTracker: (req: any) => req.user?.id ?? req.ip,
    setHeaders: true,
  }),
});

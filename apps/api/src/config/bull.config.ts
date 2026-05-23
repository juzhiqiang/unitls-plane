import { BullModule } from '@nestjs/bullmq';

function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password && { password: decodeURIComponent(parsed.password) }),
    ...(parsed.username && { username: decodeURIComponent(parsed.username) }),
  };
}

export const bullConfig = BullModule.forRootAsync({
  useFactory: () => ({
    connection: {
      ...parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: { count: 50, age: 3600 },
      removeOnFail: { count: 200, age: 24 * 3600 },
    },
  }),
});

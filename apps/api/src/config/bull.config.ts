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
      // 连接重建期间，已离线的 BZPOPMIN 也必须有客户端时限。
      // 否则 BullMQ close() 会一直等待该命令，无法完成标准优雅退出。
      // 这只限制 Redis 阻塞命令，不限制 Processor 的任务执行时间。
      blockingTimeout: 30_000,
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

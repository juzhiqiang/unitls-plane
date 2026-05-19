import { BullModule } from '@nestjs/bullmq';
export const bullConfig = BullModule.forRootAsync({
    useFactory: () => ({
        connection: {
            url: process.env.REDIS_URL ?? 'redis://localhost:6379',
            maxRetriesPerRequest: null,
        },
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000,
            },
            removeOnComplete: { count: 100, age: 7 * 24 * 3600 },
            removeOnFail: { count: 500 },
        },
    }),
});
//# sourceMappingURL=bull.config.js.map
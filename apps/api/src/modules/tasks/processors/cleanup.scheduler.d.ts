import { OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
export declare class CleanupScheduler implements OnModuleInit {
    private readonly cleanupQueue;
    constructor(cleanupQueue: Queue);
    onModuleInit(): Promise<void>;
}
//# sourceMappingURL=cleanup.scheduler.d.ts.map
import { WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
export declare class CleanupProcessor extends WorkerHost {
    private readonly logger;
    process(job: Job): Promise<unknown>;
    onFailed(job: Job, err: Error): void;
}
//# sourceMappingURL=cleanup.processor.d.ts.map
import { WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
export declare class ImageProcessor extends WorkerHost {
    private readonly logger;
    process(job: Job): Promise<unknown>;
    onFailed(job: Job, err: Error): void;
}
//# sourceMappingURL=image.processor.d.ts.map
import { WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
export declare class PdfProcessor extends WorkerHost {
    private readonly logger;
    process(job: Job): Promise<unknown>;
    onFailed(job: Job, err: Error): void;
}
//# sourceMappingURL=pdf.processor.d.ts.map
import { WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ImageService } from '../services/image.service';
import { FilesService } from '../../files/files.service';
import { TasksService } from '../tasks.service';
export declare class ImageProcessor extends WorkerHost {
    private readonly imageService;
    private readonly filesService;
    private readonly tasksService;
    private readonly logger;
    constructor(imageService: ImageService, filesService: FilesService, tasksService: TasksService);
    process(job: Job<{
        taskId: string;
    }>): Promise<unknown>;
    onFailed(job: Job, err: Error): void;
}
//# sourceMappingURL=image.processor.d.ts.map
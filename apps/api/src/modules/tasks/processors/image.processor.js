var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ImageProcessor_1;
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ImageService } from '../services/image.service';
import { FilesService } from '../../files/files.service';
import { TasksService } from '../tasks.service';
function getMimeType(format) {
    switch (format) {
        case 'png':
            return 'image/png';
        case 'webp':
            return 'image/webp';
        case 'avif':
            return 'image/avif';
        default:
            return 'image/jpeg';
    }
}
let ImageProcessor = ImageProcessor_1 = class ImageProcessor extends WorkerHost {
    imageService;
    filesService;
    tasksService;
    logger = new Logger(ImageProcessor_1.name);
    constructor(imageService, filesService, tasksService) {
        super();
        this.imageService = imageService;
        this.filesService = filesService;
        this.tasksService = tasksService;
    }
    async process(job) {
        const { taskId } = job.data;
        const task = await this.tasksService.getById(taskId);
        try {
            await this.tasksService.markProcessing(taskId);
            // 1. 下载输入文件
            const fileId = task.inputFileIds?.[0];
            if (!fileId)
                throw new Error('No input file specified');
            const inputFile = await this.filesService.getById(fileId);
            const inputBuffer = await this.filesService.download(inputFile.storageKey);
            await job.updateProgress(20);
            // 2. 处理
            const opts = task.inputConfig;
            const outputBuffer = await this.imageService.compress(inputBuffer, opts);
            await job.updateProgress(70);
            // 3. 上传结果
            const outputFile = await this.filesService.upload(outputBuffer, {
                filename: `compressed-${inputFile.filename}`,
                mimeType: getMimeType(opts.format),
                size: outputBuffer.length,
            }, task.userId ?? undefined);
            await job.updateProgress(95);
            // 4. 更新任务
            await this.tasksService.markCompleted(taskId, outputFile.id);
            await job.updateProgress(100);
            return { outputFileId: outputFile.id };
        }
        catch (err) {
            await this.tasksService.markFailed(taskId, 'IMAGE_PROCESSING_FAILED', err.message);
            throw err;
        }
    }
    onFailed(job, err) {
        this.logger.error(`Job ${job.id} failed: ${err.message}`);
    }
};
__decorate([
    OnWorkerEvent('failed'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Job, Error]),
    __metadata("design:returntype", void 0)
], ImageProcessor.prototype, "onFailed", null);
ImageProcessor = ImageProcessor_1 = __decorate([
    Processor('image-queue', { concurrency: 3 }),
    __metadata("design:paramtypes", [ImageService,
        FilesService,
        TasksService])
], ImageProcessor);
export { ImageProcessor };
//# sourceMappingURL=image.processor.js.map
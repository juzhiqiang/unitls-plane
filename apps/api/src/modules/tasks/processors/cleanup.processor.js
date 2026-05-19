var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var CleanupProcessor_1;
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
let CleanupProcessor = CleanupProcessor_1 = class CleanupProcessor extends WorkerHost {
    logger = new Logger(CleanupProcessor_1.name);
    async process(job) {
        this.logger.log(`Processing cleanup job ${job.id}`);
        // 实际清理逻辑在 Phase 6 实现
        return {};
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
], CleanupProcessor.prototype, "onFailed", null);
CleanupProcessor = CleanupProcessor_1 = __decorate([
    Processor('cleanup-queue')
], CleanupProcessor);
export { CleanupProcessor };
//# sourceMappingURL=cleanup.processor.js.map
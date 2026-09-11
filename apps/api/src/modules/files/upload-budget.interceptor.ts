import {
  Injectable,
  ServiceUnavailableException,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  Logger,
} from '@nestjs/common';
import { defer, finalize } from 'rxjs';

/** 在 Multer 写入临时文件前限制进程内并发，不让上传正文排队驻留内存。 */
@Injectable()
export class UploadBudgetInterceptor implements NestInterceptor {
  private active = 0;
  private readonly logger = new Logger(UploadBudgetInterceptor.name);
  private readonly max = Number(process.env.UPLOAD_MAX_CONCURRENT ?? 2);
  constructor() {
    if (!Number.isInteger(this.max) || this.max < 1 || this.max > 32)
      throw new Error(
        'UPLOAD_MAX_CONCURRENT must be an integer between 1 and 32'
      );
  }
  intercept(_context: ExecutionContext, next: CallHandler) {
    return defer(() => {
      if (this.active >= this.max)
        throw new ServiceUnavailableException(
          'Upload capacity is busy. Please retry shortly.'
        );
      this.active++;
      const before = process.memoryUsage().rss;
      return defer(() => next.handle()).pipe(
        finalize(() => {
          this.active--;
          if (process.env.PERFORMANCE_MEMORY_LOG === 'true') {
            const memory = process.memoryUsage();
            this.logger.log(
              JSON.stringify({
                event: 'upload_memory',
                active: this.active,
                rss: memory.rss,
                rssDelta: memory.rss - before,
                heapUsed: memory.heapUsed,
                external: memory.external,
              })
            );
          }
        })
      );
    });
  }
}

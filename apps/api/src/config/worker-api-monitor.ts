import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

/** Compose 的运行期依赖检查；停机仍交给 Nest/BullMQ 的标准信号处理。 */
@Injectable()
export class WorkerApiMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerApiMonitor.name);
  private timer?: ReturnType<typeof globalThis.setInterval>;
  private stopping = false;
  private checking = false;

  async onModuleInit() {
    const url = process.env.WORKER_API_READY_URL?.trim();
    if (!url) return;
    await this.check(url);
    this.timer = globalThis.setInterval(async () => {
      if (this.stopping || this.checking) return;
      this.checking = true;
      try {
        await this.check(url);
      } catch {
        if (!this.stopping) {
          this.onModuleDestroy();
          this.logger.error('API readiness unavailable; shutting down worker');
          process.kill(process.pid, 'SIGTERM');
        }
      } finally {
        this.checking = false;
      }
    }, 5000);
    this.timer.unref();
  }

  onModuleDestroy() {
    this.stopping = true;
    if (this.timer) globalThis.clearInterval(this.timer);
  }

  private async check(url: string) {
    const response = await fetch(url, {
      signal: globalThis.AbortSignal.timeout(3000),
    });
    await response.body?.cancel();
    if (!response.ok)
      throw new Error(`API readiness returned ${response.status}`);
  }
}

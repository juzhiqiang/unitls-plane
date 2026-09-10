import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MinioService } from '../files/minio.service';
import { AccountTaskQueueService } from './account-task-queue.service';
import { AccountRepository } from './account.repository';

type AccountSummary = Awaited<ReturnType<AccountRepository['getSummary']>>;
type SummaryCacheEntry = {
  expiresAt: number;
  value?: AccountSummary;
  pending?: Promise<AccountSummary>;
};

@Injectable()
export class AccountService {
  private readonly summaryCache = new Map<string, SummaryCacheEntry>();

  constructor(
    private readonly repository: AccountRepository,
    private readonly minio: MinioService,
    private readonly taskQueues: AccountTaskQueueService
  ) {}

  getSummary(userId: string) {
    const now = Date.now();
    const cached = this.summaryCache.get(userId);
    if (cached?.pending) return cached.pending;
    if (cached?.value && cached.expiresAt > now) {
      return Promise.resolve(cached.value);
    }
    if (cached) this.summaryCache.delete(userId);

    let pending: Promise<AccountSummary>;
    pending = this.repository.getSummary(userId).then(
      value => {
        const current = this.summaryCache.get(userId);
        if (current?.pending === pending) {
          this.summaryCache.set(userId, {
            value,
            expiresAt: Date.now() + 2_000,
          });
        }
        return value;
      },
      error => {
        const current = this.summaryCache.get(userId);
        if (current?.pending === pending) this.summaryCache.delete(userId);
        throw error;
      }
    );
    this.summaryCache.set(userId, { expiresAt: now + 2_000, pending });
    return pending;
  }

  private invalidateSummary(userId: string): void {
    this.summaryCache.delete(userId);
  }

  async deleteAccount(
    userId: string,
    confirmationEmail: string
  ): Promise<void> {
    const profile = await this.repository.getDeletionProfile(userId);
    const email = profile.email.trim().toLowerCase();
    if (confirmationEmail.trim().toLowerCase() !== email) {
      throw new BadRequestException('Confirmation email does not match');
    }

    this.invalidateSummary(userId);
    await this.repository.markDeletionStarted(userId);
    const snapshot = await this.repository.getDeletionSnapshot(userId);
    await this.taskQueues.assertNoActiveAndRemove(userId, snapshot.tasks);

    try {
      for (const file of snapshot.files) {
        await this.minio.delete(file.storageKey);
      }
    } catch {
      throw new ServiceUnavailableException('Account deletion is incomplete');
    }

    await this.repository.deleteAccountRecords(userId);
    this.invalidateSummary(userId);
  }
}

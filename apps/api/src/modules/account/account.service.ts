import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MinioService } from '../files/minio.service';
import { AccountTaskQueueService } from './account-task-queue.service';
import { AccountRepository } from './account.repository';

@Injectable()
export class AccountService {
  constructor(
    private readonly repository: AccountRepository,
    private readonly minio: MinioService,
    private readonly taskQueues: AccountTaskQueueService
  ) {}

  getSummary(userId: string) {
    return this.repository.getSummary(userId);
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
  }
}

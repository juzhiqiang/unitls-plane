import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FilesModule } from '../files/files.module';
import { AccountExportService } from './account-export.service';
import { AccountController } from './account.controller';
import { AccountRepository } from './account.repository';
import { AccountService } from './account.service';
import { AccountTaskQueueService } from './account-task-queue.service';

@Module({
  imports: [
    FilesModule,
    BullModule.registerQueue(
      { name: 'image-queue' },
      { name: 'pdf-queue' },
      { name: 'font-queue' },
      { name: 'ai-queue' }
    ),
  ],
  controllers: [AccountController],
  providers: [
    AccountRepository,
    AccountService,
    AccountExportService,
    AccountTaskQueueService,
  ],
})
export class AccountModule {}

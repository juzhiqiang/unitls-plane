import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountSummaryCacheModule } from '../../common/cache/account-summary-cache.module';
import { BullModule } from '@nestjs/bullmq';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { MinioService } from './minio.service';
import { CleanupObligationService } from './cleanup-obligation.service';
import { UploadBudgetInterceptor } from './upload-budget.interceptor';
import { initializeUploadTempDir } from './upload-temp-file';

@Module({
  imports: [
    AccountSummaryCacheModule,
    BullModule.registerQueue({ name: 'cleanup-queue' }),
  ],
  controllers: [FilesController],
  providers: [
    CleanupObligationService,
    FilesService,
    MinioService,
    UploadBudgetInterceptor,
  ],
  exports: [CleanupObligationService, FilesService, MinioService],
})
export class FilesModule implements OnModuleInit {
  onModuleInit() {
    initializeUploadTempDir();
  }
}

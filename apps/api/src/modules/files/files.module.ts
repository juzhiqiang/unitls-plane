import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { MinioService } from './minio.service';
import { CleanupObligationService } from './cleanup-obligation.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'cleanup-queue' })],
  controllers: [FilesController],
  providers: [CleanupObligationService, FilesService, MinioService],
  exports: [CleanupObligationService, FilesService, MinioService],
})
export class FilesModule {}

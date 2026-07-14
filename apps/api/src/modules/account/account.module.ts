import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { AccountExportService } from './account-export.service';
import { AccountController } from './account.controller';
import { AccountRepository } from './account.repository';
import { AccountService } from './account.service';

@Module({
  imports: [FilesModule],
  controllers: [AccountController],
  providers: [AccountRepository, AccountService, AccountExportService],
})
export class AccountModule {}

import { Module } from '@nestjs/common';
import { AccountSummaryCache } from './account-summary-cache.service';

@Module({ providers: [AccountSummaryCache], exports: [AccountSummaryCache] })
export class AccountSummaryCacheModule {}

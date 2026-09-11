import { Module } from '@nestjs/common';
import { AccountSummaryCache } from './account-summary-cache.service';
import {
  ACCOUNT_SUMMARY_REDIS,
  createAccountSummaryRedisAdapter,
} from './account-summary-redis';

@Module({
  providers: [
    {
      provide: ACCOUNT_SUMMARY_REDIS,
      useFactory: createAccountSummaryRedisAdapter,
    },
    AccountSummaryCache,
  ],
  exports: [AccountSummaryCache],
})
export class AccountSummaryCacheModule {}

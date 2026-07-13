import { Injectable } from '@nestjs/common';
import { MinioService } from '../files/minio.service';
import { AccountRepository } from './account.repository';

@Injectable()
export class AccountService {
  constructor(
    private readonly repository: AccountRepository,
    private readonly minio: MinioService
  ) {}

  getSummary(userId: string) {
    return this.repository.getSummary(userId);
  }
}

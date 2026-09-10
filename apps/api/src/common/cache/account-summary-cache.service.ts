import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { AccountRepository } from '../../modules/account/account.repository';

type Summary = Awaited<ReturnType<AccountRepository['getSummary']>>;
type Entry = { expiresAt: number; value?: Summary; pending?: Promise<Summary> };

@Injectable()
export class AccountSummaryCache implements OnModuleInit, OnModuleDestroy {
  private readonly entries = new Map<string, Entry>();
  private timer?: ReturnType<typeof globalThis.setInterval>;

  onModuleInit(): void {
    if (this.timer) return;
    this.timer = globalThis.setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.entries) {
        if (!entry.pending && entry.expiresAt <= now) this.entries.delete(key);
      }
    }, 5_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) globalThis.clearInterval(this.timer);
    this.timer = undefined;
    this.entries.clear();
  }

  invalidate(userId: string | null | undefined): void {
    if (userId) this.entries.delete(userId);
  }

  get(userId: string, read: () => Promise<Summary>): Promise<Summary> {
    if (!userId) return read();
    const cached = this.entries.get(userId);
    if (cached && (cached.pending || cached.expiresAt > Date.now())) {
      this.entries.delete(userId);
      this.entries.set(userId, cached);
      return cached.pending ?? Promise.resolve(cached.value!);
    }
    this.entries.delete(userId);
    const entry: Entry = { expiresAt: 0 };
    // Invoke the loader synchronously, but normalize synchronous failures to rejections.
    let result: Promise<Summary>;
    try {
      result = read();
    } catch (error) {
      return Promise.reject(error);
    }
    entry.pending = result.then(
      value => {
        if (this.entries.get(userId) === entry) {
          entry.value = value;
          entry.pending = undefined;
          entry.expiresAt = Date.now() + 2_000;
        }
        return value;
      },
      error => {
        if (this.entries.get(userId) === entry) this.entries.delete(userId);
        throw error;
      }
    );
    this.entries.set(userId, entry);
    if (this.entries.size > 1000)
      this.entries.delete(this.entries.keys().next().value!);
    return entry.pending;
  }
}

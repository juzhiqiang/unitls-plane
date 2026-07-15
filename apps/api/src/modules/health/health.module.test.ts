import { afterEach, describe, expect, it, vi } from 'bun:test';
import { getQueueToken } from '@nestjs/bullmq';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { db } from '@utils-plane/db';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FilesModule } from '../files/files.module';
import { MinioService } from '../files/minio.service';
import * as libreOfficeHealth from './libreoffice-health';
import { HealthModule } from './health.module';
import {
  HEALTH_CHECKS,
  HealthService,
  type HealthChecks,
} from './health.service';

const queueTokens = [
  getQueueToken('image-queue'),
  getQueueToken('pdf-queue'),
  getQueueToken('font-queue'),
  getQueueToken('cleanup-queue'),
];

interface HealthFactoryProvider {
  provide: symbol;
  inject: unknown[];
  useFactory: (...dependencies: never[]) => HealthChecks;
}

function getHealthFactory(): HealthFactoryProvider {
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    HealthModule
  ) as Array<HealthFactoryProvider | typeof HealthService>;
  const provider = providers.find(
    candidate =>
      typeof candidate === 'object' && candidate.provide === HEALTH_CHECKS
  );
  if (!provider || typeof provider !== 'object') {
    throw new Error('HEALTH_CHECKS provider is missing');
  }
  return provider;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HealthModule metadata', () => {
  it('imports FilesModule and registers all worker queues', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      HealthModule
    ) as Array<unknown>;

    expect(imports).toContain(FilesModule);
    const queueModule = imports.find(
      item =>
        typeof item === 'object' &&
        item !== null &&
        Array.isArray((item as { exports?: unknown[] }).exports)
    ) as { exports: Array<{ provide?: string } | string> };
    const exportedTokens = queueModule.exports.map(item =>
      typeof item === 'object' ? item.provide : item
    );
    expect(exportedTokens).toEqual(queueTokens);
  });

  it('provides HealthService and injects Minio plus queues in order', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      HealthModule
    ) as unknown[];

    expect(providers).toContain(HealthService);
    expect(getHealthFactory().inject).toEqual([MinioService, ...queueTokens]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, HealthModule) ?? []
    ).toEqual([]);
  });
});

describe('HEALTH_CHECKS factory', () => {
  it('adapts database, Redis, MinIO, queues, and LibreOffice checks', async () => {
    const directExecute = vi.fn(async () => []);
    const transactionExecute = vi.fn(async () => []);
    const transaction = vi.fn(
      async (
        callback: (transaction: {
          execute: typeof transactionExecute;
        }) => Promise<void>
      ) => callback({ execute: transactionExecute })
    );
    const database = db as unknown as {
      execute?: typeof directExecute;
      transaction?: typeof transaction;
    };
    const originalExecute = database.execute;
    const originalTransaction = database.transaction;
    database.execute = directExecute;
    database.transaction = transaction;
    const ping = vi.fn(async () => 'PONG');
    const minio = { checkBucket: vi.fn(async () => undefined) };
    const queues = Array.from({ length: 4 }, () => ({
      client: Promise.resolve({ status: 'ready', ping }),
      getJobCounts: vi.fn(async () => ({})),
    }));
    const libreOffice = vi
      .spyOn(libreOfficeHealth, 'checkLibreOffice')
      .mockResolvedValue(true);
    try {
      const checks = getHealthFactory().useFactory(
        minio as never,
        ...(queues as never[])
      );
      const signal = new globalThis.AbortController().signal;

      await checks.database(signal);
      await checks.redis(signal);
      await checks.minio(signal);
      await checks.queues(signal);
      await expect(checks.libreOffice(signal)).resolves.toBe(true);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(transactionExecute).toHaveBeenCalledTimes(2);
      expect(directExecute).not.toHaveBeenCalled();
      const source = readFileSync(join(import.meta.dir, 'health.module.ts'));
      expect(source.toString()).toContain(
        'await tx.execute(sql`SET LOCAL statement_timeout = 2500`)'
      );
      expect(source.toString()).toContain('await tx.execute(sql`SELECT 1`)');
      expect(ping).toHaveBeenCalledTimes(1);
      expect(minio.checkBucket).toHaveBeenCalledWith(signal);
      for (const queue of queues) {
        expect(queue.getJobCounts).toHaveBeenCalledTimes(1);
      }
      expect(libreOffice).toHaveBeenCalledTimes(1);
    } finally {
      if (originalExecute === undefined) {
        delete database.execute;
      } else {
        database.execute = originalExecute;
      }
      if (originalTransaction === undefined) {
        delete database.transaction;
      } else {
        database.transaction = originalTransaction;
      }
    }
  });

  it('fails fast without queueing Redis commands when clients are not ready', async () => {
    const ping = vi.fn(async () => 'PONG');
    const queues = Array.from({ length: 4 }, () => ({
      client: Promise.resolve({ status: 'connecting', ping }),
      getJobCounts: vi.fn(async () => ({})),
    }));
    const checks = getHealthFactory().useFactory(
      { checkBucket: vi.fn() } as never,
      ...(queues as never[])
    );
    const signal = new globalThis.AbortController().signal;

    const results = await Promise.allSettled([
      checks.redis(signal),
      checks.queues(signal),
    ]);

    expect(results.map(result => result.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    expect(ping).not.toHaveBeenCalled();
    for (const queue of queues) {
      expect(queue.getJobCounts).not.toHaveBeenCalled();
    }
  });

  it('does not queue Redis commands after the health signal is aborted', async () => {
    const ping = vi.fn(async () => 'PONG');
    const queues = Array.from({ length: 4 }, () => ({
      client: Promise.resolve({ status: 'ready', ping }),
      getJobCounts: vi.fn(async () => ({})),
    }));
    const checks = getHealthFactory().useFactory(
      { checkBucket: vi.fn() } as never,
      ...(queues as never[])
    );
    const controller = new globalThis.AbortController();
    controller.abort();

    const results = await Promise.allSettled([
      checks.redis(controller.signal),
      checks.queues(controller.signal),
    ]);

    expect(results.map(result => result.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    expect(ping).not.toHaveBeenCalled();
    for (const queue of queues) {
      expect(queue.getJobCounts).not.toHaveBeenCalled();
    }
  });
});

/**
 * 显式执行：bun apps/api/test/modules/files/file-lifecycle.integration.ts
 * 仅连接本机依赖，创建并清理独立数据库和 bucket，绝不操作应用现有文件。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const root = resolve(import.meta.dir, '../../../../..');
config({ path: resolve(root, '.env.local'), quiet: true });
const sourceUrl = new URL(
  process.env.DATABASE_URL ??
    'postgresql://utils:utils@localhost:5433/utils_plane'
);
const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
for (const hostname of [sourceUrl.hostname, new URL(endpoint).hostname]) {
  assert(
    ['localhost', '127.0.0.1', '[::1]'].includes(hostname),
    'Integration tests require local dependencies'
  );
}
const suffix = randomUUID().replaceAll('-', '');
const databaseName = `file_lifecycle_it_${suffix}`;
const bucket = `file-lifecycle-it-${suffix}`;
const admin = postgres(sourceUrl.toString(), { max: 1 });
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${databaseName}`;
process.env.DATABASE_URL = testUrl.toString();
process.env.S3_BUCKET = bucket;
process.env.S3_ENDPOINT = endpoint;
process.env.S3_FORCE_PATH_STYLE = 'true';
let databaseCreated = false;
let bucketCreated = false;
let closeApplication: (() => Promise<void>) | undefined;
const migrationClient = postgres(testUrl.toString(), { max: 1 });
const bucketClient = new S3Client({
  endpoint,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
  },
});

try {
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  await migrate(drizzle(migrationClient), {
    migrationsFolder: resolve(root, 'packages/db/drizzle'),
  });
  const { db, files, user } = await import('@utils-plane/db');
  const { FilesService } =
    await import('../../../src/modules/files/files.service');
  const { MinioService } =
    await import('../../../src/modules/files/minio.service');
  const { ThumbnailCleanupService } =
    await import('../../../src/modules/files/thumbnail-cleanup.service');
  const { CleanupObligationService } =
    await import('../../../src/modules/files/cleanup-obligation.service');
  const { AccountSummaryCache } =
    await import('../../../src/common/cache/account-summary-cache.service');
  const minio = new MinioService();
  const cache = new AccountSummaryCache();
  closeApplication = async () => {
    await cache.onModuleDestroy();
    await db.$client.end();
    (minio as unknown as { client: S3Client }).client.destroy();
  };
  await minio.onModuleInit();
  bucketCreated = true;
  const service = new FilesService(
    minio,
    {} as never,
    new CleanupObligationService(),
    cache
  );
  const owner = randomUUID();
  await db.insert(user).values({
    id: owner,
    name: 'Lifecycle integration',
    email: `${owner}@example.invalid`,
  });
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();

  async function fixture(trashed = true) {
    const id = randomUUID();
    const storageKey = `test-fixtures/${id}/source.png`;
    await minio.upload(storageKey, png, 'image/png');
    const [file] = await db
      .insert(files)
      .values({
        id,
        userId: owner,
        filename: 'source.png',
        originalSize: png.length,
        storageKey,
        mimeType: 'image/png',
        deletedAt: trashed ? new Date() : null,
      })
      .returning();
    assert(file);
    return file;
  }

  const multiVersion = await fixture();
  await minio.upload(
    `thumbnails/${multiVersion.id}/1-320.webp`,
    png,
    'image/webp'
  );
  await minio.upload(
    `thumbnails/${multiVersion.id}/2-640.webp`,
    png,
    'image/webp'
  );
  await service.permanentDelete(multiVersion.id, owner);
  assert.equal(
    await db.query.files.findFirst({ where: eq(files.id, multiVersion.id) }),
    undefined
  );
  assert.equal(await minio.probeObjectExists(multiVersion.storageKey), false);
  assert.equal(
    (await minio.listObjects(`thumbnails/${multiVersion.id}/`)).objects.length,
    0
  );
  console.log(
    'PASS: permanent deletion removes original, all thumbnail versions and the row'
  );

  const retryFile = await fixture(false);
  const realDeletePrefix = minio.deletePrefix.bind(minio);
  minio.deletePrefix = async () => {
    throw new Error('injected thumbnail failure');
  };
  await assert.rejects(
    service.forceDeleteOwned(retryFile.id, owner),
    /injected thumbnail failure/
  );
  minio.deletePrefix = realDeletePrefix;
  const pending = await db.query.files.findFirst({
    where: eq(files.id, retryFile.id),
  });
  assert(pending?.purgeStartedAt);
  await assert.rejects(service.restore(retryFile.id, owner), /File not found/);
  await assert.rejects(
    service.forceDeleteOwned(retryFile.id, owner),
    /in progress/
  );
  await db
    .update(files)
    .set({ purgeStartedAt: new Date(Date.now() - 10 * 60 * 1000) })
    .where(eq(files.id, retryFile.id));
  const retried = await service.cleanupTrashed();
  assert(retried.deletedFileIds.includes(retryFile.id));
  console.log(
    'PASS: non-trash partial deletion blocks restore and recovers after its lease'
  );

  const uncertainFile = await fixture();
  const realDelete = minio.delete.bind(minio);
  let finishLateDelete!: () => void;
  const lateDeleteGate = new Promise<void>(resolve => {
    finishLateDelete = resolve;
  });
  const lateDelete = lateDeleteGate.then(() =>
    realDelete(uncertainFile.storageKey)
  );
  minio.delete = async () => {
    throw new Error('injected response timeout');
  };
  try {
    await assert.rejects(
      service.permanentDelete(uncertainFile.id, owner),
      /injected response timeout/
    );
    assert.equal(await minio.probeObjectExists(uncertainFile.storageKey), true);
    await assert.rejects(
      service.restore(uncertainFile.id, owner),
      /File not found/
    );
  } finally {
    minio.delete = realDelete;
    finishLateDelete();
    await lateDelete;
  }
  await db
    .update(files)
    .set({ purgeStartedAt: new Date(Date.now() - 10 * 60 * 1000) })
    .where(eq(files.id, uncertainFile.id));
  assert(
    (await service.cleanupTrashed()).deletedFileIds.includes(uncertainFile.id)
  );
  console.log(
    'PASS: a timed-out delete cannot enable restore before its late storage completion'
  );

  const softFile = await fixture();
  const originalDeletedAt = softFile.deletedAt!.getTime();
  await service.softDelete(softFile.id, owner);
  await service.batchSoftDelete([softFile.id], owner);
  assert.equal(
    (
      await db.query.files.findFirst({ where: eq(files.id, softFile.id) })
    )?.deletedAt?.getTime(),
    originalDeletedAt
  );
  await service.restore(softFile.id, owner);
  assert.equal(
    (await db.query.files.findFirst({ where: eq(files.id, softFile.id) }))
      ?.deletedAt,
    null
  );
  console.log(
    'PASS: repeated soft deletion preserves retention date and restore works'
  );

  const racingFile = await fixture(false);
  let uploadStarted!: () => void;
  let allowUpload!: () => void;
  const started = new Promise<void>(resolve => {
    uploadStarted = resolve;
  });
  const gate = new Promise<void>(resolve => {
    allowUpload = resolve;
  });
  const realUpload = minio.upload.bind(minio);
  minio.upload = async (key, body, mimeType) => {
    if (key.startsWith(`thumbnails/${racingFile.id}/`)) {
      uploadStarted();
      await gate;
    }
    await realUpload(key, body, mimeType);
  };
  const thumbnail = service.thumbnail(racingFile);
  try {
    await started;
    await service.forceDeleteOwned(racingFile.id, owner);
  } finally {
    allowUpload();
  }
  await thumbnail;
  minio.upload = realUpload;
  assert.equal(
    (await minio.listObjects(`thumbnails/${racingFile.id}/`)).objects.length,
    0
  );
  console.log(
    'PASS: thumbnail upload completing after deletion is compensated'
  );

  await minio.upload(`thumbnails/${softFile.id}/1-320.webp`, png, 'image/webp');
  const trashFile = await fixture();
  await minio.upload(
    `thumbnails/${trashFile.id}/1-320.webp`,
    png,
    'image/webp'
  );
  const orphanIds = Array.from({ length: 105 }, () => randomUUID());
  for (const id of orphanIds)
    await minio.upload(`thumbnails/${id}/1-320.webp`, png, 'image/webp');
  const cleanup = new ThumbnailCleanupService(minio);
  let cursor: string | undefined;
  let pages = 0;
  let deleted = 0;
  do {
    const page = await cleanup.cleanupPage(cursor);
    assert(page.scanned <= 100);
    assert.equal(page.failed, 0);
    pages++;
    deleted += page.deleted;
    cursor = page.continuationToken;
  } while (cursor);
  assert(pages >= 2);
  assert.equal(deleted, 105);
  assert.equal(
    await minio.probeObjectExists(`thumbnails/${softFile.id}/1-320.webp`),
    true
  );
  assert.equal(
    await minio.probeObjectExists(`thumbnails/${trashFile.id}/1-320.webp`),
    true
  );
  console.log(
    'PASS: real MinIO pagination reclaims 105 orphan thumbnails and preserves active/trash caches'
  );

  await minio.deletePrefix('test-fixtures/');
  await minio.deletePrefix('thumbnails/');
} finally {
  try {
    if (bucketCreated) {
      // 全部对象只位于本脚本新建的 bucket；失败时也只回收这个隔离命名空间。
      const { MinioService } =
        await import('../../../src/modules/files/minio.service');
      const cleanup = new MinioService();
      try {
        await cleanup.deletePrefix('test-fixtures/');
        await cleanup.deletePrefix('thumbnails/');
        await bucketClient.send(new DeleteBucketCommand({ Bucket: bucket }));
      } finally {
        (cleanup as unknown as { client: S3Client }).client.destroy();
      }
    }
  } finally {
    await closeApplication?.();
    await migrationClient.end();
    if (databaseCreated)
      await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end();
    bucketClient.destroy();
  }
}

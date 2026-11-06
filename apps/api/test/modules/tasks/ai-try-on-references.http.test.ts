import 'reflect-metadata';
import { expect, it } from 'bun:test';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AiTryOnReferencesController } from '../../../src/modules/tasks/ai-try-on-references.controller';
import { AiTryOnReferencesService } from '../../../src/modules/tasks/services/ai-try-on-references.service';

it('revalidates the public catalog with ETags and returns changed or removed assets immediately', async () => {
  let rows = [{ id: 'pose-1', title: 'First pose' }];
  @Module({
    controllers: [AiTryOnReferencesController],
    providers: [
      {
        provide: AiTryOnReferencesService,
        useValue: { list: async () => rows },
      },
    ],
  })
  class CatalogTestModule {}
  const app = await NestFactory.create(CatalogTestModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  );
  try {
    await app.listen(0, '127.0.0.1');
    const url = `${await app.getUrl()}/tasks/ai-try-on/references?kind=pose&lang=zh`;
    const first = await fetch(url);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe(
      'public, max-age=0, must-revalidate'
    );
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    expect(await first.json()).toEqual(rows);
    const headers = { 'If-None-Match': etag! };
    const unchanged = await fetch(url, { headers });
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe('');
    rows = [{ id: 'pose-1', title: 'Edited pose' }];
    const changed = await fetch(url, { headers });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual([
      { id: 'pose-1', title: 'Edited pose' },
    ]);
    rows = [];
    const removed = await fetch(url, { headers });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual([]);
    expect(
      (await fetch(url.replace('kind=pose', 'kind=private'), { headers }))
        .status
    ).toBe(400);
  } finally {
    await app.close();
  }
});

import { expect, it, vi } from 'bun:test';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { PDFDocument } from '@cantoo/pdf-lib';
import { FilesService } from '../../../src/modules/files/files.service';
import { runWithTaskResources } from '../../../src/common/resources/task-resource-context';
import { resourceLimits } from '../../../src/common/resources/resource-limits';
import { TaskResourceLimitError } from '../../../src/common/resources/resource-error';

function fixture(
  buffer: Buffer,
  mimeType: string,
  declaredSize = buffer.length
) {
  const stream = Readable.from([buffer]);
  const minio = {
    downloadStream: vi.fn(async () => stream),
    download: vi.fn(),
  };
  return {
    stream,
    minio,
    service: new FilesService(minio as never, {} as never, {} as never),
    resources: {
      limits: resourceLimits({}),
      inputBytes: declaredSize,
      files: new Map([['key', { originalSize: declaredSize, mimeType }]]),
    },
  };
}

it('低报文件大小在读取时拒绝并中止底层请求', async () => {
  const { service, resources, stream, minio } = fixture(
    Buffer.alloc(6),
    'font/ttf',
    5
  );
  await expect(
    runWithTaskResources(resources, () => service.download('key'))
  ).rejects.toBeInstanceOf(TaskResourceLimitError);
  expect(stream.destroyed).toBe(true);
  expect(
    (minio.downloadStream.mock.calls[0]?.[1] as globalThis.AbortSignal).aborted
  ).toBe(true);
  expect(minio.download).not.toHaveBeenCalled();
});

it('文件下载在返回业务层前检查真实像素', async () => {
  const png = await sharp({
    create: { width: 10, height: 10, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  const { service, resources } = fixture(png, 'image/png');
  resources.limits.imagePixels = 99;
  await expect(
    runWithTaskResources(resources, () => service.download('key'))
  ).rejects.toBeInstanceOf(TaskResourceLimitError);
});

it('PDF 任务按累计实际读取页数限制，并包含重复输入', async () => {
  const document = await PDFDocument.create();
  document.addPage([10, 10]);
  const pdf = Buffer.from(await document.save());
  const minio = { downloadStream: vi.fn(async () => Readable.from([pdf])) };
  const service = new FilesService(minio as never, {} as never, {} as never);
  const resources = {
    limits: { ...resourceLimits({}), pdfPages: 1 },
    inputBytes: pdf.length * 2,
    files: new Map([
      ['key', { originalSize: pdf.length, mimeType: 'application/pdf' }],
    ]),
  };
  await runWithTaskResources(resources, async () => {
    expect(await service.download('key')).toEqual(pdf);
    await expect(service.download('key')).rejects.toBeInstanceOf(
      TaskResourceLimitError
    );
  });
});

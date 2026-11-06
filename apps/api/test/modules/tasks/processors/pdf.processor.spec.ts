const resourceBudget = {
  run: async (
    _task: unknown,
    _job: unknown,
    _token: unknown,
    operation: () => Promise<unknown>
  ) => operation(),
};
import { describe, expect, it, mock, vi } from 'bun:test';
import { UnrecoverableError, type Job } from 'bullmq';
import { inflateRawSync } from 'node:zlib';
import sharp from 'sharp';
import type { FilesService } from '../../../../src/modules/files/files.service';
import type { TasksService } from '../../../../src/modules/tasks/tasks.service';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { PdfService } from '../../../../src/modules/tasks/services/pdf.service';
import { PdfCadExtractorService } from '../../../../src/modules/tasks/services/cad/pdf-cad-extractor.service';
import { PdfToCadService } from '../../../../src/modules/tasks/services/cad/pdf-to-cad.service';
import { CadError } from '../../../../src/modules/tasks/services/cad/types';
import { createVectorLinesFixture } from '../services/cad/fixtures';

const getTaskOutputOwner = mock(async () => ({
  id: 'user-1',
  plan: 'team',
  role: 'admin',
}));

mock.module(
  '../../../../src/modules/tasks/processors/task-output-owner',
  () => ({ getTaskOutputOwner })
);

const { PdfProcessor } =
  await import('../../../../src/modules/tasks/processors/pdf.processor');

function readZipEntries(zip: Buffer): { name: string; data: Buffer }[] {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const entries: { name: string; data: Buffer }[] = [];
  for (let index = 0; index < count; index++) {
    expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
    const compression = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const dataStart =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const compressed = zip.subarray(dataStart, dataStart + size);
    entries.push({
      name: zip.subarray(offset + 46, offset + 46 + nameLength).toString(),
      data: compression === 8 ? inflateRawSync(compressed) : compressed,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function createTasksService(inputConfig: Record<string, unknown>) {
  return {
    getById: vi.fn().mockResolvedValue({
      id: 'task-1',
      type: 'pdf_to_cad',
      userId: 'user-1',
      inputFileIds: ['file-1'],
      inputConfig,
    }),
    markProcessing: vi.fn(),
    updateProgress: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    markRetrying: vi.fn(),
  };
}

function createFilesService(
  pdf: Buffer,
  overrides: Record<string, unknown> = {}
) {
  return {
    getById: vi.fn().mockResolvedValue({
      id: 'file-1',
      filename: 'plan.pdf',
      mimeType: 'application/pdf',
      originalSize: pdf.length,
      storageKey: 'uploads/plan.pdf',
      ...overrides,
    }),
    download: vi.fn().mockResolvedValue(pdf),
    upload: vi.fn().mockResolvedValue({ id: 'output-1' }),
  };
}

function createJob(attemptsMade = 0) {
  const job = {
    id: 'job-1',
    data: { taskId: 'task-1' },
    attemptsMade,
    updateProgress: vi.fn(),
    opts: { attempts: 3 },
  };
  return job as typeof job & Job<{ taskId: string }>;
}

const pdfService = {
  getPageCount: vi.fn(async (buffer: Buffer) => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    return (await PDFDocument.load(buffer)).getPageCount();
  }),
};

function createProcessor(
  filesService: ReturnType<typeof createFilesService>,
  tasksService: ReturnType<typeof createTasksService>,
  pdfToCad: Pick<PdfToCadService, 'convert'> = new PdfToCadService(
    new PdfCadExtractorService()
  )
) {
  return new PdfProcessor(
    pdfService as unknown as PdfService,
    filesService as unknown as FilesService,
    tasksService as unknown as TasksService,
    pdfToCad as unknown as PdfToCadService,
    resourceBudget as never
  );
}

describe('PdfProcessor zip outputs', () => {
  it('bundles multi-part split results into a real ZIP archive', async () => {
    const fixture = await createVectorLinesFixture();
    const filesService = createFilesService(fixture.pdf);
    const tasksService = createTasksService({ mode: 'every', every: 1 });
    tasksService.getById.mockResolvedValue({
      id: 'task-1',
      type: 'pdf_split',
      userId: 'user-1',
      inputFileIds: ['file-1'],
      inputConfig: { mode: 'every', every: 1 },
    });
    const splitService = {
      split: vi
        .fn()
        .mockResolvedValue([
          Buffer.from('%PDF-part-1'),
          Buffer.from('%PDF-part-2'),
        ]),
    };
    const processor = new PdfProcessor(
      splitService as unknown as PdfService,
      filesService as unknown as FilesService,
      tasksService as unknown as TasksService,
      {} as PdfToCadService,
      resourceBudget as never
    );

    await processor.process(createJob());

    // archiver v8 没有 create():这里保证 ZIP 分支真的走通,产物是带 PK 签名的归档。
    expect(filesService.upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        filename: 'split-plan.zip',
        mimeType: 'application/zip',
      }),
      { id: 'user-1', plan: 'team', role: 'admin' }
    );
    const zip = filesService.upload.mock.calls[0]![0] as Buffer;
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(readZipEntries(zip)).toEqual([
      { name: 'part-1.pdf', data: Buffer.from('%PDF-part-1') },
      { name: 'part-2.pdf', data: Buffer.from('%PDF-part-2') },
    ]);
    expect(tasksService.markCompleted).toHaveBeenCalledWith(
      'task-1',
      'output-1'
    );
  });
});

describe('PdfProcessor pdf_to_cad', () => {
  it('converts a PDF into a DXF, uploads it and records conversion metadata', async () => {
    const fixture = await createVectorLinesFixture();
    const filesService = createFilesService(fixture.pdf);
    const tasksService = createTasksService({ format: 'dxf', unit: 'mm' });
    const processor = createProcessor(filesService, tasksService);
    const job = createJob();

    const result = await processor.process(job);

    expect(getTaskOutputOwner).toHaveBeenCalledWith('user-1');
    expect(filesService.upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        filename: 'plan.dxf',
        mimeType: 'application/dxf',
      }),
      { id: 'user-1', plan: 'team', role: 'admin' }
    );
    const uploaded = filesService.upload.mock.calls[0]![0] as Buffer;
    expect(uploaded.toString('latin1')).toContain('AC1015');
    expect(tasksService.markCompleted).toHaveBeenCalledWith(
      'task-1',
      'output-1',
      expect.objectContaining({
        converterVersion: '1.0.0',
        format: 'dxf',
        unit: 'mm',
        pageCount: 1,
        entityCount: fixture.expected.entityCount,
        entityCountBySource: fixture.expected.bySource,
        ocrTextCount: 0,
        underlay: false,
      })
    );
    expect(result).toMatchObject({ outputFileId: 'output-1' });
    const progress = tasksService.updateProgress.mock.calls.map(
      call => call[1]
    );
    expect(progress[0]).toBe(5);
    expect(progress[progress.length - 1]).toBe(100);
    expect([...progress]).toEqual([...progress].sort((a, b) => a - b));
    expect(tasksService.markFailed).not.toHaveBeenCalled();
  });

  it('fails DWG requests with CAD_DWG_UNSUPPORTED and never uploads a file', async () => {
    const fixture = await createVectorLinesFixture();
    const filesService = createFilesService(fixture.pdf);
    const tasksService = createTasksService({ format: 'dwg' });
    const processor = createProcessor(filesService, tasksService);

    let caught: unknown;
    try {
      await processor.process(createJob());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnrecoverableError);
    expect(tasksService.markFailed).toHaveBeenCalledWith(
      'task-1',
      'CAD_DWG_UNSUPPORTED',
      expect.stringContaining('DWG')
    );
    expect(filesService.upload).not.toHaveBeenCalled();
    expect(tasksService.markCompleted).not.toHaveBeenCalled();
    expect(tasksService.markRetrying).not.toHaveBeenCalled();
  });

  it('fails with CAD_OCR_UNAVAILABLE when the OCR engine is missing', async () => {
    const fixture = await createVectorLinesFixture();
    const filesService = createFilesService(fixture.pdf);
    const tasksService = createTasksService({ ocr: true });
    const processor = createProcessor(filesService, tasksService, {
      convert: vi
        .fn()
        .mockRejectedValue(
          new CadError('CAD_OCR_UNAVAILABLE', 'Tesseract OCR is not available')
        ),
    });

    await expect(processor.process(createJob())).rejects.toBeInstanceOf(
      UnrecoverableError
    );
    expect(tasksService.markFailed).toHaveBeenCalledWith(
      'task-1',
      'CAD_OCR_UNAVAILABLE',
      'Tesseract OCR is not available'
    );
    expect(filesService.upload).not.toHaveBeenCalled();
  });

  it('rejects an invalid config before downloading anything', async () => {
    const fixture = await createVectorLinesFixture();
    const filesService = createFilesService(fixture.pdf);
    const tasksService = createTasksService({ scale: 0, unit: 'cm' });
    const processor = createProcessor(filesService, tasksService);

    await expect(processor.process(createJob())).rejects.toBeInstanceOf(
      UnrecoverableError
    );
    expect(tasksService.markFailed).toHaveBeenCalledWith(
      'task-1',
      'CAD_INVALID_CONFIG',
      expect.stringContaining('scale')
    );
    expect(filesService.download).not.toHaveBeenCalled();
  });

  it('rejects non-PDF input and oversized files with CAD_INVALID_CONFIG', async () => {
    const fixture = await createVectorLinesFixture();
    const notPdf = createFilesService(fixture.pdf, {
      mimeType: 'image/png',
      filename: 'plan.png',
    });
    const tasksService = createTasksService({});
    await expect(
      createProcessor(notPdf, tasksService).process(createJob())
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(tasksService.markFailed).toHaveBeenLastCalledWith(
      'task-1',
      'CAD_INVALID_CONFIG',
      expect.stringContaining('not a PDF')
    );

    const tooLarge = createFilesService(fixture.pdf, {
      originalSize: 51 * 1024 * 1024,
    });
    const tasksService2 = createTasksService({});
    await expect(
      createProcessor(tooLarge, tasksService2).process(createJob())
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(tasksService2.markFailed).toHaveBeenLastCalledWith(
      'task-1',
      'CAD_INVALID_CONFIG',
      expect.stringContaining('50MB')
    );
    expect(tooLarge.download).not.toHaveBeenCalled();
  });

  it('fails corrupted PDFs with CAD_CONVERSION_FAILED', async () => {
    const filesService = createFilesService(Buffer.from('%PDF-not-really'));
    const tasksService = createTasksService({});
    const processor = createProcessor(filesService, tasksService);

    await expect(processor.process(createJob())).rejects.toBeInstanceOf(
      UnrecoverableError
    );
    expect(tasksService.markFailed).toHaveBeenCalledWith(
      'task-1',
      'CAD_CONVERSION_FAILED',
      expect.any(String)
    );
    expect(filesService.upload).not.toHaveBeenCalled();
  });

  it('keeps retrying transient failures instead of writing failed', async () => {
    const fixture = await createVectorLinesFixture();
    const filesService = createFilesService(fixture.pdf);
    filesService.download.mockRejectedValueOnce(new Error('MinIO unavailable'));
    const tasksService = createTasksService({});
    const processor = createProcessor(filesService, tasksService);

    await expect(processor.process(createJob(0))).rejects.toThrow(
      'MinIO unavailable'
    );
    expect(tasksService.markRetrying).toHaveBeenCalledWith('task-1');
    expect(tasksService.markFailed).not.toHaveBeenCalled();
  });

  it('writes PDF_PROCESSING_FAILED once transient failures exhaust their attempts', async () => {
    const fixture = await createVectorLinesFixture();
    const filesService = createFilesService(fixture.pdf);
    filesService.download.mockRejectedValueOnce(new Error('MinIO unavailable'));
    const tasksService = createTasksService({});
    const processor = createProcessor(filesService, tasksService);

    await expect(processor.process(createJob(2))).rejects.toThrow(
      'MinIO unavailable'
    );
    expect(tasksService.markFailed).toHaveBeenCalledWith(
      'task-1',
      'PDF_PROCESSING_FAILED',
      'MinIO unavailable'
    );
  });
});

describe('PdfProcessor operation dispatch', () => {
  async function textPdf(text: string) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText(text, { x: 50, y: 700, font });
    return Buffer.from(await doc.save());
  }

  const pageOperations: {
    type: string;
    config: Record<string, unknown>;
    filename: string;
    verify: (output: Buffer, service: PdfService) => Promise<void>;
  }[] = [
    {
      type: 'pdf_rotate',
      config: { pages: [0], angle: 90 },
      filename: 'rotated-plan.pdf',
      verify: async output => {
        expect(
          (await PDFDocument.load(output)).getPage(0).getRotation().angle
        ).toBe(90);
      },
    },
    {
      type: 'pdf_watermark',
      config: { text: 'Private', fontSize: 18 },
      filename: 'watermarked-plan.pdf',
      verify: async (output, service) => {
        expect(await service.toText(output, { format: 'text' })).toContain(
          'Private'
        );
      },
    },
    {
      type: 'pdf_encrypt',
      config: { userPassword: 'secret', ownerPassword: 'owner' },
      filename: 'encrypted-plan.pdf',
      verify: async output => {
        await expect(PDFDocument.load(output)).rejects.toThrow();
      },
    },
    {
      type: 'pdf_metadata',
      config: { title: 'Retitled', keywords: ['one', 'two'] },
      filename: 'plan.pdf',
      verify: async (output, service) => {
        expect(await service.getMetadata(output)).toMatchObject({
          title: 'Retitled',
          keywords: ['one two'],
        });
      },
    },
    {
      type: 'pdf_rearrange',
      config: { pageOrder: [0, 0] },
      filename: 'rearranged-plan.pdf',
      verify: async (output, service) => {
        expect(await service.getPageCount(output)).toBe(2);
      },
    },
    {
      type: 'pdf_compress',
      config: { level: 'heavy' },
      filename: 'compressed-plan.pdf',
      verify: async (output, service) => {
        expect(await service.getPageCount(output)).toBe(1);
      },
    },
    {
      type: 'pdf_split',
      config: { mode: 'ranges', ranges: [[0, 0]] },
      filename: 'split-plan.pdf',
      verify: async (output, service) => {
        expect((await service.toText(output, { format: 'text' })).trim()).toBe(
          'Content'
        );
      },
    },
  ];

  for (const operation of pageOperations) {
    it(`dispatches ${operation.type} with its options and uploads the resulting PDF`, async () => {
      const input = await textPdf('Content');
      const files = createFilesService(input);
      const tasks = createTasksService({});
      tasks.getById.mockResolvedValue({
        id: 'task-1',
        type: operation.type,
        userId: 'user-1',
        inputFileIds: ['file-1'],
        inputConfig: operation.config,
      });
      const service = new PdfService();
      const processor = new PdfProcessor(
        service,
        files as unknown as FilesService,
        tasks as unknown as TasksService,
        {} as PdfToCadService,
        resourceBudget as never
      );

      const result = await processor.process(createJob());
      const output = files.upload.mock.calls[0]![0] as Buffer;
      await operation.verify(output, service);
      expect(files.upload.mock.calls[0]![1]).toEqual({
        filename: operation.filename,
        mimeType: 'application/pdf',
        size: output.length,
      });
      expect(result).toMatchObject({ outputFileId: 'output-1' });
      expect(tasks.markCompleted).toHaveBeenCalledWith('task-1', 'output-1');
      if (operation.type === 'pdf_compress') {
        expect(result).toMatchObject({
          originalSize: input.length,
          compressedSize: output.length,
        });
      }
    });
  }

  it('converts an image using the page-size and fit options', async () => {
    const png = await sharp({
      create: { width: 12, height: 6, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    const files = createFilesService(png, {
      filename: 'picture.png',
      mimeType: 'image/png',
    });
    const tasks = createTasksService({});
    tasks.getById.mockResolvedValue({
      id: 'task-1',
      type: 'image_to_pdf',
      userId: 'user-1',
      inputFileIds: ['file-1'],
      inputConfig: {
        pageSize: 'letter',
        fit: 'fill',
        outputFilename: 'picture.pdf',
      },
    });
    const processor = new PdfProcessor(
      new PdfService(),
      files as unknown as FilesService,
      tasks as unknown as TasksService,
      {} as PdfToCadService,
      resourceBudget as never
    );
    await processor.process(createJob());

    const output = files.upload.mock.calls[0]![0] as Buffer;
    expect((await PDFDocument.load(output)).getPage(0).getSize()).toEqual({
      width: 612,
      height: 792,
    });
    expect(files.upload.mock.calls[0]![1]).toMatchObject({
      filename: 'picture.pdf',
    });
    expect(tasks.updateProgress.mock.calls.map(call => call[1])).toEqual([
      50, 85, 100,
    ]);
  });

  it('infers Markdown input, normalizes the PDF filename and uploads readable fallback content', async () => {
    const previous = process.env.LIBREOFFICE_BIN;
    process.env.LIBREOFFICE_BIN = 'utils-plane-missing-libreoffice';
    try {
      const files = createFilesService(Buffer.from('# Document content'), {
        filename: 'report.markdown',
        mimeType: 'text/plain',
      });
      const tasks = createTasksService({});
      tasks.getById.mockResolvedValue({
        id: 'task-1',
        type: 'pdf_from_document',
        userId: 'user-1',
        inputFileIds: ['file-1'],
        inputConfig: { outputFilename: ' Export/Report ' },
      });
      const service = new PdfService();
      const processor = new PdfProcessor(
        service,
        files as unknown as FilesService,
        tasks as unknown as TasksService,
        {} as PdfToCadService,
        resourceBudget as never
      );
      await processor.process(createJob());

      const output = files.upload.mock.calls[0]![0] as Buffer;
      expect(await service.toText(output, { format: 'text' })).toContain(
        'Document content'
      );
      expect(files.upload.mock.calls[0]![1]).toEqual({
        filename: 'Export_Report.pdf',
        mimeType: 'application/pdf',
        size: output.length,
      });
      expect(tasks.updateProgress.mock.calls.map(call => call[1])).toEqual([
        20, 85, 100,
      ]);
    } finally {
      if (previous === undefined) delete process.env.LIBREOFFICE_BIN;
      else process.env.LIBREOFFICE_BIN = previous;
    }
  });

  it('keeps an upload failure retryable without completing the task', async () => {
    const files = createFilesService(await textPdf('Content'));
    files.upload.mockRejectedValueOnce(new Error('upload unavailable'));
    const tasks = createTasksService({});
    tasks.getById.mockResolvedValue({
      id: 'task-1',
      type: 'pdf_rotate',
      userId: 'user-1',
      inputFileIds: ['file-1'],
      inputConfig: { pages: [0], angle: 90 },
    });
    const processor = new PdfProcessor(
      new PdfService(),
      files as unknown as FilesService,
      tasks as unknown as TasksService,
      {} as PdfToCadService,
      resourceBudget as never
    );

    await expect(processor.process(createJob())).rejects.toThrow(
      'upload unavailable'
    );
    expect(tasks.markRetrying).toHaveBeenCalledWith('task-1');
    expect(tasks.markCompleted).not.toHaveBeenCalled();
    expect(tasks.markFailed).not.toHaveBeenCalled();
    expect(tasks.updateProgress.mock.calls.map(call => call[1])).toEqual([
      20, 85,
    ]);
  });

  it('zips rendered images in the selected page order with their real dimensions', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([72, 144]);
    doc.addPage([144, 72]);
    const input = Buffer.from(await doc.save());
    const files = createFilesService(input);
    const tasks = createTasksService({});
    tasks.getById.mockResolvedValue({
      id: 'task-1',
      type: 'pdf_to_image',
      userId: 'user-1',
      inputFileIds: ['file-1'],
      inputConfig: { format: 'png', dpi: 72, pages: [1, 0] },
    });
    const processor = new PdfProcessor(
      new PdfService(),
      files as unknown as FilesService,
      tasks as unknown as TasksService,
      {} as PdfToCadService,
      resourceBudget as never
    );
    await processor.process(createJob());

    const entries = readZipEntries(files.upload.mock.calls[0]![0] as Buffer);
    expect(entries.map(entry => entry.name)).toEqual([
      'page-2.png',
      'page-1.png',
    ]);
    const [second, first] = await Promise.all(
      entries.map(entry => sharp(entry.data).metadata())
    );
    expect(second).toMatchObject({ format: 'png', width: 144, height: 72 });
    expect(first).toMatchObject({ format: 'png', width: 72, height: 144 });
    expect(files.upload.mock.calls[0]![1]).toMatchObject({
      filename: 'plan-images.zip',
      mimeType: 'application/zip',
    });
    expect(tasks.updateProgress.mock.calls.map(call => call[1])).toEqual([
      10, 45, 80, 90, 100,
    ]);
  });

  it('merges files in configured order and completes both progress channels', async () => {
    const first = await textPdf('First');
    const second = await textPdf('Second');
    const files = createFilesService(first);
    files.getById.mockImplementation(async (id: string) => ({
      id,
      filename: `${id}.pdf`,
      mimeType: 'application/pdf',
      originalSize: first.length,
      storageKey: id,
    }));
    files.download.mockImplementation(async (key: string) =>
      key === 'second' ? second : first
    );
    const tasks = createTasksService({});
    tasks.getById.mockResolvedValue({
      id: 'task-1',
      type: 'pdf_merge',
      userId: 'user-1',
      inputFileIds: ['first', 'second'],
      inputConfig: {
        order: ['second', 'first'],
        outputFilename: 'ordered.pdf',
      },
    });
    const service = new PdfService();
    const processor = new PdfProcessor(
      service,
      files as unknown as FilesService,
      tasks as unknown as TasksService,
      {} as PdfToCadService,
      resourceBudget as never
    );
    const job = createJob();

    expect(await processor.process(job)).toEqual({ outputFileId: 'output-1' });
    const output = files.upload.mock.calls[0]![0] as Buffer;
    expect(
      await service.toText(output, { format: 'text', pageBreak: '|' })
    ).toBe('Second\n\n|First\n\n');
    expect(files.upload.mock.calls[0]![1]).toMatchObject({
      filename: 'ordered.pdf',
      size: output.length,
    });
    expect(tasks.updateProgress.mock.calls.map(call => call[1])).toEqual([
      20, 40, 80, 95, 100,
    ]);
    expect(
      job.updateProgress.mock.calls.map((call: unknown[]) => call[0])
    ).toEqual([20, 40, 80, 95, 100]);
    expect(tasks.markCompleted).toHaveBeenCalledWith('task-1', 'output-1');
  });

  it('extracts selected pages in order and uses the configured separator', async () => {
    const service = new PdfService();
    const input = await service.merge([
      await textPdf('First'),
      await textPdf('Second'),
    ]);
    const files = createFilesService(input);
    const tasks = createTasksService({});
    tasks.getById.mockResolvedValue({
      id: 'task-1',
      type: 'pdf_to_text',
      userId: 'user-1',
      inputFileIds: ['file-1'],
      inputConfig: { format: 'text', pages: [1, 0], pageBreak: 'none' },
    });
    const processor = new PdfProcessor(
      service,
      files as unknown as FilesService,
      tasks as unknown as TasksService,
      {} as PdfToCadService,
      resourceBudget as never
    );
    await processor.process(createJob());

    expect((files.upload.mock.calls[0]![0] as Buffer).toString()).toBe(
      'Second\n\nFirst\n\n'
    );
    expect(files.upload.mock.calls[0]![1]).toMatchObject({
      filename: 'plan.txt',
      mimeType: 'text/plain',
    });
    expect(tasks.updateProgress.mock.calls.map(call => call[1])).toEqual([
      10, 80, 95, 100,
    ]);
  });
});

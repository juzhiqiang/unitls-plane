import { describe, expect, it, mock, vi } from 'bun:test';
import { UnrecoverableError } from 'bullmq';
import { PdfCadExtractorService } from '../../../../src/modules/tasks/services/cad/pdf-cad-extractor.service';
import { PdfToCadService } from '../../../../src/modules/tasks/services/cad/pdf-to-cad.service';
import { CadError } from '../../../../src/modules/tasks/services/cad/types';
import { createVectorLinesFixture } from '../services/cad/fixtures';

const getTaskOutputOwner = mock(async () => ({
  id: 'user-1',
  plan: 'signed_in',
  role: 'user',
}));

mock.module(
  '../../../../src/modules/tasks/processors/task-output-owner',
  () => ({ getTaskOutputOwner })
);

const { PdfProcessor } =
  await import('../../../../src/modules/tasks/processors/pdf.processor');

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
  return {
    id: 'job-1',
    data: { taskId: 'task-1' },
    attemptsMade,
    updateProgress: vi.fn(),
    opts: { attempts: 3 },
  } as any;
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
  pdfToCad: {
    convert: (...args: unknown[]) => Promise<unknown>;
  } = new PdfToCadService(new PdfCadExtractorService())
) {
  return new PdfProcessor(
    pdfService as any,
    filesService as any,
    tasksService as any,
    pdfToCad as any
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
      splitService as any,
      filesService as any,
      tasksService as any,
      {} as any
    );

    await processor.process(createJob());

    // archiver v8 没有 create():这里保证 ZIP 分支真的走通,产物是带 PK 签名的归档。
    expect(filesService.upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        filename: 'split-plan.zip',
        mimeType: 'application/zip',
      }),
      { id: 'user-1', plan: 'signed_in', role: 'user' }
    );
    const zip = filesService.upload.mock.calls[0]![0] as Buffer;
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(zip.includes('part-1.pdf')).toBe(true);
    expect(zip.includes('part-2.pdf')).toBe(true);
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
      { id: 'user-1', plan: 'signed_in', role: 'user' }
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

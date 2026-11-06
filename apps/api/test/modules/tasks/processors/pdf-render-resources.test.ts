import { expect, it, vi } from 'bun:test';
import { PDFDocument } from '@cantoo/pdf-lib';
import { getMupdf } from '../../../../src/modules/tasks/services/pdf/mupdf-runtime';
import { toImageHandler } from '../../../../src/modules/tasks/processors/pdf/toImageHandler';
import { PdfSecurityOperations } from '../../../../src/modules/tasks/services/pdf/security-operations';
import { TaskResourceLimitError } from '../../../../src/common/resources/resource-error';
import { runWithTaskResources } from '../../../../src/common/resources/task-resource-context';
import { resourceLimits } from '../../../../src/common/resources/resource-limits';
import { PdfToCadService } from '../../../../src/modules/tasks/services/cad/pdf-to-cad.service';
import { PdfCadExtractorService } from '../../../../src/modules/tasks/services/cad/pdf-cad-extractor.service';
import { createScannedFixture } from '../services/cad/fixtures';
import { DEFAULT_PDF_TO_CAD_CONFIG } from '@utils-plane/validators';
import { PdfPageOperations } from '../../../../src/modules/tasks/services/pdf/page-operations';

it('CAD 底图累计编码输出在保留资源时有界', async () => {
  const fixture = await createScannedFixture();
  const service = new PdfToCadService(new PdfCadExtractorService());
  await expect(
    runWithTaskResources(
      {
        limits: { ...resourceLimits({}), outputBytes: 100 },
        inputBytes: fixture.pdf.length,
        files: new Map(),
      },
      () =>
        service.convert(
          fixture.pdf,
          { ...DEFAULT_PDF_TO_CAD_CONFIG, includeRasterUnderlay: true },
          { baseName: 'scan' }
        )
    )
  ).rejects.toBeInstanceOf(TaskResourceLimitError);
});

it('PDF 拆分累计输出在进入 ZIP 前有界', async () => {
  const { buffer } = await fixture();
  await expect(
    runWithTaskResources(
      {
        limits: { ...resourceLimits({}), outputBytes: 100 },
        inputBytes: buffer.length,
        files: new Map(),
      },
      () =>
        new PdfPageOperations().split(buffer, { mode: 'pages', pages: [0, 0] })
    )
  ).rejects.toBeInstanceOf(TaskResourceLimitError);
});

async function fixture(width = 100, height = 100) {
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  const buffer = Buffer.from(await doc.save());
  const context = {
    readPdf: async () => ({ file: { filename: 'test.pdf' }, buffer }),
    reportProgress: vi.fn(async () => undefined),
    completeOutput: vi.fn(async () => ({})),
  };
  return { buffer, context };
}

it('高 DPI 超像素在 toPixmap 前拒绝并释放 page/document', async () => {
  const mupdf = await getMupdf();
  const render = vi.spyOn(mupdf.Page.prototype, 'toPixmap');
  const pageDestroy = vi.spyOn(mupdf.Page.prototype, 'destroy');
  const docDestroy = vi.spyOn(mupdf.Document.prototype, 'destroy');
  try {
    const { context } = await fixture(2000, 2000);
    await expect(
      toImageHandler(context as never, { inputConfig: { dpi: 600 } } as never)
    ).rejects.toBeInstanceOf(TaskResourceLimitError);
    expect(render).not.toHaveBeenCalled();
    expect(pageDestroy).toHaveBeenCalledTimes(1);
    expect(docDestroy).toHaveBeenCalledTimes(1);
    expect(context.completeOutput).not.toHaveBeenCalled();
  } finally {
    render.mockRestore();
    pageDestroy.mockRestore();
    docDestroy.mockRestore();
  }
});

it('编码输出超过预算时销毁 pixmap/page/document', async () => {
  const mupdf = await getMupdf();
  const destroy = vi.spyOn(mupdf.Pixmap.prototype, 'destroy');
  try {
    const { context } = await fixture();
    await expect(
      runWithTaskResources(
        {
          limits: { ...resourceLimits({}), outputBytes: 1 },
          inputBytes: 1,
          files: new Map(),
        },
        () => toImageHandler(context as never, { inputConfig: {} } as never)
      )
    ).rejects.toBeInstanceOf(TaskResourceLimitError);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(context.completeOutput).not.toHaveBeenCalled();
  } finally {
    destroy.mockRestore();
  }
});

it('PDF 压缩也拒绝超大栅格分配', async () => {
  const { buffer } = await fixture(5000, 5000);
  await expect(
    new PdfSecurityOperations().compressPdf(buffer, { level: 'medium' })
  ).rejects.toBeInstanceOf(TaskResourceLimitError);
});

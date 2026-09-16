import { describe, expect, it } from 'bun:test';
import { PDFDocument, degrees, rgb, StandardFonts } from '@cantoo/pdf-lib';
import {
  DEFAULT_PDF_TO_CAD_CONFIG,
  pdfToCadTaskConfigSchema,
} from '@utils-plane/validators';
import { PdfCadExtractorService } from '../../../../../src/modules/tasks/services/cad/pdf-cad-extractor.service';
import {
  CadError,
  type CadEntity,
  type CadLineEntity,
} from '../../../../../src/modules/tasks/services/cad/types';
import {
  createAllCadFixtures,
  createBlankPdf,
  createChineseAnnotationFixture,
  createScannedFixture,
  createVectorLinesFixture,
} from './fixtures';

const service = new PdfCadExtractorService();
const MM = 25.4 / 72;

function lines(entities: CadEntity[]): CadLineEntity[] {
  return entities.filter(
    (entity): entity is CadLineEntity => entity.type === 'line'
  );
}

async function createLinePdf(
  options: {
    size?: [number, number];
    rotate?: 0 | 90 | 180 | 270;
  } = {}
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(options.size ?? [200, 100]);
  if (options.rotate) page.setRotation(degrees(options.rotate));
  page.drawLine({
    start: { x: 10, y: 20 },
    end: { x: 110, y: 20 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  return Buffer.from(await doc.save());
}

describe('PdfCadExtractorService coordinates', () => {
  it('flips PDF top-left coordinates into bottom-left millimetres', async () => {
    const document = await service.extract(
      await createLinePdf(),
      DEFAULT_PDF_TO_CAD_CONFIG
    );
    const page = document.pages[0]!;
    expect(page.widthPt).toBe(200);
    expect(page.heightPt).toBe(100);
    expect(page.width).toBeCloseTo(200 * MM, 5);
    expect(page.height).toBeCloseTo(100 * MM, 5);

    const [line] = lines(page.entities);
    // pdf-lib 用左下原点画的 y=20,经 MuPDF 左上原点再翻回左下,应仍是 20pt。
    expect(line!.start.x).toBeCloseTo(10 * MM, 5);
    expect(line!.start.y).toBeCloseTo(20 * MM, 5);
    expect(line!.end.x).toBeCloseTo(110 * MM, 5);
    expect(line!.end.y).toBeCloseTo(20 * MM, 5);
    expect(line!.lineWeightMm).toBeCloseTo(1 * MM, 3);
  });

  it('converts to inches and applies the scale factor after the unit', async () => {
    const document = await service.extract(
      await createLinePdf(),
      pdfToCadTaskConfigSchema.parse({ unit: 'inch', scale: 10 })
    );
    const page = document.pages[0]!;
    expect(page.width).toBeCloseTo((200 / 72) * 10, 5);
    const [line] = lines(page.entities);
    expect(line!.start.x).toBeCloseTo((10 / 72) * 10, 5);
    expect(line!.end.x).toBeCloseTo((110 / 72) * 10, 5);
    // 线宽是物理毫米,不随单位与比例变化。
    expect(line!.lineWeightMm).toBeCloseTo(1 * MM, 3);
  });

  it('applies /Rotate before converting entities', async () => {
    const document = await service.extract(
      await createLinePdf({ rotate: 90 }),
      DEFAULT_PDF_TO_CAD_CONFIG
    );
    const page = document.pages[0]!;
    expect(page.rotation).toBe(90);
    // 旋转 90° 后显示尺寸变为 100×200。
    expect(page.widthPt).toBe(100);
    expect(page.heightPt).toBe(200);

    const [line] = lines(page.entities);
    // /Rotate 90 顺时针显示:原底边成为左边,原横线 (10,20)→(110,20) 变成距左边 20pt 的竖线,
    // 距顶边 10→110pt,即左下原点下 y 从 190 降到 90。
    expect(line!.start.x).toBeCloseTo(20 * MM, 4);
    expect(line!.end.x).toBeCloseTo(20 * MM, 4);
    expect(Math.min(line!.start.y, line!.end.y)).toBeCloseTo(90 * MM, 4);
    expect(Math.max(line!.start.y, line!.end.y)).toBeCloseTo(190 * MM, 4);
  });

  it('lays multiple pages out side by side with a stable gap', async () => {
    const document = await service.extract(
      await createLinePdf(),
      DEFAULT_PDF_TO_CAD_CONFIG
    );
    expect(document.pages[0]!.origin).toEqual({ x: 0, y: 0 });

    const doc = await PDFDocument.create();
    for (let i = 0; i < 2; i++) {
      const page = doc.addPage([200, 100]);
      page.drawLine({
        start: { x: 0, y: 0 },
        end: { x: 10, y: 10 },
        thickness: 1,
      });
    }
    const twoPages = await service.extract(
      Buffer.from(await doc.save()),
      DEFAULT_PDF_TO_CAD_CONFIG
    );
    expect(twoPages.pages).toHaveLength(2);
    expect(twoPages.pages[1]!.origin.x).toBeCloseTo(200 * MM * 1.1, 4);
    expect(twoPages.meta.pages).toEqual([1, 2]);
  });
});

describe('PdfCadExtractorService entities', () => {
  it('extracts lines, polylines, circles, hatches, thin fills and text from the vector fixture', async () => {
    const fixture = await createVectorLinesFixture();
    const document = await service.extract(
      fixture.pdf,
      DEFAULT_PDF_TO_CAD_CONFIG
    );
    const page = document.pages[0]!;

    expect(page.kind).toBe('vector');
    expect(page.stats.entityCount).toBe(fixture.expected.entityCount);
    expect(page.stats.bySource).toEqual(fixture.expected.bySource);
    expect(page.stats.byType).toEqual(fixture.expected.byType);
    expect(document.meta.degradations.map(d => d.code)).toEqual(
      fixture.expected.degradations
    );

    const circle = page.entities.find(entity => entity.type === 'circle');
    expect(circle).toMatchObject({
      center: {
        x: expect.closeTo(220 * MM, 4),
        y: expect.closeTo(120 * MM, 4),
      },
      radius: expect.closeTo(30 * MM, 4),
      derived: 'fitted',
    });

    const dashed = lines(page.entities).find(
      line => line.lineType === 'DASHED'
    );
    expect(dashed?.layer).toBe('STROKE_000000_DASHED');

    const rectangle = page.entities.find(
      entity => entity.type === 'polyline' && entity.origin === 'stroke'
    );
    expect(rectangle).toMatchObject({ closed: true });
    expect((rectangle as { vertices: unknown[] }).vertices).toHaveLength(4);

    const thin = lines(page.entities).find(line => line.source === 'inferred');
    expect(thin).toMatchObject({ origin: 'fill', derived: 'fitted' });
    expect(thin!.lineWeightMm).toBeCloseTo(0.8 * MM, 2);

    const text = page.entities.find(entity => entity.type === 'text');
    expect(text).toMatchObject({
      text: 'A1',
      style: 'HELVETICA',
      rotation: 0,
      layer: 'TEXT_HELVETICA',
    });
    expect(document.textStyles.map(style => style.name)).toEqual(['HELVETICA']);
    expect(document.layers.map(layer => layer.name)).toContain('FRAME');
  });

  it('keeps Chinese text with the fallback CJK font from the annotation fixture', async () => {
    const fixture = await createChineseAnnotationFixture();
    const document = await service.extract(
      fixture.pdf,
      DEFAULT_PDF_TO_CAD_CONFIG
    );
    const page = document.pages[0]!;

    expect(page.stats.entityCount).toBe(fixture.expected.entityCount);
    expect(page.stats.byType).toEqual(fixture.expected.byType);
    const texts = page.entities
      .filter(entity => entity.type === 'text')
      .map(entity => (entity as { text: string }).text);
    for (const expected of fixture.expected.texts) {
      expect(texts.some(text => text.includes(expected))).toBe(true);
    }
    expect(document.textStyles.map(style => style.fontFamily)).toContain(
      'Droid Sans Fallback'
    );
  });

  it('marks scanned pages as raster with a placeholder underlay by default', async () => {
    const fixture = await createScannedFixture();
    const document = await service.extract(
      fixture.pdf,
      DEFAULT_PDF_TO_CAD_CONFIG
    );
    const page = document.pages[0]!;

    expect(page.kind).toBe('raster');
    expect(page.stats.byType).toEqual(fixture.expected.byType);
    expect(page.stats.imageCount).toBe(1);
    const underlay = page.entities.find(
      entity => entity.type === 'image-underlay'
    );
    expect(underlay).toMatchObject({
      placeholder: true,
      pixelWidth: 800,
      pixelHeight: 600,
      insert: { x: 0, y: 0 },
    });
    expect((underlay as { resource?: unknown }).resource).toBeUndefined();
    expect(document.meta.degradations).toEqual([
      { code: 'raster_page', page: 1 },
    ]);
    expect(document.meta.underlay).toBe(false);
  });

  it('renders the underlay PNG when includeRasterUnderlay is on', async () => {
    const fixture = await createScannedFixture();
    const document = await service.extract(
      fixture.pdf,
      pdfToCadTaskConfigSchema.parse({ includeRasterUnderlay: true }),
      { resourceBaseName: 'scan' }
    );
    const underlay = document.pages[0]!.entities.find(
      entity => entity.type === 'image-underlay'
    ) as { placeholder: boolean; resource?: { name: string; data: Buffer } };
    expect(underlay.placeholder).toBe(false);
    expect(underlay.resource?.name).toBe('scan-page-1-1.png');
    expect(underlay.resource?.data.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(document.meta.underlay).toBe(true);
  });

  it('produces identical models for identical input and config', async () => {
    const fixture = await createVectorLinesFixture();
    const first = await service.extract(fixture.pdf, DEFAULT_PDF_TO_CAD_CONFIG);
    const second = await service.extract(
      fixture.pdf,
      DEFAULT_PDF_TO_CAD_CONFIG
    );
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('matches the documented statistics for every fixture', async () => {
    for (const fixture of await createAllCadFixtures()) {
      const document = await service.extract(
        fixture.pdf,
        DEFAULT_PDF_TO_CAD_CONFIG
      );
      expect(document.meta.pageCount).toBe(fixture.expected.pageCount);
      expect(document.meta.entityCount).toBe(fixture.expected.entityCount);
      expect(document.meta.entityCountBySource).toEqual(
        fixture.expected.bySource
      );
      expect(document.meta.entityCountByType).toEqual(fixture.expected.byType);
      expect(document.meta.degradations.map(d => d.code)).toEqual(
        fixture.expected.degradations
      );
    }
  });

  it('uses semantic layers when requested', async () => {
    const fixture = await createVectorLinesFixture();
    const document = await service.extract(
      fixture.pdf,
      pdfToCadTaskConfigSchema.parse({ layerMode: 'semantic' })
    );
    const names = new Set(
      document.pages[0]!.entities.map(entity => entity.layer)
    );
    expect([...names].sort()).toEqual(
      ['FRAME', 'HATCH', 'HIDDEN', 'INFERRED', 'TEXT', 'THIN'].sort()
    );
  });

  it('reports progress per converted page', async () => {
    const fixture = await createVectorLinesFixture();
    const calls: Array<[number, number]> = [];
    await service.extract(fixture.pdf, DEFAULT_PDF_TO_CAD_CONFIG, {
      onProgress: (done, total) => {
        calls.push([done, total]);
      },
    });
    expect(calls).toEqual([[1, 1]]);
  });
});

describe('PdfCadExtractorService failures', () => {
  it('rejects corrupted input with CAD_CONVERSION_FAILED', async () => {
    await expect(
      service.extract(Buffer.from('not a pdf'), DEFAULT_PDF_TO_CAD_CONFIG)
    ).rejects.toMatchObject({
      code: 'CAD_CONVERSION_FAILED',
      retryable: false,
    });
  });

  it('rejects page indices outside the document with CAD_INVALID_CONFIG', async () => {
    const pdf = await createBlankPdf([[100, 100]]);
    await expect(
      service.extract(pdf, pdfToCadTaskConfigSchema.parse({ pages: [3] }))
    ).rejects.toMatchObject({ code: 'CAD_INVALID_CONFIG' });
  });

  it('fails when every selected page is empty', async () => {
    const pdf = await createBlankPdf([
      [100, 100],
      [100, 100],
    ]);
    let caught: unknown;
    try {
      await service.extract(pdf, DEFAULT_PDF_TO_CAD_CONFIG);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CadError);
    expect((caught as CadError).code).toBe('CAD_CONVERSION_FAILED');
    expect((caught as CadError).details).toEqual({ pages: [1, 2] });
  });

  it('keeps empty pages as a degradation when other pages have content', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const page = doc.addPage([100, 100]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('x', { x: 10, y: 10, size: 10, font });
    const document = await service.extract(
      Buffer.from(await doc.save()),
      DEFAULT_PDF_TO_CAD_CONFIG
    );
    expect(document.pages[0]!.kind).toBe('empty');
    expect(document.meta.degradations).toEqual([
      { code: 'empty_page', page: 1 },
    ]);
  });

  it('enforces the entity budget', async () => {
    const fixture = await createVectorLinesFixture();
    await expect(
      service.extract(fixture.pdf, DEFAULT_PDF_TO_CAD_CONFIG, {
        maxEntities: 3,
      })
    ).rejects.toMatchObject({
      code: 'CAD_CONVERSION_FAILED',
      details: { limit: 3, page: 1 },
    });
  });
});

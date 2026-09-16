import { describe, expect, it } from 'bun:test';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import {
  DEFAULT_PDF_TO_CAD_CONFIG,
  pdfToCadTaskConfigSchema,
} from '@utils-plane/validators';
import { PdfCadExtractorService } from '../../../../../src/modules/tasks/services/cad/pdf-cad-extractor.service';
import {
  PdfToCadService,
  type ConversionStage,
} from '../../../../../src/modules/tasks/services/cad/pdf-to-cad.service';
import {
  TesseractOcr,
  type OcrRunner,
} from '../../../../../src/modules/tasks/services/cad/tesseract-ocr';
import { CadError } from '../../../../../src/modules/tasks/services/cad/types';
import {
  createScannedFixture,
  createScannedPng,
  createVectorLinesFixture,
} from './fixtures';

const TSV = [
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
  '4\t1\t1\t1\t1\t0\t660\t340\t520\t100\t-1\t',
  '5\t1\t1\t1\t1\t1\t660\t340\t250\t100\t96\tSCAN',
  '5\t1\t1\t1\t1\t2\t960\t340\t220\t100\t93\t123',
].join('\n');

function fakeOcr(tsv = TSV, langs = 'chi_sim\neng\n'): TesseractOcr {
  const runner: OcrRunner = async (_command, args) => {
    if (args[0] === '--version') return { stdout: 'tesseract 5.5.3\n' };
    if (args[0] === '--list-langs')
      return { stdout: `List of available languages (2):\n${langs}` };
    return { stdout: tsv };
  };
  return new TesseractOcr({ runner, environment: {} });
}

function unavailableOcr(): TesseractOcr {
  return new TesseractOcr({
    runner: async () => {
      throw new Error('spawn tesseract ENOENT');
    },
    environment: {},
  });
}

class CountingExtractor extends PdfCadExtractorService {
  calls = 0;

  override async extract(
    ...args: Parameters<PdfCadExtractorService['extract']>
  ): ReturnType<PdfCadExtractorService['extract']> {
    this.calls += 1;
    return super.extract(...args);
  }
}

const service = new PdfToCadService(new PdfCadExtractorService());

describe('PdfToCadService', () => {
  it('converts a vector PDF into a single DXF with conversion metadata', async () => {
    const fixture = await createVectorLinesFixture();
    const stages: Array<[ConversionStage, number]> = [];
    const result = await service.convert(
      fixture.pdf,
      DEFAULT_PDF_TO_CAD_CONFIG,
      {
        baseName: 'vector lines',
        onProgress: (stage, fraction) => {
          stages.push([stage, fraction]);
        },
      }
    );
    expect(result.output).toMatchObject({
      filename: 'vector_lines.dxf',
      mimeType: 'application/dxf',
      archived: false,
    });
    expect(result.output.data.toString('latin1')).toContain('AC1015');
    expect(result.meta.entityCount).toBe(fixture.expected.entityCount);
    expect(result.meta.entityCountBySource).toEqual(fixture.expected.bySource);
    expect(result.meta.ocrPages).toEqual([]);
    expect(result.meta.underlay).toBe(false);
    expect(stages).toEqual([
      ['parse', 1],
      ['write', 0],
      ['write', 1],
    ]);
  });

  it('recognizes text and lines on scanned pages when OCR is enabled', async () => {
    const fixture = await createScannedFixture();
    const stages: ConversionStage[] = [];
    const result = await service.convert(
      fixture.pdf,
      pdfToCadTaskConfigSchema.parse({ ocr: true }),
      {
        baseName: 'scan',
        ocr: fakeOcr(),
        onProgress: stage => {
          stages.push(stage);
        },
      }
    );
    const page = result.document.pages[0]!;
    const ocrTexts = page.entities.filter(entity => entity.source === 'ocr');
    const inferred = page.entities.filter(
      entity => entity.source === 'inferred'
    );
    expect(ocrTexts).toHaveLength(1);
    expect(ocrTexts[0]).toMatchObject({
      type: 'text',
      text: 'SCAN 123',
      layer: 'OCR_TEXT',
    });
    expect(inferred).toHaveLength(2);
    expect(
      inferred.every(
        entity => entity.type === 'line' && entity.origin === 'raster'
      )
    ).toBe(true);
    expect(result.meta.ocrPages).toEqual([1]);
    expect(result.meta.ocrTextCount).toBe(1);
    expect(result.meta.entityCountBySource).toEqual({
      pdf: 2,
      ocr: 1,
      inferred: 2,
    });
    expect(result.meta.degradations).toEqual([
      { code: 'raster_page', page: 1 },
      { code: 'raster_lines_inferred', page: 1, count: 2 },
    ]);
    expect(result.document.layers.map(layer => layer.name)).toEqual(
      expect.arrayContaining(['OCR_TEXT', 'INFERRED_RASTER'])
    );
    expect(stages).toEqual(['parse', 'ocr', 'write', 'write']);
    const dxf = result.output.data.toString('latin1');
    expect(dxf).toContain('SCAN 123');
    expect(dxf).toContain('OCR_TEXT');
  });

  it('records ocr_no_text when the engine finds nothing', async () => {
    const fixture = await createScannedFixture();
    const result = await service.convert(
      fixture.pdf,
      pdfToCadTaskConfigSchema.parse({ ocr: true }),
      { ocr: fakeOcr(TSV.split('\n')[0]!) }
    );
    expect(result.meta.degradations.map(d => d.code)).toEqual([
      'raster_page',
      'raster_lines_inferred',
      'ocr_no_text',
    ]);
    expect(result.meta.ocrTextCount).toBe(0);
  });

  it('skips OCR on pages that already carry native text', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const png = await doc.embedPng(await createScannedPng());
    page.drawImage(png, { x: 0, y: 0, width: 400, height: 300 });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('native', { x: 20, y: 20, size: 12, font });
    const result = await service.convert(
      Buffer.from(await doc.save()),
      pdfToCadTaskConfigSchema.parse({ ocr: true }),
      { ocr: fakeOcr() }
    );
    expect(result.document.pages[0]!.kind).toBe('mixed');
    expect(result.meta.ocrPages).toEqual([]);
    expect(result.meta.degradations).toEqual([
      { code: 'ocr_skipped_native_text', page: 1 },
    ]);
    expect(result.meta.entityCountBySource.ocr).toBe(0);
  });

  it('fails fast with CAD_OCR_UNAVAILABLE before parsing anything', async () => {
    const extractor = new CountingExtractor();
    const fixture = await createScannedFixture();
    let caught: unknown;
    try {
      await new PdfToCadService(extractor).convert(
        fixture.pdf,
        pdfToCadTaskConfigSchema.parse({ ocr: true }),
        { ocr: unavailableOcr() }
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CadError);
    expect((caught as CadError).code).toBe('CAD_OCR_UNAVAILABLE');
    expect(extractor.calls).toBe(0);
  });

  it('fails fast with CAD_DWG_UNSUPPORTED without touching the PDF', async () => {
    const extractor = new CountingExtractor();
    await expect(
      new PdfToCadService(extractor).convert(
        Buffer.from('irrelevant'),
        pdfToCadTaskConfigSchema.parse({ format: 'dwg' })
      )
    ).rejects.toMatchObject({ code: 'CAD_DWG_UNSUPPORTED' });
    expect(extractor.calls).toBe(0);
  });

  it('packages underlay resources into a ZIP', async () => {
    const fixture = await createScannedFixture();
    const result = await service.convert(
      fixture.pdf,
      pdfToCadTaskConfigSchema.parse({ includeRasterUnderlay: true }),
      { baseName: 'scan' }
    );
    expect(result.output).toMatchObject({
      filename: 'scan.zip',
      mimeType: 'application/zip',
      archived: true,
    });
    expect(result.output.data.includes('scan.dxf')).toBe(true);
    expect(result.output.data.includes('scan-page-1-1.png')).toBe(true);
    expect(result.meta.underlay).toBe(true);
  });

  it('propagates extractor contract errors', async () => {
    await expect(
      service.convert(Buffer.from('not a pdf'), DEFAULT_PDF_TO_CAD_CONFIG)
    ).rejects.toMatchObject({ code: 'CAD_CONVERSION_FAILED' });
  });
});

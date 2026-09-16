import { describe, expect, it } from 'bun:test';
import {
  CAD_ERROR_CODES,
  DEFAULT_PDF_TO_CAD_CONFIG,
  PDF_TO_CAD_MAX_PAGES,
  PDF_TO_CAD_SCALE_MAX,
  PDF_TO_CAD_SCALE_MIN,
  cadErrorCodeEnum,
  pdfToCadConversionMetaSchema,
  pdfToCadTaskConfigSchema,
  pointToCadUnit,
} from '../src/cad';

describe('pdfToCadTaskConfigSchema', () => {
  it('applies the contract defaults when the config is empty', () => {
    expect(pdfToCadTaskConfigSchema.parse({})).toEqual({
      format: 'dxf',
      unit: 'mm',
      scale: 1,
      ocr: false,
      includeRasterUnderlay: false,
      layerMode: 'source',
    });
    expect(DEFAULT_PDF_TO_CAD_CONFIG.format).toBe('dxf');
    expect(DEFAULT_PDF_TO_CAD_CONFIG.pages).toBeUndefined();
  });

  it('accepts every documented option value', () => {
    const parsed = pdfToCadTaskConfigSchema.parse({
      format: 'dwg',
      pages: [3, 1, 1, 2],
      unit: 'inch',
      scale: 2.5,
      ocr: true,
      includeRasterUnderlay: true,
      layerMode: 'semantic',
    });
    expect(parsed.format).toBe('dwg');
    expect(parsed.unit).toBe('inch');
    expect(parsed.layerMode).toBe('semantic');
    // 页码去重升序:处理器按顺序输出页面,重复页只转一次。
    expect(parsed.pages).toEqual([1, 2, 3]);
  });

  it('rejects unknown formats, units and layer modes', () => {
    expect(pdfToCadTaskConfigSchema.safeParse({ format: 'svg' }).success).toBe(
      false
    );
    expect(pdfToCadTaskConfigSchema.safeParse({ unit: 'cm' }).success).toBe(
      false
    );
    expect(
      pdfToCadTaskConfigSchema.safeParse({ layerMode: 'auto' }).success
    ).toBe(false);
  });

  it('bounds the scale and the page list', () => {
    expect(
      pdfToCadTaskConfigSchema.safeParse({ scale: PDF_TO_CAD_SCALE_MIN })
        .success
    ).toBe(true);
    expect(
      pdfToCadTaskConfigSchema.safeParse({ scale: PDF_TO_CAD_SCALE_MAX })
        .success
    ).toBe(true);
    expect(pdfToCadTaskConfigSchema.safeParse({ scale: 0 }).success).toBe(
      false
    );
    expect(
      pdfToCadTaskConfigSchema.safeParse({ scale: PDF_TO_CAD_SCALE_MAX + 1 })
        .success
    ).toBe(false);
    expect(pdfToCadTaskConfigSchema.safeParse({ scale: NaN }).success).toBe(
      false
    );
    expect(pdfToCadTaskConfigSchema.safeParse({ pages: [] }).success).toBe(
      false
    );
    expect(pdfToCadTaskConfigSchema.safeParse({ pages: [-1] }).success).toBe(
      false
    );
    expect(pdfToCadTaskConfigSchema.safeParse({ pages: [1.5] }).success).toBe(
      false
    );
    expect(
      pdfToCadTaskConfigSchema.safeParse({
        pages: Array.from({ length: PDF_TO_CAD_MAX_PAGES + 1 }, (_, i) => i),
      }).success
    ).toBe(false);
  });
});

describe('CAD error codes', () => {
  it('fixes the four contract error codes', () => {
    expect([...CAD_ERROR_CODES]).toEqual([
      'CAD_INVALID_CONFIG',
      'CAD_OCR_UNAVAILABLE',
      'CAD_DWG_UNSUPPORTED',
      'CAD_CONVERSION_FAILED',
    ]);
    expect(cadErrorCodeEnum.safeParse('CAD_TIMEOUT').success).toBe(false);
  });
});

describe('pointToCadUnit', () => {
  it('converts points to millimetres and inches before applying scale', () => {
    expect(pointToCadUnit(72, 'mm')).toBeCloseTo(25.4, 6);
    expect(pointToCadUnit(72, 'inch')).toBeCloseTo(1, 6);
    expect(pointToCadUnit(72, 'mm', 2)).toBeCloseTo(50.8, 6);
    expect(pointToCadUnit(36, 'inch', 0.5)).toBeCloseTo(0.25, 6);
  });
});

describe('pdfToCadConversionMetaSchema', () => {
  it('validates the outputMeta shape written by the processor', () => {
    const meta = pdfToCadConversionMetaSchema.parse({
      converterVersion: '1.0.0',
      format: 'dxf',
      unit: 'mm',
      scale: 1,
      layerMode: 'source',
      sourcePageCount: 3,
      pageCount: 1,
      pages: [2],
      entityCount: 12,
      entityCountBySource: { pdf: 10, ocr: 2, inferred: 0 },
      entityCountByType: { line: 8, text: 4 },
      ocrTextCount: 2,
      ocrPages: [2],
      underlay: false,
      degradations: [{ code: 'raster_page', page: 2 }],
    });
    expect(meta.entityCountByType.line).toBe(8);
  });

  it('rejects unknown degradation codes', () => {
    expect(
      pdfToCadConversionMetaSchema.safeParse({
        converterVersion: '1.0.0',
        format: 'dxf',
        unit: 'mm',
        scale: 1,
        layerMode: 'source',
        sourcePageCount: 1,
        pageCount: 1,
        pages: [1],
        entityCount: 0,
        entityCountBySource: { pdf: 0, ocr: 0, inferred: 0 },
        entityCountByType: {},
        ocrTextCount: 0,
        ocrPages: [],
        underlay: false,
        degradations: [{ code: 'made_up' }],
      }).success
    ).toBe(false);
  });
});

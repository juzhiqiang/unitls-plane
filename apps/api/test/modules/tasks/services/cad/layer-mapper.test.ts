import { describe, expect, it } from 'bun:test';
import {
  classifyLineType,
  LayerMapper,
  normalizeFontFamily,
  sanitizeLayerName,
  SEMANTIC_LAYERS,
} from '../../../../../src/modules/tasks/services/cad/layer-mapper';

describe('sanitizeLayerName', () => {
  it('keeps only DXF-safe characters and upper-cases the name', () => {
    expect(sanitizeLayerName('Stroke #ff0000 / dashed')).toBe(
      'STROKE_FF0000_DASHED'
    );
    expect(sanitizeLayerName('文字')).toBe('0');
    expect(sanitizeLayerName('a'.repeat(100))).toHaveLength(64);
  });
});

describe('normalizeFontFamily', () => {
  it('strips subset prefixes and weight suffixes', () => {
    expect(normalizeFontFamily('SOKHKR+Droid Sans Fallback Regu')).toBe(
      'Droid Sans Fallback'
    );
    expect(normalizeFontFamily('ABCDEF+Arial,Bold')).toBe('Arial');
    expect(normalizeFontFamily('Helvetica-Bold')).toBe('Helvetica');
    expect(normalizeFontFamily('TimesNewRomanPSMT')).toBe('TimesNewRoman');
  });
});

describe('classifyLineType', () => {
  it('maps dash arrays onto DXF line types by shape', () => {
    expect(classifyLineType(null, 1)).toBe('CONTINUOUS');
    expect(classifyLineType([], 1)).toBe('CONTINUOUS');
    expect(classifyLineType([4, 2], 1)).toBe('DASHED');
    expect(classifyLineType([0.5, 2], 1)).toBe('DOT');
    expect(classifyLineType([6, 2, 1, 2], 1)).toBe('DASHDOT');
  });
});

describe('LayerMapper in source mode', () => {
  it('derives stable layer names from origin, colour, line type and font', () => {
    const mapper = new LayerMapper('source');
    const red = { r: 255, g: 0, b: 0 };
    expect(
      mapper.resolve({ origin: 'stroke', source: 'pdf', color: red })
    ).toBe('STROKE_FF0000');
    expect(
      mapper.resolve({
        origin: 'stroke',
        source: 'pdf',
        color: red,
        lineType: 'DASHED',
      })
    ).toBe('STROKE_FF0000_DASHED');
    expect(
      mapper.resolve({
        origin: 'fill',
        source: 'pdf',
        color: { r: 0, g: 255, b: 0 },
      })
    ).toBe('FILL_00FF00');
    expect(
      mapper.resolve({
        origin: 'text',
        source: 'pdf',
        fontFamily: 'ABCDEF+Droid Sans Fallback',
      })
    ).toBe('TEXT_DROID_SANS_FALLBACK');
    expect(mapper.resolve({ origin: 'page', source: 'pdf' })).toBe('FRAME');
    expect(mapper.resolve({ origin: 'image', source: 'pdf' })).toBe('IMAGE');
  });

  it('keeps OCR and inferred entities on dedicated layers', () => {
    const mapper = new LayerMapper('source');
    expect(mapper.resolve({ origin: 'ocr', source: 'ocr' })).toBe(
      SEMANTIC_LAYERS.ocr
    );
    expect(mapper.resolve({ origin: 'raster', source: 'inferred' })).toBe(
      'INFERRED_RASTER'
    );
    expect(mapper.resolve({ origin: 'fill', source: 'inferred' })).toBe(
      'INFERRED_FILL'
    );
  });

  it('lists layers in first-seen order starting with layer 0', () => {
    const mapper = new LayerMapper('source');
    mapper.resolve({ origin: 'page', source: 'pdf' });
    mapper.resolve({
      origin: 'stroke',
      source: 'pdf',
      color: { r: 0, g: 0, b: 0 },
    });
    mapper.resolve({ origin: 'page', source: 'pdf' });
    expect(mapper.list().map(layer => layer.name)).toEqual([
      '0',
      'FRAME',
      'STROKE_000000',
    ]);
    expect(mapper.list()[2]?.color).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('LayerMapper in semantic mode', () => {
  it('maps strokes by line weight and line type deterministically', () => {
    const mapper = new LayerMapper('semantic');
    expect(
      mapper.resolve({ origin: 'stroke', source: 'pdf', lineWeightMm: 0.7 })
    ).toBe(SEMANTIC_LAYERS.outline);
    expect(
      mapper.resolve({ origin: 'stroke', source: 'pdf', lineWeightMm: 0.25 })
    ).toBe(SEMANTIC_LAYERS.thin);
    expect(
      mapper.resolve({ origin: 'stroke', source: 'pdf', lineType: 'DASHED' })
    ).toBe(SEMANTIC_LAYERS.hidden);
    expect(
      mapper.resolve({ origin: 'stroke', source: 'pdf', lineType: 'DASHDOT' })
    ).toBe(SEMANTIC_LAYERS.center);
  });

  it('separates text, hatch, image, ocr and inferred content', () => {
    const mapper = new LayerMapper('semantic');
    expect(mapper.resolve({ origin: 'text', source: 'pdf' })).toBe('TEXT');
    expect(mapper.resolve({ origin: 'fill', source: 'pdf', fill: true })).toBe(
      'HATCH'
    );
    expect(mapper.resolve({ origin: 'image', source: 'pdf' })).toBe('IMAGE');
    expect(mapper.resolve({ origin: 'ocr', source: 'ocr' })).toBe('OCR_TEXT');
    expect(mapper.resolve({ origin: 'raster', source: 'inferred' })).toBe(
      'INFERRED'
    );
    expect(mapper.resolve({ origin: 'page', source: 'pdf' })).toBe('FRAME');
  });
});

import { describe, expect, it } from 'bun:test';
import DxfParser from 'dxf-parser';
import {
  DEFAULT_PDF_TO_CAD_CONFIG,
  pdfToCadTaskConfigSchema,
} from '@utils-plane/validators';
import {
  aciFromColor,
  decodeDxfText,
  DxfWriter,
  encodeDxfText,
  sanitizeFileName,
  snapLineWeight,
} from '../../../../../src/modules/tasks/services/cad/dxf-writer';
import { PdfCadExtractorService } from '../../../../../src/modules/tasks/services/cad/pdf-cad-extractor.service';
import {
  createEmptyPageStats,
  type CadDocument,
  type CadEntity,
} from '../../../../../src/modules/tasks/services/cad/types';
import { createVectorLinesFixture } from './fixtures';

type ParsedEntity = {
  type: string;
  layer: string;
  lineType?: string;
  colorIndex?: number;
  color?: number;
  lineweight?: number;
  vertices?: Array<{ x: number; y: number; bulge?: number }>;
  center?: { x: number; y: number };
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  text?: string;
  textHeight?: number;
  height?: number;
  width?: number;
  rotation?: number;
  startPoint?: { x: number; y: number };
  position?: { x: number; y: number };
  name?: string;
  attachmentPoint?: number;
  shape?: boolean;
};

function parse(text: string) {
  const parsed = new DxfParser().parseSync(text);
  if (!parsed) throw new Error('dxf-parser returned null');
  return parsed as unknown as {
    header: Record<string, unknown>;
    tables: {
      layer: {
        layers: Record<
          string,
          { name: string; colorIndex?: number; color?: number }
        >;
      };
      lineType: {
        lineTypes: Record<string, { name: string; pattern: unknown[] }>;
      };
    };
    blocks: Record<string, { name: string; entities: ParsedEntity[] }>;
    entities: ParsedEntity[];
  };
}

function dxfText(data: Buffer): string {
  return data.toString('latin1');
}

/** 手工拼一份覆盖全部实体类型的文档,不依赖 PDF 解析。 */
function syntheticDocument(unit: 'mm' | 'inch' = 'mm'): CadDocument {
  const entities: CadEntity[] = [
    {
      type: 'line',
      layer: 'STROKE_FF0000',
      source: 'pdf',
      origin: 'stroke',
      color: { r: 255, g: 0, b: 0 },
      lineType: 'DASHED',
      lineWeightMm: 0.35,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    },
    {
      type: 'polyline',
      layer: 'STROKE_000000',
      source: 'pdf',
      origin: 'stroke',
      color: { r: 0, g: 0, b: 0 },
      vertices: [
        { x: 0, y: 0, bulge: 0.5 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
      ],
      closed: true,
    },
    {
      type: 'arc',
      layer: 'STROKE_000000',
      source: 'pdf',
      origin: 'stroke',
      center: { x: 5, y: 5 },
      radius: 3,
      startAngle: 0,
      endAngle: 90,
    },
    {
      type: 'circle',
      layer: 'STROKE_000000',
      source: 'pdf',
      origin: 'stroke',
      center: { x: 5, y: 5 },
      radius: 3,
    },
    {
      type: 'hatch',
      layer: 'FILL_00FF00',
      source: 'pdf',
      origin: 'fill',
      color: { r: 0, g: 255, b: 0 },
      fillColor: { r: 0, g: 255, b: 0 },
      evenOdd: true,
      loops: [
        {
          vertices: [
            { x: 0, y: 0 },
            { x: 5, y: 0, bulge: 0.3 },
            { x: 5, y: 5 },
            { x: 0, y: 5 },
          ],
        },
        {
          vertices: [
            { x: 1, y: 1 },
            { x: 2, y: 1 },
            { x: 2, y: 2 },
          ],
        },
      ],
    },
    {
      type: 'text',
      layer: 'TEXT_HELVETICA',
      source: 'pdf',
      origin: 'text',
      color: { r: 0, g: 0, b: 255 },
      text: '尺寸 A1',
      insert: { x: 1, y: 1 },
      height: 2.5,
      rotation: 15,
      style: 'HELVETICA',
    },
    {
      type: 'mtext',
      layer: 'TEXT_HELVETICA',
      source: 'pdf',
      origin: 'text',
      text: '第一行\n第二行 {x}',
      insert: { x: 0, y: 20 },
      height: 2.5,
      width: 40,
      rotation: 0,
      style: 'HELVETICA',
      lineSpacingFactor: 1.2,
    },
    {
      type: 'insert',
      layer: '0',
      source: 'pdf',
      origin: 'page',
      blockName: 'PAGE_2',
      insert: { x: 100, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    },
    {
      type: 'image-underlay',
      layer: 'IMAGE',
      source: 'pdf',
      origin: 'image',
      insert: { x: 20, y: 20 },
      uVector: { x: 8, y: 0 },
      vVector: { x: 0, y: 6 },
      pixelWidth: 80,
      pixelHeight: 60,
      placeholder: true,
    },
    {
      type: 'image-underlay',
      layer: 'IMAGE',
      source: 'pdf',
      origin: 'image',
      insert: { x: 0, y: 0 },
      uVector: { x: 100, y: 0 },
      vVector: { x: 0, y: 50 },
      pixelWidth: 800,
      pixelHeight: 400,
      placeholder: false,
      resource: {
        name: 'scan-page-1-1.png',
        mimeType: 'image/png',
        data: Buffer.from('PNGDATA'),
      },
    },
  ];
  const stats = createEmptyPageStats();
  return {
    modelVersion: 1,
    converterVersion: '1.0.0',
    format: 'dxf',
    unit,
    scale: 1,
    layerMode: 'source',
    pages: [
      {
        index: 0,
        number: 1,
        width: 100,
        height: 50,
        widthPt: 283.46,
        heightPt: 141.73,
        rotation: 0,
        origin: { x: 0, y: 0 },
        kind: 'mixed',
        entities,
        stats,
      },
    ],
    layers: [
      {
        name: 'STROKE_FF0000',
        color: { r: 255, g: 0, b: 0 },
        lineType: 'DASHED',
      },
      {
        name: 'STROKE_000000',
        color: { r: 0, g: 0, b: 0 },
        lineType: 'CONTINUOUS',
      },
      {
        name: 'FILL_00FF00',
        color: { r: 0, g: 255, b: 0 },
        lineType: 'CONTINUOUS',
      },
      {
        name: 'TEXT_HELVETICA',
        color: { r: 0, g: 0, b: 0 },
        lineType: 'CONTINUOUS',
      },
      { name: 'IMAGE', color: { r: 0, g: 0, b: 0 }, lineType: 'CONTINUOUS' },
    ],
    textStyles: [
      {
        name: 'HELVETICA',
        fontFamily: 'Helvetica',
        bold: false,
        italic: false,
      },
    ],
    blocks: [
      {
        name: 'PAGE_2',
        basePoint: { x: 0, y: 0 },
        entities: [
          {
            type: 'line',
            layer: '0',
            source: 'pdf',
            origin: 'stroke',
            start: { x: 0, y: 0 },
            end: { x: 1, y: 1 },
          },
        ],
      },
    ],
    meta: {
      converterVersion: '1.0.0',
      format: 'dxf',
      unit,
      scale: 1,
      layerMode: 'source',
      sourcePageCount: 1,
      pageCount: 1,
      pages: [1],
      entityCount: entities.length,
      entityCountBySource: { pdf: entities.length, ocr: 0, inferred: 0 },
      entityCountByType: {},
      ocrTextCount: 0,
      ocrPages: [],
      underlay: true,
      degradations: [],
    },
  };
}

describe('DXF text helpers', () => {
  it('escapes non-ASCII characters as \\U+XXXX and decodes them back', () => {
    const encoded = encodeDxfText('尺寸 A1', false);
    expect(encoded).toBe('\\U+5C3A\\U+5BF8 A1');
    expect(decodeDxfText(encoded)).toBe('尺寸 A1');
  });

  it('escapes MTEXT control characters and line breaks', () => {
    expect(encodeDxfText('a\\b {c}\nd', true)).toBe('a\\\\b \\{c\\}\\Pd');
    expect(encodeDxfText('a\nb', false)).toBe('a b');
  });

  it('snaps line weights onto the DXF enumeration', () => {
    expect(snapLineWeight(0.353)).toBe(35);
    expect(snapLineWeight(0.176)).toBe(18);
    expect(snapLineWeight(0)).toBe(0);
    expect(snapLineWeight(undefined)).toBeNull();
  });

  it('maps colours to the nearest ACI index', () => {
    expect(aciFromColor({ r: 255, g: 0, b: 0 })).toBe(1);
    expect(aciFromColor({ r: 0, g: 0, b: 0 })).toBe(7);
    expect(aciFromColor({ r: 0, g: 0, b: 250 })).toBe(5);
  });

  it('sanitizes output file names', () => {
    expect(sanitizeFileName('a/b:c*d.pdf')).toBe('a_b_c_d.pdf');
    expect(sanitizeFileName('   ')).toBe('drawing');
  });
});

describe('DxfWriter structure', () => {
  it('writes an R2000 file that an open-source parser reads back entity by entity', async () => {
    const result = await new DxfWriter({ baseName: 'sample' }).write(
      syntheticDocument()
    );
    expect(result.primary).toBe('sample.dxf');
    expect(result.files.map(file => file.name)).toEqual([
      'sample.dxf',
      'scan-page-1-1.png',
    ]);
    const text = dxfText(result.files[0]!.data);
    expect(Buffer.from(text, 'latin1').every(byte => byte < 0x80)).toBe(true);
    expect(text.startsWith('  0\r\nSECTION\r\n  2\r\nHEADER')).toBe(true);
    expect(text.endsWith('  0\r\nEOF\r\n')).toBe(true);

    const dxf = parse(text);
    expect(dxf.header.$ACADVER).toBe('AC1015');
    expect(dxf.header.$INSUNITS).toBe(4);
    expect(dxf.header.$MEASUREMENT).toBe(1);
    expect(Object.keys(dxf.tables.layer.layers)).toEqual(
      expect.arrayContaining([
        '0',
        'STROKE_FF0000',
        'FILL_00FF00',
        'TEXT_HELVETICA',
        'IMAGE',
      ])
    );
    expect(dxf.tables.layer.layers['STROKE_FF0000']?.colorIndex).toBe(1);
    expect(Object.keys(dxf.tables.lineType.lineTypes)).toEqual(
      expect.arrayContaining(['ByBlock', 'ByLayer', 'Continuous', 'DASHED'])
    );
    expect(text).toContain('AcDbTextStyleTableRecord\r\n  2\r\nHELVETICA\r\n');

    const byType = (type: string) =>
      dxf.entities.filter(entity => entity.type === type);
    const [line] = byType('LINE');
    expect(line?.vertices?.map(v => [v.x, v.y])).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(line?.layer).toBe('STROKE_FF0000');
    expect(line?.lineweight).toBe(35);
    const polylines = byType('LWPOLYLINE');
    expect(polylines).toHaveLength(2);
    expect(polylines[0]?.shape).toBe(true);
    expect(polylines[0]?.vertices?.[0]?.bulge).toBe(0.5);
    const [arc] = byType('ARC');
    expect(arc?.radius).toBe(3);
    expect(arc?.startAngle).toBeCloseTo(0, 6);
    expect(arc?.endAngle).toBeCloseTo(Math.PI / 2, 6);
    expect(byType('CIRCLE')[0]?.center).toEqual({ x: 5, y: 5, z: 0 });
    const [textEntity] = byType('TEXT');
    expect(decodeDxfText(textEntity?.text ?? '')).toBe('尺寸 A1');
    expect(textEntity?.textHeight).toBe(2.5);
    expect(textEntity?.rotation).toBe(15);
    const [mtext] = byType('MTEXT');
    expect(decodeDxfText(mtext?.text ?? '')).toBe('第一行\\P第二行 \\{x\\}');
    expect(mtext?.attachmentPoint).toBe(1);
    const [insert] = byType('INSERT');
    expect(insert?.name).toBe('PAGE_2');
    expect(insert?.position).toEqual({ x: 100, y: 0, z: 0 });
    expect(dxf.blocks['PAGE_2']?.entities).toHaveLength(1);

    // HATCH 与 IMAGE 不在 dxf-parser 的实体表里,按文本结构校验。
    expect(text).toContain('  0\r\nHATCH\r\n');
    expect(text).toContain('  2\r\nSOLID\r\n');
    expect(text).toContain(' 91\r\n2\r\n');
    expect(text).toContain('  0\r\nIMAGE\r\n');
    expect(text).toContain(
      'AcDbRasterImageDef\r\n 90\r\n0\r\n  1\r\nscan-page-1-1.png'
    );
    expect(text).toContain('IMAGEDEF_REACTOR');
    expect(text).toContain('ACAD_IMAGE_DICT');
    expect(text).toContain('  1\r\nIMAGE\r\n  2\r\nAcDbRasterImage');
  });

  it('keeps handles unique and seeds $HANDSEED above them', async () => {
    const result = await new DxfWriter().write(syntheticDocument());
    const text = dxfText(result.files[0]!.data);
    const tags = text.split('\r\n');
    const handles: string[] = [];
    let seed = '';
    for (let i = 0; i + 1 < tags.length; i += 2) {
      const code = tags[i]!.trim();
      if (tags[i + 1] === '$HANDSEED') {
        seed = tags[i + 3]!;
        i += 2; // $HANDSEED 的值本身也用组码 5,不能算作对象句柄。
        continue;
      }
      if (code === '5' || code === '105') handles.push(tags[i + 1]!);
    }
    expect(new Set(handles).size).toBe(handles.length);
    const max = Math.max(...handles.map(handle => Number.parseInt(handle, 16)));
    expect(Number.parseInt(seed, 16)).toBeGreaterThan(max);
  });

  it('writes inch units and english measurement when requested', async () => {
    const result = await new DxfWriter().write(syntheticDocument('inch'));
    const dxf = parse(dxfText(result.files[0]!.data));
    expect(dxf.header.$INSUNITS).toBe(1);
    expect(dxf.header.$MEASUREMENT).toBe(0);
  });

  it('never references external files when the underlay is a placeholder', async () => {
    const document = syntheticDocument();
    document.pages[0]!.entities = document.pages[0]!.entities.filter(
      entity => entity.type !== 'image-underlay' || entity.placeholder
    );
    const result = await new DxfWriter().write(document);
    expect(result.files).toHaveLength(1);
    const text = dxfText(result.files[0]!.data);
    expect(text).not.toContain('IMAGEDEF');
    expect(text).not.toContain('.png');
    expect(text).not.toContain('  1\r\nIMAGE\r\n');
  });

  it('promotes over-long text lines to MTEXT chunks', async () => {
    const document = syntheticDocument();
    document.pages[0]!.entities = [
      {
        type: 'text',
        layer: '0',
        source: 'pdf',
        origin: 'text',
        text: '中'.repeat(120),
        insert: { x: 0, y: 0 },
        height: 2,
        rotation: 0,
        style: 'Standard',
      },
    ];
    const result = await new DxfWriter().write(document);
    const text = dxfText(result.files[0]!.data);
    expect(text).not.toContain('  0\r\nTEXT\r\n');
    expect(text).toContain('  0\r\nMTEXT\r\n');
    const chunks = text.match(/\r\n {2}3\r\n/g) ?? [];
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const dxf = parse(text);
    expect(decodeDxfText(dxf.entities[0]?.text ?? '')).toBe('中'.repeat(120));
  });

  it('offsets entities of later pages by the page origin', async () => {
    const document = syntheticDocument();
    const page = document.pages[0]!;
    document.pages = [
      { ...page, entities: [page.entities[0]!] },
      {
        ...page,
        index: 1,
        number: 2,
        origin: { x: 110, y: 0 },
        entities: [page.entities[0]!],
      },
    ];
    const result = await new DxfWriter().write(document);
    const dxf = parse(dxfText(result.files[0]!.data));
    const lines = dxf.entities.filter(entity => entity.type === 'LINE');
    expect(lines[1]?.vertices?.[0]?.x).toBe(110);
    expect(dxf.header.$EXTMAX).toEqual({ x: 210, y: 50, z: 0 });
  });
});

describe('DxfWriter with extracted fixtures', () => {
  const extractor = new PdfCadExtractorService();

  it('round-trips the vector fixture through dxf-parser', async () => {
    const fixture = await createVectorLinesFixture();
    const document = await extractor.extract(
      fixture.pdf,
      DEFAULT_PDF_TO_CAD_CONFIG
    );
    const result = await new DxfWriter({ baseName: fixture.name }).write(
      document
    );
    const text = dxfText(result.files[0]!.data);
    const dxf = parse(text);

    const count = (type: string) =>
      dxf.entities.filter(entity => entity.type === type).length;
    expect(count('LINE')).toBe(4);
    expect(count('LWPOLYLINE')).toBe(2);
    expect(count('CIRCLE')).toBe(1);
    expect(count('TEXT')).toBe(1);
    expect((text.match(/\r\n {2}0\r\nHATCH\r\n/g) ?? []).length).toBe(1);

    const circle = dxf.entities.find(entity => entity.type === 'CIRCLE');
    expect(circle?.center?.x).toBeCloseTo((220 * 25.4) / 72, 4);
    expect(circle?.center?.y).toBeCloseTo((120 * 25.4) / 72, 4);
    expect(circle?.radius).toBeCloseTo((30 * 25.4) / 72, 4);
    const dashedLayer = dxf.tables.layer.layers['STROKE_000000_DASHED'];
    expect(dashedLayer).toBeDefined();
    expect(text).toContain(
      'STROKE_000000_DASHED\r\n 70\r\n0\r\n 62\r\n7\r\n  6\r\nDASHED'
    );
  });

  it('is deterministic for identical input', async () => {
    const fixture = await createVectorLinesFixture();
    const config = pdfToCadTaskConfigSchema.parse({ layerMode: 'semantic' });
    const first = await new DxfWriter().write(
      await extractor.extract(fixture.pdf, config)
    );
    const second = await new DxfWriter().write(
      await extractor.extract(fixture.pdf, config)
    );
    expect(first.files[0]!.data.equals(second.files[0]!.data)).toBe(true);
  });
});

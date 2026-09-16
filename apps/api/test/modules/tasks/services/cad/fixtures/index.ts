import { PDFDocument, rgb, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';
import sharp from 'sharp';
import type {
  CadDegradationCode,
  CadEntitySource,
  CadEntityType,
} from '@utils-plane/validators';
import type { CadPageKind } from '../../../../../../src/modules/tasks/services/cad/types';

/**
 * PDF 转 CAD 的三类 fixture(00 契约)。
 *
 * 全部在测试运行时用 pdf-lib / MuPDF / sharp 生成,不提交二进制文件;
 * 生成过程是确定性的,所以 01/02/03 的实体统计断言可以直接钉死在这里的 `expected` 上。
 * 每个 fixture 的内容与预期统计见同目录 README.md。
 */

export type CadFixtureName = 'vector-lines' | 'chinese-annotation' | 'scanned';

export interface CadFixtureExpectation {
  pageCount: number;
  kind: CadPageKind;
  /** 默认配置(dxf / mm / scale 1 / source 图层 / 不开 OCR 与底图)下的实体统计。 */
  entityCount: number;
  bySource: Record<CadEntitySource, number>;
  byType: Partial<Record<CadEntityType, number>>;
  imageCount: number;
  /** 页内应出现的原生文字(子串匹配)。 */
  texts: string[];
  degradations: CadDegradationCode[];
}

export interface CadFixture {
  name: CadFixtureName;
  pdf: Buffer;
  /** 显示方向下的页面尺寸(point)。 */
  widthPt: number;
  heightPt: number;
  expected: CadFixtureExpectation;
}

/**
 * 矢量线图:300×200pt,一页。
 *
 * - 3 条描边直线(其中 1 条虚线)→ 3 个 line(`pdf`)
 * - 1 个描边矩形 → 1 个闭合 polyline
 * - 1 个描边圆(4 段三次贝塞尔)→ 1 个 circle
 * - 1 个填充矩形 → 1 个 hatch
 * - 1 个 0.8pt 高的细长填充矩形 → 1 个 line(`inferred`,thin_fill_as_line)
 * - 文字 "A1" → 1 个 text
 * - 页面边界 → 1 个闭合 polyline
 */
export async function createVectorLinesFixture(): Promise<CadFixture> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);

  page.drawLine({
    start: { x: 10, y: 10 },
    end: { x: 290, y: 10 },
    thickness: 1,
    color: rgb(1, 0, 0),
  });
  page.drawLine({
    start: { x: 10, y: 10 },
    end: { x: 10, y: 190 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  page.drawLine({
    start: { x: 10, y: 190 },
    end: { x: 290, y: 190 },
    thickness: 0.5,
    color: rgb(0, 0, 0),
    dashArray: [4, 2],
  });
  page.drawRectangle({
    x: 50,
    y: 50,
    width: 100,
    height: 60,
    borderColor: rgb(0, 0, 1),
    borderWidth: 1,
  });
  page.drawCircle({
    x: 220,
    y: 120,
    size: 30,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });
  page.drawRectangle({
    x: 200,
    y: 20,
    width: 60,
    height: 20,
    color: rgb(0, 1, 0),
  });
  page.drawRectangle({
    x: 20,
    y: 100,
    width: 120,
    height: 0.8,
    color: rgb(0, 0, 0),
  });
  page.drawText('A1', { x: 60, y: 150, size: 12, font: helvetica });

  return {
    name: 'vector-lines',
    pdf: Buffer.from(await doc.save()),
    widthPt: 300,
    heightPt: 200,
    expected: {
      pageCount: 1,
      kind: 'vector',
      entityCount: 9,
      bySource: { pdf: 8, ocr: 0, inferred: 1 },
      byType: { line: 4, polyline: 2, circle: 1, hatch: 1, text: 1 },
      imageCount: 0,
      texts: ['A1'],
      degradations: ['thin_fill_as_line'],
    },
  };
}

/**
 * 中文标注图:300×200pt,一页。
 *
 * 先用 MuPDF 把两段中文 HTML 排成 PDF(内置 Droid Sans Fallback,不依赖系统字体),
 * 再用 pdf-lib 在同一页叠加 2 条标注线与 1 个圆。
 *
 * - 2 段中文 → 2 个 text(`pdf`)
 * - 2 条描边直线 → 2 个 line
 * - 1 个描边圆 → 1 个 circle
 * - 页面边界 → 1 个闭合 polyline
 */
export async function createChineseAnnotationFixture(): Promise<CadFixture> {
  const html = [
    '<!doctype html><html><head><style>',
    'body { margin: 0; padding: 20pt; font-family: sans-serif; }',
    'p { margin: 0 0 8pt 0; }',
    '</style></head><body>',
    '<p style="font-size: 14pt">尺寸标注 直径50</p>',
    '<p style="font-size: 10pt">Note: 中文注释</p>',
    '</body></html>',
  ].join('');
  const htmlDocument = mupdf.Document.openDocument(
    Buffer.from(html, 'utf8'),
    'text/html'
  );
  const buffer = new mupdf.Buffer();
  try {
    htmlDocument.layout(300, 200, 12);
    const writer = new mupdf.DocumentWriter(buffer, 'pdf', '');
    try {
      const page = htmlDocument.loadPage(0);
      try {
        const device = writer.beginPage([0, 0, 300, 200]);
        page.run(device, mupdf.Matrix.identity);
        writer.endPage();
      } finally {
        page.destroy();
      }
      writer.close();
    } finally {
      writer.destroy();
    }
  } finally {
    htmlDocument.destroy();
  }

  // 内置 CJK 回退字体整套嵌入有 3.6MB,pdf-lib 解析要几十秒;子集化后只剩 20KB。
  const rendered = mupdf.Document.openDocument(
    buffer.asUint8Array(),
    'application/pdf'
  ) as mupdf.PDFDocument;
  buffer.destroy();
  let subsetBytes: Uint8Array;
  try {
    rendered.subsetFonts();
    const subsetBuffer = rendered.saveToBuffer('compress');
    subsetBytes = subsetBuffer.asUint8Array().slice();
    subsetBuffer.destroy();
  } finally {
    rendered.destroy();
  }

  const doc = await PDFDocument.load(subsetBytes);
  const page = doc.getPage(0);
  page.drawLine({
    start: { x: 20, y: 60 },
    end: { x: 200, y: 60 },
    thickness: 0.75,
    color: rgb(0, 0, 0),
  });
  page.drawLine({
    start: { x: 200, y: 60 },
    end: { x: 240, y: 100 },
    thickness: 0.75,
    color: rgb(0, 0, 0),
  });
  page.drawCircle({
    x: 240,
    y: 130,
    size: 25,
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.75,
  });

  return {
    name: 'chinese-annotation',
    pdf: Buffer.from(await doc.save()),
    widthPt: 300,
    heightPt: 200,
    expected: {
      pageCount: 1,
      kind: 'vector',
      entityCount: 6,
      bySource: { pdf: 6, ocr: 0, inferred: 0 },
      byType: { line: 2, circle: 1, polyline: 1, text: 2 },
      imageCount: 0,
      texts: ['尺寸标注 直径50', 'Note: 中文注释'],
      degradations: [],
    },
  };
}

/**
 * 扫描图:400×300pt,一页,只有一张整页 PNG(800×600 像素,白底黑线加文字)。
 *
 * - 没有任何原生路径与文字 → 页面类型 raster,记录 raster_page 降级
 * - 1 张图片 → 1 个 image-underlay 占位(`placeholder: true`)
 * - 页面边界 → 1 个闭合 polyline
 *
 * 图里画了 1 条横线(y=300px,x 60→740,粗 6px)和 1 条竖线(x=100px,y 80→520,粗 6px),
 * 供 02 的栅格线段推断断言;文字 "SCAN 123" 供 OCR 测试(OCR 在测试里 mock)。
 */
export async function createScannedFixture(): Promise<CadFixture> {
  const png = await createScannedPng();
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const image = await doc.embedPng(png);
  page.drawImage(image, { x: 0, y: 0, width: 400, height: 300 });

  return {
    name: 'scanned',
    pdf: Buffer.from(await doc.save()),
    widthPt: 400,
    heightPt: 300,
    expected: {
      pageCount: 1,
      kind: 'raster',
      entityCount: 2,
      bySource: { pdf: 2, ocr: 0, inferred: 0 },
      byType: { polyline: 1, 'image-underlay': 1 },
      imageCount: 1,
      texts: [],
      degradations: ['raster_page'],
    },
  };
}

export const SCANNED_FIXTURE_PIXELS = { width: 800, height: 600 } as const;

/** 扫描页用的 PNG:白底,一横一竖两条黑线,一行文字。 */
export async function createScannedPng(): Promise<Buffer> {
  const { width, height } = SCANNED_FIXTURE_PIXELS;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="#ffffff" />
  <rect x="60" y="297" width="680" height="6" fill="#000000" />
  <rect x="97" y="80" width="6" height="440" fill="#000000" />
  <text x="320" y="200" font-family="sans-serif" font-size="48" fill="#000000">SCAN 123</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function createAllCadFixtures(): Promise<CadFixture[]> {
  return Promise.all([
    createVectorLinesFixture(),
    createChineseAnnotationFixture(),
    createScannedFixture(),
  ]);
}

/** 若干空白页,给空页 / 页码越界用例用。 */
export async function createBlankPdf(
  pages: Array<[number, number]> = [[200, 100]]
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (const size of pages) doc.addPage(size);
  return Buffer.from(await doc.save());
}

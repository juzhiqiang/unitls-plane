import { CAD_POINT_TO_UNIT } from '@utils-plane/validators';
import { pageToCadMatrix, applyMatrix, round, roundPoint } from './geometry';
import type { MupdfModule } from './pdf-cad-extractor.service';
import type { CadDocument, CadLineEntity, CadPage } from './types';

/**
 * 栅格底图与栅格线段推断(02 契约)。
 *
 * - `renderPageRaster`:用 MuPDF 把一页渲染成灰度/彩色位图,供 OCR 与线段推断使用;
 *   分辨率按最长边封顶,避免 A0 扫描件在 300 DPI 下撑爆内存。
 * - `inferRasterLines`:在二值化位图上按行/列扫描长而薄的墨迹带,还原成横线/竖线。
 *   这是确定性的启发式规则(无机器学习),结果一律标记 `source: 'inferred'`、`origin: 'raster'`。
 *
 * 底图资源本身(嵌入图片的 PNG)由解析器在 `includeRasterUnderlay` 时直接从图像对象导出,
 * 这里不重复渲染整页。
 */

type MupdfPage = import('mupdf').Page;

export const OCR_RENDER_DPI = 300;
export const RASTER_MAX_EDGE_PX = 6000;

export interface PageRaster {
  /** 灰度像素,行主序,`width × height`。 */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** 实际渲染 DPI(可能因封顶而低于请求值)。 */
  dpi: number;
  /** PNG 编码(RGB),供 OCR 引擎读取。 */
  png: Buffer;
}

/** 请求 DPI 会被封顶,使最长边不超过 RASTER_MAX_EDGE_PX。 */
export function effectiveRasterDpi(
  widthPt: number,
  heightPt: number,
  requestedDpi: number
): number {
  const longestPt = Math.max(widthPt, heightPt, 1);
  const maxDpi = (RASTER_MAX_EDGE_PX * 72) / longestPt;
  return Math.max(24, Math.min(requestedDpi, maxDpi));
}

export function renderPageRaster(
  mupdf: MupdfModule,
  page: MupdfPage,
  requestedDpi = OCR_RENDER_DPI
): PageRaster {
  const bounds = page.getBounds();
  const dpi = effectiveRasterDpi(
    bounds[2] - bounds[0],
    bounds[3] - bounds[1],
    requestedDpi
  );
  const scale = dpi / 72;
  const gray = page.toPixmap(
    mupdf.Matrix.scale(scale, scale),
    mupdf.ColorSpace.DeviceGray,
    false,
    false
  );
  try {
    const width = gray.getWidth();
    const height = gray.getHeight();
    const stride = gray.getStride();
    const source = gray.getPixels();
    const pixels = new Uint8ClampedArray(width * height);
    if (stride === width) {
      pixels.set(source.subarray(0, width * height));
    } else {
      for (let y = 0; y < height; y++) {
        pixels.set(source.subarray(y * stride, y * stride + width), y * width);
      }
    }
    return { pixels, width, height, dpi, png: Buffer.from(gray.asPNG()) };
  } finally {
    gray.destroy();
  }
}

export interface RasterLineOptions {
  /** 判定为墨迹的灰度阈值(0-255,小于即墨迹)。 */
  threshold?: number;
  /** 最短线长(像素);缺省取短边的 8%,且不小于 40px。 */
  minLengthPx?: number;
  /** 最大线粗(像素);更粗的墨迹带视为填充区域而非线。 */
  maxThicknessPx?: number;
  /** 每页最多返回的线段数,防止噪声图产生海量实体。 */
  maxLines?: number;
}

export interface RasterLine {
  orientation: 'horizontal' | 'vertical';
  /** 像素坐标(左上原点),线段中心线。 */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thicknessPx: number;
}

interface Band {
  start: number;
  end: number;
  firstIndex: number;
  lastIndex: number;
}

/**
 * 在灰度位图上推断横线/竖线。
 *
 * 逐行找出长度 ≥ minLength 的连续墨迹段,相邻行且区间重叠的段合并成一条"带";
 * 带的厚度 ≤ maxThickness 时输出为一条线(取带的中心与并集区间)。列方向同理。
 * 文字笔画远短于 minLength,不会被误判;大块填色区域厚度超限被丢弃。
 */
export function inferRasterLines(
  raster: Pick<PageRaster, 'pixels' | 'width' | 'height'>,
  options: RasterLineOptions = {}
): RasterLine[] {
  const { pixels, width, height } = raster;
  const threshold = options.threshold ?? 128;
  const minLength =
    options.minLengthPx ??
    Math.max(40, Math.round(Math.min(width, height) * 0.08));
  const maxThickness =
    options.maxThicknessPx ?? Math.max(4, Math.round(minLength / 4));
  const maxLines = options.maxLines ?? 2000;
  const isInk = (x: number, y: number) => pixels[y * width + x]! < threshold;

  const scan = (
    primaryCount: number,
    secondaryCount: number,
    inkAt: (primary: number, secondary: number) => boolean,
    emit: (band: Band) => void
  ) => {
    let open: Band[] = [];
    for (let p = 0; p < primaryCount; p++) {
      const runs: Array<[number, number]> = [];
      let runStart = -1;
      for (let s = 0; s <= secondaryCount; s++) {
        const ink = s < secondaryCount && inkAt(p, s);
        if (ink && runStart < 0) runStart = s;
        if (!ink && runStart >= 0) {
          if (s - runStart >= minLength) runs.push([runStart, s - 1]);
          runStart = -1;
        }
      }
      const next: Band[] = [];
      for (const [start, end] of runs) {
        const match = open.find(band => overlaps(band, start, end));
        if (match) {
          match.start = Math.min(match.start, start);
          match.end = Math.max(match.end, end);
          match.lastIndex = p;
          next.push(match);
        } else {
          next.push({ start, end, firstIndex: p, lastIndex: p });
        }
      }
      for (const band of open) {
        if (!next.includes(band)) emit(band);
      }
      open = next;
    }
    for (const band of open) emit(band);
  };

  const lines: RasterLine[] = [];
  const push = (line: RasterLine, band: Band) => {
    const thickness = band.lastIndex - band.firstIndex + 1;
    if (thickness > maxThickness || lines.length >= maxLines) return;
    lines.push({ ...line, thicknessPx: thickness });
  };
  scan(
    height,
    width,
    (y, x) => isInk(x, y),
    band => {
      const y = (band.firstIndex + band.lastIndex) / 2;
      push(
        {
          orientation: 'horizontal',
          x1: band.start,
          y1: y,
          x2: band.end,
          y2: y,
          thicknessPx: 0,
        },
        band
      );
    }
  );
  scan(
    width,
    height,
    (x, y) => isInk(x, y),
    band => {
      const x = (band.firstIndex + band.lastIndex) / 2;
      push(
        {
          orientation: 'vertical',
          x1: x,
          y1: band.start,
          x2: x,
          y2: band.end,
          thicknessPx: 0,
        },
        band
      );
    }
  );
  return lines;
}

function overlaps(band: Band, start: number, end: number): boolean {
  const overlap = Math.min(band.end, end) - Math.max(band.start, start);
  const shorter = Math.min(band.end - band.start, end - start);
  return overlap >= 0 && overlap >= shorter * 0.8;
}

/** 目标单位 / point,由页面尺寸反推,免得各阶段各自换算。 */
export function pageUnitFactor(document: CadDocument): number {
  return CAD_POINT_TO_UNIT[document.unit] * document.scale;
}

/** 把像素坐标的推断线段转换成页内 CAD 线实体。 */
export function rasterLinesToEntities(
  lines: RasterLine[],
  page: CadPage,
  raster: Pick<PageRaster, 'dpi'>,
  unitFactor: number,
  layer: string
): CadLineEntity[] {
  const pointPerPixel = 72 / raster.dpi;
  const toCad = pageToCadMatrix(page.heightPt, unitFactor, 1);
  const mmPerPixel = (pointPerPixel * 25.4) / 72;
  return lines.map(line => ({
    type: 'line',
    layer,
    source: 'inferred',
    origin: 'raster',
    color: { r: 0, g: 0, b: 0 },
    lineWeightMm: round(line.thicknessPx * mmPerPixel, 3),
    start: roundPoint(
      applyMatrix(toCad, line.x1 * pointPerPixel, line.y1 * pointPerPixel)
    ),
    end: roundPoint(
      applyMatrix(toCad, line.x2 * pointPerPixel, line.y2 * pointPerPixel)
    ),
  }));
}

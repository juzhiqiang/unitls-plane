import { Injectable } from '@nestjs/common';
import {
  CAD_POINT_TO_UNIT,
  PDF_TO_CAD_MAX_ENTITIES,
  type CadDegradationCode,
  type PdfToCadTaskConfig,
} from '@utils-plane/validators';
import {
  applyMatrix,
  arcSweepDeg,
  arcToBulge,
  asAxisAlignedRect,
  concatMatrix,
  dedupeVertices,
  distance,
  fitArcFromBezier,
  flattenCubicBezier,
  matrixExpansion,
  nearlyEqual,
  normalizeAngleDeg,
  pageToCadMatrix,
  pointsNearlyEqual,
  round,
  roundPoint,
  toByte,
  toCounterClockwiseArc,
  type AffineMatrix,
  type FittedArc,
} from './geometry';
import {
  classifyLineType,
  isBoldFont,
  isItalicFont,
  LayerMapper,
  normalizeFontFamily,
  sanitizeLayerName,
} from './layer-mapper';
import {
  CAD_CONVERTER_VERSION,
  CAD_MODEL_VERSION,
  CadError,
  countEntity,
  createEmptyPageStats,
  type CadColor,
  type CadDegradation,
  type CadDocument,
  type CadEntity,
  type CadEntityType,
  type CadHatchLoop,
  type CadImageResource,
  type CadImageUnderlayEntity,
  type CadLineType,
  type CadPage,
  type CadPoint,
  type CadPolylineVertex,
  type CadTextStyle,
} from './types';

/**
 * PDF Buffer → CadDocument(01 契约)。
 *
 * 不依赖 Nest 任务生命周期:没有构造依赖,`new PdfCadExtractorService().extract()` 即可用。
 * 解析用 MuPDF 的自定义 Device 回调拿到路径/图片/渐变/裁剪,用 StructuredText 拿到按行组织的文字;
 * 页面旋转由 MuPDF 的页面变换统一处理,回调里拿到的一律是显示方向、左上原点、point 单位的坐标。
 */

export type MupdfModule = typeof import('mupdf');
type MupdfPath = import('mupdf').Path;
type MupdfPage = import('mupdf').Page;
type MupdfImage = import('mupdf').Image;
type MupdfFont = import('mupdf').Font;
type MupdfColorSpace = import('mupdf').ColorSpace;
type MupdfStrokeState = import('mupdf').StrokeState;

const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<MupdfModule>;
let mupdfPromise: Promise<MupdfModule> | undefined;

/** 与 pdf.service 相同的动态加载:tsc 编译成 CJS 后 mupdf(ESM)仍要走原生 import。 */
export function loadMupdf(): Promise<MupdfModule> {
  mupdfPromise ??= nativeImport('mupdf');
  return mupdfPromise;
}

/** 曲线拟合/打散容差(point);实际按 unit × scale 换算到目标单位。 */
export const ARC_FIT_TOLERANCE_PT = 0.05;
export const FLATTEN_TOLERANCE_PT = 0.1;
export const VERTEX_EPSILON_PT = 0.01;
/** 细长填充矩形当作线段的阈值:短边 ≤ 1.5pt 且长边 ≥ 4 倍短边。 */
export const THIN_FILL_MAX_WIDTH_PT = 1.5;
export const THIN_FILL_MIN_ASPECT = 4;
/** CAD 文字高度 = 字号 × 大写字高比例;CJK 方块字占满字身,用更高的比例。 */
export const TEXT_CAP_HEIGHT_RATIO = 0.7;
export const CJK_TEXT_HEIGHT_RATIO = 0.85;
/** 多页排版时页与页之间的间距(相对最宽页宽)。 */
export const PAGE_GAP_RATIO = 0.1;
const POINT_TO_MM = 25.4 / 72;
const CJK_PATTERN = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/;

export interface ExtractOptions {
  /** 每解析完一页回调一次(done 从 1 起)。 */
  onProgress?: (done: number, total: number) => void | Promise<void>;
  /** 底图资源文件名前缀,缺省 `underlay`。 */
  resourceBaseName?: string;
  /** 实体总数预算,缺省 PDF_TO_CAD_MAX_ENTITIES;测试用小值验证超限路径。 */
  maxEntities?: number;
}

interface PathSegment {
  kind: 'line' | 'curve';
  c1?: CadPoint;
  c2?: CadPoint;
  to: CadPoint;
}

interface SubPath {
  start: CadPoint;
  segments: PathSegment[];
  closed: boolean;
}

interface Piece {
  kind: 'line' | 'arc';
  from: CadPoint;
  to: CadPoint;
  arc?: FittedArc;
  /** 曲线拟合失败时打散出来的中间点(不含 from,含 to)。 */
  flattened?: CadPoint[];
}

interface PaintStyle {
  color?: CadColor;
  lineWeightMm?: number;
  lineType?: CadLineType;
}

interface PageContext {
  page: CadPage;
  /** 显示页面空间(左上原点、pt)→ 页内 CAD 坐标。 */
  toCad: AffineMatrix;
  /** 目标单位 / point。 */
  k: number;
  layers: LayerMapper;
  textStyles: Map<string, CadTextStyle>;
  counters: {
    paths: number;
    images: number;
    flattenedCurves: number;
    thinFills: number;
  };
  resourceBaseName: string;
  includeUnderlay: boolean;
  totalEntities: { value: number };
  maxEntities: number;
}

@Injectable()
export class PdfCadExtractorService {
  async extract(
    pdf: Buffer,
    config: PdfToCadTaskConfig,
    options: ExtractOptions = {}
  ): Promise<CadDocument> {
    const mupdf = await loadMupdf();
    let document: import('mupdf').Document;
    try {
      document = mupdf.Document.openDocument(pdf, 'application/pdf');
    } catch (error) {
      throw new CadError(
        'CAD_CONVERSION_FAILED',
        `Unable to open PDF: ${(error as Error).message}`
      );
    }

    try {
      if (document.needsPassword()) {
        throw new CadError(
          'CAD_CONVERSION_FAILED',
          'Encrypted PDF requires a password'
        );
      }
      const totalPages = document.countPages();
      if (totalPages === 0) {
        throw new CadError('CAD_CONVERSION_FAILED', 'PDF has no pages');
      }
      const pageIndices =
        config.pages ?? Array.from({ length: totalPages }, (_, i) => i);
      for (const index of pageIndices) {
        if (!Number.isInteger(index) || index < 0 || index >= totalPages) {
          throw new CadError(
            'CAD_INVALID_CONFIG',
            `Page index ${index} is out of range (total pages: ${totalPages})`,
            { index, totalPages }
          );
        }
      }

      const layers = new LayerMapper(config.layerMode);
      const textStyles = new Map<string, CadTextStyle>();
      const degradations: CadDegradation[] = [];
      const totalEntities = { value: 0 };
      const pages: CadPage[] = [];
      const k = CAD_POINT_TO_UNIT[config.unit] * config.scale;

      for (let i = 0; i < pageIndices.length; i++) {
        const index = pageIndices[i]!;
        const page = document.loadPage(index);
        try {
          const context = this.createPageContext(mupdf, page, index, {
            k,
            layers,
            textStyles,
            includeUnderlay: config.includeRasterUnderlay,
            resourceBaseName: options.resourceBaseName ?? 'underlay',
            totalEntities,
            maxEntities: options.maxEntities ?? PDF_TO_CAD_MAX_ENTITIES,
          });
          this.runDevice(mupdf, page, context);
          this.collectText(page, context);
          this.finishPage(context, degradations);
          pages.push(context.page);
        } finally {
          page.destroy();
        }
        await options.onProgress?.(i + 1, pageIndices.length);
      }

      if (
        pages.every(page =>
          page.entities.every(entity => entity.origin === 'page')
        )
      ) {
        throw new CadError(
          'CAD_CONVERSION_FAILED',
          'PDF has no convertible content on the selected pages',
          { pages: pages.map(page => page.number) }
        );
      }

      layoutPages(pages);

      const cadDocument: CadDocument = {
        modelVersion: CAD_MODEL_VERSION,
        converterVersion: CAD_CONVERTER_VERSION,
        format: config.format,
        unit: config.unit,
        scale: config.scale,
        layerMode: config.layerMode,
        pages,
        layers: layers.list(),
        textStyles: [...textStyles.values()],
        blocks: [],
        meta: {
          converterVersion: CAD_CONVERTER_VERSION,
          format: config.format,
          unit: config.unit,
          scale: config.scale,
          layerMode: config.layerMode,
          sourcePageCount: totalPages,
          pageCount: pages.length,
          pages: pages.map(page => page.number),
          entityCount: 0,
          entityCountBySource: { pdf: 0, ocr: 0, inferred: 0 },
          entityCountByType: {},
          ocrTextCount: 0,
          ocrPages: [],
          underlay: false,
          degradations,
        },
      };
      recomputeConversionMeta(cadDocument);
      return cadDocument;
    } finally {
      document.destroy();
    }
  }

  private createPageContext(
    mupdf: MupdfModule,
    page: MupdfPage,
    index: number,
    shared: Pick<
      PageContext,
      | 'k'
      | 'layers'
      | 'textStyles'
      | 'includeUnderlay'
      | 'resourceBaseName'
      | 'totalEntities'
      | 'maxEntities'
    >
  ): PageContext {
    const bounds = page.getBounds();
    const widthPt = bounds[2] - bounds[0];
    const heightPt = bounds[3] - bounds[1];
    const toCad = concatMatrix(
      [1, 0, 0, 1, -bounds[0], -bounds[1]],
      pageToCadMatrix(heightPt, shared.k, 1)
    );
    const cadPage: CadPage = {
      index,
      number: index + 1,
      width: round(widthPt * shared.k),
      height: round(heightPt * shared.k),
      widthPt: round(widthPt),
      heightPt: round(heightPt),
      rotation: readRotation(mupdf, page),
      origin: { x: 0, y: 0 },
      kind: 'empty',
      entities: [],
      stats: createEmptyPageStats(),
    };
    return {
      page: cadPage,
      toCad,
      layers: shared.layers,
      textStyles: shared.textStyles,
      counters: { paths: 0, images: 0, flattenedCurves: 0, thinFills: 0 },
      k: shared.k,
      includeUnderlay: shared.includeUnderlay,
      resourceBaseName: shared.resourceBaseName,
      totalEntities: shared.totalEntities,
      maxEntities: shared.maxEntities,
    };
  }

  private runDevice(
    mupdf: MupdfModule,
    page: MupdfPage,
    context: PageContext
  ): void {
    const device = new mupdf.Device({
      fillPath: (path, evenOdd, ctm, colorspace, color) => {
        context.counters.paths += 1;
        this.emitFill(
          context,
          path,
          evenOdd,
          ctm,
          toCadColor(colorspace, color)
        );
      },
      strokePath: (path, stroke, ctm, colorspace, color) => {
        context.counters.paths += 1;
        this.emitStroke(
          context,
          path,
          ctm,
          strokeStyle(stroke, ctm, toCadColor(colorspace, color))
        );
      },
      clipPath: () => {
        context.page.stats.dropped.clips += 1;
      },
      clipStrokePath: () => {
        context.page.stats.dropped.clips += 1;
      },
      clipText: () => {
        context.page.stats.dropped.clips += 1;
      },
      clipImageMask: () => {
        context.page.stats.dropped.clips += 1;
      },
      fillShade: () => {
        context.page.stats.dropped.shadings += 1;
      },
      fillImage: (image, ctm) => {
        context.counters.images += 1;
        this.emitImage(mupdf, context, image, ctm, null);
      },
      fillImageMask: (image, ctm, colorspace, color) => {
        context.counters.images += 1;
        this.emitImage(
          mupdf,
          context,
          image,
          ctm,
          toCadColor(colorspace, color) ?? { r: 0, g: 0, b: 0 }
        );
      },
      beginMask: () => {
        context.page.stats.dropped.imageMasks += 1;
      },
      beginTile: () => 0,
    });
    try {
      page.run(device, mupdf.Matrix.identity);
    } finally {
      try {
        device.close();
      } catch {
        // 回调里抛出的契约错误已经在传播,关闭设备失败不需要再报。
      }
      device.destroy();
    }
  }

  private emitStroke(
    context: PageContext,
    path: MupdfPath,
    ctm: AffineMatrix,
    style: PaintStyle
  ): void {
    const full = concatMatrix(ctm, context.toCad);
    const subPaths = walkPath(path, full);
    const epsilon = VERTEX_EPSILON_PT * context.k;
    const layer = context.layers.resolve({
      origin: 'stroke',
      source: 'pdf',
      color: style.color,
      lineWeightMm: style.lineWeightMm,
      lineType: style.lineType,
    });

    for (const subPath of subPaths) {
      const pieces = this.toPieces(context, subPath);
      if (pieces.length === 0) continue;
      const base = {
        layer,
        source: 'pdf' as const,
        origin: 'stroke' as const,
        ...style,
      };

      const circle = asCircle(pieces, subPath.closed, epsilon);
      if (circle) {
        this.push(context, {
          type: 'circle',
          ...base,
          ...circle,
          derived: 'fitted',
        });
        continue;
      }
      if (pieces.length === 1 && pieces[0]!.kind === 'arc' && !subPath.closed) {
        const arc = pieces[0]!.arc!;
        this.push(context, {
          type: 'arc',
          ...base,
          center: roundPoint(arc.center),
          radius: round(arc.radius),
          ...toCounterClockwiseArc(arc),
          derived: 'fitted',
        });
        continue;
      }
      if (
        pieces.length === 1 &&
        pieces[0]!.kind === 'line' &&
        !pieces[0]!.flattened
      ) {
        const piece = pieces[0]!;
        if (pointsNearlyEqual(piece.from, piece.to, epsilon)) continue;
        this.push(context, {
          type: 'line',
          ...base,
          start: roundPoint(piece.from),
          end: roundPoint(piece.to),
        });
        continue;
      }

      const vertices = piecesToVertices(pieces, epsilon);
      const closed = subPath.closed || isClosedLoop(vertices, epsilon);
      if (closed && isClosedLoop(vertices, epsilon)) vertices.pop();
      if (vertices.length < 2) continue;
      if (vertices.length === 2 && !vertices[0]!.bulge && !closed) {
        this.push(context, {
          type: 'line',
          ...base,
          start: roundPoint(vertices[0]!),
          end: roundPoint(vertices[1]!),
          ...(pieces.some(piece => piece.flattened)
            ? { derived: 'flattened' }
            : {}),
        });
        continue;
      }
      this.push(context, {
        type: 'polyline',
        ...base,
        vertices,
        closed,
        ...(pieces.some(piece => piece.flattened)
          ? { derived: 'flattened' }
          : {}),
      });
    }
  }

  private emitFill(
    context: PageContext,
    path: MupdfPath,
    evenOdd: boolean,
    ctm: AffineMatrix,
    color: CadColor | undefined
  ): void {
    const full = concatMatrix(ctm, context.toCad);
    const subPaths = walkPath(path, full);
    const epsilon = VERTEX_EPSILON_PT * context.k;
    const fillColor = color ?? { r: 0, g: 0, b: 0 };

    // 单个轴对齐细长矩形:PDF 里常用填充矩形画细线,还原成带线宽的 LINE 更符合 CAD 语义。
    if (subPaths.length === 1) {
      const thin = asThinFillLine(subPaths[0]!, context.k, epsilon);
      if (thin) {
        context.counters.thinFills += 1;
        const layer = context.layers.resolve({
          origin: 'fill',
          source: 'inferred',
          color: fillColor,
          fill: false,
        });
        this.push(context, {
          type: 'line',
          layer,
          source: 'inferred',
          origin: 'fill',
          color: fillColor,
          lineWeightMm: thin.lineWeightMm,
          start: roundPoint(thin.start),
          end: roundPoint(thin.end),
          derived: 'fitted',
        });
        return;
      }
    }

    const loops: CadHatchLoop[] = [];
    let flattened = false;
    for (const subPath of subPaths) {
      const pieces = this.toPieces(context, subPath);
      if (pieces.length === 0) continue;
      flattened ||= pieces.some(piece => piece.flattened);
      const vertices = piecesToVertices(pieces, epsilon);
      if (vertices.length >= 2 && isClosedLoop(vertices, epsilon)) {
        vertices.pop();
      }
      if (
        vertices.length < 3 &&
        !(vertices.length === 2 && vertices[0]!.bulge)
      ) {
        continue;
      }
      loops.push({ vertices });
    }
    if (loops.length === 0) return;

    const layer = context.layers.resolve({
      origin: 'fill',
      source: 'pdf',
      color: fillColor,
      fill: true,
    });
    this.push(context, {
      type: 'hatch',
      layer,
      source: 'pdf',
      origin: 'fill',
      color: fillColor,
      loops,
      evenOdd,
      fillColor,
      ...(flattened ? { derived: 'flattened' } : {}),
    });
  }

  private emitImage(
    mupdf: MupdfModule,
    context: PageContext,
    image: MupdfImage,
    ctm: AffineMatrix,
    maskColor: CadColor | null
  ): void {
    const full = concatMatrix(ctm, context.toCad);
    // MuPDF 的图片 ctm 把单位正方形映射到页面,(0,0) 是图片左上角,(1,1) 是右下角。
    const topLeft = applyMatrix(full, 0, 0);
    const bottomLeft = applyMatrix(full, 0, 1);
    const bottomRight = applyMatrix(full, 1, 1);
    const pixelWidth = image.getWidth();
    const pixelHeight = image.getHeight();
    if (pixelWidth <= 0 || pixelHeight <= 0) return;

    const layer = context.layers.resolve({ origin: 'image', source: 'pdf' });
    const entity: CadImageUnderlayEntity = {
      type: 'image-underlay',
      layer,
      source: 'pdf',
      origin: 'image',
      insert: roundPoint(bottomLeft),
      uVector: roundPoint({
        x: bottomRight.x - bottomLeft.x,
        y: bottomRight.y - bottomLeft.y,
      }),
      vVector: roundPoint({
        x: topLeft.x - bottomLeft.x,
        y: topLeft.y - bottomLeft.y,
      }),
      pixelWidth,
      pixelHeight,
      placeholder: !context.includeUnderlay,
    };
    if (context.includeUnderlay) {
      const resource = renderImageResource(
        mupdf,
        image,
        maskColor,
        `${context.resourceBaseName}-page-${context.page.number}-${context.counters.images}.png`
      );
      if (resource) {
        entity.resource = resource;
      } else {
        entity.placeholder = true;
      }
    }
    this.push(context, entity);
  }

  private toPieces(context: PageContext, subPath: SubPath): Piece[] {
    const pieces: Piece[] = [];
    let current = subPath.start;
    for (const segment of subPath.segments) {
      if (segment.kind === 'line') {
        pieces.push({ kind: 'line', from: current, to: segment.to });
      } else {
        const curve = {
          p0: current,
          p1: segment.c1!,
          p2: segment.c2!,
          p3: segment.to,
        };
        const radiusGuess = distance(current, segment.to);
        const arc = fitArcFromBezier(
          curve,
          Math.max(ARC_FIT_TOLERANCE_PT * context.k, radiusGuess * 5e-4)
        );
        if (arc && arcSweepDeg(arc) < 180) {
          pieces.push({ kind: 'arc', from: current, to: segment.to, arc });
        } else {
          context.counters.flattenedCurves += 1;
          pieces.push({
            kind: 'line',
            from: current,
            to: segment.to,
            flattened: flattenCubicBezier(
              curve,
              FLATTEN_TOLERANCE_PT * context.k
            ),
          });
        }
      }
      current = segment.to;
    }
    if (subPath.closed && pieces.length > 0) {
      const last = pieces[pieces.length - 1]!;
      if (
        !pointsNearlyEqual(
          last.to,
          subPath.start,
          VERTEX_EPSILON_PT * context.k
        )
      ) {
        pieces.push({ kind: 'line', from: last.to, to: subPath.start });
      }
    }
    return pieces;
  }

  private collectText(page: MupdfPage, context: PageContext): void {
    const structured = page.toStructuredText('preserve-whitespace');
    try {
      const blocks: TextBlock[] = [];
      let block: TextBlock | null = null;
      let line: TextLine | null = null;
      structured.walk({
        beginTextBlock: bbox => {
          block = { bbox, lines: [] };
        },
        beginLine: (bbox, wmode, direction) => {
          line = { bbox, wmode, direction, chars: [] };
        },
        onChar: (c, origin, font, size, quad, color) => {
          if (!line) return;
          line.chars.push({ c, origin, font, size, quad, color });
        },
        endLine: () => {
          if (
            block &&
            line &&
            line.chars.some(char => char.c.trim().length > 0)
          ) {
            block.lines.push(line);
          }
          line = null;
        },
        endTextBlock: () => {
          if (block && block.lines.length > 0) blocks.push(block);
          block = null;
        },
      });
      for (const textBlock of blocks) this.emitTextBlock(context, textBlock);
    } finally {
      structured.destroy();
    }
  }

  private emitTextBlock(context: PageContext, block: TextBlock): void {
    const lines = block.lines.map(line => describeLine(context, line));
    for (const line of lines) {
      context.page.stats.textCharCount += line.text.replace(/\s+/g, '').length;
    }

    const horizontal = lines.every(line => line.rotation === 0);
    const sameSize =
      lines.length >= 2 &&
      lines.every(line =>
        nearlyEqual(line.size, lines[0]!.size, lines[0]!.size * 0.05)
      );
    if (horizontal && sameSize) {
      const first = lines[0]!;
      const style = this.registerTextStyle(context, first.font);
      const layer = context.layers.resolve({
        origin: 'text',
        source: 'pdf',
        color: first.color,
        fontFamily: normalizeFontFamily(first.font.getName()),
      });
      const pitches = lines
        .slice(1)
        .map((line, i) => Math.abs(lines[i]!.insert.y - line.insert.y));
      const pitch = pitches.length > 0 ? Math.max(...pitches) : first.height;
      const topLeft = applyMatrix(context.toCad, block.bbox[0], block.bbox[1]);
      const topRight = applyMatrix(context.toCad, block.bbox[2], block.bbox[1]);
      this.push(context, {
        type: 'mtext',
        layer,
        source: 'pdf',
        origin: 'text',
        color: first.color,
        text: lines.map(line => line.text).join('\n'),
        insert: roundPoint(topLeft),
        height: round(first.height),
        width: round(Math.abs(topRight.x - topLeft.x)),
        rotation: 0,
        style: style.name,
        lineSpacingFactor: round(pitch / ((first.height * 5) / 3), 3),
      });
      return;
    }

    for (const line of lines) {
      const style = this.registerTextStyle(context, line.font);
      const layer = context.layers.resolve({
        origin: 'text',
        source: 'pdf',
        color: line.color,
        fontFamily: normalizeFontFamily(line.font.getName()),
      });
      this.push(context, {
        type: 'text',
        layer,
        source: 'pdf',
        origin: 'text',
        color: line.color,
        text: line.text,
        insert: roundPoint(line.insert),
        height: round(line.height),
        rotation: line.rotation,
        style: style.name,
      });
    }
  }

  private registerTextStyle(
    context: PageContext,
    font: MupdfFont
  ): CadTextStyle {
    const rawName = font.getName();
    const family = normalizeFontFamily(rawName);
    const bold = font.isBold() || isBoldFont(rawName);
    const italic = font.isItalic() || isItalicFont(rawName);
    const name = sanitizeLayerName(
      `${family}${bold ? '_BOLD' : ''}${italic ? '_ITALIC' : ''}`
    );
    const existing = context.textStyles.get(name);
    if (existing) return existing;
    const style: CadTextStyle = { name, fontFamily: family, bold, italic };
    context.textStyles.set(name, style);
    return style;
  }

  private finishPage(
    context: PageContext,
    degradations: CadDegradation[]
  ): void {
    const { page, counters } = context;
    const hasVector = counters.paths > 0 || page.stats.textCharCount > 0;
    const hasRaster = counters.images > 0;
    page.kind =
      hasVector && hasRaster
        ? 'mixed'
        : hasVector
          ? 'vector'
          : hasRaster
            ? 'raster'
            : 'empty';
    page.stats.imageCount = counters.images;

    // 页面边界:所有页都有,方便在 CAD 里对齐多页与识别图幅。
    const frameLayer = context.layers.resolve({
      origin: 'page',
      source: 'pdf',
    });
    this.push(context, {
      type: 'polyline',
      layer: frameLayer,
      source: 'pdf',
      origin: 'page',
      vertices: [
        { x: 0, y: 0 },
        { x: page.width, y: 0 },
        { x: page.width, y: page.height },
        { x: 0, y: page.height },
      ],
      closed: true,
    });

    const record = (
      code: CadDegradationCode,
      count?: number,
      detail?: string
    ) => {
      degradations.push({
        code,
        page: page.number,
        ...(count && count > 0 ? { count } : {}),
        ...(detail ? { detail } : {}),
      });
    };
    if (page.kind === 'empty') record('empty_page');
    if (page.kind === 'raster') record('raster_page');
    if (page.stats.dropped.shadings > 0)
      record('shading_dropped', page.stats.dropped.shadings);
    if (page.stats.dropped.clips > 0)
      record('clip_ignored', page.stats.dropped.clips);
    if (page.stats.dropped.imageMasks > 0)
      record('mask_ignored', page.stats.dropped.imageMasks);
    if (counters.flattenedCurves > 0)
      record('curve_flattened', counters.flattenedCurves);
    if (counters.thinFills > 0) record('thin_fill_as_line', counters.thinFills);
  }

  private push(context: PageContext, entity: CadEntity): void {
    context.page.entities.push(entity);
    countEntity(context.page.stats, entity);
    context.totalEntities.value += 1;
    if (context.totalEntities.value > context.maxEntities) {
      throw new CadError(
        'CAD_CONVERSION_FAILED',
        `Entity budget of ${context.maxEntities} exceeded`,
        { limit: context.maxEntities, page: context.page.number }
      );
    }
  }
}

interface TextChar {
  c: string;
  origin: [number, number];
  font: MupdfFont;
  size: number;
  quad: number[];
  color: number[] | undefined;
}

interface TextLine {
  bbox: [number, number, number, number];
  wmode: number;
  direction: [number, number];
  chars: TextChar[];
}

interface TextBlock {
  bbox: [number, number, number, number];
  lines: TextLine[];
}

interface DescribedLine {
  text: string;
  insert: CadPoint;
  size: number;
  height: number;
  rotation: number;
  font: MupdfFont;
  color?: CadColor;
}

function describeLine(context: PageContext, line: TextLine): DescribedLine {
  const text = line.chars
    .map(char => char.c)
    .join('')
    // eslint-disable-next-line no-control-regex -- 去掉控制字符与零宽字符,保留可见文字。
    .replace(/[\u0000-\u001f\u200b-\u200f\ufeff]/g, '')
    .replace(/\s+$/g, '');
  const first =
    line.chars.find(char => char.c.trim().length > 0) ?? line.chars[0]!;
  // 字号取众数,字体取字符数最多的那一款:一行里 Latin 与 CJK 回退字体常混排。
  const size = mode(line.chars.map(char => round(char.size, 3)));
  const fontVotes = new Map<string, { font: MupdfFont; count: number }>();
  for (const char of line.chars) {
    if (char.c.trim().length === 0) continue;
    const key = char.font.getName();
    const entry = fontVotes.get(key) ?? { font: char.font, count: 0 };
    entry.count += 1;
    fontVotes.set(key, entry);
  }
  const font =
    [...fontVotes.values()].sort((a, b) => b.count - a.count)[0]?.font ??
    first.font;
  const ratio = CJK_PATTERN.test(text)
    ? CJK_TEXT_HEIGHT_RATIO
    : TEXT_CAP_HEIGHT_RATIO;
  const height = size * ratio * context.k;
  const insert = applyMatrix(context.toCad, first.origin[0], first.origin[1]);
  // 页面空间 y 向下,翻到 CAD 后方向向量 y 取反。
  const rotation = normalizeAngleDeg(
    round(
      (Math.atan2(-line.direction[1], line.direction[0]) * 180) / Math.PI,
      3
    )
  );
  const color =
    first.color && first.color.length >= 1
      ? componentsToColor(first.color)
      : undefined;
  return { text, insert, size, height, rotation, font, color };
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  let best = values[0] ?? 0;
  let bestCount = 0;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount || (count === bestCount && value > best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function readRotation(mupdf: MupdfModule, page: MupdfPage): 0 | 90 | 180 | 270 {
  if (!(page instanceof mupdf.PDFPage)) return 0;
  try {
    const rotate = page.getObject().getInheritable('Rotate');
    if (!rotate.isNumber()) return 0;
    const normalized =
      (((Math.round(rotate.asNumber() / 90) * 90) % 360) + 360) % 360;
    return normalized as 0 | 90 | 180 | 270;
  } catch {
    return 0;
  }
}

function walkPath(path: MupdfPath, matrix: AffineMatrix): SubPath[] {
  const subPaths: SubPath[] = [];
  let current: SubPath | null = null;
  let last: CadPoint | null = null;
  const map = (x: number, y: number) => applyMatrix(matrix, x, y);
  path.walk({
    moveTo: (x, y) => {
      const point = map(x, y);
      current = { start: point, segments: [], closed: false };
      subPaths.push(current);
      last = point;
    },
    lineTo: (x, y) => {
      if (!current) {
        current = { start: last ?? map(x, y), segments: [], closed: false };
        subPaths.push(current);
      }
      const point = map(x, y);
      current.segments.push({ kind: 'line', to: point });
      last = point;
    },
    curveTo: (x1, y1, x2, y2, x3, y3) => {
      if (!current) {
        current = { start: last ?? map(x1, y1), segments: [], closed: false };
        subPaths.push(current);
      }
      const point = map(x3, y3);
      current.segments.push({
        kind: 'curve',
        c1: map(x1, y1),
        c2: map(x2, y2),
        to: point,
      });
      last = point;
    },
    closePath: () => {
      if (current) {
        current.closed = true;
        last = current.start;
        current = null;
      }
    },
  });
  return subPaths.filter(subPath => subPath.segments.length > 0);
}

function asCircle(
  pieces: Piece[],
  closed: boolean,
  epsilon: number
): { center: CadPoint; radius: number } | null {
  if (pieces.length < 2 || !pieces.every(piece => piece.kind === 'arc'))
    return null;
  const first = pieces[0]!.arc!;
  const radiusTolerance = Math.max(epsilon, first.radius * 1e-3);
  let sweep = 0;
  for (const piece of pieces) {
    const arc = piece.arc!;
    if (
      !pointsNearlyEqual(arc.center, first.center, radiusTolerance) ||
      !nearlyEqual(arc.radius, first.radius, radiusTolerance) ||
      arc.counterClockwise !== first.counterClockwise
    ) {
      return null;
    }
    sweep += arcSweepDeg(arc);
  }
  const endsMeet =
    closed ||
    pointsNearlyEqual(pieces[0]!.from, pieces[pieces.length - 1]!.to, epsilon);
  if (!endsMeet || !nearlyEqual(sweep, 360, 1)) return null;
  return { center: roundPoint(first.center), radius: round(first.radius) };
}

function piecesToVertices(
  pieces: Piece[],
  epsilon: number
): CadPolylineVertex[] {
  const vertices: CadPolylineVertex[] = [];
  for (const piece of pieces) {
    if (vertices.length === 0) vertices.push({ ...piece.from });
    if (piece.kind === 'arc') {
      const last = vertices[vertices.length - 1]!;
      last.bulge = round(arcToBulge(piece.arc!));
      vertices.push({ ...piece.to });
    } else if (piece.flattened) {
      for (const point of piece.flattened) vertices.push({ ...point });
    } else {
      vertices.push({ ...piece.to });
    }
  }
  return dedupeVertices(vertices, epsilon).map(vertex => ({
    ...roundPoint(vertex),
    ...(vertex.bulge ? { bulge: vertex.bulge } : {}),
  }));
}

function isClosedLoop(vertices: CadPoint[], epsilon: number): boolean {
  return (
    vertices.length >= 3 &&
    pointsNearlyEqual(vertices[0]!, vertices[vertices.length - 1]!, epsilon)
  );
}

function asThinFillLine(
  subPath: SubPath,
  k: number,
  epsilon: number
): { start: CadPoint; end: CadPoint; lineWeightMm: number } | null {
  if (subPath.segments.some(segment => segment.kind !== 'line')) return null;
  const points = [
    subPath.start,
    ...subPath.segments.map(segment => segment.to),
  ];
  const rect = asAxisAlignedRect(points, epsilon);
  if (!rect) return null;
  const width = rect.maxX - rect.minX;
  const height = rect.maxY - rect.minY;
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short > THIN_FILL_MAX_WIDTH_PT * k || long < short * THIN_FILL_MIN_ASPECT)
    return null;
  const lineWeightMm = round((short / k) * POINT_TO_MM, 3);
  if (width >= height) {
    const y = (rect.minY + rect.maxY) / 2;
    return {
      start: { x: rect.minX, y },
      end: { x: rect.maxX, y },
      lineWeightMm,
    };
  }
  const x = (rect.minX + rect.maxX) / 2;
  return { start: { x, y: rect.minY }, end: { x, y: rect.maxY }, lineWeightMm };
}

function strokeStyle(
  stroke: MupdfStrokeState,
  ctm: AffineMatrix,
  color: CadColor | undefined
): PaintStyle {
  const widthPt = stroke.getLineWidth() * matrixExpansion(ctm);
  return {
    color,
    lineWeightMm: round(widthPt * POINT_TO_MM, 3),
    lineType: classifyLineType(stroke.getDashes(), stroke.getLineWidth()),
  };
}

function toCadColor(
  colorspace: MupdfColorSpace | null,
  color: number[]
): CadColor | undefined {
  if (!color || color.length === 0) return undefined;
  const n = colorspace ? safeComponentCount(colorspace) : color.length;
  return componentsToColor(color.slice(0, n || color.length));
}

function safeComponentCount(colorspace: MupdfColorSpace): number {
  try {
    return colorspace.getNumberOfComponents();
  } catch {
    return 0;
  }
}

function componentsToColor(components: number[]): CadColor {
  if (components.length >= 4) {
    const [c, m, y, k] = components as [number, number, number, number];
    return {
      r: toByte((1 - c) * (1 - k)),
      g: toByte((1 - m) * (1 - k)),
      b: toByte((1 - y) * (1 - k)),
    };
  }
  if (components.length === 3) {
    return {
      r: toByte(components[0]!),
      g: toByte(components[1]!),
      b: toByte(components[2]!),
    };
  }
  const gray = toByte(components[0] ?? 0);
  return { r: gray, g: gray, b: gray };
}

/** 图像对象 → PNG 底图资源。失败(不支持的色彩空间等)返回 null,调用方退回占位框。 */
function renderImageResource(
  mupdf: MupdfModule,
  image: MupdfImage,
  maskColor: CadColor | null,
  name: string
): CadImageResource | null {
  try {
    let pixmap = image.toPixmap();
    try {
      if (maskColor) {
        // 蒙版图:像素是覆盖度,按填充色着色到白底。
        const width = pixmap.getWidth();
        const height = pixmap.getHeight();
        const source = pixmap.getPixels();
        const stride = pixmap.getStride();
        const components = pixmap.getNumberOfComponents() + pixmap.getAlpha();
        const rgb = new mupdf.Pixmap(
          mupdf.ColorSpace.DeviceRGB,
          [0, 0, width, height],
          false
        );
        const target = rgb.getPixels();
        const targetStride = rgb.getStride();
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const coverage = source[y * stride + x * components]! / 255;
            const offset = y * targetStride + x * 3;
            target[offset] = Math.round(255 - (255 - maskColor.r) * coverage);
            target[offset + 1] = Math.round(
              255 - (255 - maskColor.g) * coverage
            );
            target[offset + 2] = Math.round(
              255 - (255 - maskColor.b) * coverage
            );
          }
        }
        pixmap.destroy();
        pixmap = rgb;
      } else if (
        pixmap.getNumberOfComponents() > 3 ||
        pixmap.getNumberOfComponents() === 2
      ) {
        const converted = pixmap.convertToColorSpace(
          mupdf.ColorSpace.DeviceRGB,
          false
        );
        pixmap.destroy();
        pixmap = converted;
      }
      return { name, mimeType: 'image/png', data: Buffer.from(pixmap.asPNG()) };
    } finally {
      pixmap.destroy();
    }
  } catch {
    return null;
  }
}

/** 多页横向排开:页与页之间留最宽页宽的 10%。 */
export function layoutPages(pages: CadPage[]): void {
  const widest = Math.max(0, ...pages.map(page => page.width));
  const gap = round(widest * PAGE_GAP_RATIO);
  let x = 0;
  for (const page of pages) {
    page.origin = { x: round(x), y: 0 };
    x += page.width + gap;
  }
}

/** 由页面重新统计 meta 里的实体计数;解析、OCR、推断各阶段结束后都调用一次。 */
export function recomputeConversionMeta(document: CadDocument): void {
  const bySource = { pdf: 0, ocr: 0, inferred: 0 };
  const byType: Partial<Record<CadEntityType, number>> = {};
  let total = 0;
  let ocrTextCount = 0;
  let underlay = false;
  for (const page of document.pages) {
    for (const entity of page.entities) {
      total += 1;
      bySource[entity.source] += 1;
      byType[entity.type] = (byType[entity.type] ?? 0) + 1;
      if (
        entity.source === 'ocr' &&
        (entity.type === 'text' || entity.type === 'mtext')
      ) {
        ocrTextCount += 1;
      }
      if (entity.type === 'image-underlay' && entity.resource) underlay = true;
    }
  }
  document.meta.pageCount = document.pages.length;
  document.meta.pages = document.pages.map(page => page.number);
  document.meta.entityCount = total;
  document.meta.entityCountBySource = bySource;
  document.meta.entityCountByType = byType;
  document.meta.ocrTextCount = ocrTextCount;
  document.meta.underlay = underlay;
}

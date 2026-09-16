import type {
  CadDegradation,
  CadEntitySource,
  CadEntityType,
  CadErrorCode,
  CadLayerMode,
  CadOutputFormat,
  CadUnit,
  PdfToCadConversionMeta,
} from '@utils-plane/validators';

/**
 * PDF 转 CAD 的中间模型(00 契约)。
 *
 * 坐标约定:
 * - 输入 PDF 使用左上原点、单位 point,页面旋转(/Rotate)已由 MuPDF 的页面变换统一处理,
 *   解析器拿到的一律是「显示方向」下的页面坐标。
 * - 中间模型与 DXF 使用左下原点:`yCad = (pageHeightPt - yPage) * unitFactor * scale`,
 *   `xCad = xPage * unitFactor * scale`;所有坐标先按 point 换算到目标单位,再乘 `scale`。
 * - 页内坐标以页面左下角为原点;多页时每页另有 `origin` 偏移,写出器负责相加。
 * - 角度一律为度、逆时针为正(CAD 习惯);弧的 `startAngle → endAngle` 逆时针扫过。
 * - 线宽 `lineWeightMm` 是物理毫米(打印线宽),不随单位或比例缩放。
 */

export type { CadEntitySource, CadEntityType };

export const CAD_CONVERTER_VERSION = '1.0.0';
/** 中间模型结构版本;结构不兼容变更时递增。 */
export const CAD_MODEL_VERSION = 1;

export interface CadPoint {
  x: number;
  y: number;
}

/** 0-255 整数 RGB。 */
export interface CadColor {
  r: number;
  g: number;
  b: number;
}

/**
 * 实体在 PDF 里的出处,与 `source` 正交:
 * `source` 说的是「可信度」(原生 / OCR / 推断),`origin` 说的是「由哪类对象产生」。
 */
export type CadEntityOrigin =
  | 'stroke'
  | 'fill'
  | 'text'
  | 'image'
  | 'page'
  | 'ocr'
  | 'raster';

export type CadLineType = 'CONTINUOUS' | 'DASHED' | 'DOT' | 'DASHDOT';

/** 几何是否经过近似:`fitted` 由曲线/填充拟合成线弧圆,`flattened` 由曲线打散成折线。 */
export type CadEntityDerivation = 'fitted' | 'flattened';

export interface CadEntityBase {
  layer: string;
  source: CadEntitySource;
  origin: CadEntityOrigin;
  color?: CadColor;
  lineWeightMm?: number;
  lineType?: CadLineType;
  derived?: CadEntityDerivation;
}

export interface CadLineEntity extends CadEntityBase {
  type: 'line';
  start: CadPoint;
  end: CadPoint;
}

export interface CadPolylineVertex extends CadPoint {
  /** 到下一顶点的圆弧凸度 tan(θ/4),逆时针为正;省略或 0 表示直线段。 */
  bulge?: number;
}

export interface CadPolylineEntity extends CadEntityBase {
  type: 'polyline';
  vertices: CadPolylineVertex[];
  closed: boolean;
}

export interface CadArcEntity extends CadEntityBase {
  type: 'arc';
  center: CadPoint;
  radius: number;
  /** 度,逆时针从 startAngle 扫到 endAngle。 */
  startAngle: number;
  endAngle: number;
}

export interface CadCircleEntity extends CadEntityBase {
  type: 'circle';
  center: CadPoint;
  radius: number;
}

export interface CadHatchLoop {
  /** 闭合边界顶点(最后一点隐式连回第一点),支持 bulge 圆弧段。 */
  vertices: CadPolylineVertex[];
}

export interface CadHatchEntity extends CadEntityBase {
  type: 'hatch';
  loops: CadHatchLoop[];
  /** PDF 的奇偶/非零填充规则。 */
  evenOdd: boolean;
  fillColor: CadColor;
}

export interface CadTextEntity extends CadEntityBase {
  type: 'text';
  text: string;
  /** 基线左端插入点。 */
  insert: CadPoint;
  /** 文字高度(目标单位)。 */
  height: number;
  /** 度,逆时针。 */
  rotation: number;
  /** 文字样式名,对应 `CadDocument.textStyles`。 */
  style: string;
  widthFactor?: number;
}

export interface CadMTextEntity extends CadEntityBase {
  type: 'mtext';
  /** 多行文字,用 `\n` 分行。 */
  text: string;
  /** 段落左上角插入点。 */
  insert: CadPoint;
  height: number;
  /** 段落参考宽度(目标单位)。 */
  width: number;
  rotation: number;
  style: string;
  /** 行距倍数(相对单倍行距),省略为 1。 */
  lineSpacingFactor?: number;
}

export interface CadInsertEntity extends CadEntityBase {
  type: 'insert';
  blockName: string;
  insert: CadPoint;
  scale: CadPoint;
  rotation: number;
}

export interface CadImageResource {
  /** 输出包内的文件名(与 DXF 同级),例如 `drawing-page-1.png`。 */
  name: string;
  mimeType: 'image/png';
  data: Buffer;
}

export interface CadImageUnderlayEntity extends CadEntityBase {
  type: 'image-underlay';
  /** 图像左下角插入点。 */
  insert: CadPoint;
  /** 图像整体的 U(宽)/V(高)向量,目标单位;旋转图像由向量方向表达。 */
  uVector: CadPoint;
  vVector: CadPoint;
  pixelWidth: number;
  pixelHeight: number;
  /** 关闭底图时为 true:写出器只画占位外框,不引用任何外部资源。 */
  placeholder: boolean;
  resource?: CadImageResource;
}

export type CadEntity =
  | CadLineEntity
  | CadPolylineEntity
  | CadArcEntity
  | CadCircleEntity
  | CadHatchEntity
  | CadTextEntity
  | CadMTextEntity
  | CadInsertEntity
  | CadImageUnderlayEntity;

export interface CadBlock {
  name: string;
  basePoint: CadPoint;
  entities: CadEntity[];
}

export interface CadLayer {
  name: string;
  color: CadColor;
  lineType: CadLineType;
  /** 图层由哪类内容构成,便于前端/文档解释。 */
  description?: string;
}

export interface CadTextStyle {
  name: string;
  /** PDF 里的字体名(已去除子集前缀)。 */
  fontFamily: string;
  /** 写出器使用的字体文件名,缺省由 fontFamily 派生。 */
  fontFile?: string;
  bold: boolean;
  italic: boolean;
}

export type CadPageKind = 'vector' | 'raster' | 'mixed' | 'empty';

export interface CadPageStats {
  entityCount: number;
  bySource: Record<CadEntitySource, number>;
  byType: Partial<Record<CadEntityType, number>>;
  /** 页内原生图片对象数(不含底图)。 */
  imageCount: number;
  /** 原生文字字符数。 */
  textCharCount: number;
  /** 无法恢复的对象计数。 */
  dropped: {
    shadings: number;
    clips: number;
    imageMasks: number;
  };
}

export interface CadPage {
  /** 源 PDF 0 基页索引。 */
  index: number;
  /** 1 基页码。 */
  number: number;
  /** 显示方向下的页面尺寸(目标单位 × 比例)。 */
  width: number;
  height: number;
  /** 显示方向下的页面尺寸(point)。 */
  widthPt: number;
  heightPt: number;
  /** 源 PDF 的 /Rotate。 */
  rotation: 0 | 90 | 180 | 270;
  /** 该页在模型空间的放置偏移(目标单位)。 */
  origin: CadPoint;
  kind: CadPageKind;
  entities: CadEntity[];
  stats: CadPageStats;
}

export type CadConversionMeta = PdfToCadConversionMeta;
export type { CadDegradation };

export interface CadDocument {
  modelVersion: number;
  converterVersion: string;
  format: CadOutputFormat;
  unit: CadUnit;
  scale: number;
  layerMode: CadLayerMode;
  pages: CadPage[];
  layers: CadLayer[];
  textStyles: CadTextStyle[];
  blocks: CadBlock[];
  meta: CadConversionMeta;
}

export interface CadWriteFile {
  name: string;
  mimeType: string;
  data: Buffer;
}

export interface CadWriteResult {
  format: CadOutputFormat;
  /** 主文件名(DXF);files 里除主文件外的都是底图等附属资源。 */
  primary: string;
  files: CadWriteFile[];
}

export interface CadWriter {
  readonly format: CadOutputFormat;
  write(document: CadDocument): Promise<CadWriteResult>;
}

/**
 * 契约错误。`retryable = false`:配置非法、DWG 未支持、OCR 缺失、损坏 PDF
 * 重跑一次结果也一样,处理器据此直接落 failed,不再消耗重试次数。
 */
export class CadError extends Error {
  readonly retryable = false;

  constructor(
    readonly code: CadErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'CadError';
  }
}

export function isCadError(error: unknown): error is CadError {
  return error instanceof CadError;
}

/** 空的每页统计,解析器/OCR/推断各阶段在其上累加。 */
export function createEmptyPageStats(): CadPageStats {
  return {
    entityCount: 0,
    bySource: { pdf: 0, ocr: 0, inferred: 0 },
    byType: {},
    imageCount: 0,
    textCharCount: 0,
    dropped: { shadings: 0, clips: 0, imageMasks: 0 },
  };
}

/** 把一个实体计入页统计。集中在这里,避免各阶段各算一套口径。 */
export function countEntity(stats: CadPageStats, entity: CadEntity): void {
  stats.entityCount += 1;
  stats.bySource[entity.source] += 1;
  stats.byType[entity.type] = (stats.byType[entity.type] ?? 0) + 1;
}

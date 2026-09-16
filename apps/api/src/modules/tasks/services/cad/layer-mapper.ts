import type { CadLayerMode } from '@utils-plane/validators';
import type { CadColor, CadEntityOrigin, CadLayer, CadLineType } from './types';

/**
 * 图层映射(01 契约)。
 *
 * - `source` 模式:按来源对象 + 颜色 + 字体生成稳定图层名,同一 PDF 多次转换得到同样的图层集。
 * - `semantic` 模式:只做确定性的规则映射(线宽/线型/来源决定语义),不做任何机器学习或
 *   上下文推断;OCR 与推断实体永远单独成层,方便用户一眼区分可信度。
 *
 * 图层名只允许 DXF 安全字符:字母、数字、`_`、`-`、`$`;其它字符一律折成 `_`。
 */

export interface LayerRequest {
  origin: CadEntityOrigin;
  source: 'pdf' | 'ocr' | 'inferred';
  color?: CadColor;
  lineWeightMm?: number;
  lineType?: CadLineType;
  /** 文字用:字体族(已去除子集前缀),决定 source 模式下的文字图层后缀。 */
  fontFamily?: string;
  /** 填充用:是否是闭合区域填充(相对于细长填充当作线段)。 */
  fill?: boolean;
}

export const LAYER_NAME_MAX_LENGTH = 64;
export const DEFAULT_LAYER = '0';

export const SEMANTIC_LAYERS = {
  frame: 'FRAME',
  outline: 'OUTLINE',
  thin: 'THIN',
  hidden: 'HIDDEN',
  center: 'CENTER',
  hatch: 'HATCH',
  text: 'TEXT',
  image: 'IMAGE',
  ocr: 'OCR_TEXT',
  inferred: 'INFERRED',
} as const;

/** 语义模式的线宽阈值(毫米,打印线宽):≥ 0.5mm 视为轮廓线,否则细线。 */
export const SEMANTIC_OUTLINE_MIN_WEIGHT_MM = 0.5;

export function sanitizeLayerName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_$-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  const trimmed = cleaned.slice(0, LAYER_NAME_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : DEFAULT_LAYER;
}

export function colorHex(color: CadColor): string {
  return [color.r, color.g, color.b]
    .map(component => component.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

/**
 * 去除 PDF 子集前缀(`ABCDEF+Name`)与常见后缀(`,Bold`、`-Regular`),得到字体族名。
 */
export function normalizeFontFamily(fontName: string): string {
  const withoutSubset = fontName.replace(/^[A-Z]{6}\+/, '');
  const family = withoutSubset
    .split(/[,+]/)[0]!
    .replace(/[-_ ]?(Regular|Regu|Bold|Italic|Oblique|MT|PSMT)$/i, '')
    .trim();
  return family.length > 0 ? family : withoutSubset || 'Unknown';
}

export function isBoldFont(fontName: string): boolean {
  return /bold|black|heavy|semibold|demibold/i.test(fontName);
}

export function isItalicFont(fontName: string): boolean {
  return /italic|oblique/i.test(fontName);
}

const BLACK: CadColor = { r: 0, g: 0, b: 0 };
const WHITE: CadColor = { r: 255, g: 255, b: 255 };

/**
 * 有状态的图层登记:实体请求图层名时顺便把图层定义收集起来,写出器据此产出 LAYER 表。
 * 图层按首次出现顺序排列,输出顺序稳定。
 */
export class LayerMapper {
  private readonly layers = new Map<string, CadLayer>();

  constructor(private readonly mode: CadLayerMode) {
    this.register(DEFAULT_LAYER, WHITE, 'CONTINUOUS', 'default');
  }

  resolve(request: LayerRequest): string {
    const name =
      this.mode === 'semantic'
        ? this.semanticLayer(request)
        : this.sourceLayer(request);
    const color = request.color ?? (request.source === 'pdf' ? BLACK : WHITE);
    this.register(
      name,
      color,
      request.lineType ?? 'CONTINUOUS',
      describeOrigin(request)
    );
    return name;
  }

  list(): CadLayer[] {
    return [...this.layers.values()];
  }

  private register(
    name: string,
    color: CadColor,
    lineType: CadLineType,
    description: string
  ): void {
    if (this.layers.has(name)) return;
    this.layers.set(name, { name, color, lineType, description });
  }

  private sourceLayer(request: LayerRequest): string {
    if (request.source === 'ocr') return SEMANTIC_LAYERS.ocr;
    if (request.source === 'inferred') {
      return sanitizeLayerName(`${SEMANTIC_LAYERS.inferred}_${request.origin}`);
    }
    const color = request.color ?? BLACK;
    switch (request.origin) {
      case 'page':
        return SEMANTIC_LAYERS.frame;
      case 'stroke':
        return sanitizeLayerName(
          `STROKE_${colorHex(color)}${request.lineType && request.lineType !== 'CONTINUOUS' ? `_${request.lineType}` : ''}`
        );
      case 'fill':
        return sanitizeLayerName(`FILL_${colorHex(color)}`);
      case 'text':
        return sanitizeLayerName(
          `TEXT_${normalizeFontFamily(request.fontFamily ?? 'Unknown')}`
        );
      case 'image':
        return SEMANTIC_LAYERS.image;
      case 'raster':
      case 'ocr':
        return SEMANTIC_LAYERS.inferred;
    }
  }

  private semanticLayer(request: LayerRequest): string {
    if (request.source === 'ocr') return SEMANTIC_LAYERS.ocr;
    if (request.source === 'inferred') return SEMANTIC_LAYERS.inferred;
    switch (request.origin) {
      case 'page':
        return SEMANTIC_LAYERS.frame;
      case 'text':
        return SEMANTIC_LAYERS.text;
      case 'image':
        return SEMANTIC_LAYERS.image;
      case 'fill':
        return request.fill === false
          ? SEMANTIC_LAYERS.thin
          : SEMANTIC_LAYERS.hatch;
      case 'stroke': {
        if (request.lineType === 'DASHED') return SEMANTIC_LAYERS.hidden;
        if (request.lineType === 'DASHDOT' || request.lineType === 'DOT') {
          return SEMANTIC_LAYERS.center;
        }
        return (request.lineWeightMm ?? 0) >= SEMANTIC_OUTLINE_MIN_WEIGHT_MM
          ? SEMANTIC_LAYERS.outline
          : SEMANTIC_LAYERS.thin;
      }
      case 'raster':
      case 'ocr':
        return SEMANTIC_LAYERS.inferred;
    }
  }
}

function describeOrigin(request: LayerRequest): string {
  if (request.source === 'ocr') return 'ocr text';
  if (request.source === 'inferred') return `inferred ${request.origin}`;
  return `pdf ${request.origin}`;
}

/**
 * PDF 虚线数组 → DXF 线型。只按形态归类,不复刻精确间距:
 * 全部段长相近且很短(≤ 线宽 2 倍)是点线;长短交替是点划线;其余是虚线。
 */
export function classifyLineType(
  dashes: number[] | null | undefined,
  lineWidth: number
): CadLineType {
  if (!dashes || dashes.length === 0) return 'CONTINUOUS';
  const positive = dashes.filter(value => value > 0);
  if (positive.length === 0) return 'CONTINUOUS';
  const onSegments = dashes.filter(
    (_, index) => index % 2 === 0 && dashes[index]! > 0
  );
  const dotThreshold = Math.max(lineWidth * 2, 0.5);
  if (
    onSegments.length > 0 &&
    onSegments.every(value => value <= dotThreshold)
  ) {
    return 'DOT';
  }
  if (onSegments.length >= 2) {
    const max = Math.max(...onSegments);
    const min = Math.min(...onSegments);
    if (min <= dotThreshold && max > dotThreshold) return 'DASHDOT';
  }
  return 'DASHED';
}

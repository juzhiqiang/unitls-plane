import type { CadUnit } from '@utils-plane/validators';
import { normalizeAngleDeg, round } from './geometry';
import type {
  CadBlock,
  CadColor,
  CadDocument,
  CadEntity,
  CadHatchEntity,
  CadImageUnderlayEntity,
  CadLayer,
  CadLineType,
  CadMTextEntity,
  CadPoint,
  CadPolylineVertex,
  CadTextEntity,
  CadTextStyle,
  CadWriteFile,
  CadWriteResult,
  CadWriter,
} from './types';

/**
 * DXF R2000(AC1015)写出器(02 契约)。
 *
 * 结构逐段对照 ezdxf 生成的最小 R2000 文件:HEADER / CLASSES / TABLES(VPORT、LTYPE、LAYER、
 * STYLE、VIEW、UCS、APPID、DIMSTYLE、BLOCK_RECORD)/ BLOCKS / ENTITIES / OBJECTS(根字典、
 * 布局、绘图样式占位、底图字典)。选择 R2000 而非更新版本:它是 LibreCAD(libdxfrw)、QCAD、
 * AutoCAD 与开源解析器共同支持得最稳的文本 DXF 版本,又已经具备 LWPOLYLINE / HATCH / MTEXT / IMAGE。
 *
 * 文件编码为纯 ASCII:非 ASCII 字符(中文等)按 DXF 规范写成 `\U+XXXX`,AutoCAD、BricsCAD、
 * LibreCAD、ezdxf 都会解码。
 *
 * 坐标:实体已经是左下原点、目标单位;多页时加上 `page.origin` 偏移。
 */

export interface DxfWriterOptions {
  /** 主文件名(不含扩展名),缺省 `drawing`。 */
  baseName?: string;
}

/** 单行字符串组值上限(R2000)。超过的 TEXT 会改写为 MTEXT,MTEXT 用 3/1 分段。 */
export const DXF_STRING_LIMIT = 255;
const MTEXT_CHUNK = 250;

/** DXF 370 允许的线宽枚举(1/100 mm)。 */
const LINEWEIGHTS = [
  0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106,
  120, 140, 158, 200, 211,
];

/** 固定句柄,与 ezdxf 最小模板一致;动态对象从 HANDLE_DYNAMIC_START 起分配。 */
const H = {
  layerTable: '1',
  ltypeTable: '2',
  appidTable: '3',
  dimstyleTable: '4',
  styleTable: '5',
  ucsTable: '6',
  viewTable: '7',
  vportTable: '8',
  blockRecordTable: '9',
  rootDict: 'A',
  groupDict: 'C',
  layoutDict: 'D',
  mlineStyleDict: '10',
  plotSettingsDict: '11',
  plotStyleDict: '12',
  plotStylePlaceholder: '13',
  modelSpaceRecord: '17',
  modelSpaceBlock: '18',
  modelSpaceEndBlk: '19',
  modelLayout: '1A',
  paperSpaceRecord: '1B',
  paperSpaceBlock: '1C',
  paperSpaceEndBlk: '1D',
  paperLayout: '1E',
  mlineStyle: '22',
  activeVport: '23',
  ltypeByBlock: '24',
  ltypeByLayer: '25',
  ltypeContinuous: '26',
  layer0: '27',
  styleStandard: '29',
  appidAcad: '2A',
  dimstyleStandard: '2B',
} as const;
const HANDLE_DYNAMIC_START = 0x40;

/** ACI 基础色与灰阶,按欧氏距离取最近。 */
const ACI_PALETTE: Array<[number, CadColor]> = [
  [1, { r: 255, g: 0, b: 0 }],
  [2, { r: 255, g: 255, b: 0 }],
  [3, { r: 0, g: 255, b: 0 }],
  [4, { r: 0, g: 255, b: 255 }],
  [5, { r: 0, g: 0, b: 255 }],
  [6, { r: 255, g: 0, b: 255 }],
  [7, { r: 0, g: 0, b: 0 }],
  [8, { r: 128, g: 128, b: 128 }],
  [9, { r: 192, g: 192, b: 192 }],
  [30, { r: 255, g: 127, b: 0 }],
  [40, { r: 255, g: 191, b: 0 }],
  [90, { r: 0, g: 255, b: 127 }],
  [150, { r: 0, g: 127, b: 255 }],
  [170, { r: 0, g: 0, b: 189 }],
  [200, { r: 127, g: 0, b: 255 }],
  [250, { r: 51, g: 51, b: 51 }],
  [251, { r: 91, g: 91, b: 91 }],
  [252, { r: 132, g: 132, b: 132 }],
  [253, { r: 173, g: 173, b: 173 }],
  [254, { r: 214, g: 214, b: 214 }],
  [255, { r: 255, g: 255, b: 255 }],
];

export function aciFromColor(color: CadColor): number {
  let best = 7;
  let bestDistance = Infinity;
  for (const [index, candidate] of ACI_PALETTE) {
    const distance =
      (candidate.r - color.r) ** 2 +
      (candidate.g - color.g) ** 2 +
      (candidate.b - color.b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/**
 * 纯黑/近黑不写真彩色:AutoCAD 黑底模型空间里 0x000000 真彩色会隐形,
 * 只写 ACI 7(随背景反色)是 CAD 界的惯例。
 */
export function isNearBlack(color: CadColor): boolean {
  return color.r < 40 && color.g < 40 && color.b < 40;
}

export function trueColorValue(color: CadColor): number {
  return (color.r << 16) | (color.g << 8) | color.b;
}

export function snapLineWeight(mm: number | undefined): number | null {
  if (mm === undefined || !Number.isFinite(mm)) return null;
  const target = Math.max(0, mm) * 100;
  let best = LINEWEIGHTS[0]!;
  for (const candidate of LINEWEIGHTS) {
    if (Math.abs(candidate - target) < Math.abs(best - target))
      best = candidate;
  }
  return best;
}

/** 非 ASCII → `\U+XXXX`;MTEXT 额外转义反斜杠/花括号并把换行写成 `\P`。 */
export function encodeDxfText(text: string, mtext: boolean): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (mtext && (char === '\\' || char === '{' || char === '}')) {
      out += `\\${char}`;
      continue;
    }
    if (char === '\n') {
      out += mtext ? '\\P' : ' ';
      continue;
    }
    if (code < 0x20 || code === 0x7f) continue;
    if (code > 0x7e) {
      // 仅 BMP 可用 \U+ 表达;补充平面字符(emoji 等)在工程图里无意义,退化为 ?。
      out +=
        code > 0xffff
          ? '?'
          : `\\U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
      continue;
    }
    out += char;
  }
  return out;
}

/** 把 `\U+XXXX` 还原为 Unicode(测试与回读用)。 */
export function decodeDxfText(text: string): string {
  return text.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  );
}

function chunkEncoded(encoded: string, size: number): string[] {
  const tokens = encoded.match(/\\U\+[0-9A-F]{4}|\\.|[\s\S]/g) ?? [];
  const chunks: string[] = [];
  let current = '';
  for (const token of tokens) {
    if (current.length + token.length > size) {
      chunks.push(current);
      current = '';
    }
    current += token;
  }
  chunks.push(current);
  return chunks;
}

function real(value: number): string {
  const rounded = round(value, 6);
  const text = String(rounded);
  if (text.includes('e')) return rounded.toFixed(6);
  return text.includes('.') ? text : `${text}.0`;
}

function fontFileFor(style: CadTextStyle): string {
  if (style.fontFile) return style.fontFile;
  const family = style.fontFamily.toLowerCase();
  if (
    /droid sans fallback|sim(sun|hei|kai)|song|hei|kai|fang|noto ?sans ?(sc|cjk)|source han|pingfang|yahei|msyh|mingliu|cjk/.test(
      family
    )
  ) {
    return 'simsun.ttc';
  }
  if (/courier|mono|consol/.test(family)) {
    return style.bold ? 'courbd.ttf' : style.italic ? 'couri.ttf' : 'cour.ttf';
  }
  if (/times|serif|georgia|roman|nimbus roman|book/.test(family)) {
    return style.bold
      ? 'timesbd.ttf'
      : style.italic
        ? 'timesi.ttf'
        : 'times.ttf';
  }
  return style.bold ? 'arialbd.ttf' : style.italic ? 'ariali.ttf' : 'arial.ttf';
}

interface LineTypePattern {
  description: string;
  elements: number[];
}

function lineTypePatterns(unit: CadUnit): Record<CadLineType, LineTypePattern> {
  const k = unit === 'inch' ? 1 / 25.4 : 1;
  return {
    CONTINUOUS: { description: 'Solid line', elements: [] },
    DASHED: { description: '__ __ __ __ __ __ __', elements: [6 * k, -3 * k] },
    DOT: { description: '. . . . . . . . . . .', elements: [0, -2 * k] },
    DASHDOT: {
      description: '__ . __ . __ . __ . __',
      elements: [6 * k, -3 * k, 0, -3 * k],
    },
  };
}

interface ImageRecord {
  entityHandle: string;
  defHandle: string;
  reactorHandle: string;
  fileName: string;
  pixelWidth: number;
  pixelHeight: number;
  pixelSize: number;
}

class HandleAllocator {
  private next = HANDLE_DYNAMIC_START;

  allocate(): string {
    const value = this.next.toString(16).toUpperCase();
    this.next += 1;
    return value;
  }

  /** $HANDSEED:必须大于文件里出现过的所有句柄。 */
  get seed(): string {
    return (this.next + 1).toString(16).toUpperCase();
  }
}

class DxfBuilder {
  private readonly lines: string[] = [];

  constructor(private readonly handles: HandleAllocator) {}

  tag(code: number, value: string | number): void {
    this.lines.push(String(code).padStart(3, ' '), String(value));
  }

  point(codeX: number, point: CadPoint, z = true): void {
    this.tag(codeX, real(point.x));
    this.tag(codeX + 10, real(point.y));
    if (z) this.tag(codeX + 20, '0.0');
  }

  handle(): string {
    return this.handles.allocate();
  }

  toString(): string {
    return `${this.lines.join('\r\n')}\r\n`;
  }
}

export class DxfWriter implements CadWriter {
  readonly format = 'dxf' as const;

  constructor(private readonly options: DxfWriterOptions = {}) {}

  async write(document: CadDocument): Promise<CadWriteResult> {
    const baseName = sanitizeFileName(this.options.baseName ?? 'drawing');
    const files: CadWriteFile[] = [];
    const text = renderDxf(document, files);
    const primary = `${baseName}.dxf`;
    return {
      format: 'dxf',
      primary,
      files: [
        {
          name: primary,
          mimeType: 'application/dxf',
          data: Buffer.from(text, 'latin1'),
        },
        ...files,
      ],
    };
  }
}

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .trim()
    // eslint-disable-next-line no-control-regex -- 去掉文件名里不允许的字符与控制字符。
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'drawing';
}

function renderDxf(document: CadDocument, resources: CadWriteFile[]): string {
  const handles = new HandleAllocator();
  const extents = documentExtents(document);
  const layers = collectLayers(document);
  const styles = collectStyles(document);
  const usedLineTypes = collectLineTypes(document);
  const blockRecords = document.blocks.map(block => ({
    block,
    recordHandle: handles.allocate(),
    beginHandle: handles.allocate(),
    endHandle: handles.allocate(),
  }));
  const images: ImageRecord[] = [];

  // 各段分别构建、共用一个句柄分配器;HEADER 里的 $HANDSEED 必须大于所有句柄,所以最后写。
  const tables = new DxfBuilder(handles);
  writeTablesSection(
    tables,
    document,
    layers,
    styles,
    usedLineTypes,
    blockRecords,
    extents
  );
  const blocks = new DxfBuilder(handles);
  writeBlocksSection(blocks, document, blockRecords, layers, images, resources);
  const entities = new DxfBuilder(handles);
  writeEntitiesSection(entities, document, layers, images, resources);
  const objects = new DxfBuilder(handles);
  writeObjectsSection(objects, images, extents);
  const header = new DxfBuilder(handles);
  writeHeaderSection(header, document, extents, handles.seed);
  writeClassesSection(header, images.length > 0);

  const tail = new DxfBuilder(handles);
  tail.tag(0, 'EOF');
  return [header, tables, blocks, entities, objects, tail]
    .map(section => section.toString())
    .join('');
}

interface Extents {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function documentExtents(document: CadDocument): Extents {
  const extents: Extents = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let first = true;
  for (const page of document.pages) {
    const minX = page.origin.x;
    const minY = page.origin.y;
    const maxX = page.origin.x + page.width;
    const maxY = page.origin.y + page.height;
    if (first) {
      Object.assign(extents, { minX, minY, maxX, maxY });
      first = false;
    } else {
      extents.minX = Math.min(extents.minX, minX);
      extents.minY = Math.min(extents.minY, minY);
      extents.maxX = Math.max(extents.maxX, maxX);
      extents.maxY = Math.max(extents.maxY, maxY);
    }
  }
  return extents;
}

function collectLayers(document: CadDocument): Map<string, CadLayer> {
  const layers = new Map<string, CadLayer>();
  layers.set('0', {
    name: '0',
    color: { r: 255, g: 255, b: 255 },
    lineType: 'CONTINUOUS',
  });
  for (const layer of document.layers) layers.set(layer.name, layer);
  const ensure = (entity: CadEntity) => {
    if (!layers.has(entity.layer)) {
      layers.set(entity.layer, {
        name: entity.layer,
        color: entity.color ?? { r: 255, g: 255, b: 255 },
        lineType: entity.lineType ?? 'CONTINUOUS',
      });
    }
  };
  for (const page of document.pages) page.entities.forEach(ensure);
  for (const block of document.blocks) block.entities.forEach(ensure);
  return layers;
}

function collectStyles(document: CadDocument): Map<string, CadTextStyle> {
  const styles = new Map<string, CadTextStyle>();
  styles.set('Standard', {
    name: 'Standard',
    fontFamily: 'txt',
    fontFile: 'txt',
    bold: false,
    italic: false,
  });
  for (const style of document.textStyles) styles.set(style.name, style);
  const ensure = (entity: CadEntity) => {
    if (
      (entity.type === 'text' || entity.type === 'mtext') &&
      !styles.has(entity.style)
    ) {
      styles.set(entity.style, {
        name: entity.style,
        fontFamily: entity.style,
        bold: false,
        italic: false,
      });
    }
  };
  for (const page of document.pages) page.entities.forEach(ensure);
  for (const block of document.blocks) block.entities.forEach(ensure);
  return styles;
}

function collectLineTypes(document: CadDocument): Set<CadLineType> {
  const used = new Set<CadLineType>();
  const visit = (entity: CadEntity) => {
    if (entity.lineType && entity.lineType !== 'CONTINUOUS')
      used.add(entity.lineType);
  };
  for (const page of document.pages) page.entities.forEach(visit);
  for (const block of document.blocks) block.entities.forEach(visit);
  for (const layer of document.layers) {
    if (layer.lineType !== 'CONTINUOUS') used.add(layer.lineType);
  }
  return used;
}

function writeHeaderSection(
  b: DxfBuilder,
  document: CadDocument,
  extents: Extents,
  handleSeed: string
): void {
  b.tag(0, 'SECTION');
  b.tag(2, 'HEADER');
  const variable = (name: string, code: number, value: string | number) => {
    b.tag(9, name);
    b.tag(code, value);
  };
  const point = (name: string, x: number, y: number, z = true) => {
    b.tag(9, name);
    b.tag(10, real(x));
    b.tag(20, real(y));
    if (z) b.tag(30, '0.0');
  };
  variable('$ACADVER', 1, 'AC1015');
  variable('$ACADMAINTVER', 70, 6);
  variable('$DWGCODEPAGE', 3, 'ANSI_1252');
  point('$INSBASE', 0, 0);
  point('$EXTMIN', extents.minX, extents.minY);
  point('$EXTMAX', extents.maxX, extents.maxY);
  point('$LIMMIN', extents.minX, extents.minY, false);
  point('$LIMMAX', extents.maxX, extents.maxY, false);
  variable('$ORTHOMODE', 70, 0);
  variable('$REGENMODE', 70, 1);
  variable('$FILLMODE', 70, 1);
  variable('$QTEXTMODE', 70, 0);
  variable('$MIRRTEXT', 70, 0);
  variable('$LTSCALE', 40, '1.0');
  variable('$ATTMODE', 70, 1);
  variable('$TEXTSIZE', 40, '2.5');
  variable('$TRACEWID', 40, '1.0');
  variable('$TEXTSTYLE', 7, 'Standard');
  variable('$CLAYER', 8, '0');
  variable('$CELTYPE', 6, 'ByLayer');
  variable('$CECOLOR', 62, 256);
  variable('$CELTSCALE', 40, '1.0');
  variable('$DISPSILH', 70, 0);
  variable('$DIMSTYLE', 2, 'Standard');
  variable('$DIMTXSTY', 7, 'Standard');
  variable('$LUNITS', 70, 2);
  variable('$LUPREC', 70, 4);
  variable('$SKETCHINC', 40, '1.0');
  variable('$FILLETRAD', 40, '0.0');
  variable('$AUNITS', 70, 0);
  variable('$AUPREC', 70, 2);
  variable('$MENU', 1, '.');
  variable('$ELEVATION', 40, '0.0');
  variable('$PELEVATION', 40, '0.0');
  variable('$THICKNESS', 40, '0.0');
  variable('$LIMCHECK', 70, 0);
  variable('$CHAMFERA', 40, '0.0');
  variable('$CHAMFERB', 40, '0.0');
  variable('$CHAMFERC', 40, '0.0');
  variable('$CHAMFERD', 40, '0.0');
  variable('$SKPOLY', 70, 0);
  variable('$USRTIMER', 70, 1);
  variable('$ANGBASE', 50, '0.0');
  variable('$ANGDIR', 70, 0);
  variable('$PDMODE', 70, 0);
  variable('$PDSIZE', 40, '0.0');
  variable('$PLINEWID', 40, '0.0');
  variable('$SPLFRAME', 70, 0);
  variable('$SPLINETYPE', 70, 6);
  variable('$SPLINESEGS', 70, 8);
  variable('$HANDSEED', 5, handleSeed);
  variable('$SURFTAB1', 70, 6);
  variable('$SURFTAB2', 70, 6);
  variable('$SURFTYPE', 70, 6);
  variable('$SURFU', 70, 6);
  variable('$SURFV', 70, 6);
  variable('$UCSBASE', 2, '');
  variable('$UCSNAME', 2, '');
  point('$UCSORG', 0, 0);
  point('$UCSXDIR', 1, 0);
  point('$UCSYDIR', 0, 1);
  variable('$UCSORTHOREF', 2, '');
  variable('$UCSORTHOVIEW', 70, 0);
  variable('$PUCSBASE', 2, '');
  variable('$PUCSNAME', 2, '');
  point('$PUCSORG', 0, 0);
  point('$PUCSXDIR', 1, 0);
  point('$PUCSYDIR', 0, 1);
  variable('$PUCSORTHOREF', 2, '');
  variable('$PUCSORTHOVIEW', 70, 0);
  variable('$WORLDVIEW', 70, 1);
  variable('$SHADEDGE', 70, 3);
  variable('$SHADEDIF', 70, 70);
  variable('$TILEMODE', 70, 1);
  variable('$MAXACTVP', 70, 64);
  point('$PINSBASE', 0, 0);
  variable('$PLIMCHECK', 70, 0);
  point('$PEXTMIN', 0, 0);
  point('$PEXTMAX', 0, 0);
  point('$PLIMMIN', 0, 0, false);
  point('$PLIMMAX', 420, 297, false);
  variable('$UNITMODE', 70, 0);
  variable('$VISRETAIN', 70, 1);
  variable('$PLINEGEN', 70, 0);
  variable('$PSLTSCALE', 70, 1);
  variable('$TREEDEPTH', 70, 3020);
  variable('$CMLSTYLE', 2, 'Standard');
  variable('$CMLJUST', 70, 0);
  variable('$CMLSCALE', 40, '1.0');
  variable('$PROXYGRAPHICS', 70, 1);
  variable('$MEASUREMENT', 70, document.unit === 'inch' ? 0 : 1);
  variable('$CELWEIGHT', 370, -1);
  variable('$ENDCAPS', 280, 0);
  variable('$JOINSTYLE', 280, 0);
  variable('$LWDISPLAY', 290, 0);
  variable('$INSUNITS', 70, document.unit === 'inch' ? 1 : 4);
  variable('$HYPERLINKBASE', 1, '');
  variable('$STYLESHEET', 1, '');
  variable('$XEDIT', 290, 1);
  variable('$CEPSNTYPE', 380, 0);
  variable('$PSTYLEMODE', 290, 1);
  variable('$EXTNAMES', 290, 1);
  variable('$PSVPSCALE', 40, '0.0');
  variable('$OLESTARTUP', 290, 0);
  b.tag(0, 'ENDSEC');
}

function writeClassesSection(b: DxfBuilder, withImages: boolean): void {
  b.tag(0, 'SECTION');
  b.tag(2, 'CLASSES');
  const cls = (
    name: string,
    cpp: string,
    app: string,
    proxyFlags: number,
    isEntity: number
  ) => {
    b.tag(0, 'CLASS');
    b.tag(1, name);
    b.tag(2, cpp);
    b.tag(3, app);
    b.tag(90, proxyFlags);
    b.tag(280, 0);
    b.tag(281, isEntity);
  };
  cls(
    'ACDBDICTIONARYWDFLT',
    'AcDbDictionaryWithDefault',
    'ObjectDBX Classes',
    0,
    0
  );
  cls('ACDBPLACEHOLDER', 'AcDbPlaceHolder', 'ObjectDBX Classes', 0, 0);
  cls('LAYOUT', 'AcDbLayout', 'ObjectDBX Classes', 0, 0);
  if (withImages) {
    cls('RASTERVARIABLES', 'AcDbRasterVariables', 'ISM', 0, 0);
    cls('IMAGE', 'AcDbRasterImage', 'ISM', 2175, 1);
    cls('IMAGEDEF', 'AcDbRasterImageDef', 'ISM', 0, 0);
    cls('IMAGEDEF_REACTOR', 'AcDbRasterImageDefReactor', 'ISM', 1, 0);
  }
  b.tag(0, 'ENDSEC');
}

function writeTablesSection(
  b: DxfBuilder,
  document: CadDocument,
  layers: Map<string, CadLayer>,
  styles: Map<string, CadTextStyle>,
  usedLineTypes: Set<CadLineType>,
  blockRecords: Array<{ block: CadBlock; recordHandle: string }>,
  extents: Extents
): void {
  b.tag(0, 'SECTION');
  b.tag(2, 'TABLES');

  const table = (
    name: string,
    handle: string,
    count: number,
    body: () => void
  ) => {
    b.tag(0, 'TABLE');
    b.tag(2, name);
    b.tag(5, handle);
    b.tag(330, '0');
    b.tag(100, 'AcDbSymbolTable');
    b.tag(70, count);
    if (name === 'DIMSTYLE') b.tag(100, 'AcDbDimStyleTable');
    body();
    b.tag(0, 'ENDTAB');
  };
  const record = (
    type: string,
    handle: string,
    owner: string,
    subclass: string
  ) => {
    b.tag(0, type);
    b.tag(type === 'DIMSTYLE' ? 105 : 5, handle);
    b.tag(330, owner);
    b.tag(100, 'AcDbSymbolTableRecord');
    b.tag(100, subclass);
  };

  const width = Math.max(extents.maxX - extents.minX, 1);
  const height = Math.max(extents.maxY - extents.minY, 1);
  table('VPORT', H.vportTable, 1, () => {
    record('VPORT', H.activeVport, H.vportTable, 'AcDbViewportTableRecord');
    b.tag(2, '*Active');
    b.tag(70, 0);
    b.tag(10, '0.0');
    b.tag(20, '0.0');
    b.tag(11, '1.0');
    b.tag(21, '1.0');
    b.tag(12, real((extents.minX + extents.maxX) / 2));
    b.tag(22, real((extents.minY + extents.maxY) / 2));
    b.tag(13, '0.0');
    b.tag(23, '0.0');
    b.tag(14, '0.5');
    b.tag(24, '0.5');
    b.tag(15, '0.5');
    b.tag(25, '0.5');
    b.tag(16, '0.0');
    b.tag(26, '0.0');
    b.tag(36, '1.0');
    b.tag(17, '0.0');
    b.tag(27, '0.0');
    b.tag(37, '0.0');
    b.tag(40, real(height * 1.1));
    b.tag(41, real(width / height));
    b.tag(42, '50.0');
    b.tag(43, '0.0');
    b.tag(44, '0.0');
    b.tag(50, '0.0');
    b.tag(51, '0.0');
    b.tag(71, 0);
    b.tag(72, 1000);
    b.tag(73, 1);
    b.tag(74, 3);
    b.tag(75, 0);
    b.tag(76, 0);
    b.tag(77, 0);
    b.tag(78, 0);
    b.tag(281, 0);
    b.tag(65, 0);
    b.tag(146, '0.0');
  });

  const patterns = lineTypePatterns(document.unit);
  const extraLineTypes = [...usedLineTypes].sort();
  table('LTYPE', H.ltypeTable, 3 + extraLineTypes.length, () => {
    const simple = (name: string, handle: string) => {
      record('LTYPE', handle, H.ltypeTable, 'AcDbLinetypeTableRecord');
      b.tag(2, name);
      b.tag(70, 0);
      b.tag(3, name === 'Continuous' ? 'Solid line' : '');
      b.tag(72, 65);
      b.tag(73, 0);
      b.tag(40, '0.0');
    };
    simple('ByBlock', H.ltypeByBlock);
    simple('ByLayer', H.ltypeByLayer);
    simple('Continuous', H.ltypeContinuous);
    for (const name of extraLineTypes) {
      const pattern = patterns[name];
      record('LTYPE', b.handle(), H.ltypeTable, 'AcDbLinetypeTableRecord');
      b.tag(2, name);
      b.tag(70, 0);
      b.tag(3, pattern.description);
      b.tag(72, 65);
      b.tag(73, pattern.elements.length);
      b.tag(
        40,
        real(pattern.elements.reduce((sum, value) => sum + Math.abs(value), 0))
      );
      for (const element of pattern.elements) {
        b.tag(49, real(element));
        b.tag(74, 0);
      }
    }
  });

  table('LAYER', H.layerTable, layers.size, () => {
    for (const layer of layers.values()) {
      record(
        'LAYER',
        layer.name === '0' ? H.layer0 : b.handle(),
        H.layerTable,
        'AcDbLayerTableRecord'
      );
      b.tag(2, layer.name);
      b.tag(70, 0);
      b.tag(62, layer.name === '0' ? 7 : aciFromColor(layer.color));
      if (
        layer.name !== '0' &&
        !isNearBlack(layer.color) &&
        aciFromColor(layer.color) !== 255
      ) {
        b.tag(420, trueColorValue(layer.color));
      }
      b.tag(6, lineTypeName(layer.lineType));
      b.tag(370, -3);
      b.tag(390, H.plotStylePlaceholder);
    }
  });

  table('STYLE', H.styleTable, styles.size, () => {
    for (const style of styles.values()) {
      record(
        'STYLE',
        style.name === 'Standard' ? H.styleStandard : b.handle(),
        H.styleTable,
        'AcDbTextStyleTableRecord'
      );
      b.tag(2, style.name);
      b.tag(70, 0);
      b.tag(40, '0.0');
      b.tag(41, '1.0');
      b.tag(50, '0.0');
      b.tag(71, 0);
      b.tag(42, '2.5');
      b.tag(3, fontFileFor(style));
      b.tag(4, '');
    }
  });

  table('VIEW', H.viewTable, 0, () => undefined);
  table('UCS', H.ucsTable, 0, () => undefined);
  table('APPID', H.appidTable, 1, () => {
    record('APPID', H.appidAcad, H.appidTable, 'AcDbRegAppTableRecord');
    b.tag(2, 'ACAD');
    b.tag(70, 0);
  });

  table('DIMSTYLE', H.dimstyleTable, 1, () => {
    record(
      'DIMSTYLE',
      H.dimstyleStandard,
      H.dimstyleTable,
      'AcDbDimStyleTableRecord'
    );
    b.tag(2, 'Standard');
    b.tag(70, 0);
    b.tag(3, '');
    b.tag(4, '');
    b.tag(40, '1.0');
    b.tag(41, '2.5');
    b.tag(42, '0.625');
    b.tag(43, '3.75');
    b.tag(44, '1.25');
    b.tag(45, '0.0');
    b.tag(46, '0.0');
    b.tag(47, '0.0');
    b.tag(48, '0.0');
    b.tag(140, '2.5');
    b.tag(141, '2.5');
    b.tag(142, '0.0');
    b.tag(143, '0.03937007874');
    b.tag(144, '1.0');
    b.tag(145, '0.0');
    b.tag(146, '1.0');
    b.tag(147, '0.625');
    b.tag(148, '0.0');
    b.tag(71, 0);
    b.tag(72, 0);
    b.tag(73, 0);
    b.tag(74, 0);
    b.tag(75, 0);
    b.tag(76, 0);
    b.tag(77, 1);
    b.tag(78, 8);
    b.tag(79, 3);
    b.tag(170, 0);
    b.tag(171, 3);
    b.tag(172, 1);
    b.tag(173, 0);
    b.tag(174, 0);
    b.tag(175, 0);
    b.tag(176, 0);
    b.tag(177, 0);
    b.tag(178, 0);
    b.tag(179, 2);
    b.tag(271, 2);
    b.tag(272, 2);
    b.tag(273, 2);
    b.tag(274, 3);
    b.tag(275, 0);
    b.tag(276, 0);
    b.tag(277, 2);
    b.tag(278, 44);
    b.tag(279, 0);
    b.tag(280, 0);
    b.tag(281, 0);
    b.tag(282, 0);
    b.tag(283, 0);
    b.tag(284, 8);
    b.tag(285, 0);
    b.tag(286, 0);
    b.tag(288, 0);
    b.tag(289, 3);
    b.tag(340, H.styleStandard);
    b.tag(371, -2);
    b.tag(372, -2);
  });

  table('BLOCK_RECORD', H.blockRecordTable, 2 + blockRecords.length, () => {
    const blockRecord = (name: string, handle: string, layout: string) => {
      record(
        'BLOCK_RECORD',
        handle,
        H.blockRecordTable,
        'AcDbBlockTableRecord'
      );
      b.tag(2, name);
      b.tag(340, layout);
    };
    blockRecord('*Model_Space', H.modelSpaceRecord, H.modelLayout);
    blockRecord('*Paper_Space', H.paperSpaceRecord, H.paperLayout);
    for (const entry of blockRecords) {
      blockRecord(entry.block.name, entry.recordHandle, '0');
    }
  });

  b.tag(0, 'ENDSEC');
}

function lineTypeName(lineType: CadLineType | undefined): string {
  return !lineType || lineType === 'CONTINUOUS' ? 'Continuous' : lineType;
}

function writeBlocksSection(
  b: DxfBuilder,
  document: CadDocument,
  blockRecords: Array<{
    block: CadBlock;
    recordHandle: string;
    beginHandle: string;
    endHandle: string;
  }>,
  layers: Map<string, CadLayer>,
  images: ImageRecord[],
  resources: CadWriteFile[]
): void {
  b.tag(0, 'SECTION');
  b.tag(2, 'BLOCKS');
  const blockBegin = (
    name: string,
    handle: string,
    owner: string,
    base: CadPoint
  ) => {
    b.tag(0, 'BLOCK');
    b.tag(5, handle);
    b.tag(330, owner);
    b.tag(100, 'AcDbEntity');
    b.tag(8, '0');
    b.tag(100, 'AcDbBlockBegin');
    b.tag(2, name);
    b.tag(70, 0);
    b.point(10, base);
    b.tag(3, name);
    b.tag(1, '');
  };
  const blockEnd = (handle: string, owner: string) => {
    b.tag(0, 'ENDBLK');
    b.tag(5, handle);
    b.tag(330, owner);
    b.tag(100, 'AcDbEntity');
    b.tag(8, '0');
    b.tag(100, 'AcDbBlockEnd');
  };
  blockBegin('*Model_Space', H.modelSpaceBlock, H.modelSpaceRecord, {
    x: 0,
    y: 0,
  });
  blockEnd(H.modelSpaceEndBlk, H.modelSpaceRecord);
  blockBegin('*Paper_Space', H.paperSpaceBlock, H.paperSpaceRecord, {
    x: 0,
    y: 0,
  });
  blockEnd(H.paperSpaceEndBlk, H.paperSpaceRecord);
  for (const entry of blockRecords) {
    blockBegin(
      entry.block.name,
      entry.beginHandle,
      entry.recordHandle,
      entry.block.basePoint
    );
    for (const entity of entry.block.entities) {
      writeEntity(
        b,
        entity,
        { x: 0, y: 0 },
        entry.recordHandle,
        layers,
        images,
        resources,
        document
      );
    }
    blockEnd(entry.endHandle, entry.recordHandle);
  }
  b.tag(0, 'ENDSEC');
}

function writeEntitiesSection(
  b: DxfBuilder,
  document: CadDocument,
  layers: Map<string, CadLayer>,
  images: ImageRecord[],
  resources: CadWriteFile[]
): void {
  b.tag(0, 'SECTION');
  b.tag(2, 'ENTITIES');
  for (const page of document.pages) {
    for (const entity of page.entities) {
      writeEntity(
        b,
        entity,
        page.origin,
        H.modelSpaceRecord,
        layers,
        images,
        resources,
        document
      );
    }
  }
  b.tag(0, 'ENDSEC');
}

function writeEntityHeader(
  b: DxfBuilder,
  type: string,
  entity: CadEntity,
  owner: string,
  layers: Map<string, CadLayer>
): string {
  const handle = b.handle();
  b.tag(0, type);
  b.tag(5, handle);
  b.tag(330, owner);
  b.tag(100, 'AcDbEntity');
  b.tag(8, entity.layer);
  const layer = layers.get(entity.layer);
  if (
    entity.lineType &&
    entity.lineType !== (layer?.lineType ?? 'CONTINUOUS')
  ) {
    b.tag(6, lineTypeName(entity.lineType));
  }
  if (entity.color && !sameColor(entity.color, layer?.color)) {
    b.tag(62, aciFromColor(entity.color));
    if (!isNearBlack(entity.color)) b.tag(420, trueColorValue(entity.color));
  }
  const weight = snapLineWeight(entity.lineWeightMm);
  if (weight !== null) b.tag(370, weight);
  return handle;
}

function sameColor(a: CadColor, b: CadColor | undefined): boolean {
  return !!b && a.r === b.r && a.g === b.g && a.b === b.b;
}

function shift(point: CadPoint, origin: CadPoint): CadPoint {
  return { x: point.x + origin.x, y: point.y + origin.y };
}

function writeEntity(
  b: DxfBuilder,
  entity: CadEntity,
  origin: CadPoint,
  owner: string,
  layers: Map<string, CadLayer>,
  images: ImageRecord[],
  resources: CadWriteFile[],
  document: CadDocument
): void {
  switch (entity.type) {
    case 'line':
      writeEntityHeader(b, 'LINE', entity, owner, layers);
      b.tag(100, 'AcDbLine');
      b.point(10, shift(entity.start, origin));
      b.point(11, shift(entity.end, origin));
      return;
    case 'polyline':
      writeEntityHeader(b, 'LWPOLYLINE', entity, owner, layers);
      b.tag(100, 'AcDbPolyline');
      b.tag(90, entity.vertices.length);
      b.tag(70, entity.closed ? 1 : 0);
      writeVertices(b, entity.vertices, origin, false);
      return;
    case 'arc':
      writeEntityHeader(b, 'ARC', entity, owner, layers);
      b.tag(100, 'AcDbCircle');
      b.point(10, shift(entity.center, origin));
      b.tag(40, real(entity.radius));
      b.tag(100, 'AcDbArc');
      b.tag(50, real(normalizeAngleDeg(entity.startAngle)));
      b.tag(51, real(normalizeAngleDeg(entity.endAngle)));
      return;
    case 'circle':
      writeEntityHeader(b, 'CIRCLE', entity, owner, layers);
      b.tag(100, 'AcDbCircle');
      b.point(10, shift(entity.center, origin));
      b.tag(40, real(entity.radius));
      return;
    case 'hatch':
      writeHatch(b, entity, origin, owner, layers);
      return;
    case 'text':
      writeText(b, entity, origin, owner, layers);
      return;
    case 'mtext':
      writeMText(b, entity, origin, owner, layers);
      return;
    case 'insert':
      writeEntityHeader(b, 'INSERT', entity, owner, layers);
      b.tag(100, 'AcDbBlockReference');
      b.tag(2, entity.blockName);
      b.point(10, shift(entity.insert, origin));
      b.tag(41, real(entity.scale.x));
      b.tag(42, real(entity.scale.y));
      b.tag(43, '1.0');
      b.tag(50, real(normalizeAngleDeg(entity.rotation)));
      return;
    case 'image-underlay':
      writeImage(b, entity, origin, owner, layers, images, resources, document);
      return;
  }
}

function writeVertices(
  b: DxfBuilder,
  vertices: CadPolylineVertex[],
  origin: CadPoint,
  alwaysBulge: boolean
): void {
  for (const vertex of vertices) {
    b.point(10, shift(vertex, origin), false);
    if (alwaysBulge || vertex.bulge) b.tag(42, real(vertex.bulge ?? 0));
  }
}

function writeHatch(
  b: DxfBuilder,
  entity: CadHatchEntity,
  origin: CadPoint,
  owner: string,
  layers: Map<string, CadLayer>
): void {
  const layer = layers.get(entity.layer);
  const handle = b.handle();
  b.tag(0, 'HATCH');
  b.tag(5, handle);
  b.tag(330, owner);
  b.tag(100, 'AcDbEntity');
  b.tag(8, entity.layer);
  if (!sameColor(entity.fillColor, layer?.color)) {
    b.tag(62, aciFromColor(entity.fillColor));
    if (!isNearBlack(entity.fillColor))
      b.tag(420, trueColorValue(entity.fillColor));
  }
  b.tag(100, 'AcDbHatch');
  b.tag(10, '0.0');
  b.tag(20, '0.0');
  b.tag(30, '0.0');
  b.tag(210, '0.0');
  b.tag(220, '0.0');
  b.tag(230, '1.0');
  b.tag(2, 'SOLID');
  b.tag(70, 1);
  b.tag(71, 0);
  b.tag(91, entity.loops.length);
  entity.loops.forEach((loop, index) => {
    // 2 = 折线边界;首个环再标 1(外部)。
    b.tag(92, index === 0 ? 3 : 2);
    b.tag(72, 1);
    b.tag(73, 1);
    b.tag(93, loop.vertices.length);
    writeVertices(b, loop.vertices, origin, true);
    b.tag(97, 0);
  });
  // 75 = 0 奇偶填充:对 PDF 的 even-odd 精确,对 nonzero 在常见嵌套环上结果一致。
  b.tag(75, 0);
  b.tag(76, 1);
  b.tag(98, 0);
}

function writeText(
  b: DxfBuilder,
  entity: CadTextEntity,
  origin: CadPoint,
  owner: string,
  layers: Map<string, CadLayer>
): void {
  const encoded = encodeDxfText(entity.text, false);
  if (encoded.length > DXF_STRING_LIMIT) {
    // 单行 TEXT 放不下(常见于长中文行转义后膨胀):改写成不自动换行的 MTEXT,左下对齐。
    writeMText(
      b,
      {
        ...entity,
        type: 'mtext',
        width: 0,
        lineSpacingFactor: 1,
      },
      origin,
      owner,
      layers,
      7
    );
    return;
  }
  writeEntityHeader(b, 'TEXT', entity, owner, layers);
  b.tag(100, 'AcDbText');
  const insert = shift(entity.insert, origin);
  b.point(10, insert);
  b.tag(40, real(entity.height));
  b.tag(1, encoded);
  b.tag(50, real(normalizeAngleDeg(entity.rotation)));
  if (entity.widthFactor && entity.widthFactor !== 1)
    b.tag(41, real(entity.widthFactor));
  b.tag(7, entity.style);
  b.point(11, insert);
  b.tag(100, 'AcDbText');
}

function writeMText(
  b: DxfBuilder,
  entity: CadMTextEntity,
  origin: CadPoint,
  owner: string,
  layers: Map<string, CadLayer>,
  attachmentPoint = 1
): void {
  writeEntityHeader(b, 'MTEXT', entity, owner, layers);
  b.tag(100, 'AcDbMText');
  b.point(10, shift(entity.insert, origin));
  b.tag(40, real(entity.height));
  b.tag(41, real(entity.width));
  b.tag(71, attachmentPoint);
  b.tag(72, 1);
  const chunks = chunkEncoded(encodeDxfText(entity.text, true), MTEXT_CHUNK);
  const last = chunks.pop() ?? '';
  for (const chunk of chunks) b.tag(3, chunk);
  b.tag(1, last);
  b.tag(7, entity.style);
  b.tag(50, real(normalizeAngleDeg(entity.rotation)));
  const spacing = entity.lineSpacingFactor ?? 1;
  b.tag(73, 1);
  b.tag(44, real(Math.min(4, Math.max(0.25, spacing))));
}

function writeImage(
  b: DxfBuilder,
  entity: CadImageUnderlayEntity,
  origin: CadPoint,
  owner: string,
  layers: Map<string, CadLayer>,
  images: ImageRecord[],
  resources: CadWriteFile[],
  document: CadDocument
): void {
  const insert = shift(entity.insert, origin);
  if (entity.placeholder || !entity.resource) {
    // 关闭底图:只画占位外框,DXF 不引用任何外部文件。
    const corners: CadPolylineVertex[] = [
      insert,
      { x: insert.x + entity.uVector.x, y: insert.y + entity.uVector.y },
      {
        x: insert.x + entity.uVector.x + entity.vVector.x,
        y: insert.y + entity.uVector.y + entity.vVector.y,
      },
      { x: insert.x + entity.vVector.x, y: insert.y + entity.vVector.y },
    ];
    writeEntityHeader(b, 'LWPOLYLINE', entity, owner, layers);
    b.tag(100, 'AcDbPolyline');
    b.tag(90, 4);
    b.tag(70, 1);
    writeVertices(b, corners, { x: 0, y: 0 }, false);
    return;
  }

  const defHandle = b.handle();
  const reactorHandle = b.handle();
  const entityHandle = writeEntityHeader(b, 'IMAGE', entity, owner, layers);
  const uPerPixel = {
    x: entity.uVector.x / entity.pixelWidth,
    y: entity.uVector.y / entity.pixelWidth,
  };
  const vPerPixel = {
    x: entity.vVector.x / entity.pixelHeight,
    y: entity.vVector.y / entity.pixelHeight,
  };
  b.tag(100, 'AcDbRasterImage');
  b.tag(90, 0);
  b.point(10, insert);
  b.point(11, uPerPixel);
  b.point(12, vPerPixel);
  b.tag(13, real(entity.pixelWidth));
  b.tag(23, real(entity.pixelHeight));
  b.tag(340, defHandle);
  b.tag(70, 3);
  b.tag(280, 0);
  b.tag(281, 50);
  b.tag(282, 50);
  b.tag(283, 0);
  b.tag(360, reactorHandle);
  b.tag(71, 1);
  b.tag(91, 2);
  b.tag(14, '-0.5');
  b.tag(24, '-0.5');
  b.tag(14, real(entity.pixelWidth - 0.5));
  b.tag(24, real(entity.pixelHeight - 0.5));

  const fileName = entity.resource.name;
  if (!resources.some(file => file.name === fileName)) {
    resources.push({
      name: fileName,
      mimeType: entity.resource.mimeType,
      data: entity.resource.data,
    });
  }
  images.push({
    entityHandle,
    defHandle,
    reactorHandle,
    fileName,
    pixelWidth: entity.pixelWidth,
    pixelHeight: entity.pixelHeight,
    pixelSize:
      Math.hypot(uPerPixel.x, uPerPixel.y) ||
      (document.unit === 'inch' ? 0.001 : 0.01),
  });
}

function writeObjectsSection(
  b: DxfBuilder,
  images: ImageRecord[],
  extents: Extents
): void {
  b.tag(0, 'SECTION');
  b.tag(2, 'OBJECTS');
  const rasterVarsHandle = images.length > 0 ? b.handle() : null;
  const imageDictHandle = images.length > 0 ? b.handle() : null;

  const dictionary = (
    handle: string,
    owner: string,
    entries: Array<[string, string]>,
    hardOwner = false
  ) => {
    b.tag(0, 'DICTIONARY');
    b.tag(5, handle);
    b.tag(330, owner);
    b.tag(100, 'AcDbDictionary');
    if (hardOwner) b.tag(280, 1);
    b.tag(281, 1);
    for (const [name, target] of entries) {
      b.tag(3, name);
      b.tag(350, target);
    }
  };

  const rootEntries: Array<[string, string]> = [
    ['ACAD_GROUP', H.groupDict],
    ['ACAD_LAYOUT', H.layoutDict],
    ['ACAD_MLINESTYLE', H.mlineStyleDict],
    ['ACAD_PLOTSETTINGS', H.plotSettingsDict],
    ['ACAD_PLOTSTYLENAME', H.plotStyleDict],
  ];
  if (rasterVarsHandle && imageDictHandle) {
    rootEntries.push(
      ['ACAD_IMAGE_VARS', rasterVarsHandle],
      ['ACAD_IMAGE_DICT', imageDictHandle]
    );
  }
  dictionary(H.rootDict, '0', rootEntries);
  dictionary(H.groupDict, H.rootDict, []);
  dictionary(H.layoutDict, H.rootDict, [
    ['Model', H.modelLayout],
    ['Layout1', H.paperLayout],
  ]);
  dictionary(H.mlineStyleDict, H.rootDict, [['Standard', H.mlineStyle]]);
  dictionary(H.plotSettingsDict, H.rootDict, []);

  b.tag(0, 'ACDBDICTIONARYWDFLT');
  b.tag(5, H.plotStyleDict);
  b.tag(330, H.rootDict);
  b.tag(100, 'AcDbDictionary');
  b.tag(281, 1);
  b.tag(3, 'Normal');
  b.tag(350, H.plotStylePlaceholder);
  b.tag(100, 'AcDbDictionaryWithDefault');
  b.tag(340, H.plotStylePlaceholder);
  b.tag(0, 'ACDBPLACEHOLDER');
  b.tag(5, H.plotStylePlaceholder);
  b.tag(330, H.plotStyleDict);

  writeLayout(b, H.modelLayout, 'Model', 1, 0, H.modelSpaceRecord, extents);
  writeLayout(b, H.paperLayout, 'Layout1', 0, 1, H.paperSpaceRecord, extents);

  b.tag(0, 'MLINESTYLE');
  b.tag(5, H.mlineStyle);
  b.tag(102, '{ACAD_REACTORS');
  b.tag(330, H.mlineStyleDict);
  b.tag(102, '}');
  b.tag(330, H.mlineStyleDict);
  b.tag(100, 'AcDbMlineStyle');
  b.tag(2, 'Standard');
  b.tag(70, 0);
  b.tag(3, '');
  b.tag(62, 256);
  b.tag(51, '90.0');
  b.tag(52, '90.0');
  b.tag(71, 2);
  b.tag(49, '0.5');
  b.tag(62, 256);
  b.tag(6, 'BYLAYER');
  b.tag(49, '-0.5');
  b.tag(62, 256);
  b.tag(6, 'BYLAYER');

  if (rasterVarsHandle && imageDictHandle) {
    b.tag(0, 'RASTERVARIABLES');
    b.tag(5, rasterVarsHandle);
    b.tag(102, '{ACAD_REACTORS');
    b.tag(330, H.rootDict);
    b.tag(102, '}');
    b.tag(330, H.rootDict);
    b.tag(100, 'AcDbRasterVariables');
    b.tag(90, 0);
    b.tag(70, 0);
    b.tag(71, 1);
    b.tag(72, 0);

    dictionary(
      imageDictHandle,
      H.rootDict,
      images.map(image => [image.fileName, image.defHandle])
    );
    for (const image of images) {
      b.tag(0, 'IMAGEDEF');
      b.tag(5, image.defHandle);
      b.tag(102, '{ACAD_REACTORS');
      b.tag(330, imageDictHandle);
      b.tag(330, image.reactorHandle);
      b.tag(102, '}');
      b.tag(330, imageDictHandle);
      b.tag(100, 'AcDbRasterImageDef');
      b.tag(90, 0);
      b.tag(1, image.fileName);
      b.tag(10, real(image.pixelWidth));
      b.tag(20, real(image.pixelHeight));
      b.tag(11, real(image.pixelSize));
      b.tag(21, real(image.pixelSize));
      b.tag(280, 1);
      b.tag(281, 0);
      b.tag(0, 'IMAGEDEF_REACTOR');
      b.tag(5, image.reactorHandle);
      b.tag(330, image.entityHandle);
      b.tag(100, 'AcDbRasterImageDefReactor');
      b.tag(90, 2);
      b.tag(330, image.entityHandle);
    }
  }
  b.tag(0, 'ENDSEC');
}

function writeLayout(
  b: DxfBuilder,
  handle: string,
  name: string,
  tabOrder: number,
  flags: number,
  blockRecord: string,
  extents: Extents
): void {
  b.tag(0, 'LAYOUT');
  b.tag(5, handle);
  b.tag(330, H.layoutDict);
  b.tag(100, 'AcDbPlotSettings');
  b.tag(1, '');
  b.tag(2, 'none_device');
  b.tag(4, '');
  b.tag(6, '');
  b.tag(40, '0.0');
  b.tag(41, '0.0');
  b.tag(42, '0.0');
  b.tag(43, '0.0');
  b.tag(44, '0.0');
  b.tag(45, '0.0');
  b.tag(46, '0.0');
  b.tag(47, '0.0');
  b.tag(48, '0.0');
  b.tag(49, '0.0');
  b.tag(140, '0.0');
  b.tag(141, '0.0');
  b.tag(142, '1.0');
  b.tag(143, '1.0');
  b.tag(70, flags === 0 ? 1024 : 0);
  b.tag(72, 1);
  b.tag(73, 0);
  b.tag(74, 5);
  b.tag(7, '');
  b.tag(75, 16);
  b.tag(76, 0);
  b.tag(77, 2);
  b.tag(78, 300);
  b.tag(147, '1.0');
  b.tag(148, '0.0');
  b.tag(149, '0.0');
  b.tag(100, 'AcDbLayout');
  b.tag(1, name);
  b.tag(70, 1);
  b.tag(71, tabOrder);
  b.tag(10, real(extents.minX));
  b.tag(20, real(extents.minY));
  b.tag(11, real(extents.maxX));
  b.tag(21, real(extents.maxY));
  b.tag(12, '0.0');
  b.tag(22, '0.0');
  b.tag(32, '0.0');
  b.tag(14, real(extents.minX));
  b.tag(24, real(extents.minY));
  b.tag(34, '0.0');
  b.tag(15, real(extents.maxX));
  b.tag(25, real(extents.maxY));
  b.tag(35, '0.0');
  b.tag(146, '0.0');
  b.tag(13, '0.0');
  b.tag(23, '0.0');
  b.tag(33, '0.0');
  b.tag(16, '1.0');
  b.tag(26, '0.0');
  b.tag(36, '0.0');
  b.tag(17, '0.0');
  b.tag(27, '1.0');
  b.tag(37, '0.0');
  b.tag(76, 1);
  b.tag(330, blockRecord);
}

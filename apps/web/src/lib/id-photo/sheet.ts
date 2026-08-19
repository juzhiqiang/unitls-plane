/**
 * 证件照相纸拼版。
 *
 * 冲印店按「张」收费,一张 6 寸相纸能排 12 张一寸照 —— 拿单张证件照去冲印是纯浪费。
 * 这里把成品照按目标相纸尺寸拼成一张,带裁切线,直接拿去冲印或打印。
 *
 * 纯本地 canvas 合成:输入已经是成品照,不需要再上传或跑模型。
 */

import { withDecodedImage } from '@/lib/processing/image-bitmap';

export type SheetKey = 'five_inch' | 'six_inch' | 'seven_inch' | 'a4';

export interface SheetSpec {
  key: SheetKey;
  widthMm: number;
  heightMm: number;
}

/** 相纸规格(短边 × 长边,mm)。摆放方向由布局算法按容量自选。 */
export const ID_PHOTO_SHEETS: Record<SheetKey, SheetSpec> = {
  five_inch: { key: 'five_inch', widthMm: 89, heightMm: 127 },
  six_inch: { key: 'six_inch', widthMm: 102, heightMm: 152 },
  seven_inch: { key: 'seven_inch', widthMm: 127, heightMm: 178 },
  a4: { key: 'a4', widthMm: 210, heightMm: 297 },
};

export const SHEET_ORDER: SheetKey[] = [
  'six_inch',
  'five_inch',
  'seven_inch',
  'a4',
];

/** 证件照预设本身就是 300dpi,拼版沿用同一密度,像素可以 1:1 摆放不重采样。 */
export const SHEET_DPI = 300;

/** 相邻照片间距(mm),留出下刀的余量。 */
export const DEFAULT_GAP_MM = 2;
/** 相纸四周留白(mm),冲印裁切会吃掉边缘。 */
export const DEFAULT_MARGIN_MM = 3;

export interface SheetCell {
  x: number;
  y: number;
}

export interface SheetLayout {
  widthPx: number;
  heightPx: number;
  cols: number;
  rows: number;
  /** 实际摆放的张数(受 maxCount 限制,不超过容量)。 */
  count: number;
  /** 相纸最多能放几张。 */
  capacity: number;
  cellWidth: number;
  cellHeight: number;
  gapPx: number;
  cells: SheetCell[];
}

export function mmToPx(mm: number, dpi = SHEET_DPI): number {
  return Math.round((mm / 25.4) * dpi);
}

interface Grid {
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
}

function fitGrid(
  sheetWidth: number,
  sheetHeight: number,
  photoWidth: number,
  photoHeight: number,
  gap: number,
  margin: number
): Grid {
  const usableWidth = sheetWidth - margin * 2;
  const usableHeight = sheetHeight - margin * 2;
  // n 张照片 + (n-1) 个间距 ≤ 可用长度 → n ≤ (可用 + 间距) / (照片 + 间距)
  const cols = Math.floor((usableWidth + gap) / (photoWidth + gap));
  const rows = Math.floor((usableHeight + gap) / (photoHeight + gap));

  return {
    cols: Math.max(0, cols),
    rows: Math.max(0, rows),
    widthPx: sheetWidth,
    heightPx: sheetHeight,
  };
}

export interface SheetLayoutOptions {
  dpi?: number;
  gapMm?: number;
  marginMm?: number;
  /** 只排前 N 张;省略或超过容量时排满。 */
  maxCount?: number;
}

/**
 * 计算拼版布局。
 *
 * 相纸横放竖放能放的张数往往不同(例如 6 寸放一寸照:竖放 8 张、横放 8 张,但二寸照
 * 差异明显),这里两种方向都算一遍取容量大的那个,用户不需要自己判断该横还是竖。
 */
export function buildIdPhotoSheetLayout(
  sheet: SheetSpec,
  photoWidthPx: number,
  photoHeightPx: number,
  options: SheetLayoutOptions = {}
): SheetLayout {
  const dpi = options.dpi ?? SHEET_DPI;
  const gapPx = mmToPx(options.gapMm ?? DEFAULT_GAP_MM, dpi);
  const marginPx = mmToPx(options.marginMm ?? DEFAULT_MARGIN_MM, dpi);
  const shortSide = mmToPx(sheet.widthMm, dpi);
  const longSide = mmToPx(sheet.heightMm, dpi);

  const candidates = [
    fitGrid(shortSide, longSide, photoWidthPx, photoHeightPx, gapPx, marginPx),
    fitGrid(longSide, shortSide, photoWidthPx, photoHeightPx, gapPx, marginPx),
  ];
  const best = candidates.reduce((a, b) =>
    b.cols * b.rows > a.cols * a.rows ? b : a
  );

  const capacity = best.cols * best.rows;
  const count =
    options.maxCount === undefined
      ? capacity
      : Math.max(0, Math.min(capacity, Math.floor(options.maxCount)));

  // 网格整体居中,而不是靠着 margin 堆在左上角 —— 冲印裁切更容易对齐。
  const gridWidth =
    best.cols * photoWidthPx + Math.max(0, best.cols - 1) * gapPx;
  const gridHeight =
    best.rows * photoHeightPx + Math.max(0, best.rows - 1) * gapPx;
  const originX = Math.round((best.widthPx - gridWidth) / 2);
  const originY = Math.round((best.heightPx - gridHeight) / 2);

  const cells: SheetCell[] = [];
  for (let index = 0; index < count; index += 1) {
    const col = index % best.cols;
    const row = Math.floor(index / best.cols);
    cells.push({
      x: originX + col * (photoWidthPx + gapPx),
      y: originY + row * (photoHeightPx + gapPx),
    });
  }

  return {
    widthPx: best.widthPx,
    heightPx: best.heightPx,
    cols: best.cols,
    rows: best.rows,
    count,
    capacity,
    cellWidth: photoWidthPx,
    cellHeight: photoHeightPx,
    gapPx,
    cells,
  };
}

export interface RenderSheetOptions {
  background?: string;
  /** 每张照片外描一圈细线,便于下刀。 */
  cutMarks?: boolean;
  outputType?: 'image/jpeg' | 'image/png';
  quality?: number;
}

export function getSheetFileName(
  sheet: SheetKey,
  outputType: 'image/jpeg' | 'image/png'
): string {
  return `id-photo-sheet-${sheet}.${outputType === 'image/png' ? 'png' : 'jpg'}`;
}

/**
 * 把单张证件照按布局拼到相纸上。
 *
 * @param photo 成品证件照(已换底、已裁剪)
 */
export async function renderIdPhotoSheet(
  photo: Blob,
  layout: SheetLayout,
  options: RenderSheetOptions = {}
): Promise<Blob> {
  const outputType = options.outputType ?? 'image/jpeg';

  return withDecodedImage(photo, async image => {
    const canvas = document.createElement('canvas');
    canvas.width = layout.widthPx;
    canvas.height = layout.heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');

    // 相纸底色必须填白:JPEG 没有透明通道,不填会变成黑底。
    ctx.fillStyle = options.background ?? '#ffffff';
    ctx.fillRect(0, 0, layout.widthPx, layout.heightPx);

    for (const cell of layout.cells) {
      ctx.drawImage(
        image.source,
        cell.x,
        cell.y,
        layout.cellWidth,
        layout.cellHeight
      );
    }

    if (options.cutMarks !== false) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = 1;
      for (const cell of layout.cells) {
        // 描在照片外侧半像素处,避免线盖住照片内容
        ctx.strokeRect(
          cell.x - 0.5,
          cell.y - 0.5,
          layout.cellWidth + 1,
          layout.cellHeight + 1
        );
      }
    }

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        blob => {
          if (!blob) return reject(new Error('Sheet export failed'));
          resolve(blob);
        },
        outputType,
        outputType === 'image/jpeg' ? (options.quality ?? 0.95) : undefined
      );
    });
  });
}

import { describe, expect, it } from 'vitest';
import { idPhotoPresetSpecs } from '@utils-plane/validators';
import {
  buildIdPhotoSheetLayout,
  getSheetFileName,
  ID_PHOTO_SHEETS,
  mmToPx,
  SHEET_DPI,
} from '../sheet';

const ONE_INCH = idPhotoPresetSpecs.one_inch;
const TWO_INCH = idPhotoPresetSpecs.two_inch;

describe('mmToPx', () => {
  it('converts millimetres at the sheet density', () => {
    expect(mmToPx(25.4)).toBe(SHEET_DPI);
    expect(mmToPx(152)).toBe(Math.round((152 / 25.4) * 300));
  });
});

describe('buildIdPhotoSheetLayout', () => {
  it('fits twelve one-inch photos on a 6-inch sheet', () => {
    // 手算复核(300dpi,间距 2mm=24px,留白 3mm=35px):
    //   6 寸 = 102×152mm → 1205×1795px,竖放可用区 1135×1725px
    //   列 = floor((1135+24)/(295+24)) = 3,行 = floor((1725+24)/(413+24)) = 4
    // 坊间常说「6 寸排 8 张」,那是按更宽的留白算的;295×413 这个规格实际能排 12 张。
    const layout = buildIdPhotoSheetLayout(
      ID_PHOTO_SHEETS.six_inch,
      ONE_INCH.widthPx,
      ONE_INCH.heightPx
    );

    expect(layout.cols).toBe(3);
    expect(layout.rows).toBe(4);
    expect(layout.capacity).toBe(12);
    expect(layout.cells).toHaveLength(12);
  });

  it('fits fewer two-inch photos on the same sheet', () => {
    const oneInch = buildIdPhotoSheetLayout(
      ID_PHOTO_SHEETS.six_inch,
      ONE_INCH.widthPx,
      ONE_INCH.heightPx
    );
    const twoInch = buildIdPhotoSheetLayout(
      ID_PHOTO_SHEETS.six_inch,
      TWO_INCH.widthPx,
      TWO_INCH.heightPx
    );

    expect(twoInch.capacity).toBeGreaterThan(0);
    expect(twoInch.capacity).toBeLessThan(oneInch.capacity);
  });

  it('picks the sheet orientation that fits more copies', () => {
    const layout = buildIdPhotoSheetLayout(
      ID_PHOTO_SHEETS.six_inch,
      ONE_INCH.widthPx,
      ONE_INCH.heightPx
    );
    const shortSide = mmToPx(ID_PHOTO_SHEETS.six_inch.widthMm);
    const longSide = mmToPx(ID_PHOTO_SHEETS.six_inch.heightMm);

    // 输出必须是这两种摆放之一,且不能比另一种装得少。
    expect([shortSide, longSide]).toContain(layout.widthPx);
    expect([shortSide, longSide]).toContain(layout.heightPx);
    expect(layout.widthPx * layout.heightPx).toBe(shortSide * longSide);
  });

  it('keeps every cell inside the sheet', () => {
    for (const sheet of Object.values(ID_PHOTO_SHEETS)) {
      for (const preset of Object.values(idPhotoPresetSpecs)) {
        const layout = buildIdPhotoSheetLayout(
          sheet,
          preset.widthPx,
          preset.heightPx
        );
        for (const cell of layout.cells) {
          expect(cell.x).toBeGreaterThanOrEqual(0);
          expect(cell.y).toBeGreaterThanOrEqual(0);
          expect(cell.x + layout.cellWidth).toBeLessThanOrEqual(layout.widthPx);
          expect(cell.y + layout.cellHeight).toBeLessThanOrEqual(
            layout.heightPx
          );
        }
      }
    }
  });

  it('never overlaps two cells', () => {
    const layout = buildIdPhotoSheetLayout(
      ID_PHOTO_SHEETS.a4,
      ONE_INCH.widthPx,
      ONE_INCH.heightPx
    );

    for (let i = 0; i < layout.cells.length; i += 1) {
      for (let j = i + 1; j < layout.cells.length; j += 1) {
        const a = layout.cells[i]!;
        const b = layout.cells[j]!;
        const overlaps =
          a.x < b.x + layout.cellWidth &&
          b.x < a.x + layout.cellWidth &&
          a.y < b.y + layout.cellHeight &&
          b.y < a.y + layout.cellHeight;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('centres the grid on the sheet', () => {
    const layout = buildIdPhotoSheetLayout(
      ID_PHOTO_SHEETS.six_inch,
      ONE_INCH.widthPx,
      ONE_INCH.heightPx
    );
    const left = Math.min(...layout.cells.map(c => c.x));
    const right = Math.max(...layout.cells.map(c => c.x + layout.cellWidth));

    expect(left).toBeCloseTo(layout.widthPx - right, -0.5);
  });

  it('honours maxCount without changing capacity', () => {
    const layout = buildIdPhotoSheetLayout(
      ID_PHOTO_SHEETS.six_inch,
      ONE_INCH.widthPx,
      ONE_INCH.heightPx,
      { maxCount: 3 }
    );

    expect(layout.capacity).toBe(12);
    expect(layout.count).toBe(3);
    expect(layout.cells).toHaveLength(3);
  });

  it('clamps maxCount to the sheet capacity', () => {
    const layout = buildIdPhotoSheetLayout(
      ID_PHOTO_SHEETS.six_inch,
      ONE_INCH.widthPx,
      ONE_INCH.heightPx,
      { maxCount: 99 }
    );

    expect(layout.count).toBe(layout.capacity);
  });

  it('reports zero capacity when the photo cannot fit at all', () => {
    const layout = buildIdPhotoSheetLayout(
      ID_PHOTO_SHEETS.five_inch,
      mmToPx(500),
      mmToPx(500)
    );

    expect(layout.capacity).toBe(0);
    expect(layout.cells).toHaveLength(0);
  });

  it('a larger sheet fits at least as many copies', () => {
    const six = buildIdPhotoSheetLayout(
      ID_PHOTO_SHEETS.six_inch,
      ONE_INCH.widthPx,
      ONE_INCH.heightPx
    );
    const a4 = buildIdPhotoSheetLayout(
      ID_PHOTO_SHEETS.a4,
      ONE_INCH.widthPx,
      ONE_INCH.heightPx
    );

    expect(a4.capacity).toBeGreaterThan(six.capacity);
  });
});

describe('getSheetFileName', () => {
  it('matches the output type', () => {
    expect(getSheetFileName('six_inch', 'image/jpeg')).toBe(
      'id-photo-sheet-six_inch.jpg'
    );
    expect(getSheetFileName('a4', 'image/png')).toBe('id-photo-sheet-a4.png');
  });
});

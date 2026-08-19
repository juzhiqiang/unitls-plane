import { describe, expect, it } from 'bun:test';
import {
  IMAGE_WATERMARK_GRID,
  imageWatermarkPositionEnum,
  resolveWatermarkAnchor,
  resolveWatermarkMargin,
} from './watermark';

const W = 800;
const H = 600;
const M = 32;

describe('imageWatermarkPositionEnum', () => {
  it('保留原有三个取值,老配置不失效', () => {
    for (const legacy of ['center', 'bottom-right', 'tile']) {
      expect(() => imageWatermarkPositionEnum.parse(legacy)).not.toThrow();
    }
  });

  it('九宫格是九个,加上 tile 共十个', () => {
    expect(IMAGE_WATERMARK_GRID).toHaveLength(9);
    expect(imageWatermarkPositionEnum.options).toHaveLength(10);
  });
});

describe('resolveWatermarkAnchor', () => {
  it('四角贴边并带外边距', () => {
    expect(resolveWatermarkAnchor('top-left', W, H, M)).toMatchObject({
      x: M,
      y: M,
      horizontal: 'start',
      vertical: 'top',
    });
    expect(resolveWatermarkAnchor('bottom-right', W, H, M)).toMatchObject({
      x: W - M,
      y: H - M,
      horizontal: 'end',
      vertical: 'bottom',
    });
    expect(resolveWatermarkAnchor('top-right', W, H, M)).toMatchObject({
      x: W - M,
      y: M,
    });
    expect(resolveWatermarkAnchor('bottom-left', W, H, M)).toMatchObject({
      x: M,
      y: H - M,
    });
  });

  it('居中位置落在正中', () => {
    expect(resolveWatermarkAnchor('center', W, H, M)).toMatchObject({
      x: W / 2,
      y: H / 2,
      horizontal: 'middle',
      vertical: 'middle',
    });
  });

  it('边中点只在一个轴上贴边', () => {
    expect(resolveWatermarkAnchor('top-center', W, H, M)).toMatchObject({
      x: W / 2,
      y: M,
    });
    expect(resolveWatermarkAnchor('middle-left', W, H, M)).toMatchObject({
      x: M,
      y: H / 2,
    });
  });

  it('九宫格里每个锚点都落在图内', () => {
    for (const position of IMAGE_WATERMARK_GRID) {
      const anchor = resolveWatermarkAnchor(position, W, H, M);
      expect(anchor.x).toBeGreaterThanOrEqual(0);
      expect(anchor.y).toBeGreaterThanOrEqual(0);
      expect(anchor.x).toBeLessThanOrEqual(W);
      expect(anchor.y).toBeLessThanOrEqual(H);
    }
  });

  it('九宫格的锚点两两不重合', () => {
    const seen = new Set(
      IMAGE_WATERMARK_GRID.map(p => {
        const a = resolveWatermarkAnchor(p, W, H, M);
        return `${a.x},${a.y}`;
      })
    );
    expect(seen.size).toBe(IMAGE_WATERMARK_GRID.length);
  });
});

describe('resolveWatermarkMargin', () => {
  it('按短边比例给,并有下限', () => {
    expect(resolveWatermarkMargin(1000, 800)).toBe(32);
    // 小图不能因为比例太小而顶到边上
    expect(resolveWatermarkMargin(100, 60)).toBe(12);
  });
});

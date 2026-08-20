import { describe, expect, it } from 'vitest';
import {
  centeredCropRect,
  clampCropRect,
  CROP_ASPECTS,
  MIN_CROP_SIZE,
  moveCropRect,
  resizeCropRect,
  type CropHandle,
  type CropRect,
} from '../geometry';

const BOUNDS = { width: 800, height: 600 };

function aspectOf(rect: CropRect): number {
  return rect.width / rect.height;
}

function insideBounds(rect: CropRect, bounds = BOUNDS): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= bounds.width &&
    rect.y + rect.height <= bounds.height
  );
}

describe('centeredCropRect', () => {
  it('uses the whole image when no aspect is locked', () => {
    expect(centeredCropRect(BOUNDS)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
  });

  it('fits the largest centred rect for the requested aspect', () => {
    const square = centeredCropRect(BOUNDS, 1);
    expect(square.width).toBe(600);
    expect(square.height).toBe(600);
    expect(square.x).toBe(100);
    expect(square.y).toBe(0);
  });

  it('handles aspects taller than the image', () => {
    const tall = centeredCropRect(BOUNDS, 9 / 16);
    expect(aspectOf(tall)).toBeCloseTo(9 / 16, 2);
    expect(insideBounds(tall)).toBe(true);
  });

  it('every preset aspect produces an in-bounds rect', () => {
    for (const preset of CROP_ASPECTS) {
      const rect = centeredCropRect(BOUNDS, preset.value);
      expect(insideBounds(rect)).toBe(true);
      if (preset.value) expect(aspectOf(rect)).toBeCloseTo(preset.value, 1);
    }
  });
});

describe('clampCropRect', () => {
  it('pulls an out-of-bounds rect back inside', () => {
    const rect = clampCropRect(
      { x: -50, y: -20, width: 400, height: 300 },
      BOUNDS
    );
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(insideBounds(rect)).toBe(true);
  });

  it('never lets the rect collapse below the minimum', () => {
    const rect = clampCropRect({ x: 10, y: 10, width: 1, height: 0 }, BOUNDS);
    expect(rect.width).toBeGreaterThanOrEqual(MIN_CROP_SIZE);
    expect(rect.height).toBeGreaterThanOrEqual(MIN_CROP_SIZE);
  });

  it('caps a rect larger than the image', () => {
    const rect = clampCropRect(
      { x: 0, y: 0, width: 9999, height: 9999 },
      BOUNDS
    );
    expect(rect.width).toBe(800);
    expect(rect.height).toBe(600);
  });
});

describe('moveCropRect', () => {
  it('translates without changing the size', () => {
    const rect = moveCropRect(
      { x: 100, y: 100, width: 200, height: 150 },
      40,
      -30,
      BOUNDS
    );
    expect(rect).toEqual({ x: 140, y: 70, width: 200, height: 150 });
  });

  it('stops at the edge instead of shrinking', () => {
    const rect = moveCropRect(
      { x: 700, y: 500, width: 200, height: 150 },
      500,
      500,
      BOUNDS
    );
    // 尺寸必须保持,只是贴到边上
    expect(rect.width).toBe(200);
    expect(rect.height).toBe(150);
    expect(rect.x + rect.width).toBe(800);
    expect(rect.y + rect.height).toBe(600);
  });
});

describe('resizeCropRect', () => {
  const base: CropRect = { x: 200, y: 150, width: 300, height: 200 };

  it('drags each edge in the expected direction', () => {
    expect(resizeCropRect(base, 'e', 50, 0, BOUNDS).width).toBe(350);
    expect(resizeCropRect(base, 's', 0, 50, BOUNDS).height).toBe(250);

    const west = resizeCropRect(base, 'w', -50, 0, BOUNDS);
    expect(west.x).toBe(150);
    expect(west.width).toBe(350);

    const north = resizeCropRect(base, 'n', 0, -50, BOUNDS);
    expect(north.y).toBe(100);
    expect(north.height).toBe(250);
  });

  it('keeps the opposite edge anchored', () => {
    const west = resizeCropRect(base, 'w', 40, 0, BOUNDS);
    // 拖左边时右边不该动
    expect(west.x + west.width).toBe(base.x + base.width);

    const north = resizeCropRect(base, 'n', 0, 40, BOUNDS);
    expect(north.y + north.height).toBe(base.y + base.height);
  });

  it('never inverts when dragged past the opposite edge', () => {
    for (const handle of [
      'nw',
      'n',
      'ne',
      'e',
      'se',
      's',
      'sw',
      'w',
    ] as const) {
      const rect = resizeCropRect(base, handle, -9999, -9999, BOUNDS);
      expect(rect.width).toBeGreaterThanOrEqual(MIN_CROP_SIZE);
      expect(rect.height).toBeGreaterThanOrEqual(MIN_CROP_SIZE);
      expect(insideBounds(rect)).toBe(true);
    }
  });

  it('stays inside the image for large drags in every direction', () => {
    const handles: CropHandle[] = [
      'nw',
      'n',
      'ne',
      'e',
      'se',
      's',
      'sw',
      'w',
      'move',
    ];
    for (const handle of handles) {
      for (const [dx, dy] of [
        [9999, 9999],
        [-9999, 9999],
        [9999, -9999],
        [-9999, -9999],
      ]) {
        const rect = resizeCropRect(base, handle, dx!, dy!, BOUNDS);
        expect(insideBounds(rect)).toBe(true);
      }
    }
  });

  it('holds the locked aspect on corner drags', () => {
    const rect = resizeCropRect(base, 'se', 120, 10, BOUNDS, 1);
    expect(aspectOf(rect)).toBeCloseTo(1, 1);
    expect(insideBounds(rect)).toBe(true);
  });

  it('holds the locked aspect on edge drags', () => {
    const east = resizeCropRect(base, 'e', 60, 0, BOUNDS, 16 / 9);
    expect(aspectOf(east)).toBeCloseTo(16 / 9, 1);

    const south = resizeCropRect(base, 's', 0, 60, BOUNDS, 16 / 9);
    expect(aspectOf(south)).toBeCloseTo(16 / 9, 1);
  });

  it('anchors the far corner when resizing with a locked aspect', () => {
    const rect = resizeCropRect(base, 'nw', -60, -60, BOUNDS, 1);
    // 拖左上角时右下角应保持不动
    expect(rect.x + rect.width).toBeCloseTo(base.x + base.width, 0);
    expect(rect.y + rect.height).toBeCloseTo(base.y + base.height, 0);
  });

  it('keeps the aspect even when the drag would leave the image', () => {
    const rect = resizeCropRect(
      { x: 0, y: 0, width: 200, height: 200 },
      'se',
      9999,
      9999,
      BOUNDS,
      1
    );
    expect(insideBounds(rect)).toBe(true);
    // 夹回图内后仍应接近正方形(受整数取整影响,允许 1px 误差)
    expect(Math.abs(rect.width - rect.height)).toBeLessThanOrEqual(1);
  });
});

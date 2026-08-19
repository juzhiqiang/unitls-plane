import { describe, expect, it } from 'vitest';
import { hexToRgb, cropToPresetBounds } from '../composite';

describe('composite', () => {
  it('hexToRgb parses #rrggbb to rgb triple', () => {
    expect(hexToRgb('#438edb')).toEqual({ r: 0x43, g: 0x8e, b: 0xdb });
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('hexToRgb throws on invalid hex', () => {
    expect(() => hexToRgb('red')).toThrow();
    expect(() => hexToRgb('#123')).toThrow();
  });

  it('cropToPresetBounds centers and fits preset aspect', () => {
    // 原图 1000x1500,目标一寸 295x413,按 contain 居中裁剪
    const bounds = cropToPresetBounds(1000, 1500, 295, 413);
    expect(bounds.width).toBeGreaterThanOrEqual(295);
    expect(bounds.height).toBeGreaterThanOrEqual(413);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(500, -1);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(750, -1);
  });
});

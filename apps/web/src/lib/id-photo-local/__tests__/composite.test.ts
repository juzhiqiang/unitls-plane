import { describe, expect, it } from 'vitest';
import { hexToRgb, cropToPresetBounds, solidifyAlpha } from '../composite';

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

  describe('solidifyAlpha', () => {
    // 构造 RGBA 像素序列,只关心 alpha 通道
    const withAlphas = (alphas: number[]) => {
      const d = new Uint8ClampedArray(alphas.length * 4);
      alphas.forEach((a, i) => {
        d[i * 4] = 10;
        d[i * 4 + 1] = 20;
        d[i * 4 + 2] = 30;
        d[i * 4 + 3] = a;
      });
      return d;
    };
    const alphasOf = (d: Uint8ClampedArray) =>
      Array.from({ length: d.length / 4 }, (_, i) => d[i * 4 + 3]!);

    it('把主体内部的偏软 alpha 推到全不透明', () => {
      // 实测样张里帽子实体 alpha 中位数 232 → 底色透过来导致染色
      const d = withAlphas([232, 240, 255]);
      solidifyAlpha(d);
      expect(alphasOf(d)).toEqual([255, 255, 255]);
    });

    it('把携带背景色的低 alpha 边缘推到全透明', () => {
      const d = withAlphas([0, 20, 60]);
      solidifyAlpha(d);
      expect(alphasOf(d)).toEqual([0, 0, 0]);
    });

    it('过渡带保留中间值以做抗锯齿(不是二值化)', () => {
      // lo=0.40(102) 与 hi=0.75(191) 的中点应落在中间区间
      const d = withAlphas([146]);
      solidifyAlpha(d);
      const a = alphasOf(d)[0]!;
      expect(a).toBeGreaterThan(60);
      expect(a).toBeLessThan(195);
    });

    it('单调不减:更高的输入 alpha 不会得到更低的输出', () => {
      const input = [0, 40, 80, 120, 160, 200, 240, 255];
      const d = withAlphas(input);
      solidifyAlpha(d);
      const out = alphasOf(d);
      for (let i = 1; i < out.length; i++) {
        expect(out[i]!).toBeGreaterThanOrEqual(out[i - 1]!);
      }
    });

    it('不改动 RGB 通道', () => {
      const d = withAlphas([128]);
      solidifyAlpha(d);
      expect([d[0], d[1], d[2]]).toEqual([10, 20, 30]);
    });
  });
});

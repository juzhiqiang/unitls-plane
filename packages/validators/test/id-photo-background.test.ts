import { describe, expect, it } from 'bun:test';
import { estimateSourceBackgroundColors } from '../src/id-photo-background';

function makeImage(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number]
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 3;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
    }
  }
  return out;
}

describe('estimateSourceBackgroundColors', () => {
  it('only samples the top edge and upper side edges, not the lower area', () => {
    // 构造：200x260，upper = round(260 * 0.28) = 73 行，侧边采样只覆盖 y < 73。
    // 上 80 行纯蓝 [67,142,219]；其余 180 行是浅蓝 [110,170,230]，占 69% 面积。
    // 浅蓝与锚点（上边缘蓝色）距离约 52，小于 ANCHOR_RADIUS=80，因此不会被锚点过滤掉。
    // 如果错误地整图采样，浅蓝会以 69% 的占比排到首位或出现在候选里；
    // 正确实现只采样上边缘和上 28% 的左右边（全部落在前 80 行内），只能看到蓝色。
    const rgb = makeImage(200, 260, (_x, y) =>
      y < 80 ? [67, 142, 219] : [110, 170, 230]
    );
    const colors = estimateSourceBackgroundColors(rgb, 200, 260);
    expect(colors.length).toBeGreaterThanOrEqual(1);
    // 量化后蓝色为 [64,144,224]，与原始色各通道相差不超过 5，收紧到 ±8。
    expect(Math.abs(colors[0]!.r - 67)).toBeLessThanOrEqual(8);
    expect(Math.abs(colors[0]!.g - 142)).toBeLessThanOrEqual(8);
    expect(Math.abs(colors[0]!.b - 219)).toBeLessThanOrEqual(8);
    // 距离 < 30 视为存在浅蓝候选；正确实现不应包含它。
    expect(
      colors.some(c => Math.hypot(c.r - 110, c.g - 170, c.b - 230) < 30)
    ).toBe(false);
  });

  it('orders candidates by frequency descending', () => {
    const a: [number, number, number] = [80, 120, 160];
    const b: [number, number, number] = [120, 160, 200];
    // 上边缘 70% 是 A、30% 是 B。A/B 原始距离约 69，量化后约 75，均 > DEDUPE_RADIUS=24，
    // 两个桶不会被合并；锚点取左右顶角 patch 的中位数，落在两者中点，A/B 距锚点分别约
    // 31 和 44，都在 ANCHOR_RADIUS=80 内。整幅图按列重复两色，保持上边缘 70/30 的比例，
    // 侧边采样同样只落到 A/B，A 的频次稳定更高，因此 colors[0] 必须是 A。
    const rgb = makeImage(200, 260, x => (x < 140 ? a : b));
    const colors = estimateSourceBackgroundColors(rgb, 200, 260);
    expect(colors.length).toBeGreaterThanOrEqual(2);
    // 量化后 A ≈ [80,128,160]，B ≈ [128,160,208]。
    expect(
      Math.hypot(colors[0]!.r - 80, colors[0]!.g - 128, colors[0]!.b - 160)
    ).toBeLessThan(30);
    expect(
      Math.hypot(colors[1]!.r - 128, colors[1]!.g - 160, colors[1]!.b - 208)
    ).toBeLessThan(30);
  });

  it('returns at most four candidates', () => {
    const rgb = makeImage(200, 260, (x, y) => [
      (x * 7) % 256,
      (y * 11) % 256,
      ((x + y) * 5) % 256,
    ]);
    const colors = estimateSourceBackgroundColors(rgb, 200, 260);
    expect(colors.length).toBeLessThanOrEqual(4);
    expect(colors.length).toBeGreaterThanOrEqual(1);
  });

  it('handles a tiny image without throwing', () => {
    const rgb = makeImage(2, 2, () => [10, 20, 30]);
    const colors = estimateSourceBackgroundColors(rgb, 2, 2);
    expect(colors.length).toBeGreaterThanOrEqual(1);
  });
});

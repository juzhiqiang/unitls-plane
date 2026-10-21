/**
 * 原图底色估计。
 *
 * 对应参考实现 engine.py:_background_colors —— 只用图像上边缘与上 28% 的左右边缘：
 * 证件照人像的头顶通常不超出画面上部，上边缘几乎必然是纯背景，而底部可能是衣服。
 *
 * 为什么不用「四角均值」：四角里下两角经常落在肩膀/衣服上，均值会被前景污染，
 * 去污染时底色估计错一点，边缘就会留下整圈原背景色。
 *
 * 纯函数，不依赖 sharp / DOM。
 */

export interface BackgroundCandidate {
  r: number;
  g: number;
  b: number;
}

const QUANT_STEP = 16;
const ANCHOR_RADIUS = 80;
const DEDUPE_RADIUS = 24;
const MAX_CANDIDATES = 4;

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, value));
}

/**
 * 量化到 16 步。四舍五入可能得到 256，必须夹到 255，
 * 否则候选底色会超出 RGB 合法范围。
 */
function quantize(value: number): number {
  return clampChannel(Math.round(value / QUANT_STEP) * QUANT_STEP);
}

function readPixel(
  rgb: Uint8ClampedArray | Uint8Array,
  index: number
): [number, number, number] {
  const p = index * 3;
  return [rgb[p] ?? 0, rgb[p + 1] ?? 0, rgb[p + 2] ?? 0];
}

export function estimateSourceBackgroundColors(
  rgb: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): BackgroundCandidate[] {
  if (width <= 0 || height <= 0) return [{ r: 0, g: 0, b: 0 }];

  const step = Math.max(1, Math.floor(Math.min(width, height) / 80));
  const upper = Math.max(1, Math.round(height * 0.28));

  // 1) 采样：上边全宽 + 上 28% 的左右两条边
  const samples: [number, number, number][] = [];
  for (let x = 0; x < width; x += step) samples.push(readPixel(rgb, x));
  // 侧边从 y = step 开始，避免与上边缘采样在 x=0 / x=width-1 两个顶角重复计数。
  for (let y = step; y < upper; y += step) {
    samples.push(readPixel(rgb, y * width));
    samples.push(readPixel(rgb, y * width + width - 1));
  }
  if (!samples.length) samples.push(readPixel(rgb, 0));

  // 2) 锚点：取上边缘两端 patch 的中位数，把采样里与锚点差太远的丢掉
  //    （多色/复杂背景时这是主要的抑制手段）
  const patch = Math.max(2, Math.floor(Math.min(width, height) / 30));
  const anchors: [number, number, number][] = [];
  for (let y = 0; y < Math.min(patch, height); y += 1) {
    for (let x = 0; x < Math.min(patch, width); x += 1) {
      anchors.push(readPixel(rgb, y * width + x));
      anchors.push(readPixel(rgb, y * width + width - 1 - x));
    }
  }
  const median = (channel: 0 | 1 | 2) => {
    if (!anchors.length) return 0;
    const values = anchors.map(v => v[channel]).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    // 偶数个样本时取中间两个的均值；只取上中位数会整体偏移，
    // 单通道偏移叠加后锚点可能是画面上根本不存在的颜色。
    return values.length % 2 === 1
      ? (values[mid] ?? 0)
      : Math.round(((values[mid - 1] ?? 0) + (values[mid] ?? 0)) / 2);
  };
  const anchor: BackgroundCandidate = {
    r: median(0),
    g: median(1),
    b: median(2),
  };

  const near = samples.filter(s => {
    const dr = s[0] - anchor.r;
    const dg = s[1] - anchor.g;
    const db = s[2] - anchor.b;
    return Math.sqrt(dr * dr + dg * dg + db * db) <= ANCHOR_RADIUS;
  });
  const pool = near.length ? near : samples;

  // 3) 量化到 16 步后再聚类：确定性、无需引入 k-means
  const buckets = new Map<
    string,
    { color: BackgroundCandidate; count: number }
  >();
  for (const s of pool) {
    const color = { r: quantize(s[0]), g: quantize(s[1]), b: quantize(s[2]) };
    const key = `${color.r},${color.g},${color.b}`;
    const existing = buckets.get(key);
    if (existing) existing.count += 1;
    else buckets.set(key, { color, count: 1 });
  }

  // 4) 按频次降序，过滤远离锚点的桶，再按相互距离去重
  const ordered = [...buckets.values()].sort((a, b) => b.count - a.count);
  const selected: BackgroundCandidate[] = [];
  for (const entry of ordered) {
    const dr = entry.color.r - anchor.r;
    const dg = entry.color.g - anchor.g;
    const db = entry.color.b - anchor.b;
    if (Math.sqrt(dr * dr + dg * dg + db * db) > ANCHOR_RADIUS) continue;

    const tooClose = selected.some(
      s =>
        Math.hypot(
          s.r - entry.color.r,
          s.g - entry.color.g,
          s.b - entry.color.b
        ) < DEDUPE_RADIUS
    );
    if (tooClose) continue;

    selected.push(entry.color);
    if (selected.length === MAX_CANDIDATES) break;
  }

  if (selected.length) return selected;

  // 兜底：理论上 samples 至少含一个像素，仍显式防备空集导致的除零。
  if (!pool.length) return [anchor];

  const mean = pool.reduce(
    (acc, s) => {
      acc.r += s[0];
      acc.g += s[1];
      acc.b += s[2];
      return acc;
    },
    { r: 0, g: 0, b: 0 }
  );
  return [
    {
      r: Math.round(mean.r / pool.length),
      g: Math.round(mean.g / pool.length),
      b: Math.round(mean.b / pool.length),
    },
  ];
}

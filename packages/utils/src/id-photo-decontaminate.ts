/**
 * 证件照前景去污染（边缘去底色 / 去光晕 / 溢色替换）。
 *
 * 算法对应参考实现 id_photo_bg_changer 的 engine.py:render_cutout：
 *   1. 反预乘去底色   c' = (c - bg * (1 - a)) / a
 *   2. 内边缘 alpha 压制（按与底色的颜色距离）
 *   3. 溢色替换（用最近不透明前景像素的 RGB 替换边缘染色）
 *
 * 浏览器端与 Node 端共用：只接受 Uint8ClampedArray / Uint8Array 与普通对象，
 * 不 import sharp、node:*、DOM API。
 *
 * 不实现 GrabCut：photographic/RMBG 的 alpha 已足够干净，GrabCut 的收益递减
 * 而浏览器纯 JS 实现成本过高（见 spec「已确认决策」）。
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const INF = 1e20;

/**
 * 两遍扫描的近似欧氏距离变换（Felzenszwalb 简化版），O(w*h)。
 *
 * `fg[i] !== 0` 视为前景。返回每个像素到最近前景像素的欧氏距离，
 * 以及该最近前景像素的下标（用于溢色替换时取"源色"）。
 *
 * 前景像素自身 distance = 0、label = 自己。
 * 整图无前景时 distance 全为 INF、label 全为 -1。
 */
export function approximateDistanceTransform(
  fg: Uint8Array,
  width: number,
  height: number
): { distance: Float32Array; label: Int32Array } {
  const size = width * height;
  const distance = new Float32Array(size);
  const label = new Int32Array(size);

  for (let i = 0; i < size; i += 1) {
    if (fg[i]) {
      distance[i] = 0;
      label[i] = i;
    } else {
      distance[i] = INF;
      label[i] = -1;
    }
  }

  // 四邻域松弛，两个方向各扫一遍。对 ±1 步长的格点足够精确到
  // 亚像素级误差（实测与暴力最近邻偏差 < 1.5px），且是 O(n) 的。
  const relax = (i: number, j: number) => {
    const dj = distance[j]! + 1;
    if (dj < distance[i]!) {
      distance[i] = dj;
      label[i] = label[j]!;
    }
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (x > 0) relax(i, i - 1);
      if (y > 0) relax(i, i - width);
      if (x > 0 && y > 0) {
        const dj = distance[i - width - 1]! + Math.SQRT2;
        if (dj < distance[i]!) {
          distance[i] = dj;
          label[i] = label[i - width - 1]!;
        }
      }
      if (x < width - 1 && y > 0) {
        const dj = distance[i - width + 1]! + Math.SQRT2;
        if (dj < distance[i]!) {
          distance[i] = dj;
          label[i] = label[i - width + 1]!;
        }
      }
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      if (x < width - 1) relax(i, i + 1);
      if (y < height - 1) relax(i, i + width);
      if (x < width - 1 && y < height - 1) {
        const dj = distance[i + width + 1]! + Math.SQRT2;
        if (dj < distance[i]!) {
          distance[i] = dj;
          label[i] = label[i + width + 1]!;
        }
      }
      if (x > 0 && y < height - 1) {
        const dj = distance[i + width - 1]! + Math.SQRT2;
        if (dj < distance[i]!) {
          distance[i] = dj;
          label[i] = label[i + width - 1]!;
        }
      }
    }
  }

  return { distance, label };
}

function colorDistance(rgb: Uint8ClampedArray, index: number, bg: Rgb): number {
  const p = index * 4;
  const dr = (rgb[p] ?? 0) - bg.r;
  const dg = (rgb[p + 1] ?? 0) - bg.g;
  const db = (rgb[p + 2] ?? 0) - bg.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 对 RGBA 抠图做边缘去污染。
 *
 * 返回新数组（不修改入参），调用方自行 putImageData / 拼接。
 *
 * 参数：
 * - `alphaFloor`：反预乘时的 alpha 下限，默认 0.15。低于它的像素视为几乎全透明，
 *   直接跳过而不是把噪声放大 6 倍。
 * - `spillStrength`：溢色替换的最大强度，默认 0.85。
 */
export function decontaminateIdPhotoForeground(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  background: Rgb,
  options: { alphaFloor?: number; spillStrength?: number } = {}
): Uint8ClampedArray {
  const alphaFloor = options.alphaFloor ?? 0.15;
  const maxSpill = options.spillStrength ?? 0.85;
  const size = width * height;
  const out = new Uint8ClampedArray(rgba);

  const opaque = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    if ((out[i * 4 + 3] ?? 0) >= 250) opaque[i] = 1;
  }
  const { distance, label } = approximateDistanceTransform(
    opaque,
    width,
    height
  );

  for (let i = 0; i < size; i += 1) {
    const a = (out[i * 4 + 3] ?? 0) / 255;
    if (a <= 0.02) continue;

    const p = i * 4;

    // 1) 反预乘去底色：把「前景 × a + 背景 × (1-a)」还原成真实前景。
    if (a < 0.98 && a >= alphaFloor) {
      for (let c = 0; c < 3; c += 1) {
        const bg =
          c === 0 ? background.r : c === 1 ? background.g : background.b;
        const recovered = ((out[p + c] ?? 0) - bg * (1 - a)) / a;
        out[p + c] = Math.max(0, Math.min(255, recovered));
      }
    }

    // 2) 内边缘 alpha 压制：贴近轮廓且颜色仍像底色的半透明像素，其 alpha 是
    //    被底色"撑起来"的，压暗它来削光晕。距离 <= 3.5px 才算内边缘。
    if (a > 0.02 && a < 0.98 && distance[i]! <= 3.5) {
      const confidence = Math.max(
        0,
        Math.min(1, (colorDistance(out, i, background) - 8) / 72)
      );
      out[p + 3] = Math.max(0, Math.min(255, (out[p + 3] ?? 0) * confidence));
    }

    // 3) 溢色替换：边缘像素的 RGB 被原底色污染，用最近不透明前景像素的 RGB
    //    按颜色置信度混合替换，保留真实纹理同时去掉染色。
    if (a > 0.02 && a < 0.98) {
      const src = label[i]!;
      if (src >= 0 && src !== i) {
        const sp = src * 4;
        const colorConfidence = Math.max(
          0,
          Math.min(1, (colorDistance(out, i, background) - 10) / 95)
        );
        const spill = Math.min(
          maxSpill,
          Math.max(0, (1 - a) * 0.7 + (1 - colorConfidence) * 0.3)
        );
        for (let c = 0; c < 3; c += 1) {
          const own = out[p + c] ?? 0;
          const neighbor = out[sp + c] ?? own;
          out[p + c] = own * (1 - spill) + neighbor * spill;
        }
      }
    }
  }

  return out;
}

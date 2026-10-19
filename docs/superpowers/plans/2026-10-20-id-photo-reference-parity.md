# 证件照参考对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把证件照生成的 7 个效果缺口(分割模型、人脸自动构图、边缘去污染、亮度/旋转校正、质量检查面板、构图辅助线、输出质量与 DPI)在本地路与服务端路同时补齐,对齐参考实现 `id_photo_bg_changer` 的生成质量。

**Architecture:** 算法层一律下沉到共享包(`packages/validators` 放几何与判定纯函数,`packages/utils` 放像素级算法),两端只保留「模型加载 + 数据搬运」。本地路用 `onnxruntime-web`,服务端用 `onnxruntime-node`,共用同一份 YuNet 与 MODNet photographic 权重。

**Tech Stack:** TypeScript、Next.js 14、React 18、NestJS、BullMQ、vitest(web)、bun test(api/validators)、sharp、onnxruntime-web、onnxruntime-node、@huggingface/transformers 3.5.1

## Global Constraints

- 证件照规格单一事实源是 `packages/validators/src/id-photo.ts` 的 `idPhotoPresetSpecs`:一寸 `295×413`、二寸 `413×626`、小一寸 `260×378`、护照照 `413×531`,全部 `dpi: 300`。
- 裁剪几何单一事实源是 `resolveIdPhotoCropBox` / `clampIdPhotoCrop` / `idPhotoCropFromBox`,本地 canvas 与服务端 sharp **必须**调用同一个函数,不得各写一份。
- 默认背景色 蓝 `#438edb`、白 `#ffffff`、红 `#d82727`。
- 模型许可:MODNet(Apache-2.0)、YuNet(MIT)可自由分发;RMBG-1.4 是 BRIA 专有许可,仅作本地路回落保留,不得作为默认档。
- 模型资产不进 Git,落 `docker/models/`(已 gitignore),由 `scripts/` 下载、`sync-id-photo-models.ts` 同步到 MinIO `models` 桶(匿名只读)。
- 新增共享纯函数**不得** import `sharp`、`node:*`、DOM API —— 只收 `Uint8ClampedArray` / `Buffer` / 普通对象。
- 所有新增 UI 文案必须同时写 `apps/web/messages/zh.json` 与 `apps/web/messages/en.json`。
- 测试命令:`packages/*` 与 `apps/api` 用 `bun test`;`apps/web` 用 `bun run --cwd apps/web test`。

---

## File Structure

**新增(共享纯函数)**
- `packages/validators/src/id-photo-layout.ts` —— 人脸自动构图
- `packages/validators/src/id-photo-quality.ts` —— 8 项质量检查
- `packages/validators/src/id-photo-background.ts` —— 底色聚类
- `packages/utils/src/id-photo-decontaminate.ts` —— 反预乘 + 距离场溢色替换
- `packages/utils/src/id-photo-face-tensor.ts` —— YuNet 张量解析

**新增(本地路)**
- `apps/web/src/lib/id-photo-local/face-detection.ts`
- `apps/web/src/lib/id-photo-local/dpi-metadata.ts`
- `apps/web/src/components/tools/id-photo-quality-panel.tsx`

**新增(服务端)**
- `apps/api/src/modules/tasks/services/face-detection.service.ts`

**修改(本地路)**
- `apps/web/src/lib/id-photo-local/model-registry.ts`
- `apps/web/src/lib/id-photo-local/segmentation.ts`
- `apps/web/src/lib/id-photo-local/composite.ts`
- `apps/web/src/lib/id-photo-local/use-local-id-photo.ts`
- `apps/web/src/components/tools/id-photo-options.tsx`
- `apps/web/src/components/tools/image-crop-field.tsx`
- `apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`
- `apps/web/messages/zh.json`、`apps/web/messages/en.json`

**修改(服务端)**
- `apps/api/src/modules/tasks/services/portrait-segmentation.service.ts`
- `apps/api/src/modules/tasks/services/id-photo.service.ts`
- `apps/api/src/modules/tasks/tasks.module.ts`

**修改(资产与文档)**
- `scripts/download-rmbg-assets.cjs`、`scripts/prepare-id-photo-models.sh`
- `apps/api/src/scripts/sync-id-photo-models.ts`
- `docs/id-photo-models.md`

---

## 任务依赖关系

```
Task 1 (photographic 实测)
  └─> 决定 Task 6 / Task 8 的档位策略

Task 2 (utils: 距离场+去污染)  ─┐
Task 3 (validators: 底色聚类) ─┤
Task 4 (validators: 自动构图) ─┼─> Task 8 (服务端) ─> Task 12 (端到端)
Task 5 (validators: 质量检查) ─┤      Task 9 (本地路推理)
Task 6 (utils: 人脸张量)     ─┤      Task 10 (本地路合成+DPI)
Task 7 (模型资产)            ─┘      Task 11 (UI)
```

Task 2–7 互相独立，可并行。

---

### Task 1: MODNet photographic 破洞实测

**Files:**
- Create: `scripts/evaluate-photographic-matte.cjs`
- Create: `docs/id-photo-model-comparison.md`

**Interfaces:**
- Produces: 一份实测结论，决定 Task 6 与 Task 8 的默认档位。若 photographic 在项目样张上复现「衣服破洞」，则 Task 6 的 `segmentToCutout` 需保留 RMBG 回落分支与高精度开关；否则 photographic 作为唯一默认档，`highPrecision` 开关保留但映射到 fp32 与否由结论决定。

- [ ] **Step 1: 写评测脚本骨架**

```js
// scripts/evaluate-photographic-matte.cjs
// 对同一张样张分别跑 MODNet photographic 与 RMBG-1.4，输出量化对比。
// 用法: node scripts/evaluate-photographic-matte.cjs <样张.jpg>
const path = require('path');
const ort = require('onnxruntime-node');
const sharp = require('sharp');

const MODNET_INPUT = 512;

async function runModnet(modelPath, inputPath) {
  const { data, info } = await sharp(inputPath)
    .resize(MODNET_INPUT, MODNET_INPUT, { fit: 'contain', background: '#000000' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const tensor = new Float32Array(3 * MODNET_INPUT * MODNET_INPUT);
  for (let i = 0; i < MODNET_INPUT * MODNET_INPUT; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      tensor[c * MODNET_INPUT * MODNET_INPUT + i] =
        ((data[i * 3 + c] ?? 0) / 255 - 0.5) / 0.5;
    }
  }

  const session = await ort.InferenceSession.create(modelPath);
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const result = await session.run({
    [inputName]: new ort.Tensor('float32', tensor, [1, 3, MODNET_INPUT, MODNET_INPUT]),
  });
  return result[outputName].data;
}

function summarize(alpha) {
  const sorted = Array.from(alpha).sort((a, b) => a - b);
  const q = p => sorted[Math.floor(sorted.length * p)] ?? 0;
  const semi = Array.from(alpha).filter(v => v > 0.02 && v < 0.98).length;
  return {
    p05: q(0.05).toFixed(3),
    p50: q(0.5).toFixed(3),
    semiRatio: ((semi / alpha.length) * 100).toFixed(2) + '%',
  };
}

(async () => {
  const sample = process.argv[2];
  if (!sample) {
    console.error('usage: node evaluate-photographic-matte.cjs <sample.jpg>');
    process.exit(1);
  }
  const photographic = await runModnet(
    path.resolve(__dirname, '../docker/models/modnet/modnet_photographic.onnx'),
    sample
  );
  console.log('photographic:', summarize(photographic));
})();
```

- [ ] **Step 2: 把 photographic 权重放到 docker/models 下**

从参考仓库复制(该仓库已内置该模型,Apache-2.0):

```bash
mkdir -p docker/models/modnet
cp /tmp/id_photo_ref/pictone/models/modnet_photographic.onnx docker/models/modnet/
ls -lh docker/models/modnet/
```

预期:`modnet_photographic.onnx` 约 25MB。

- [ ] **Step 3: 用项目样张跑评测**

取项目的「黑帽子 + 暗背景」样张(若无，用参考仓库的 `图片.jpg` 作为等价低对比样本):

```bash
node scripts/evaluate-photographic-matte.cjs /tmp/id_photo_ref/图片.jpg
```

- [ ] **Step 4: 记录结论**

在 `docs/id-photo-model-comparison.md` 写下:

```markdown
# 证件照分割模型实测对比

样张:`图片.jpg`(黑帽子 + 暗背景,低对比)

| 指标 | photographic (512 contain) | RMBG-1.4 fp16 (1024) | 通用 MODNet (256 fill) |
| --- | --- | --- | --- |
| alpha p05 | (填实测) | — | — |
| alpha p50 | (填实测) | — | — |
| 半透明像素占比 | (填实测) | 0.63% | — |
| 衣服是否破洞 | (填实测:是/否) | 否 | 是 |
| 帽子是否实心 | (填实测) | 是 | — |

## 结论

- 若「衣服是否破洞 = 否」:photographic 作为两端唯一默认档,RMBG-1.4 仅保留为紧急回落。
- 若「衣服是否破洞 = 是」:本地路默认 photographic，`highPrecision` 开关切 RMBG-1.4 fp32(需 WebGPU);服务端仍用 photographic，另在 `segment()` 里对破洞区域做 alpha 填充后处理。
```

- [ ] **Step 5: 提交**

```bash
git add scripts/evaluate-photographic-matte.cjs docs/id-photo-model-comparison.md
git commit -m "chore(id-photo): 增加 photographic 与 RMBG 的抠图质量实测脚本"
```

---

### Task 2: 近似欧氏距离变换 + 边缘去污染

**Files:**
- Create: `packages/utils/src/id-photo-decontaminate.ts`
- Test: `packages/utils/test/id-photo-decontaminate.test.ts`

**Interfaces:**
- Produces:
  - `export interface Rgb { r: number; g: number; b: number }`
  - `export function approximateDistanceTransform(fg: Uint8Array, width: number, height: number): { distance: Float32Array; label: Int32Array }` —— `distance[i]` 为像素到最近前景像素的欧氏距离(前景自身为 0),`label[i]` 为最近前景像素下标。
  - `export function decontaminateIdPhotoForeground(rgba: Uint8ClampedArray, width: number, height: number, background: Rgb, options?: { alphaFloor?: number; spillStrength?: number }): Uint8ClampedArray` —— 返回新的 RGBA 数组，就地修改 alpha 与边缘 RGB。

- [ ] **Step 1: 写距离变换的失败测试**

```ts
// packages/utils/test/id-photo-decontaminate.test.ts
import { describe, expect, it } from 'bun:test';
import {
  approximateDistanceTransform,
  decontaminateIdPhotoForeground,
} from '../src/id-photo-decontaminate';

function bruteForceDistance(fg: Uint8Array, width: number, height: number) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let best = Infinity;
      for (let j = 0; j < height; j += 1) {
        for (let i = 0; i < width; i += 1) {
          if (!fg[j * width + i]) continue;
          const d = Math.hypot(x - i, y - j);
          if (d < best) best = d;
        }
      }
      out[y * width + x] = best;
    }
  }
  return out;
}

describe('approximateDistanceTransform', () => {
  it('matches brute-force nearest-foreground distance on a tiny image', () => {
    const width = 8;
    const height = 8;
    const fg = new Uint8Array(width * height);
    fg[1 * width + 1] = 1;
    fg[5 * width + 6] = 1;

    const { distance } = approximateDistanceTransform(fg, width, height);
    const expected = bruteForceDistance(fg, width, height);

    for (let i = 0; i < distance.length; i += 1) {
      expect(Math.abs(distance[i]! - expected[i]!)).toBeLessThan(1.5);
    }
  });

  it('labels every pixel with a foreground index', () => {
    const width = 4;
    const height = 4;
    const fg = new Uint8Array(width * height);
    fg[0] = 1;

    const { label } = approximateDistanceTransform(fg, width, height);
    for (let i = 0; i < label.length; i += 1) {
      expect(label[i]).toBe(0);
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd packages/utils && bun test test/id-photo-decontaminate.test.ts
```

预期:FAIL,`Cannot find module '../src/id-photo-decontaminate'`。

- [ ] **Step 3: 实现距离变换**

```ts
// packages/utils/src/id-photo-decontaminate.ts
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

  for (let i = 0; i < size; i += 1) {
    if (distance[i]! >= INF) distance[i] = 0;
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
        const bg = c === 0 ? background.r : c === 1 ? background.g : background.b;
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
```

- [ ] **Step 4: 补充去污染的失败测试**

追加到同一测试文件:

```ts
describe('decontaminateIdPhotoForeground', () => {
  it('recovers true foreground color from a 50% alpha blue-background pixel', () => {
    // 真实前景是纯白 (255,255,255)，叠在蓝底 (67,142,219) 上取 alpha=0.5
    const bg = { r: 67, g: 142, b: 219 };
    const alpha = 0.5;
    const observed = {
      r: Math.round(255 * alpha + bg.r * (1 - alpha)),
      g: Math.round(255 * alpha + bg.g * (1 - alpha)),
      b: Math.round(255 * alpha + bg.b * (1 - alpha)),
    };

    const width = 3;
    const height = 1;
    const rgba = new Uint8ClampedArray(width * height * 4);
    // 中心是半透明边缘像素，左右是完全不透明的白色前景
    for (const i of [0, 2]) {
      rgba[i * 4] = 255;
      rgba[i * 4 + 1] = 255;
      rgba[i * 4 + 2] = 255;
      rgba[i * 4 + 3] = 255;
    }
    rgba[1 * 4] = observed.r;
    rgba[1 * 4 + 1] = observed.g;
    rgba[1 * 4 + 2] = observed.b;
    rgba[1 * 4 + 3] = Math.round(alpha * 255);

    const out = decontaminateIdPhotoForeground(rgba, width, height, bg);

    // 反预乘后应显著远离底色，朝纯白靠拢
    expect(out[1 * 4]!).toBeGreaterThan(200);
    expect(out[1 * 4 + 1]!).toBeGreaterThan(200);
    expect(out[1 * 4 + 2]!).toBeGreaterThan(180);
  });

  it('leaves fully transparent and fully opaque pixels untouched in color', () => {
    const bg = { r: 0, g: 0, b: 0 };
    const rgba = new Uint8ClampedArray([
      10, 20, 30, 0, 200, 100, 50, 255,
    ]);
    const out = decontaminateIdPhotoForeground(rgba, 2, 1, bg);
    expect(Array.from(out.slice(0, 4))).toEqual([10, 20, 30, 0]);
    expect(Array.from(out.slice(4, 8))).toEqual([200, 100, 50, 255]);
  });
});
```

- [ ] **Step 5: 运行全部测试**

```bash
cd packages/utils && bun test test/id-photo-decontaminate.test.ts
```

预期:PASS,4 个用例全过。

- [ ] **Step 6: 从 index 导出**

```ts
// packages/utils/src/index.ts —— 追加一行
export * from './id-photo-decontaminate';
```

- [ ] **Step 7: 提交**

```bash
git add packages/utils/src/id-photo-decontaminate.ts packages/utils/test/id-photo-decontaminate.test.ts packages/utils/src/index.ts
git commit -m "feat(id-photo): 新增边缘去污染纯函数(距离场+反预乘+溢色替换)"
```

---

### Task 3: 底色聚类估计

**Files:**
- Create: `packages/validators/src/id-photo-background.ts`
- Test: `packages/validators/test/id-photo-background.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `export interface BackgroundCandidate { r: number; g: number; b: number }`
  - `export function estimateSourceBackgroundColors(rgb: Uint8ClampedArray | Uint8Array, width: number, height: number): BackgroundCandidate[]` —— 返回 1..4 个候选底色，按出现频次降序。

- [ ] **Step 1: 写失败测试**

```ts
// packages/validators/test/id-photo-background.test.ts
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
  it('returns the dominant solid background color', () => {
    const rgb = makeImage(200, 260, (x, y) =>
      y < 60 ? [67, 142, 219] : [200, 170, 150]
    );
    const colors = estimateSourceBackgroundColors(rgb, 200, 260);
    expect(colors.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(colors[0]!.r - 67)).toBeLessThan(20);
    expect(Math.abs(colors[0]!.g - 142)).toBeLessThan(20);
    expect(Math.abs(colors[0]!.b - 219)).toBeLessThan(20);
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
```

- [ ] **Step 2: 运行确认失败**

```bash
cd packages/validators && bun test test/id-photo-background.test.ts
```

预期:FAIL,module not found。

- [ ] **Step 3: 实现**

```ts
// packages/validators/src/id-photo-background.ts
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
  for (let y = 0; y < upper; y += step) {
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
    const values = anchors.map(v => v[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 0;
  };
  const anchor: BackgroundCandidate = {
    r: median(0),
    g: median(1),
    b: median(2),
  };

  const distToAnchor = (c: [number, number, number] | BackgroundCandidate) =>
    Math.hypot(c[0 as never] ?? (c as BackgroundCandidate).r - anchor.r, 0) || 0;

  const near = samples.filter(s => {
    const dr = s[0] - anchor.r;
    const dg = s[1] - anchor.g;
    const db = s[2] - anchor.b;
    return Math.sqrt(dr * dr + dg * dg + db * db) <= ANCHOR_RADIUS;
  });
  const pool = near.length ? near : samples;

  // 3) 量化到 16 步后再聚类：确定性、无需引入 k-means
  const buckets = new Map<string, { color: BackgroundCandidate; count: number }>();
  for (const s of pool) {
    const key = `${Math.round(s[0] / QUANT_STEP) * QUANT_STEP},${Math.round(
      s[1] / QUANT_STEP
    ) * QUANT_STEP},${Math.round(s[2] / QUANT_STEP) * QUANT_STEP}`;
    const existing = buckets.get(key);
    if (existing) existing.count += 1;
    else {
      buckets.set(key, {
        color: {
          r: Math.round(s[0] / QUANT_STEP) * QUANT_STEP,
          g: Math.round(s[1] / QUANT_STEP) * QUANT_STEP,
          b: Math.round(s[2] / QUANT_STEP) * QUANT_STEP,
        },
        count: 1,
      });
    }
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
        Math.hypot(s.r - entry.color.r, s.g - entry.color.g, s.b - entry.color.b) <
        DEDUPE_RADIUS
    );
    if (tooClose) continue;

    selected.push(entry.color);
    if (selected.length === MAX_CANDIDATES) break;
  }

  if (selected.length) return selected;

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
```

- [ ] **Step 4: 运行测试**

```bash
cd packages/validators && bun test test/id-photo-background.test.ts
```

预期:PASS。若第一个用例失败,检查 `upper` 采样是否覆盖了 `y < 60` 的背景带(应为 `0.28*260 ≈ 73 > 60`,覆盖成立)。

- [ ] **Step 5: 删除上面实现里的死代码 `distToAnchor`**

`distToAnchor` 是迭代时的残留,未被使用。删除它以及紧随其后的空行:

```ts
  const distToAnchor = (c: [number, number, number] | BackgroundCandidate) =>
    Math.hypot(c[0 as never] ?? (c as BackgroundCandidate).r - anchor.r, 0) || 0;

```

- [ ] **Step 6: 重新运行测试并 lint**

```bash
cd packages/validators && bun test test/id-photo-background.test.ts && bun run lint
```

预期:PASS,无 unused 警告。

- [ ] **Step 7: 导出并提交**

```ts
// packages/validators/src/index.ts —— 追加
export * from './id-photo-background';
```

```bash
git add packages/validators/src/id-photo-background.ts packages/validators/test/id-photo-background.test.ts packages/validators/src/index.ts
git commit -m "feat(id-photo): 新增底色聚类估计(上边缘采样+量化聚类)"
```

---

### Task 4: 人脸自动构图

**Files:**
- Create: `packages/validators/src/id-photo-layout.ts`
- Test: `packages/validators/test/id-photo-layout.test.ts`

**Interfaces:**
- Consumes: `IdPhotoCrop` from `./id-photo`
- Produces:
  - `export interface FaceBox { x: number; y: number; width: number; height: number }`
  - `export interface FaceDetection { box: FaceBox; landmarks: ReadonlyArray<readonly [number, number]>; score: number }`
  - `export interface IdPhotoLayout { zoom: number; offsetX: number; offsetY: number; rotation: number; faceRatio: number; headroom: number }`
  - `export function suggestIdPhotoLayout(face: FaceDetection | null, source: { width: number; height: number }, targetAspect: number, crownY?: number): IdPhotoLayout | null`
  - `export function idPhotoCropFromLayout(layout: IdPhotoLayout, source: { width: number; height: number }, targetAspect: number): IdPhotoCrop`
  - `export function eyeTiltDegrees(landmarks: ReadonlyArray<readonly [number, number]>): number`

- [ ] **Step 1: 写失败测试**

```ts
// packages/validators/test/id-photo-layout.test.ts
import { describe, expect, it } from 'bun:test';
import {
  eyeTiltDegrees,
  idPhotoCropFromLayout,
  suggestIdPhotoLayout,
  type FaceDetection,
} from '../src/id-photo-layout';
import { resolveIdPhotoCropBox } from '../src/id-photo';

function faceAt(
  x: number,
  y: number,
  size: number,
  tilt = 0
): FaceDetection {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const eyeY = cy + Math.tan((tilt * Math.PI) / 180) * (size * 0.2);
  return {
    box: { x, y, width: size, height: size },
    landmarks: [
      [cx - size * 0.2, eyeY],
      [cx + size * 0.2, eyeY],
      [cx, cy + size * 0.1],
      [cx - size * 0.1, cy + size * 0.25],
      [cx + size * 0.1, cy + size * 0.25],
    ],
    score: 0.95,
  };
}

describe('eyeTiltDegrees', () => {
  it('returns 0 for level eyes', () => {
    expect(Math.abs(eyeTiltDegrees([[0, 10], [20, 10]]))).toBeLessThan(0.001);
  });

  it('returns positive angle when right eye is lower', () => {
    expect(eyeTiltDegrees([[0, 0], [20, 5]])).toBeGreaterThan(13);
  });
});

describe('suggestIdPhotoLayout', () => {
  it('returns null without a face', () => {
    expect(
      suggestIdPhotoLayout(null, { width: 1000, height: 1400 }, 295 / 413)
    ).toBeNull();
  });

  it('zooms so the face occupies roughly 35% of the crop width', () => {
    const source = { width: 1200, height: 1600 };
    const face = faceAt(500, 400, 240);
    const layout = suggestIdPhotoLayout(face, source, 295 / 413);
    expect(layout).not.toBeNull();
    expect(layout!.faceRatio).toBeGreaterThan(0.28);
    expect(layout!.faceRatio).toBeLessThan(0.45);
  });

  it('keeps every output field inside the documented ranges', () => {
    const source = { width: 1200, height: 1600 };
    const layout = suggestIdPhotoLayout(
      faceAt(100, 100, 900, 8),
      source,
      295 / 413
    )!;
    expect(layout.zoom).toBeGreaterThanOrEqual(90);
    expect(layout.zoom).toBeLessThanOrEqual(145);
    expect(Math.abs(layout.offsetX)).toBeLessThanOrEqual(20);
    expect(Math.abs(layout.offsetY)).toBeLessThanOrEqual(20);
    expect(Math.abs(layout.rotation)).toBeLessThanOrEqual(5);
    expect(layout.headroom).toBeGreaterThanOrEqual(0);
  });

  it('prefers the segmentation crown over the face-box estimate', () => {
    const source = { width: 1200, height: 1600 };
    const face = faceAt(500, 400, 240);
    const withCrown = suggestIdPhotoLayout(face, source, 295 / 413, 200)!;
    const withoutCrown = suggestIdPhotoLayout(face, source, 295 / 413)!;
    expect(withCrown.headroom).toBeGreaterThan(withoutCrown.headroom);
  });

  it('ignores an implausible crown value', () => {
    const source = { width: 1200, height: 1600 };
    const face = faceAt(500, 400, 240);
    // 头顶落在人脸框下沿之后 —— 不可能，应被丢弃
    const bogus = suggestIdPhotoLayout(face, source, 295 / 413, 700)!;
    const none = suggestIdPhotoLayout(face, source, 295 / 413)!;
    expect(bogus.headroom).toBeCloseTo(none.headroom, 5);
  });

  it('does not rotate when the eye line is within 3 degrees', () => {
    const layout = suggestIdPhotoLayout(
      faceAt(500, 400, 240, 2),
      { width: 1200, height: 1600 },
      295 / 413
    )!;
    expect(layout.rotation).toBe(0);
  });
});

describe('idPhotoCropFromLayout', () => {
  it('produces a crop whose resolved box matches the layout zoom', () => {
    const source = { width: 1200, height: 1600 };
    const aspect = 295 / 413;
    const layout = suggestIdPhotoLayout(faceAt(500, 400, 240), source, aspect)!;
    const crop = idPhotoCropFromLayout(layout, source, aspect);

    expect(crop.scale).toBeGreaterThanOrEqual(1);
    expect(crop.scale).toBeLessThanOrEqual(3);
    expect(crop.x).toBeGreaterThan(0);
    expect(crop.x).toBeLessThan(1);
    expect(crop.y).toBeGreaterThan(0);
    expect(crop.y).toBeLessThan(1);

    const box = resolveIdPhotoCropBox(1200, 1600, 295, 413, crop);
    const baseWidth = Math.min(1200, 1600 * aspect);
    expect(Math.abs(box.width - baseWidth / crop.scale)).toBeLessThan(2);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd packages/validators && bun test test/id-photo-layout.test.ts
```

预期:FAIL,module not found。

- [ ] **Step 3: 实现**

```ts
// packages/validators/src/id-photo-layout.ts
/**
 * 人脸自动构图。
 *
 * 对应参考实现 face.py:suggest_layout —— 用 YuNet 的人脸框与 5 点关键点，
 * 算出「让这张脸在成片里占到标准比例」所需的缩放、偏移与旋转。
 *
 * 关键指标（证件照通用经验值，与参考实现一致）：
 * - 人脸宽度占成片 35%（质量检查的合格区间是 26%~42%）
 * - 头顶留白约为成片高度的 8%
 * - 眼线倾斜超过 3° 才旋转修正，且最多 ±5°（再多就该重拍了）
 *
 * 纯函数：不依赖 DOM、不依赖模型，输入是普通对象。
 */

import type { IdPhotoCrop } from './id-photo';

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceDetection {
  box: FaceBox;
  /** 5 点：左眼、右眼、鼻尖、左嘴角、右嘴角。 */
  landmarks: ReadonlyArray<readonly [number, number]>;
  score: number;
}

export interface IdPhotoLayout {
  /** 100 = 基准框不缩放；>100 放大画面（裁得更紧）。区间 [90, 145]。 */
  zoom: number;
  /** 裁剪框中心相对源图中心的归一化水平偏移，区间 [-20, 20]。 */
  offsetX: number;
  /** 同上，垂直方向。 */
  offsetY: number;
  /** 逆时针为正（与 PIL / canvas 一致），区间 [-5, 5]。 */
  rotation: number;
  /** 人脸宽度占裁剪框宽度的比例，用于质量面板与调试。 */
  faceRatio: number;
  /** 头顶留白占裁剪框高度的比例。 */
  headroom: number;
}

const DESIRED_FACE_RATIO = 0.35;
const TOP_MARGIN_RATIO = 0.08;
const MIN_ZOOM = 90;
const MAX_ZOOM = 145;
const MAX_OFFSET = 20;
const CROWN_FACE_GAP = 0.28;
const CROWN_PLAUSIBLE_SLACK = 0.12;
const ROTATION_THRESHOLD = 3;
const ROTATION_GAIN = 1.4;
const MAX_ROTATION = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 两眼连线相对水平线的夹角（度）。右眼低于左眼时为正。 */
export function eyeTiltDegrees(
  landmarks: ReadonlyArray<readonly [number, number]>
): number {
  const left = landmarks[0];
  const right = landmarks[1];
  if (!left || !right) return 0;
  return (Math.atan2(right[1] - left[1], right[0] - left[0]) * 180) / Math.PI;
}

/**
 * 给定人脸与源图尺寸，算出自动构图参数。
 *
 * `crownY` 是分割蒙版前景最高行的像素 y（真实头顶）。YuNet 的人脸框起点在发际线
 * 附近而不是头顶，所以有蒙版时优先用蒙版；蒙版给出的位置明显不合理（落在人脸框中
 * 下部之后）时退回估算。
 *
 * 无人脸时返回 null，调用方应保持原有的居中 crop。
 */
export function suggestIdPhotoLayout(
  face: FaceDetection | null,
  source: { width: number; height: number },
  targetAspect: number,
  crownY?: number
): IdPhotoLayout | null {
  if (!face || source.width <= 0 || source.height <= 0) return null;
  if (!(targetAspect > 0) || !Number.isFinite(targetAspect)) return null;

  const { width, height } = source;
  const { x, y, width: faceWidth, height: faceHeight } = face.box;
  if (faceWidth <= 0 || faceHeight <= 0) return null;

  // 基准框：源图内符合目标宽高比的最大框
  const sourceRatio = width / height;
  const baseCropWidth =
    sourceRatio >= targetAspect ? height * targetAspect : width;
  const baseCropHeight =
    sourceRatio >= targetAspect ? height : width / targetAspect;

  const zoom = Math.round(
    clamp(
      (DESIRED_FACE_RATIO * baseCropWidth) / faceWidth * 100,
      MIN_ZOOM,
      MAX_ZOOM
    )
  );
  const zoomRatio = zoom / 100;
  const cropWidth = baseCropWidth / zoomRatio;
  const cropHeight = baseCropHeight / zoomRatio;

  // 水平：让人脸中心对齐裁剪框中心
  const faceCenterX = x + faceWidth / 2;
  const desiredLeft = faceCenterX - cropWidth / 2;
  const left =
    zoomRatio < 1
      ? desiredLeft
      : clamp(desiredLeft, 0, Math.max(0, width - cropWidth));

  // 垂直：头顶留出 8% 的空白
  let crown = Math.max(0, y - faceHeight * CROWN_FACE_GAP);
  if (typeof crownY === 'number' && Number.isFinite(crownY)) {
    const plausibleLimit = y + faceHeight * CROWN_PLAUSIBLE_SLACK;
    if (crownY <= plausibleLimit) crown = Math.max(0, crownY);
  }
  const desiredTop = crown - cropHeight * TOP_MARGIN_RATIO;
  // zoom < 100 时源图比裁剪框小，顶部无法再往前留白，固定贴底
  const top =
    zoomRatio < 1
      ? height - cropHeight
      : clamp(desiredTop, 0, Math.max(0, height - cropHeight));

  const offsetX = Math.round(
    clamp(
      ((left + cropWidth / 2 - width / 2) / Math.max(1, width)) * 100,
      -MAX_OFFSET,
      MAX_OFFSET
    )
  );
  const offsetY =
    zoomRatio < 1
      ? 0
      : Math.round(
          clamp(
            ((top + cropHeight / 2 - height / 2) / Math.max(1, height)) * 100,
            -MAX_OFFSET,
            MAX_OFFSET
          )
        );

  const tilt = eyeTiltDegrees(face.landmarks);
  const rotation =
    Math.abs(tilt) < ROTATION_THRESHOLD
      ? 0
      : clamp(tilt * ROTATION_GAIN, -MAX_ROTATION, MAX_ROTATION);

  return {
    zoom,
    offsetX,
    offsetY,
    rotation,
    faceRatio: faceWidth / Math.max(1, cropWidth),
    headroom: (crown - top) / Math.max(1, cropHeight),
  };
}

/**
 * 把自动构图结果换算成服务端契约的 `IdPhotoCrop`。
 *
 * 两套模型描述的是同一个框：`suggestIdPhotoLayout` 用「zoom/offset」，
 * `resolveIdPhotoCropBox` 用「中心 + 相对基准框的放大倍数」。这里做一次换算，
 * 保证自动构图与服务端/本地合成用的是同一个几何函数。
 */
export function idPhotoCropFromLayout(
  layout: IdPhotoLayout,
  source: { width: number; height: number },
  targetAspect: number
): IdPhotoCrop {
  const zoomRatio = clamp(layout.zoom / 100, 0.6, 1.8);
  const sourceRatio = source.width / source.height;
  const baseCropWidth =
    sourceRatio >= targetAspect
      ? source.height * targetAspect
      : source.width;

  const cropWidth = baseCropWidth / zoomRatio;
  const cropHeight = cropWidth / targetAspect;

  // offset 是「裁剪框中心相对源图中心的百分比」，与 suggestIdPhotoLayout 的写入口径一致
  const centerX = source.width / 2 + (layout.offsetX / 100) * source.width;
  const centerY = source.height / 2 + (layout.offsetY / 100) * source.height;

  const left = clamp(centerX - cropWidth / 2, 0, Math.max(0, source.width - cropWidth));
  const top = clamp(centerY - cropHeight / 2, 0, Math.max(0, source.height - cropHeight));

  return {
    x: (left + cropWidth / 2) / source.width,
    y: (top + cropHeight / 2) / source.height,
    scale: clamp(baseCropWidth / Math.max(1, cropWidth), 1, 3),
  };
}
```

- [ ] **Step 4: 运行测试**

```bash
cd packages/validators && bun test test/id-photo-layout.test.ts
```

预期:PASS。

- [ ] **Step 5: 导出并提交**

```ts
// packages/validators/src/index.ts —— 追加
export * from './id-photo-layout';
```

```bash
git add packages/validators/src/id-photo-layout.ts packages/validators/test/id-photo-layout.test.ts packages/validators/src/index.ts
git commit -m "feat(id-photo): 新增人脸自动构图(35%脸宽+8%头顶留白+眼线旋转)"
```

---

### Task 5: 质量检查(8 项)

**Files:**
- Create: `packages/validators/src/id-photo-quality.ts`
- Test: `packages/validators/test/id-photo-quality.test.ts`

**Interfaces:**
- Consumes: `FaceDetection`, `eyeTiltDegrees` from `./id-photo-layout`
- Produces:
  - `export interface QualityItem { name: string; value: string; passed: boolean; detail: string }`
  - `export interface QualityReport { items: QualityItem[]; score: number; passed: boolean }`
  - `export function inspectIdPhoto(input: { rgb: Uint8ClampedArray | Uint8Array; width: number; height: number; face: FaceDetection | null; faceCount: number; alpha?: Uint8ClampedArray | Uint8Array }): QualityReport`

- [ ] **Step 1: 写失败测试**

```ts
// packages/validators/test/id-photo-quality.test.ts
import { describe, expect, it } from 'bun:test';
import { inspectIdPhoto } from '../src/id-photo-quality';
import type { FaceDetection } from '../src/id-photo-layout';

function solidImage(
  width: number,
  height: number,
  gray: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 3);
  out.fill(gray);
  return out;
}

function centeredFace(
  width: number,
  height: number,
  faceWidthRatio: number,
  tilt = 0
): FaceDetection {
  const size = width * faceWidthRatio;
  const x = (width - size) / 2;
  const y = height * 0.15;
  const cy = y + size / 2;
  const dx = size * 0.2;
  const dy = Math.tan((tilt * Math.PI) / 180) * dx;
  return {
    box: { x, y, width: size, height: size },
    landmarks: [
      [width / 2 - dx, cy - dy],
      [width / 2 + dx, cy + dy],
      [width / 2, cy + size * 0.1],
      [width / 2 - dx * 0.5, cy + size * 0.3],
      [width / 2 + dx * 0.5, cy + size * 0.3],
    ],
    score: 0.9,
  };
}

describe('inspectIdPhoto', () => {
  it('reports eight items and full score for a well-formed photo', () => {
    const width = 295;
    const height = 413;
    const report = inspectIdPhoto({
      rgb: solidImage(width, height, 128),
      width,
      height,
      face: centeredFace(width, height, 0.35),
      faceCount: 1,
    });

    expect(report.items.length).toBe(8);
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
  });

  it('fails the face-count item when no face is found', () => {
    const width = 295;
    const height = 413;
    const report = inspectIdPhoto({
      rgb: solidImage(width, height, 128),
      width,
      height,
      face: null,
      faceCount: 0,
    });

    const item = report.items.find(i => i.name === 'faceCount')!;
    expect(item.passed).toBe(false);
    expect(report.passed).toBe(false);
  });

  it('flags a face that is too small', () => {
    const width = 295;
    const height = 413;
    const report = inspectIdPhoto({
      rgb: solidImage(width, height, 128),
      width,
      height,
      face: centeredFace(width, height, 0.15),
      faceCount: 1,
    });

    expect(report.items.find(i => i.name === 'faceRatio')!.passed).toBe(false);
  });

  it('flags an over-tilted eye line', () => {
    const width = 295;
    const height = 413;
    const report = inspectIdPhoto({
      rgb: solidImage(width, height, 128),
      width,
      height,
      face: centeredFace(width, height, 0.35, 12),
      faceCount: 1,
    });

    expect(report.items.find(i => i.name === 'eyeTilt')!.passed).toBe(false);
  });

  it('flags a severely underexposed photo', () => {
    const width = 295;
    const height = 413;
    const report = inspectIdPhoto({
      rgb: solidImage(width, height, 5),
      width,
      height,
      face: centeredFace(width, height, 0.35),
      faceCount: 1,
    });

    expect(report.items.find(i => i.name === 'exposure')!.passed).toBe(false);
  });

  it('flags a matte with too many translucent pixels', () => {
    const width = 10;
    const height = 10;
    const alpha = new Uint8ClampedArray(width * height);
    alpha.fill(128);
    const report = inspectIdPhoto({
      rgb: solidImage(width, height, 128),
      width,
      height,
      face: null,
      faceCount: 1,
      alpha,
    });

    expect(report.items.find(i => i.name === 'matteEdge')!.passed).toBe(false);
  });

  it('omits the matte item when no alpha is supplied', () => {
    const report = inspectIdPhoto({
      rgb: solidImage(295, 413, 128),
      width: 295,
      height: 413,
      face: centeredFace(295, 413, 0.35),
      faceCount: 1,
    });

    expect(report.items.find(i => i.name === 'matteEdge')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd packages/validators && bun test test/id-photo-quality.test.ts
```

预期:FAIL,module not found。

- [ ] **Step 3: 实现**

```ts
// packages/validators/src/id-photo-quality.ts
/**
 * 证件照质量检查。
 *
 * 对应参考实现 quality.py:inspect_photo 的 8 项。两端共用同一份判定，
 * 保证用户在本地路与服务端路看到的结论一致。
 *
 * 纯函数：输入是普通数组/对象，不依赖 sharp、DOM、模型。
 * 调用方负责先跑人脸检测与分割，再把结果传进来。
 */

import { eyeTiltDegrees, type FaceDetection } from './id-photo-layout';

export interface QualityItem {
  /** 稳定的 i18n key，UI 用 `quality.items.${name}` 取文案。 */
  name:
    | 'faceCount'
    | 'faceCentered'
    | 'faceRatio'
    | 'eyeTilt'
    | 'headroom'
    | 'sharpness'
    | 'exposure'
    | 'matteEdge';
  /** 实测值，已格式化成展示串（如 `35%`、`+1.2°`）。 */
  value: string;
  passed: boolean;
  /** 建议文案的 i18n key，UI 用 `quality.hints.${hint}` 取。 */
  hint: string;
}

export interface QualityReport {
  items: QualityItem[];
  /** 通过项占比，0..100。 */
  score: number;
  passed: boolean;
}

const FACE_CENTER_TOLERANCE = 0.12;
const FACE_RATIO_MIN = 0.26;
const FACE_RATIO_MAX = 0.42;
const MAX_EYE_TILT = 5;
const MIN_HEADROOM = 0.03;
const MIN_SHARPNESS = 30;
const EXPOSURE_MIN = 35;
const EXPOSURE_MAX = 225;
const MAX_TRANSLUCENT_RATIO = 0.75;

/**
 * Laplacian 方差，清晰度指标。
 *
 * 3×3 卷积核 [0,1,0; 1,-4,1; 0,1,0]，只取灰度。方差越低越糊。
 * 为了不被大图拖慢，按最大 512 边降采样 —— 清晰度的相对比较不需要原分辨率。
 */
function laplacianVariance(
  rgb: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): number {
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 512));
  const gw = Math.floor((width - 2) / step);
  const gh = Math.floor((height - 2) / step);
  if (gw <= 0 || gh <= 0) return 0;

  const grayAt = (x: number, y: number): number => {
    const p = (y * width + x) * 3;
    return (
      (rgb[p] ?? 0) * 0.299 +
      (rgb[p + 1] ?? 0) * 0.587 +
      (rgb[p + 2] ?? 0) * 0.114
    );
  };

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let gy = 0; gy < gh; gy += 1) {
    const y = 1 + gy * step;
    for (let gx = 0; gx < gw; gx += 1) {
      const x = 1 + gx * step;
      const value =
        grayAt(x, y - 1) +
        grayAt(x, y + 1) +
        grayAt(x - 1, y) +
        grayAt(x + 1, y) -
        4 * grayAt(x, y);
      sum += value;
      sumSq += value * value;
      count += 1;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function meanBrightness(
  rgb: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): number {
  const pixels = Math.min(width * height, 200_000);
  const stride = Math.max(1, Math.floor((width * height) / pixels));
  let sum = 0;
  let count = 0;
  for (let i = 0; i < width * height; i += stride) {
    const p = i * 3;
    sum +=
      ((rgb[p] ?? 0) + (rgb[p + 1] ?? 0) + (rgb[p + 2] ?? 0)) / 3;
    count += 1;
  }
  return count ? sum / count : 0;
}

export function inspectIdPhoto(input: {
  rgb: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  face: FaceDetection | null;
  faceCount: number;
  /** 可选：分割 alpha（1 通道，0..255）。提供时才检查抠图边缘。 */
  alpha?: Uint8ClampedArray | Uint8Array;
}): QualityReport {
  const { rgb, width, height, face, faceCount, alpha } = input;
  const items: QualityItem[] = [];

  items.push({
    name: 'faceCount',
    value: String(faceCount),
    passed: faceCount === 1,
    hint: 'singleFrontalPortrait',
  });

  if (face) {
    const faceCenterX = face.box.x + face.box.width / 2;
    const centerOffset = Math.abs(faceCenterX - width / 2) / width;
    items.push({
      name: 'faceCentered',
      value: `${Math.round(centerOffset * 100)}%`,
      passed: centerOffset < FACE_CENTER_TOLERANCE,
      hint: 'adjustHorizontalPosition',
    });

    const ratio = face.box.width / width;
    items.push({
      name: 'faceRatio',
      value: `${Math.round(ratio * 100)}%`,
      passed: ratio >= FACE_RATIO_MIN && ratio <= FACE_RATIO_MAX,
      hint: 'faceRatioRange',
    });

    const tilt = eyeTiltDegrees(face.landmarks);
    items.push({
      name: 'eyeTilt',
      value: `${tilt >= 0 ? '+' : ''}${tilt.toFixed(1)}°`,
      passed: Math.abs(tilt) <= MAX_EYE_TILT,
      hint: 'levelEyes',
    });

    const headroom = face.box.y / height;
    items.push({
      name: 'headroom',
      value: `${Math.round(headroom * 100)}%`,
      passed: headroom >= MIN_HEADROOM,
      hint: 'headroomTooSmall',
    });
  } else {
    // 没有人脸时，这四项无法判定，按未通过计（避免「没检测到却满分」）
    for (const name of [
      'faceCentered',
      'faceRatio',
      'eyeTilt',
      'headroom',
    ] as const) {
      items.push({ name, value: '—', passed: false, hint: 'faceNotDetected' });
    }
  }

  const sharpness = laplacianVariance(rgb, width, height);
  items.push({
    name: 'sharpness',
    value: sharpness.toFixed(0),
    passed: sharpness >= MIN_SHARPNESS,
    hint: 'avoidBlurrySource',
  });

  const brightness = meanBrightness(rgb, width, height);
  items.push({
    name: 'exposure',
    value: `${brightness.toFixed(0)}/255`,
    passed: brightness >= EXPOSURE_MIN && brightness <= EXPOSURE_MAX,
    hint: 'avoidUnderexposedOrBlown',
  });

  if (alpha && alpha.length) {
    let translucent = 0;
    for (let i = 0; i < alpha.length; i += 1) {
      const a = alpha[i] ?? 0;
      if (a > 0 && a < 255) translucent += 1;
    }
    const ratio = translucent / alpha.length;
    items.push({
      name: 'matteEdge',
      value: `${(ratio * 100).toFixed(1)}%`,
      passed: ratio < MAX_TRANSLUCENT_RATIO,
      hint: 'checkHairAndShoulder',
    });
  }

  const passedCount = items.filter(i => i.passed).length;
  const score = Math.round((100 * passedCount) / Math.max(1, items.length));

  return { items, score, passed: passedCount === items.length };
}
```

- [ ] **Step 4: 运行测试**

```bash
cd packages/validators && bun test test/id-photo-quality.test.ts
```

预期:PASS,7 个用例全过。

- [ ] **Step 5: 导出并提交**

```ts
// packages/validators/src/index.ts —— 追加
export * from './id-photo-quality';
```

```bash
git add packages/validators/src/id-photo-quality.ts packages/validators/test/id-photo-quality.test.ts packages/validators/src/index.ts
git commit -m "feat(id-photo): 新增 8 项质量检查(人脸/构图/清晰度/曝光/抠图边缘)"
```

---

### Task 6: YuNet 输出张量解析(两端共享)

> **⚠️ 本节已被 Task 8 实测取代。** 真实 YuNet 权重（OpenCV 2023mar）输出 12 个张量
> 而非单个 `[N,15]`，`parseYunetOutput` 已删除。实际交付的共享模块是
> `packages/utils/src/id-photo-yunet.ts`（`createYunetInputTensor` /
> `decodeYunetRawOutputs` / `usesRawYunetLayout` / `resolveYunetInputSize` /
> `scaleDetectedFaces` / `DetectedFace`）。下文保留为历史记录，执行时以实际模块为准。

**Files:**
- Create: `packages/utils/src/id-photo-face-tensor.ts`
- Test: `packages/utils/test/id-photo-face-tensor.test.ts`

**Interfaces:**
- Consumes: `FaceDetection` type shape from `@utils-plane/validators`(仅结构，`packages/utils` 不 import validators 以避免循环依赖 —— 本地重新声明等价结构)
- Produces:
  - `export interface DetectedFace { box: { x: number; y: number; width: number; height: number }; landmarks: Array<[number, number]>; score: number }`
  - `export const YUNET_INPUT_SIZE: number` = `320`
  - `export function parseYunetOutput(values: ArrayLike<number>, stride: number, confidenceThreshold?: number): DetectedFace[]`

- [ ] **Step 1: 写失败测试**

```ts
// packages/utils/test/id-photo-face-tensor.test.ts
import { describe, expect, it } from 'bun:test';
import {
  YUNET_INPUT_SIZE,
  parseYunetOutput,
} from '../src/id-photo-face-tensor';

function makeRow(
  x: number,
  y: number,
  w: number,
  h: number,
  score: number
): number[] {
  return [
    x, y, w, h,
    // 5 个关键点
    x + w * 0.3, y + h * 0.4,
    x + w * 0.7, y + h * 0.4,
    x + w * 0.5, y + h * 0.55,
    x + w * 0.35, y + h * 0.75,
    x + w * 0.65, y + h * 0.75,
    score,
  ];
}

describe('parseYunetOutput', () => {
  it('exposes the 320px default input size', () => {
    expect(YUNET_INPUT_SIZE).toBe(320);
  });

  it('parses a single confident face', () => {
    const faces = parseYunetOutput(makeRow(10, 20, 60, 80, 0.9), 15);
    expect(faces.length).toBe(1);
    expect(faces[0]!.box.x).toBe(10);
    expect(faces[0]!.box.width).toBe(60);
    expect(faces[0]!.score).toBeCloseTo(0.9, 5);
    expect(faces[0]!.landmarks.length).toBe(5);
  });

  it('sorts by score descending', () => {
    const values = [
      ...makeRow(0, 0, 40, 40, 0.4),
      ...makeRow(50, 50, 40, 40, 0.95),
    ];
    const faces = parseYunetOutput(values, 15);
    expect(faces.length).toBe(2);
    expect(faces[0]!.score).toBeCloseTo(0.95, 5);
  });

  it('drops rows below the confidence threshold', () => {
    const values = [
      ...makeRow(0, 0, 40, 40, 0.2),
      ...makeRow(50, 50, 40, 40, 0.9),
    ];
    const faces = parseYunetOutput(values, 15, 0.6);
    expect(faces.length).toBe(1);
    expect(faces[0]!.score).toBeCloseTo(0.9, 5);
  });

  it('ignores trailing padding rows', () => {
    const values = [...makeRow(10, 10, 40, 40, 0.9)];
    // 补一个全 0 的行（YuNet 用 0 填充未使用的 anchor）
    values.push(...new Array(15).fill(0));
    const faces = parseYunetOutput(values, 15);
    expect(faces.length).toBe(1);
  });

  it('returns an empty array for empty input', () => {
    expect(parseYunetOutput([], 15)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd packages/utils && bun test test/id-photo-face-tensor.test.ts
```

预期:FAIL,module not found。

- [ ] **Step 3: 实现**

```ts
// packages/utils/src/id-photo-face-tensor.ts
/**
 * YuNet 输出张量解析。
 *
 * YuNet（face_detection_yunet_2023mar.onnx）的输出是 `[batch, 15]`：
 *   [0..3]   x, y, w, h        —— 人脸框（输入分辨率下的像素坐标）
 *   [4..13]  5 个关键点 x,y     —— 左眼、右眼、鼻尖、左嘴角、右嘴角
 *   [14]     score
 *
 * 未使用的 anchor 会被填 0，这里用 score 过滤。
 *
 * 放在 packages/utils 而不是各自端里：onnxruntime-web 和 onnxruntime-node
 * 拿到的都是 Float32Array，解析逻辑完全一样，写两份必然漂移。
 */

export const YUNET_INPUT_SIZE = 320;
export const YUNET_STRIDE = 15;

export interface DetectedFace {
  box: { x: number; y: number; width: number; height: number };
  landmarks: Array<[number, number]>;
  score: number;
}

/**
 * 把 YuNet 的扁平输出切成人脸列表，按 score 降序。
 *
 * `stride` 默认 15；显式传参是为了让调用方面对模型变体时有逃生口。
 */
export function parseYunetOutput(
  values: ArrayLike<number>,
  stride: number = YUNET_STRIDE,
  confidenceThreshold = 0.6
): DetectedFace[] {
  if (stride < 15) {
    throw new Error(`unexpected YuNet stride: ${stride}`);
  }
  const rows = Math.floor(values.length / stride);
  const faces: DetectedFace[] = [];

  for (let r = 0; r < rows; r += 1) {
    const base = r * stride;
    const score = values[base + 14] ?? 0;
    if (!(score >= confidenceThreshold)) continue;

    const x = values[base] ?? 0;
    const y = values[base + 1] ?? 0;
    const width = values[base + 2] ?? 0;
    const height = values[base + 3] ?? 0;
    if (width <= 0 || height <= 0) continue;

    const landmarks: Array<[number, number]> = [];
    for (let k = 0; k < 5; k += 1) {
      landmarks.push([
        values[base + 4 + k * 2] ?? 0,
        values[base + 5 + k * 2] ?? 0,
      ]);
    }

    faces.push({ box: { x, y, width, height }, landmarks, score });
  }

  return faces.sort((a, b) => b.score - a.score);
}

/**
 * 把人脸框与关键点从模型输入分辨率映射回源图分辨率。
 *
 * YuNet 的预处理是直接拉伸到 320×320（`fit: 'fill'`），两轴比例独立，
 * 调用方传 `scaleX = 源宽/320`、`scaleY = 源高/320` 即可，偏移恒为 0。
 * `offsetX/offsetY` 保留给将来可能引入的补边预处理，当前两端都不用。
 */
export function scaleDetectedFaces(
  faces: DetectedFace[],
  scale: { scaleX: number; scaleY: number; offsetX?: number; offsetY?: number }
): DetectedFace[] {
  const { scaleX, scaleY, offsetX = 0, offsetY = 0 } = scale;
  return faces.map(face => ({
    box: {
      x: (face.box.x - offsetX) * scaleX,
      y: (face.box.y - offsetY) * scaleY,
      width: face.box.width * scaleX,
      height: face.box.height * scaleY,
    },
    landmarks: face.landmarks.map(
      ([lx, ly]) =>
        [(lx - offsetX) * scaleX, (ly - offsetY) * scaleY] as [number, number]
    ),
    score: face.score,
  }));
}
```

- [ ] **Step 4: 运行测试**

```bash
cd packages/utils && bun test test/id-photo-face-tensor.test.ts
```

预期:PASS。

- [ ] **Step 5: 导出并提交**

```ts
// packages/utils/src/index.ts —— 追加
export * from './id-photo-face-tensor';
```

```bash
git add packages/utils/src/id-photo-face-tensor.ts packages/utils/test/id-photo-face-tensor.test.ts packages/utils/src/index.ts
git commit -m "feat(id-photo): 新增 YuNet 输出张量解析与坐标映射"
```

---

### Task 7: 模型资产下载与同步

**Files:**
- Modify: `scripts/download-rmbg-assets.cjs`
- Modify: `scripts/prepare-id-photo-models.sh`
- Modify: `apps/api/src/scripts/sync-id-photo-models.ts:ASSET_PREFIXES`
- Modify: `docs/id-photo-models.md`

**Interfaces:**
- Produces: `docker/models/` 下新增
  - `modnet/modnet_photographic.onnx`
  - `face/yunet/face_detection_yunet_2023mar.onnx`
  - 对应的 MinIO key：`models/modnet/modnet_photographic.onnx`、`models/face/yunet/face_detection_yunet_2023mar.onnx`

- [ ] **Step 1: 扩展下载脚本**

在 `scripts/download-rmbg-assets.cjs` 的常量区追加模型清单与下载函数（保持既有 RMBG 逻辑不动，只新增 `modnet` 与 `face` 两个前缀）：

```js
// 追加到 MODEL_FILES 定义之后
const MODNET_DIR = path.join(ROOT, 'docker', 'models', 'modnet');
const YUNET_DIR = path.join(ROOT, 'docker', 'models', 'face', 'yunet');

// MODNet photographic：Apache-2.0，参考实现仓库已内置，直接复制即可，无需联网。
const MODNET_LOCAL_CANDIDATES = [
  path.join(ROOT, 'vendor', 'modnet_photographic.onnx'),
  path.join(ROOT, '..', 'id_photo_bg_changer', 'pictone', 'models', 'modnet_photographic.onnx'),
];

// YuNet：OpenCV Zoo 官方发行，MIT。
const YUNET_URL =
  'https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx';

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function fetchModnetPhotographic() {
  const dest = path.join(MODNET_DIR, 'modnet_photographic.onnx');
  if (fs.existsSync(dest)) {
    console.log(`[modnet] already present: ${dest}`);
    return;
  }
  const local = MODNET_LOCAL_CANDIDATES.find(p => fs.existsSync(p));
  if (!local) {
    throw new Error(
      'modnet_photographic.onnx not found. Place it at vendor/modnet_photographic.onnx\n' +
        '(source: https://github.com/you-xiu/id_photo_bg_changer/blob/main/pictone/models/modnet_photographic.onnx)'
    );
  }
  fs.mkdirSync(MODNET_DIR, { recursive: true });
  fs.copyFileSync(local, dest);
  console.log(`[modnet] copied from ${local} → ${dest}`);
}

async function fetchYunet() {
  const dest = path.join(YUNET_DIR, 'face_detection_yunet_2023mar.onnx');
  if (fs.existsSync(dest)) {
    console.log(`[yunet] already present: ${dest}`);
    return;
  }
  const size = await downloadFile(YUNET_URL, dest);
  console.log(`[yunet] downloaded ${size} bytes → ${dest}`);
}
```

再把主入口的分支从两档扩成四档：

```js
const target = process.argv[2] ?? 'all';
const tasks = {
  model: () => fetchRmbgModel(),      // 既有函数，改名后调用
  runtime: () => fetchOrtRuntime(),   // 既有函数，改名后调用
  modnet: fetchModnetPhotographic,
  yunet: fetchYunet,
};

if (target === 'all') {
  for (const fn of Object.values(tasks)) await fn();
} else if (tasks[target]) {
  await tasks[target]();
} else {
  console.error(`unknown target: ${target}. use one of: ${Object.keys(tasks).join(', ')}, all`);
  process.exit(1);
}
```

- [ ] **Step 2: 扩展 prepare 脚本**

```bash
# scripts/prepare-id-photo-models.sh —— 在 node 调用之后、aws s3 sync 之前插入
node scripts/download-rmbg-assets.cjs modnet
node scripts/download-rmbg-assets.cjs yunet
```

`aws s3 sync` 那一行保持不变 —— 它同步的是整个 `docker/models/` 树，新增目录自动包含。

- [ ] **Step 3: 扩展同步前缀**

```ts
// apps/api/src/scripts/sync-id-photo-models.ts —— 改这一行
const ASSET_PREFIXES = ['rmbg/', 'ort/', 'modnet/', 'face/'];
```

同步更新紧邻的 JSDoc：

```ts
/**
 * 把镜像内置的证件照资产树同步到 MinIO/S3 models 桶（只读匿名）。
 *
 * 资产：
 *   rmbg/<version>/{config.json, preprocessor_config.json, onnx/model*.onnx}  RMBG-1.4（BRIA 许可，仅回落）
 *   modnet/modnet_photographic.onnx                                          MODNet photographic（Apache-2.0，主分割）
 *   face/yunet/face_detection_yunet_2023mar.onnx                             YuNet 人脸检测（MIT）
 *   ort/ort-wasm-simd-threaded{,.jsep}.{wasm,mjs}                            onnxruntime-web 运行时
 */
```

- [ ] **Step 4: 验证脚本可跑**

```bash
node scripts/download-rmbg-assets.cjs yunet
ls -lh docker/models/face/yunet/
node scripts/download-rmbg-assets.cjs modnet
ls -lh docker/models/modnet/
```

预期:YuNet 约 340KB，photographic 约 25MB。若 photographic 不在候选路径，按报错提示放到 `vendor/modnet_photographic.onnx`。

- [ ] **Step 5: 更新文档**

在 `docs/id-photo-models.md` 的「档位与模型」表格后追加一节：

```markdown
## 参考对齐新增资产

| 资产 | MinIO key | 体积 | 许可 | 用途 |
| --- | --- | --- | --- | --- |
| MODNet photographic | `models/modnet/modnet_photographic.onnx` | ~25MB | Apache-2.0 | 两端主分割（512×512，保长宽比） |
| YuNet 人脸检测 | `models/face/yunet/face_detection_yunet_2023mar.onnx` | ~340KB | MIT | 两端人脸检测与自动构图 |

`prepare-id-photo-models.sh` 会一并下载；`sync-id-photo-models.ts` 的
`ASSET_PREFIXES` 已包含 `modnet/` 与 `face/`，离线镜像启动时自动同步。
```

- [ ] **Step 6: 提交**

```bash
git add scripts/download-rmbg-assets.cjs scripts/prepare-id-photo-models.sh apps/api/src/scripts/sync-id-photo-models.ts docs/id-photo-models.md
git commit -m "chore(id-photo): 资产脚本支持 photographic 与 YuNet 模型"
```

---

### Task 8: 服务端人脸检测服务

> **⚠️ 本节假设已被实测修正。** 真实权重要求 640×640 输入、0..255 BGR、12 个输出张量；
> 本节原文的 320 / 0..1 / 单输出会让 `detect()` 永久返回空数组且测试全绿。实际交付为
> 「共享解码 + 服务层薄适配」，见 `apps/api/src/modules/tasks/services/face-detection.service.ts`
> 与 `packages/utils/src/id-photo-yunet.ts`。下文保留为历史记录。

**Files:**
- Create: `apps/api/src/modules/tasks/services/face-detection.service.ts`
- Modify: `apps/api/src/modules/tasks/tasks.module.ts:14,44`
- Test: `apps/api/test/modules/tasks/services/face-detection.service.spec.ts`

**Interfaces:**
- Consumes: `parseYunetOutput`, `scaleDetectedFaces`, `YUNET_INPUT_SIZE`, `DetectedFace` from `@utils-plane/utils`
- Produces:
  - `export function resolveYunetModelPath(options?: ResolveYunetOptions): string`
  - `export class FaceDetectionService { detect(input: Buffer): Promise<DetectedFace[]> }`
  - `export function createYunetInputTensor(rawRgb: Buffer | Uint8ClampedArray, size: number): Float32Array`

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/test/modules/tasks/services/face-detection.service.spec.ts
import { describe, expect, it } from 'bun:test';
import {
  createYunetInputTensor,
  resolveYunetModelPath,
} from '../../../../src/modules/tasks/services/face-detection.service';

describe('resolveYunetModelPath', () => {
  it('prefers the configured env path', () => {
    const resolved = resolveYunetModelPath({
      configuredPath: '/custom/yunet.onnx',
      cwd: '/app',
      exists: () => false,
    });
    expect(resolved).toBe('/custom/yunet.onnx');
  });

  it('finds the vendored model next to the api package', () => {
    const resolved = resolveYunetModelPath({
      cwd: '/app',
      exists: p => p === '/app/apps/api/models/face_detection_yunet_2023mar.onnx',
    });
    expect(resolved).toBe('/app/apps/api/models/face_detection_yunet_2023mar.onnx');
  });

  it('falls back to the image-baked models dir', () => {
    const resolved = resolveYunetModelPath({
      cwd: '/app',
      exists: p => p === '/app/models/yunet/face_detection_yunet_2023mar.onnx',
    });
    expect(resolved).toBe('/app/models/yunet/face_detection_yunet_2023mar.onnx');
  });
});

describe('createYunetInputTensor', () => {
  it('produces a CHW float32 tensor normalised to 0..1', () => {
    const size = 2;
    const raw = Buffer.from([
      255, 0, 0, 0, 255, 0,
      0, 0, 255, 255, 255, 255,
    ]);
    const tensor = createYunetInputTensor(raw, size);

    expect(tensor.length).toBe(3 * size * size);
    // R 平面
    expect(tensor[0]).toBeCloseTo(1, 5);
    expect(tensor[1]).toBeCloseTo(0, 5);
    // G 平面起点 = size*size
    expect(tensor[4]).toBeCloseTo(0, 5);
    expect(tensor[5]).toBeCloseTo(1, 5);
    // B 平面起点 = 2*size*size
    expect(tensor[8]).toBeCloseTo(1, 5);
    expect(tensor[11]).toBeCloseTo(1, 5);
  });

  it('uses 0..1 normalisation, not -1..1', () => {
    const raw = Buffer.alloc(3 * 4, 127);
    const tensor = createYunetInputTensor(raw, 2);
    expect(tensor[0]).toBeCloseTo(127 / 255, 5);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/api && bun test test/modules/tasks/services/face-detection.service.spec.ts
```

预期:FAIL,module not found。

- [ ] **Step 3: 实现**

```ts
// apps/api/src/modules/tasks/services/face-detection.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {
  YUNET_INPUT_SIZE,
  parseYunetOutput,
  scaleDetectedFaces,
  type DetectedFace,
} from '@utils-plane/utils';

const YUNET_MODEL_NAME = 'face_detection_yunet_2023mar.onnx';

type ResolveYunetOptions = {
  configuredPath?: string;
  cwd?: string;
  exists?: (modelPath: string) => boolean;
};

/**
 * 解析 YuNet 权重路径。
 *
 * 候选顺序与 `resolvePortraitSegmentationModelPath` 保持一致，便于运维只记一套约定：
 * env 覆盖 → 仓库内 apps/api/models → 镜像内置 /app/models。
 */
export function resolveYunetModelPath({
  configuredPath = process.env.ID_PHOTO_FACE_MODEL,
  cwd = process.cwd(),
  exists = existsSync,
}: ResolveYunetOptions = {}): string {
  if (configuredPath) return configuredPath;

  const candidates = [
    path.resolve(cwd, `apps/api/models/${YUNET_MODEL_NAME}`),
    path.resolve(cwd, `models/${YUNET_MODEL_NAME}`),
    path.resolve(cwd, `models/yunet/${YUNET_MODEL_NAME}`),
  ];
  return candidates.find(candidate => exists(candidate)) ?? candidates[0]!;
}

/**
 * 构造 YuNet 输入张量：CHW、float32、归一化到 0..1。
 *
 * 注意归一化区间：YuNet 用 0..1，MODNet 用 -1..1。两者写反模型不会报错，
 * 只会静默给出离谱的框 —— 所以这里单独成函数并有专门的测试守着。
 */
export function createYunetInputTensor(
  rawRgb: Buffer | Uint8ClampedArray,
  size: number
): Float32Array {
  const plane = size * size;
  const tensor = new Float32Array(3 * plane);

  for (let i = 0; i < plane; i += 1) {
    const p = i * 3;
    tensor[i] = (rawRgb[p] ?? 0) / 255;
    tensor[plane + i] = (rawRgb[p + 1] ?? 0) / 255;
    tensor[2 * plane + i] = (rawRgb[p + 2] ?? 0) / 255;
  }
  return tensor;
}

@Injectable()
export class FaceDetectionService {
  private readonly logger = new Logger(FaceDetectionService.name);
  private sessionPromise?: Promise<ort.InferenceSession>;

  /**
   * 检测人脸，按 score 降序返回。
   *
   * 任何失败（模型缺失、推理异常）都返回空数组 —— 自动构图是增强，不是必需，
   * 没有检测结果时上层退回居中裁剪即可，不该让整张证件照失败。
   */
  async detect(input: Buffer): Promise<DetectedFace[]> {
    try {
      const oriented = await sharp(input).rotate().toBuffer();
      const meta = await sharp(oriented).metadata();
      if (!meta.width || !meta.height) return [];

      const { data } = await sharp(oriented)
        .resize(YUNET_INPUT_SIZE, YUNET_INPUT_SIZE, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const session = await this.getSession();
      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];
      if (!inputName || !outputName) return [];

      const result = await session.run({
        [inputName]: new ort.Tensor(
          'float32',
          createYunetInputTensor(data, YUNET_INPUT_SIZE),
          [1, 3, YUNET_INPUT_SIZE, YUNET_INPUT_SIZE]
        ),
      });
      const output = result[outputName];
      if (!output) return [];

      const faces = parseYunetOutput(output.data as Float32Array, 15);
      // fill 缩放：两轴独立比例，偏移为 0
      return scaleDetectedFaces(faces, {
        scaleX: meta.width / YUNET_INPUT_SIZE,
        scaleY: meta.height / YUNET_INPUT_SIZE,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`face detection unavailable: ${message}`);
      return [];
    }
  }

  private getSession(): Promise<ort.InferenceSession> {
    if (!this.sessionPromise) {
      const modelPath = resolveYunetModelPath();
      this.sessionPromise = ort.InferenceSession.create(modelPath);
    }
    return this.sessionPromise;
  }
}
```

- [ ] **Step 4: 运行测试**

```bash
cd apps/api && bun test test/modules/tasks/services/face-detection.service.spec.ts
```

预期:PASS,5 个用例全过。

- [ ] **Step 5: 注册到模块**

```ts
// apps/api/src/modules/tasks/tasks.module.ts —— providers 与 exports 两处都要加
import { FaceDetectionService } from './services/face-detection.service';

// providers 数组内追加（与 PortraitSegmentationService 同一段）
FaceDetectionService,

// exports 数组内追加
FaceDetectionService,
```

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/modules/tasks/services/face-detection.service.ts apps/api/test/modules/tasks/services/face-detection.service.spec.ts apps/api/src/modules/tasks/tasks.module.ts
git commit -m "feat(api): 新增 YuNet 人脸检测服务"
```

---

### Task 9: 服务端分割升级（动态尺寸，不补边 + photographic 回落链）

> **Task 1 实测修正**：原计划用 `letterboxResize` 补边成 512×512，实测证明这是**唯一**稳定复现「衣服破洞」的路径（1524 px 洞，含人脸 1176 px）。同一权重不补边时 0 洞。本任务因此改为参考实现口径：长边 512、保持长宽比、宽高取 32 的倍数、**不补边**（见 `docs/id-photo-model-comparison.md`）。

**Files:**
- Create: `packages/utils/src/id-photo-modnet-size.ts`
- Create: `packages/utils/test/id-photo-modnet-size.test.ts`
- Modify: `packages/utils/src/index.ts`
- Modify: `apps/api/src/modules/tasks/services/portrait-segmentation.service.ts:11,66-82,84-103,399-428,449-487`
- Test: `apps/api/test/modules/tasks/services/portrait-segmentation.service.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `export const MODNET_LONG_EDGE: number` = `512`（`packages/utils`）
  - `export function modnetInputSize(source: { width: number; height: number }, longEdge?: number): { width: number; height: number }` —— 返回模型输入尺寸，**无 padding、无 offset**，宽高均为 32 的倍数。**两端共用这一个函数**，本地路 Task 11 也 import 它。
  - `apps/api/.../portrait-segmentation.service.ts` 导出 `MODNET_INPUT_SIZE = 512` 并 re-export `modnetInputSize`（保持既有 import 路径可用）
  - `export function resolvePortraitSegmentationModelPath(...)` 候选顺序改为 photographic 优先
  - `createModNetInputTensor(rawRgb, width, height)`（由原 `(rawRgb, size)` 扩成宽高）

- [ ] **Step 1: 在 `packages/utils` 写 `modnetInputSize` 的失败测试**

新建 `packages/utils/test/id-photo-modnet-size.test.ts`：

```ts
import { describe, expect, it } from 'bun:test';
import { MODNET_LONG_EDGE, modnetInputSize } from '../src/id-photo-modnet-size';

describe('modnetInputSize', () => {
  it('exposes 512 as the default long edge', () => {
    expect(MODNET_LONG_EDGE).toBe(512);
  });

  it('scales a tall image so the long edge is 512', () => {
    expect(modnetInputSize({ width: 1280, height: 1706 }, 512)).toEqual({
      width: 384,
      height: 512,
    });
  });

  it('scales a landscape image so the long edge is 512', () => {
    expect(modnetInputSize({ width: 1600, height: 900 }, 512)).toEqual({
      width: 512,
      height: 288,
    });
  });

  it('upscales an image smaller than the long edge', () => {
    expect(modnetInputSize({ width: 300, height: 400 }, 512)).toEqual({
      width: 384,
      height: 512,
    });
  });

  it('keeps an already-large image at its own size', () => {
    // 长边已 >= 512 且短边 <= 512：不缩放，只做 32 对齐
    expect(modnetInputSize({ width: 1000, height: 300 }, 512)).toEqual({
      width: 992,
      height: 288,
    });
  });

  it('always returns multiples of 32 and never below 32', () => {
    for (const source of [
      { width: 1, height: 1 },
      { width: 333, height: 777 },
      { width: 4000, height: 17 },
      { width: 513, height: 513 },
    ]) {
      const box = modnetInputSize(source, 512);
      expect(box.width % 32).toBe(0);
      expect(box.height % 32).toBe(0);
      expect(box.width).toBeGreaterThanOrEqual(32);
      expect(box.height).toBeGreaterThanOrEqual(32);
    }
  });

  it('preserves the aspect ratio within 32px rounding', () => {
    const source = { width: 1280, height: 1706 };
    const box = modnetInputSize(source, 512);
    expect(
      Math.abs(box.width / box.height - source.width / source.height)
    ).toBeLessThan(0.08);
  });

  it('returns no padding fields', () => {
    const box = modnetInputSize({ width: 1280, height: 1706 }, 512);
    expect(Object.keys(box).sort()).toEqual(['height', 'width']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd packages/utils && bun test test/id-photo-modnet-size.test.ts
```

预期:FAIL,module not found。

- [ ] **Step 3: 实现共享函数**

新建 `packages/utils/src/id-photo-modnet-size.ts`：

```ts
/**
 * MODNet 模型输入尺寸：长边 512、保持长宽比、宽高取 32 的倍数、**不补边**。
 *
 * 口径与参考实现 matting.py:portrait_alpha 一致：
 *   长边 < 512 或 短边 > 512 → 按长边缩放到 512；否则保持原尺寸；
 *   最后把宽高向下取整到 32 的倍数（MODNet 的下采样需要 32 对齐）。
 *
 * 为什么不能补边成正方形：实测证明同一份 photographic 权重在
 * 「512×512 + 补黑边」下会稳定产生衣服 2 个洞 + 人脸 1 个大洞（1524 px），
 * 而不补边时是 0 个洞（见 docs/id-photo-model-comparison.md）。
 * 补边引入的纯色区域会被模型当成前景断开处，后处理补不回来。
 *
 * 放在 packages/utils 而不是各端各写一份：服务端 onnxruntime-node 与
 * 浏览器 onnxruntime-web 必须看到完全相同的输入尺寸，否则两端出图不一致。
 */

export const MODNET_LONG_EDGE = 512;
const ALIGN = 32;

export function modnetInputSize(
  source: { width: number; height: number },
  longEdge: number = MODNET_LONG_EDGE
): { width: number; height: number } {
  if (source.width <= 0 || source.height <= 0) {
    return { width: longEdge, height: longEdge };
  }

  const longest = Math.max(source.width, source.height);
  const shortest = Math.min(source.width, source.height);

  let width = source.width;
  let height = source.height;
  if (longest < longEdge || shortest > longEdge) {
    const scale = longEdge / longest;
    width = Math.round(source.width * scale);
    height = Math.round(source.height * scale);
  }

  width = Math.max(ALIGN, width - (width % ALIGN));
  height = Math.max(ALIGN, height - (height % ALIGN));
  return { width, height };
}
```

从 `packages/utils/src/index.ts` 导出：

```ts
export * from './id-photo-modnet-size';
```

- [ ] **Step 4: 运行共享函数测试**

```bash
cd packages/utils && bun test test/id-photo-modnet-size.test.ts
```

预期:PASS,8 个用例全过。

- [ ] **Step 5: 改服务端常量、模型路径解析与 re-export**

```ts
// portrait-segmentation.service.ts 第 11 行：256 → 512
export const MODNET_INPUT_SIZE = MODNET_LONG_EDGE;

const MODNET_PHOTOGRAPHIC_NAME = 'modnet_photographic.onnx';
const MODNET_GENERIC_NAME = 'modnet.onnx';
```

顶部 import 追加：

```ts
import { MODNET_LONG_EDGE, modnetInputSize } from '@utils-plane/utils';

// 保持既有 import 路径可用（既有测试从本文件 import 这个函数）
export { modnetInputSize };
```

```ts
// 替换 resolvePortraitSegmentationModelPath（原 66-82 行）
export function resolvePortraitSegmentationModelPath({
  configuredPath = process.env.ID_PHOTO_SEGMENTATION_MODEL,
  cwd = process.cwd(),
  exists = existsSync,
}: ResolveModelPathOptions = {}): string {
  if (configuredPath) return configuredPath;

  // photographic 优先：它是证件照专用变体，通用 modnet 只作文件缺失时的回落。
  // 注意：Task 1 实测两者逐像素等价（max abs diff = 0），回落的意义仅在
  // 「photographic 文件缺失时不至于整条链路不可用」，不带来画质差异。
  const candidates = [
    path.resolve(cwd, `apps/api/models/${MODNET_PHOTOGRAPHIC_NAME}`),
    path.resolve(cwd, `models/modnet/${MODNET_PHOTOGRAPHIC_NAME}`),
    path.resolve(cwd, `models/${MODNET_PHOTOGRAPHIC_NAME}`),
    path.resolve(cwd, `apps/api/models/${MODNET_GENERIC_NAME}`),
    path.resolve(cwd, `models/${MODNET_GENERIC_NAME}`),
  ];
  return candidates.find(candidate => exists(candidate)) ?? candidates[0]!;
}
```

- [ ] **Step 6: 改 `inferAlphaBytes` 用动态尺寸（不补边）**

```ts
// 替换 inferAlphaBytes 的预处理段（原 453-458 行）
private async inferAlphaBytes(
  session: ort.InferenceSession,
  input: Buffer,
  sourceSize: { width: number; height: number }
): Promise<Buffer> {
  const box = modnetInputSize(sourceSize, MODNET_INPUT_SIZE);
  // 宽高比已保持，fit:'fill' 不会产生形变；这里不 extend 补边
  const raw = await sharp(input)
    .resize(box.width, box.height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
  const tensorData = createModNetInputTensor(raw, box.width, box.height);
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) {
    return Buffer.alloc(0);
  }

  const result = await session.run({
    [inputName]: new ort.Tensor('float32', tensorData, [
      1,
      3,
      box.height,
      box.width,
    ]),
  });
  const output = result[outputName];
  if (!output) {
    return Buffer.alloc(0);
  }

  return normalizeModNetMatteValues(output.data as Float32Array);
}
```

`createModNetInputTensor` 需要同时接受宽高（原来只接受正方形边长）：

```ts
export function createModNetInputTensor(
  rawRgb: Buffer,
  width: number,
  height: number
): Float32Array {
  const plane = width * height;
  const tensorData = new Float32Array(3 * plane);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 3;
      const target = y * width + x;
      tensorData[target] = ((rawRgb[pixel] ?? 0) / 255 - 0.5) / 0.5;
      tensorData[plane + target] =
        ((rawRgb[pixel + 1] ?? 0) / 255 - 0.5) / 0.5;
      tensorData[2 * plane + target] =
        ((rawRgb[pixel + 2] ?? 0) / 255 - 0.5) / 0.5;
    }
  }
  return tensorData;
}
```

既有测试若以 `createModNetInputTensor(raw, 256)` 调用，改为 `(raw, 256, 256)`。

- [ ] **Step 7: 改 `segment` 把 alpha 直接缩回原尺寸（无 extract）**

```ts
// 替换 segment 的 405-428 行
const session = await this.getSession();
const sourceSize = { width: metadata.width, height: metadata.height };
const alphaBytes = refinePortraitAlphaBytes(
  await this.inferAlphaBytes(session, orientedInput, sourceSize)
);
if (!alphaBytes.length) {
  return { mask: Buffer.alloc(0), faceCount: 0 };
}

// 输入没有补边，蒙版就是整张图的前景概率，直接缩放回原尺寸
const box = modnetInputSize(sourceSize, MODNET_INPUT_SIZE);
const mask = await sharp(alphaBytes, {
  raw: { width: box.width, height: box.height, channels: 1 },
})
  .resize(metadata.width, metadata.height, { fit: 'fill' })
  .png()
  .toBuffer();

return {
  mask,
  bounds: { x: 0, y: 0, width: metadata.width, height: metadata.height },
  faceCount: 1,
};
```

- [ ] **Step 8: 加 photographic → 通用 modnet 的回落**

```ts
// 替换 getSession（原 481-487 行）
private getSession(): Promise<ort.InferenceSession> {
  if (!this.sessionPromise) {
    const modelPath = resolvePortraitSegmentationModelPath();
    this.sessionPromise = ort.InferenceSession.create(modelPath).catch(err => {
      // photographic 缺失时退回通用 modnet，保证任务仍能产出
      const generic = path.resolve(process.cwd(), `models/${MODNET_GENERIC_NAME}`);
      if (modelPath.endsWith(MODNET_GENERIC_NAME)) throw err;
      this.logger.warn(
        `falling back to generic modnet (${modelPath} unavailable): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return ort.InferenceSession.create(generic);
    });
  }
  return this.sessionPromise;
}
```

- [ ] **Step 9: 运行全部相关测试**

```bash
cd apps/api && bun test test/modules/tasks/services/portrait-segmentation.service.spec.ts
```

预期:PASS。若既有用例断言 256，一并更新为 `MODNET_INPUT_SIZE`（不要硬编码 512，用常量以免下次再改）。

- [ ] **Step 10: 提交**

```bash
git add apps/api/src/modules/tasks/services/portrait-segmentation.service.ts apps/api/test/modules/tasks/services/portrait-segmentation.service.spec.ts
git commit -m "feat(api): 分割输入改为长边512动态尺寸不补边,photographic 优先并回落通用 modnet"
```

---

### Task 10: 服务端渲染增强（构图 + 去污染 + 质量 + DPI）

**Files:**
- Modify: `apps/api/src/modules/tasks/services/id-photo.service.ts:29-93,408-571,573-604`
- Test: `apps/api/test/modules/tasks/services/id-photo.service.spec.ts`

**Interfaces:**
- Consumes:
  - `suggestIdPhotoLayout`, `idPhotoCropFromLayout`, `inspectIdPhoto` from `@utils-plane/validators`
  - `estimateSourceBackgroundColors` from `@utils-plane/validators`
  - `decontaminateIdPhotoForeground` from `@utils-plane/utils`
  - `FaceDetectionService` from `./face-detection.service`
- Produces:
  - `IdPhotoService` 构造函数签名变为 `constructor(segmentation: PortraitSegmentationService, faces?: FaceDetectionService)`
  - `IdPhotoRenderResult` 追加可选字段 `quality?: QualityReport` —— 供 processor 写入任务结果 metadata

- [ ] **Step 1: 写失败测试**

追加到既有 spec：

```ts
// apps/api/test/modules/tasks/services/id-photo.service.spec.ts —— 追加
describe('IdPhotoService reference parity', () => {
  async function makeInput() {
    return sharp({
      create: { width: 600, height: 800, channels: 3, background: '#438edb' },
    })
      .jpeg()
      .toBuffer();
  }

  it('writes 300 dpi into the JPEG output', async () => {
    const input = await makeInput();
    const service = new IdPhotoService({
      segment: async () => ({
        mask: await sharp(Buffer.alloc(600 * 800, 255), {
          raw: { width: 600, height: 800, channels: 1 },
        })
          .png()
          .toBuffer(),
        bounds: { x: 0, y: 0, width: 600, height: 800 },
        faceCount: 1,
      }),
    });

    const result = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#438edb',
      outputType: 'image/jpeg',
      dpi: 300,
    });

    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(295);
    expect(meta.height).toBe(413);
    expect(meta.density).toBe(300);
  });

  it('writes 300 dpi into the PNG output', async () => {
    const input = await makeInput();
    const service = new IdPhotoService({
      segment: async () => ({
        mask: await sharp(Buffer.alloc(600 * 800, 255), {
          raw: { width: 600, height: 800, channels: 1 },
        })
          .png()
          .toBuffer(),
        bounds: { x: 0, y: 0, width: 600, height: 800 },
        faceCount: 1,
      }),
    });

    const result = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#438edb',
      outputType: 'image/png',
      dpi: 300,
    });

    const meta = await sharp(result.buffer).metadata();
    expect(meta.density).toBe(300);
  });

  it('uses the detected face to auto-frame when no crop is supplied', async () => {
    const input = await makeInput();
    const withFace = new IdPhotoService(
      {
        segment: async () => ({
          mask: await sharp(Buffer.alloc(600 * 800, 255), {
            raw: { width: 600, height: 800, channels: 1 },
          })
            .png()
            .toBuffer(),
          bounds: { x: 0, y: 0, width: 600, height: 800 },
          faceCount: 1,
        }),
      },
      {
        detect: async () => [
          {
            box: { x: 200, y: 150, width: 180, height: 180 },
            landmarks: [
              [230, 230],
              [350, 230],
              [290, 260],
              [265, 290],
              [315, 290],
            ],
            score: 0.95,
          },
        ],
      } as never
    );
    const withoutFace = new IdPhotoService({
      segment: async () => ({
        mask: await sharp(Buffer.alloc(600 * 800, 255), {
          raw: { width: 600, height: 800, channels: 1 },
        })
          .png()
          .toBuffer(),
        bounds: { x: 0, y: 0, width: 600, height: 800 },
        faceCount: 1,
      }),
    });

    const config = {
      preset: 'one_inch' as const,
      backgroundColor: '#438edb',
      outputType: 'image/jpeg' as const,
      dpi: 300 as const,
    };

    const a = await withFace.render(input, config);
    const b = await withoutFace.render(input, config);
    // 自动构图会缩放/偏移，两次产出的字节不应相同
    expect(Buffer.compare(a.buffer, b.buffer)).not.toBe(0);
  });

  it('honours an explicit crop over the detected face', async () => {
    const input = await makeInput();
    const detect = async () => [
      {
        box: { x: 200, y: 150, width: 180, height: 180 },
        landmarks: [
          [230, 230],
          [350, 230],
          [290, 260],
          [265, 290],
          [315, 290],
        ],
        score: 0.95,
      },
    ];
    const segmented = async () => ({
      mask: await sharp(Buffer.alloc(600 * 800, 255), {
        raw: { width: 600, height: 800, channels: 1 },
      })
        .png()
        .toBuffer(),
      bounds: { x: 0, y: 0, width: 600, height: 800 },
      faceCount: 1,
    });

    const withExplicitCrop = new IdPhotoService({ segment: segmented }, { detect } as never);
    const withoutCrop = new IdPhotoService({ segment: segmented }, { detect } as never);

    const base = {
      preset: 'one_inch' as const,
      backgroundColor: '#438edb',
      outputType: 'image/jpeg' as const,
      dpi: 300 as const,
    };

    const a = await withExplicitCrop.render(input, {
      ...base,
      crop: { x: 0.5, y: 0.5, scale: 1 },
    });
    const b = await withoutCrop.render(input, base);
    expect(Buffer.compare(a.buffer, b.buffer)).not.toBe(0);
  });

  it('returns a quality report with eight items', async () => {
    const input = await makeInput();
    const service = new IdPhotoService({
      segment: async () => ({
        mask: await sharp(Buffer.alloc(600 * 800, 255), {
          raw: { width: 600, height: 800, channels: 1 },
        })
          .png()
          .toBuffer(),
        bounds: { x: 0, y: 0, width: 600, height: 800 },
        faceCount: 1,
      }),
    });
    await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#438edb',
      outputType: 'image/jpeg',
      dpi: 300,
    });
    expect(lastQuality.items.length).toBe(8);
  });
});
```

第 5 个用例依赖一个模块级捕获变量，在 spec 文件顶部加：

```ts
let lastQuality: import('@utils-plane/validators').QualityReport;
```

并在 `IdPhotoService` 实现中每次 render 后把它挂到结果上（见 Step 3），测试里改为从返回值取：

```ts
const result = await service.render(input, { /* ... */ });
expect(result.quality!.items.length).toBe(8);
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/api && bun test test/modules/tasks/services/id-photo.service.spec.ts
```

预期:FAIL —— `density` 为 undefined、`quality` 不存在。

- [ ] **Step 3: 改 import 与类型**

```ts
// id-photo.service.ts 顶部
import {
  estimateSourceBackgroundColors,
  idPhotoPresetSpecs,
  idPhotoTaskConfigSchema,
  inspectIdPhoto,
  idPhotoCropFromLayout,
  resolveIdPhotoCropBox,
  suggestIdPhotoLayout,
  type IdPhotoTaskConfig,
  type QualityReport,
} from '@utils-plane/validators';
import { decontaminateIdPhotoForeground } from '@utils-plane/utils';
import { FaceDetectionService } from './face-detection.service';

export type IdPhotoRenderResult = {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png';
  extension: 'jpg' | 'png';
  /** 质量检查报告；前端结果页据此渲染面板。 */
  quality?: QualityReport;
};
```

- [ ] **Step 4: 删掉旧的底色估计与四个去污染函数**

删除 `estimateSourceBackgroundRgb`(56-93)、`hasNearbySolidForeground`(95-125)、`hasNearbyTransparentBackground`(127-157)、`sampleNearbySolidForegroundRgb`(159-220)、`suppressSourceBackgroundFringe`(222-251)、`replaceBackgroundContaminatedEdgeRgb`(253-314)、`removeUnresolvedBackgroundEdgeAlpha`(316-360)、`decontaminateForegroundRgb`(362-406)。

保留 `hexToRgb`、`colorDistance`、`readRgbAt`（`colorDistance` 与 `readRgbAt` 若再无引用也一并删除；`hexToRgb` 仍被背景合成使用）。

- [ ] **Step 5: 改构造函数**

```ts
@Injectable()
export class IdPhotoService {
  constructor(
    private readonly segmentation: PortraitSegmentationService,
    @Optional() private readonly faces?: FaceDetectionService
  ) {}
```

并在顶部 import 补 `Optional`：

```ts
import { Injectable, Optional } from '@nestjs/common';
```

- [ ] **Step 6: 在 render 里插入自动构图与共享去污染**

替换 `462-530` 行（从 `const oriented = ...` 到 `const finalAlpha = ...`）为：

```ts
const oriented = await sharp(input).rotate().toBuffer();
const orientedMeta = await sharp(oriented).metadata();
const sourceWidth = orientedMeta.width ?? metadata.width;
const sourceHeight = orientedMeta.height ?? metadata.height;

// 裁剪优先级：显式 crop > 人脸自动构图 > 居中
const detected = (await this.faces?.detect(oriented)) ?? [];
const face = detected[0] ?? null;
let crop = config.crop;
let rotation = 0;
if (!crop && face) {
  const layout = suggestIdPhotoLayout(
    face,
    { width: sourceWidth, height: sourceHeight },
    preset.widthPx / preset.heightPx,
    await detectCrownY(mask.mask)
  );
  if (layout) {
    crop = idPhotoCropFromLayout(
      layout,
      { width: sourceWidth, height: sourceHeight },
      preset.widthPx / preset.heightPx
    );
    rotation = layout.rotation;
  }
}

const baseBox = resolveIdPhotoCropBox(
  sourceWidth,
  sourceHeight,
  preset.widthPx,
  preset.heightPx,
  crop
);

const base = await sharp(oriented)
  .extract(baseBox)
  .resize({
    width: preset.widthPx,
    height: preset.heightPx,
    fit: 'cover',
    position: 'centre',
  })
  .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toBuffer();

const maskMeta = await sharp(mask.mask).metadata();
const maskBox = resolveIdPhotoCropBox(
  maskMeta.width ?? sourceWidth,
  maskMeta.height ?? sourceHeight,
  preset.widthPx,
  preset.heightPx,
  crop
);

const resizedAlpha = await sharp(mask.mask)
  .extract(maskBox)
  .resize(preset.widthPx, preset.heightPx, { fit: 'cover' })
  .greyscale()
  .raw()
  .toBuffer();

const baseRgbRaw = await sharp(base).removeAlpha().raw().toBuffer();

// 底色聚类（替换原四角均值），取出现频次最高的那个
const candidates = estimateSourceBackgroundColors(
  baseRgbRaw,
  preset.widthPx,
  preset.heightPx
);
const sourceBackground = candidates[0] ?? { r: 0, g: 0, b: 0 };

// 共享纯函数做去污染，返回 RGBA
const rgba = new Uint8ClampedArray(preset.widthPx * preset.heightPx * 4);
for (let i = 0; i < preset.widthPx * preset.heightPx; i += 1) {
  rgba[i * 4] = baseRgbRaw[i * 3] ?? 0;
  rgba[i * 4 + 1] = baseRgbRaw[i * 3 + 1] ?? 0;
  rgba[i * 4 + 2] = baseRgbRaw[i * 3 + 2] ?? 0;
  rgba[i * 4 + 3] = resizedAlpha[i] ?? 0;
}
const cleaned = decontaminateIdPhotoForeground(
  rgba,
  preset.widthPx,
  preset.heightPx,
  sourceBackground
);

const foregroundRgb = Buffer.alloc(preset.widthPx * preset.heightPx * 3);
const finalAlpha = Buffer.alloc(preset.widthPx * preset.heightPx);
for (let i = 0; i < preset.widthPx * preset.heightPx; i += 1) {
  foregroundRgb[i * 3] = cleaned[i * 4] ?? 0;
  foregroundRgb[i * 3 + 1] = cleaned[i * 4 + 1] ?? 0;
  foregroundRgb[i * 3 + 2] = cleaned[i * 4 + 2] ?? 0;
  finalAlpha[i] = cleaned[i * 4 + 3] ?? 0;
}
```

在类内加一个私有方法（放在 `render` 之后）：

```ts
/**
 * 从分割蒙版取真实头顶（前景最高行）。
 *
 * YuNet 的人脸框起点在发际线附近，不是头顶；用它算头顶留白会偏小。
 * 蒙版不可用时返回 undefined，`suggestIdPhotoLayout` 会自动退回估算。
 */
private async detectCrownY(maskPng: Buffer): Promise<number | undefined> {
  try {
    const { data, info } = await sharp(maskPng)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if ((data[y * info.width + x] ?? 0) > 96) return y;
      }
    }
  } catch {
    // 蒙版读不出来不影响出图
  }
  return undefined;
}
```

- [ ] **Step 7: 改编码段，加 q95 + 4:4:4 + DPI + 质量报告**

替换 `547-570` 行：

```ts
const background = sharp({
  create: {
    width: preset.widthPx,
    height: preset.heightPx,
    channels: 3,
    background: hexToRgb(config.backgroundColor),
  },
})
  .png()
  .composite([{ input: foreground, blend: 'over' }]);

// 质量检查在最终成片上做，faceCount 用真实检测结果
const quality = inspectIdPhoto({
  rgb: baseRgbRaw,
  width: preset.widthPx,
  height: preset.heightPx,
  face,
  faceCount: detected.length,
  alpha: finalAlpha,
});

if (config.outputType === 'image/png') {
  return {
    buffer: await background
      .png({ compressionLevel: 9 })
      .withMetadata({ density: 300 })
      .toBuffer(),
    mimeType: 'image/png',
    extension: 'png',
    quality,
  };
}

return {
  buffer: await background
    .jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .withMetadata({ density: 300 })
    .toBuffer(),
  mimeType: 'image/jpeg',
  extension: 'jpg',
  quality,
};
```

- [ ] **Step 8: 同步 `encodeFinalResult` 的编码参数**

```ts
// 573-604 行内两处 return
if (config.outputType === 'image/png') {
  return {
    buffer: await image.png({ compressionLevel: 9 }).withMetadata({ density: 300 }).toBuffer(),
    mimeType: 'image/png',
    extension: 'png',
  };
}
return {
  buffer: await image
    .flatten({ background: hexToRgb(config.backgroundColor) })
    .jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .withMetadata({ density: 300 })
    .toBuffer(),
  mimeType: 'image/jpeg',
  extension: 'jpg',
};
```

- [ ] **Step 9: 运行测试**

```bash
cd apps/api && bun test test/modules/tasks/services/id-photo.service.spec.ts
```

预期:PASS。第 5 个用例改用 `result.quality!.items.length` 后应返回 8。

- [ ] **Step 10: 提交**

```bash
git add apps/api/src/modules/tasks/services/id-photo.service.ts apps/api/test/modules/tasks/services/id-photo.service.spec.ts
git commit -m "feat(api): 证件照渲染接入自动构图/共享去污染/质量报告/DPI 与 q95 4:4:4"
```

---

### Task 11: 本地路推理升级（photographic + YuNet）

**Files:**
- Modify: `apps/web/src/lib/id-photo-local/model-registry.ts`
- Modify: `apps/web/src/lib/id-photo-local/segmentation.ts`
- Create: `apps/web/src/lib/id-photo-local/face-detection.ts`
- Modify: `apps/web/package.json`

> **Task 8 实测修正（2026-10-20）**：真实 YuNet 权重（OpenCV 2023mar）是
> **640×640 输入、12 个输出张量、0..255 BGR**，不是原计划的 320 / 单 `[N,15]` / 0..1。
> 解码逻辑已于 Task 8 提升到 `packages/utils/src/id-photo-yunet.ts` 共享，
> 本地路必须直接复用，不得重写一份。

**Interfaces:**
- Consumes（全部来自 `@utils-plane/utils`）:
  - `createYunetInputTensor(rawPixels, size, options?)` —— 默认 0..255 + BGR，与生产权重一致
  - `decodeYunetRawOutputs(outputs, { inputWidth, inputHeight, scoreThreshold?, iouThreshold? })`
  - `usesRawYunetLayout(outputNames)` —— 校验确实是 12 输出布局
  - `scaleDetectedFaces(faces, { scaleX, scaleY })`
  - `type DetectedFace`
- Produces:
  - `export const MODNET_MODEL_URL: (base: string) => string`
  - `export const YUNET_MODEL_URL: (base: string) => string`
  - `export const YUNET_INPUT_SIZE = 640`（写在 `model-registry.ts`，与权重一致）
  - `export async function segmentToCutout(file: Blob, tier: ModelTier, ep: LocalEp, options?): Promise<ImageBitmap>`（签名不变）
  - `export async function detectFaces(file: Blob): Promise<DetectedFace[]>`（新增）

- [ ] **Step 1: 加显式 onnxruntime-web 依赖**

```bash
cd apps/web && bun add onnxruntime-web@1.22.0
```

`YUNET` 需要裸 session，`@huggingface/transformers` 不对外暴露，必须显式依赖。版本与 `model-registry.ORT_VERSION` 的 1.22.0-dist 对齐。

- [ ] **Step 2: 改 model-registry**

```ts
// model-registry.ts 全文替换顶部常量与导出（保留 ORT_VERSION 与路径函数不动）
/** 主分割模型：MODNet photographic（证件照专用，Apache-2.0），512×512 保长宽比。 */
export const MODNET_MODEL_FILE = 'modnet_photographic.onnx';
/** 人脸检测：YuNet（MIT），320×320。 */
export const YUNET_MODEL_FILE = 'face_detection_yunet_2023mar.onnx';

export function modnetModelUrl(): string {
  return `${s3Base()}/models/modnet/${MODNET_MODEL_FILE}`;
}

export function yunetModelUrl(): string {
  return `${s3Base()}/models/face/yunet/${YUNET_MODEL_FILE}`;
}

/**
 * 档位。
 *
 * 换 photographic 后体积从 84MB 降到 ~25MB，CPU 也能跑；`high` 档保留给
 * 「photographic 实测破洞 → 用户手动切 RMBG-1.4 fp32」这条退路（见
 * docs/id-photo-model-comparison.md）。
 */
export const ID_PHOTO_MODELS: Record<ModelTier, ModelMeta> = {
  balanced: { dtype: 'fp32', requiresWebGpu: false, sizeBytes: 25 * 1024 * 1024 },
  high: { dtype: 'fp32', requiresWebGpu: true, sizeBytes: 176 * 1024 * 1024 },
};
```

- [ ] **Step 3: 重写 segmentation 的推理段**

```ts
// segmentation.ts —— 替换 segmentToCutout 的实现体
export async function segmentToCutout(
  file: Blob,
  requestedTier: ModelTier,
  ep: LocalEp,
  options: SegmentationOptions = {}
): Promise<ImageBitmap> {
  const { onDownloadProgress, isStale } = options;

  const ortModule = await import('onnxruntime-web');
  const ort = ortModule as unknown as {
    env: { wasm: { wasmPaths: string } };
    InferenceSession: {
      create: (url: string, opts?: { executionProviders?: string[] }) => Promise<{
        inputNames: string[];
        outputNames: string[];
        run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>>;
      }>;
    };
    Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
  };
  if (isStale?.()) throw new StaleSegmentationError();

  ort.env.wasm.wasmPaths = ortWasmPath();

  const meta = ID_PHOTO_MODELS[tierFor(ep === 'webgpu', requestedTier)];
  if (!meta) throw new Error(`unknown model tier: ${requestedTier}`);

  const cacheKey = `${requestedTier}:${meta.sizeBytes}`;
  let session = cachedSessions.get(cacheKey);
  if (!session) {
    onDownloadProgress?.(0);
    session = await ort.InferenceSession.create(modnetModelUrl(), {
      executionProviders: [ep === 'webgpu' ? 'webgpu' : 'wasm'],
    });
    if (isStale?.()) throw new StaleSegmentationError();
    cachedSessions.set(cacheKey, session);
    onDownloadProgress?.(1);
  }

  // 动态尺寸：长边 512、保持长宽比、32 对齐、**不补边**
  // （补边会稳定复现衣服/人脸破洞，见 docs/id-photo-model-comparison.md）
  const bitmap = await createImageBitmap(file);
  const box = modnetInputSize({ width: bitmap.width, height: bitmap.height });
  const inputW = box.width;
  const inputH = box.height;

  const canvas = new OffscreenCanvas(inputW, inputH);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, inputW, inputH);
  const pixels = ctx.getImageData(0, 0, inputW, inputH).data;

  const plane = inputW * inputH;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      tensor[c * plane + i] = ((pixels[i * 4 + c] ?? 0) / 255 - 0.5) / 0.5;
    }
  }

  const result = await session.run({
    [session.inputNames[0]!]: new ort.Tensor('float32', tensor, [1, 3, inputH, inputW]),
  });
  if (isStale?.()) throw new StaleSegmentationError();

  const matte = result[session.outputNames[0]!]!.data;

  // 蒙版缩放回原尺寸 → 作为 alpha 与原图合成（输入没有补边，直接用整张蒙版）
  const matteCanvas = new OffscreenCanvas(inputW, inputH);
  const mctx = matteCanvas.getContext('2d')!;
  const imageData = mctx.createImageData(inputW, inputH);
  for (let i = 0; i < plane; i += 1) {
    const a = Math.max(0, Math.min(255, Math.round((matte[i] ?? 0) * 255)));
    imageData.data[i * 4] = 255;
    imageData.data[i * 4 + 1] = 255;
    imageData.data[i * 4 + 2] = 255;
    imageData.data[i * 4 + 3] = a;
  }
  mctx.putImageData(imageData, 0, 0);

  const out = new OffscreenCanvas(bitmap.width, bitmap.height);
  const octx = out.getContext('2d')!;
  octx.drawImage(bitmap, 0, 0);
  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(
    matteCanvas,
    0,
    0,
    inputW,
    inputH,
    0,
    0,
    bitmap.width,
    bitmap.height
  );
  octx.globalCompositeOperation = 'source-over';

  const cutout = await createImageBitmap(out);
  bitmap.close?.();
  return cutout;
}
```

同文件顶部加模块级缓存与常量：

```ts
type OrtSession = Awaited<ReturnType<typeof createOrtSession>>;
const cachedSessions = new Map<string, OrtSession>();
```

并从共享包 import 尺寸函数（不要在本文件重定义）：

```ts
import { modnetInputSize } from '@utils-plane/utils';
```

并把原 `cached`（transformers pipeline 缓存）与 `resetSegmentationCacheForTests` 改为清空 `cachedSessions`：

```ts
export function resetSegmentationCacheForTests(): void {
  cachedSessions.clear();
}
```

删除对 `@huggingface/transformers` 的 import 与 `tf.pipeline` 相关代码（`background-removal` pipeline 不再使用）。

- [ ] **Step 4: 写 YuNet 本地推理**

```ts
// apps/web/src/lib/id-photo-local/face-detection.ts
/**
 * 本地人脸检测（YuNet，onnxruntime-web）。
 *
 * 为什么不用 transformers.js：它不对外暴露裸 InferenceSession，而 YuNet 不是
 * 它支持的 pipeline 任务。这里直接用 onnxruntime-web，与分割共用同一份 wasm
 * 运行时路径（见 model-registry.ortWasmPath）。
 *
 * 解码、NMS、输入尺寸推导、坐标映射全部来自 packages/utils 的共享实现 ——
 * 服务端（onnxruntime-node）与本地路必须得出完全相同的人脸框，否则同一张图在
 * 两种处理模式下会被自动构图裁到不同位置。
 *
 * 检测失败一律返回空数组：自动构图是增强，失败时退回居中裁剪即可，不该让整张
 * 证件照失败。
 */

import {
  createYunetInputTensor,
  decodeYunetRawOutputs,
  scaleDetectedFaces,
  usesRawYunetLayout,
  type DetectedFace,
} from '@utils-plane/utils';
import {
  YUNET_INPUT_SIZE,
  ortWasmPath,
  yunetModelUrl,
} from './model-registry';

type OrtLike = {
  env: { wasm: { wasmPaths: string } };
  InferenceSession: {
    create: (url: string) => Promise<{
      inputNames: string[];
      outputNames: string[];
      run: (
        feeds: Record<string, unknown>
      ) => Promise<
        Record<string, { data: Float32Array; dims: readonly number[] } | undefined>
      >;
    }>;
  };
  Tensor: new (
    type: 'float32',
    data: Float32Array,
    dims: number[]
  ) => unknown;
};

type CachedSession = Awaited<ReturnType<OrtLike['InferenceSession']['create']>>;

let ortModule: OrtLike | null = null;
let sessionPromise: Promise<CachedSession> | null = null;

async function getOrt(): Promise<OrtLike> {
  if (!ortModule) {
    ortModule = (await import('onnxruntime-web')) as unknown as OrtLike;
    ortModule.env.wasm.wasmPaths = ortWasmPath();
  }
  return ortModule;
}

async function getSession(): Promise<CachedSession> {
  if (!sessionPromise) {
    const ort = await getOrt();
    sessionPromise = ort.InferenceSession.create(yunetModelUrl()).catch(err => {
      // 加载失败不能缓存 rejected promise，否则下一次调用永远拿不到重试机会。
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

/** 仅供测试。 */
export function resetFaceDetectionCacheForTests(): void {
  sessionPromise = null;
}

export async function detectFaces(file: Blob): Promise<DetectedFace[]> {
  try {
    const ort = await getOrt();
    const session = await getSession();

    // 我们自托管的权重是官方 2023mar，固定 640。浏览器端的 session 不保证
    // 暴露 inputMetadata，因此以已知常量为准，不静默回落 320。
    const size = YUNET_INPUT_SIZE;

    const bitmap = await createImageBitmap(file);
    const srcWidth = bitmap.width;
    const srcHeight = bitmap.height;

    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, size, size);
    const rgba = ctx.getImageData(0, 0, size, size).data;
    bitmap.close?.();

    // canvas 给的是 RGBA；共享的 tree 构造假定紧密排列的 3 通道，
    // 这里先剥掉 A 通道，避免步长错位（步长错位不会报错，只会给出离谱的框）。
    const rgb = new Uint8ClampedArray(size * size * 3);
    for (let i = 0; i < size * size; i += 1) {
      rgb[i * 3] = rgba[i * 4] ?? 0;
      rgb[i * 3 + 1] = rgba[i * 4 + 1] ?? 0;
      rgb[i * 3 + 2] = rgba[i * 4 + 2] ?? 0;
    }

    // 默认参数就是生产参数：0..255 + BGR。
    const tensor = createYunetInputTensor(rgb, size);

    const result = await session.run({
      [session.inputNames[0]!]: new ort.Tensor('float32', tensor, [
        1,
        3,
        size,
        size,
      ]),
    });

    if (!usesRawYunetLayout(session.outputNames)) {
      throw new Error(
        `unexpected YuNet output layout: ${session.outputNames.join(', ')}`
      );
    }

    const faces = decodeYunetRawOutputs(result, {
      inputWidth: size,
      inputHeight: size,
    });

    return scaleDetectedFaces(faces, {
      scaleX: srcWidth / size,
      scaleY: srcHeight / size,
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[id-photo-local] face detection unavailable:', error);
    }
    return [];
  }
}
```

- [ ] **Step 5: 在 model-registry 里声明 640**

```ts
/// 本地人脸检测：YuNet（MIT），官方 2023mar 权重固定 640×640 输入。
/// 这个常量必须与自托管权重一致；写错不会报错，只会静默检测不到人脸。
export const YUNET_INPUT_SIZE = 640;
```

- [ ] **Step 6: 构建验证**

```bash
cd apps/web && bun run build 2>&1 | tail -20
```

预期:构建成功，无 `onnxruntime-web` 解析错误，无 `@huggingface/transformers` 残留引用。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/lib/id-photo-local/model-registry.ts apps/web/src/lib/id-photo-local/segmentation.ts apps/web/src/lib/id-photo-local/face-detection.ts apps/web/package.json
git commit -m "feat(web): 本地路换 photographic 512 保长宽比,新增 YuNet 人脸检测"
```

---

### Task 12: 本地路合成增强（去污染 + DPI + 旋转）

**Files:**
- Modify: `apps/web/src/lib/id-photo-local/composite.ts`
- Create: `apps/web/src/lib/id-photo-local/dpi-metadata.ts`
- Test: `apps/web/test/lib/id-photo-local/dpi-metadata.test.ts`

**Interfaces:**
- Consumes: `decontaminateIdPhotoForeground` from `@utils-plane/utils`; `estimateSourceBackgroundColors` from `@utils-plane/validators`
- Produces:
  - `export async function compositeIdPhoto(cutout: ImageBitmap, backgroundColor: string, presetW: number, presetH: number, outputType: 'image/jpeg' | 'image/png', crop?: IdPhotoCrop, rotation?: number): Promise<Blob>`（新增第 7 个参数）
  - `export async function writeDpi(blob: Blob, dpi?: number): Promise<Blob>`
  - `export function injectJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array`
  - `export function injectPngDpi(bytes: Uint8Array, dpi: number): Uint8Array`

- [ ] **Step 1: 写 DPI 注入的失败测试**

```ts
// apps/web/test/lib/id-photo-local/dpi-metadata.test.ts
import { describe, expect, it } from 'vitest';
import { injectJpegDpi, injectPngDpi } from '@/lib/id-photo-local/dpi-metadata';

/** 最小的合法 JPEG 头：SOI + APP0 + EOI。足以验证段插入逻辑。 */
function minimalJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xd9, // EOI
  ]);
}

/** 最小的合法 PNG 头：签名 + IHDR。 */
function minimalPng(): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = new Uint8Array([
    0, 0, 0, 1, // width 1
    0, 0, 0, 1, // height 1
    8, 6, 0, 0, 0, // bit depth 8, color type 6, rest 0
  ]);
  const ihdr = new Uint8Array([
    0, 0, 0, 13, // length
    73, 72, 68, 82, // 'IHDR'
    ...ihdrData,
    0, 0, 0, 0, // crc placeholder
  ]);
  const out = new Uint8Array(signature.length + ihdr.length);
  out.set(signature, 0);
  out.set(ihdr, signature.length);
  return out;
}

describe('injectJpegDpi', () => {
  it('inserts an APP1 Exif segment carrying 300 dpi', () => {
    const out = injectJpegDpi(minimalJpeg(), 300);
    const bytes = Array.from(out);

    // SOI 之后紧跟 APP1
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    expect(bytes[2]).toBe(0xff);
    expect(bytes[3]).toBe(0xe1);

    const asLatin = new TextDecoder('latin1').decode(out);
    expect(asLatin).toContain('Exif');
  });

  it('is idempotent for already-tagged images', () => {
    const once = injectJpegDpi(minimalJpeg(), 300);
    const twice = injectJpegDpi(once, 300);
    const count = () => (new TextDecoder('latin1').decode(twice).match(/Exif/g) ?? []).length;
    expect(count()).toBe(1);
  });
});

describe('injectPngDpi', () => {
  it('inserts a pHYs chunk after IHDR', () => {
    const out = injectPngDpi(minimalPng(), 300);
    const ascii = new TextDecoder('latin1').decode(out);
    expect(ascii).toContain('pHYs');
    // pHYs 必须出现在 IHDR 之后
    expect(ascii.indexOf('pHYs')).toBeGreaterThan(ascii.indexOf('IHDR'));
  });

  it('encodes 300 dpi as 11811 pixels per metre', () => {
    const out = injectPngDpi(minimalPng(), 300);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const idx = new TextDecoder('latin1').decode(out).indexOf('pHYs');
    // 4 字节长度 + 4 字节类型 + 4 字节 X + 4 字节 Y + 1 字节 unit
    const ppuX = view.getUint32(idx + 4);
    const ppuY = view.getUint32(idx + 8);
    expect(ppuX).toBe(11811);
    expect(ppuY).toBe(11811);
    expect(view.getUint8(idx + 12)).toBe(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/web && bun run test test/lib/id-photo-local/dpi-metadata.test.ts
```

预期:FAIL,module not found。

- [ ] **Step 3: 实现 DPI 注入**

```ts
// apps/web/src/lib/id-photo-local/dpi-metadata.ts
/**
 * 给 canvas 产物补写 DPI 元数据。
 *
 * canvas 的 `toBlob` 不写任何分辨率信息 —— 拿到的是「295×413 像素，但没有密度」
 * 的文件，打印时会按 72dpi 解释成 10×14cm 的巨幅照片。而证件照的像素规格本身
 * 就是按 300dpi 定的（295px ≈ 25mm），必须把密度写回去，拼版与冲印才对得上。
 *
 * 两条路径都是纯二进制操作，不引第三方库：
 * - JPEG：插入 APP1 Exif 段，XResolution/YResolution = dpi，ResolutionUnit = 2 (inch)
 * - PNG：插入 pHYs chunk，pixels-per-unit = dpi / 0.0254
 */

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) {
    crc ^= bytes[i]!;
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 构造最小的 TIFF 结构 Exif 载荷，只含 XResolution/YResolution/ResolutionUnit。 */
function buildExifPayload(dpi: number): Uint8Array {
  // TIFF header (8) + IFD (2 + 3*12 + 4) + rational data (2 * 8) = 54
  const out = new Uint8Array(54);
  const view = new DataView(out.buffer);

  // TIFF header，小端
  out[0] = 0x49;
  out[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true); // 指向 IFD0

  // IFD0：3 个条目
  view.setUint16(8, 3, true);

  // (1) XResolution (0x011A) = RATIONAL @ offset 38
  view.setUint16(10, 0x011a, true);
  view.setUint16(12, 5, true); // RATIONAL
  view.setUint32(14, 1, true);
  view.setUint32(18, 38, true);
  view.setUint32(38, dpi, true);
  view.setUint32(42, 1, true);

  // (2) YResolution (0x011B) = RATIONAL @ offset 46
  view.setUint16(22, 0x011b, true);
  view.setUint16(24, 5, true);
  view.setUint32(26, 1, true);
  view.setUint32(30, 46, true);
  view.setUint32(46, dpi, true);
  view.setUint32(50, 1, true);

  // (3) ResolutionUnit (0x0128) = SHORT = 2 (inch)，内联在 IFD 里
  view.setUint16(34, 0x0128, true);
  view.setUint16(36, 3, true);
  view.setUint32(38 - 4 + 4, 1, true);

  return out;
}

/**
 * 在 SOI 之后插入 APP1 Exif 段。
 *
 * 已经有 Exif 的原样返回，避免重复插入把文件撑大。
 */
export function injectJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;

  // 已存在 APP1 Exif 就不动
  if (
    bytes.length > 6 &&
    bytes[2] === 0xff &&
    bytes[3] === 0xe1 &&
    bytes[6] === 0x45 &&
    bytes[7] === 0x78
  ) {
    return bytes;
  }

  const tiff = buildExifPayload(dpi);
  const identifier = new Uint8Array([
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // 'Exif\0\0'
  ]);
  const payloadLength = identifier.length + tiff.length;
  const app1 = new Uint8Array(4 + payloadLength);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  // APP1 长度字段包含它自己（2 字节），不含标记本身
  app1[2] = ((payloadLength + 2) >> 8) & 0xff;
  app1[3] = (payloadLength + 2) & 0xff;
  app1.set(identifier, 4);
  app1.set(tiff, 4 + identifier.length);

  const out = new Uint8Array(bytes.length + app1.length);
  out.set(bytes.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(bytes.subarray(2), 2 + app1.length);
  return out;
}

/**
 * 在 IHDR 之后插入 pHYs chunk。
 *
 * pHYs 是 PNG 唯一表达物理像素密度的标准块，单位固定为「每米像素数」。
 */
export function injectPngDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  // PNG 签名 8 字节，IHDR 固定为 8(sig) + 4(len) + 4(type) + 13(data) + 4(crc) = 33
  if (bytes.length < 33) return bytes;

  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));
  if (ascii(12, 16) !== 'IHDR') return bytes;

  // pHYs：4(len) + 4(type) + 9(data) + 4(crc)
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  const ppm = Math.round(dpi / 0.0254); // 300 dpi ≈ 11811 px/m

  view.setUint32(0, 9); // data length
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  view.setUint32(17, crc32(chunk, 4, 17));

  const insertAt = 33;
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(bytes.subarray(insertAt), insertAt + chunk.length);
  return out;
}

/** 按 blob 的实际类型分派，返回带 DPI 的新 blob。 */
export async function writeDpi(blob: Blob, dpi = 300): Promise<Blob> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const tagged =
      blob.type === 'image/png' ? injectPngDpi(bytes, dpi) : injectJpegDpi(bytes, dpi);
    return new Blob([tagged], { type: blob.type });
  } catch {
    // 注入失败不能阻断下载
    return blob;
  }
}
```

- [ ] **Step 4: 运行 DPI 测试**

```bash
cd apps/web && bun run test test/lib/id-photo-local/dpi-metadata.test.ts
```

预期:PASS,4 个用例全过。

- [ ] **Step 5: 改写 composite.ts**

```ts
import {
  estimateSourceBackgroundColors,
  resolveIdPhotoCropBox,
  type IdPhotoCrop,
} from '@utils-plane/validators';
import { decontaminateIdPhotoForeground } from '@utils-plane/utils';
import { writeDpi } from './dpi-metadata';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`invalid background color: ${hex}`);
  const v = m[1]!;
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

/**
 * 把透明抠图叠到纯色背景上，按 crop 解算出的框裁剪并缩放到目标像素。
 *
 * 剪辑几何一律走 validators 的 resolveIdPhotoCropBox —— 服务端 sharp 路径用的是
 * 同一个函数，这样同一组 crop 参数在本地与服务端产出完全一致的构图。
 *
 * 边缘去污染走共享的 decontaminateIdPhotoForeground（反预乘 + 溢色替换）：
 * 抠图 alpha 再干净，边缘像素的 RGB 仍是「前景 × a + 原背景 × (1-a)」，
 * 不还原就会在新底色上留下原背景色的光晕。
 *
 * @param cutout 抠图产出的透明 ImageBitmap（自带 alpha）
 * @param rotation 自动构图算出的旋转角（度，逆时针为正），0 表示不转
 */
export async function compositeIdPhoto(
  cutout: ImageBitmap,
  backgroundColor: string,
  presetW: number,
  presetH: number,
  outputType: 'image/jpeg' | 'image/png',
  crop?: IdPhotoCrop,
  rotation = 0
): Promise<Blob> {
  const { r, g, b } = hexToRgb(backgroundColor);
  const box = resolveIdPhotoCropBox(
    cutout.width,
    cutout.height,
    presetW,
    presetH,
    crop
  );

  // 1) 先估计原底色（用在去污染的反预乘上）
  const srcCanvas = new OffscreenCanvas(cutout.width, cutout.height);
  const sctx = srcCanvas.getContext('2d')!;
  sctx.drawImage(cutout, 0, 0);
  const srcData = sctx.getImageData(0, 0, cutout.width, cutout.height);

  const rgbTriples = new Uint8ClampedArray(cutout.width * cutout.height * 3);
  for (let i = 0; i < cutout.width * cutout.height; i += 1) {
    rgbTriples[i * 3] = srcData.data[i * 4] ?? 0;
    rgbTriples[i * 3 + 1] = srcData.data[i * 4 + 1] ?? 0;
    rgbTriples[i * 3 + 2] = srcData.data[i * 4 + 2] ?? 0;
  }
  const sourceBackground =
    estimateSourceBackgroundColors(rgbTriples, cutout.width, cutout.height)[0] ?? {
      r: 255,
      g: 255,
      b: 255,
    };

  // 2) 去污染后写回
  const cleaned = decontaminateIdPhotoForeground(
    srcData.data,
    cutout.width,
    cutout.height,
    sourceBackground
  );
  sctx.putImageData(new ImageData(cleaned, cutout.width, cutout.height), 0, 0);

  // 3) 合成：纯色底 + 裁剪框内的前景（可选旋转）
  const out = new OffscreenCanvas(presetW, presetH);
  const octx = out.getContext('2d')!;
  octx.fillStyle = `rgb(${r},${g},${b})`;
  octx.fillRect(0, 0, presetW, presetH);

  if (rotation) {
    octx.translate(presetW / 2, presetH / 2);
    octx.rotate((-rotation * Math.PI) / 180);
    octx.translate(-presetW / 2, -presetH / 2);
  }

  octx.drawImage(
    srcCanvas,
    box.left,
    box.top,
    box.width,
    box.height,
    0,
    0,
    presetW,
    presetH
  );

  const blob = await out.convertToBlob({
    type: outputType,
    quality: outputType === 'image/jpeg' ? 0.95 : undefined,
  });

  // 4) 写回 300dpi：canvas 不写密度，打印会按 72dpi 解释
  return writeDpi(blob, 300);
}
```

- [ ] **Step 6: 加 composite 的测试**

```ts
// apps/web/test/lib/id-photo-local/composite.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const decontaminate = vi.fn((rgba: Uint8ClampedArray) => rgba);
vi.mock('@utils-plane/utils', () => ({
  decontaminateIdPhotoForeground: (...args: unknown[]) =>
    decontaminate(...(args as [Uint8ClampedArray])),
}));

const writeDpi = vi.fn(async (blob: Blob) => blob);
vi.mock('@/lib/id-photo-local/dpi-metadata', () => ({ writeDpi }));

describe('compositeIdPhoto', () => {
  beforeEach(() => {
    decontaminate.mockClear();
    writeDpi.mockClear();
  });

  it('calls the shared decontamination and DPI injection', async () => {
    const { compositeIdPhoto } = await import('@/lib/id-photo-local/composite');

    const fakeBitmap = {
      width: 100,
      height: 140,
      close: vi.fn(),
    } as unknown as ImageBitmap;

    // jsdom 没有 OffscreenCanvas，替换成最小桩
    const ctx = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(128),
      }),
      putImageData: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      set fillStyle(_v: string) {},
      get fillStyle() {
        return '#000';
      },
    };
    // @ts-expect-error test stub
    globalThis.OffscreenCanvas = class {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return ctx;
      }
      convertToBlob(opts: { type: string }) {
        return Promise.resolve(new Blob(['x'], { type: opts.type }));
      }
    };
    // @ts-expect-error test stub
    globalThis.ImageData = class {
      data: Uint8ClampedArray;
      constructor(data: Uint8ClampedArray) {
        this.data = data;
      }
    };

    await compositeIdPhoto(fakeBitmap, '#438edb', 295, 413, 'image/jpeg');

    expect(decontaminate).toHaveBeenCalledTimes(1);
    expect(writeDpi).toHaveBeenCalledTimes(1);
    expect(writeDpi.mock.calls[0]![1]).toBe(300);
  });
});
```

- [ ] **Step 7: 运行 web 测试**

```bash
cd apps/web && bun run test test/lib/id-photo-local
```

预期:PASS。

- [ ] **Step 8: 提交**

```bash
git add apps/web/src/lib/id-photo-local/composite.ts apps/web/src/lib/id-photo-local/dpi-metadata.ts apps/web/test/lib/id-photo-local/composite.test.ts apps/web/test/lib/id-photo-local/dpi-metadata.test.ts
git commit -m "feat(web): 本地合成接入共享去污染、旋转与 DPI 注入"
```


---

### Task 13: 本地路编排(人脸 → 构图 → 合成 → 质量)

**Files:**
- Modify: `apps/web/src/lib/id-photo-local/use-local-id-photo.ts`
- Test: `apps/web/test/lib/id-photo-local/use-local-id-photo.test.tsx`

**Interfaces:**
- Consumes: `detectFaces` from `./face-detection`; `compositeIdPhoto` from `./composite`; `segmentToCutout` from `./segmentation`; `suggestIdPhotoLayout`, `idPhotoCropFromLayout`, `inspectIdPhoto`, `type IdPhotoLayout`, `type QualityReport` from `@utils-plane/validators`
- Produces:
  - `UseLocalIdPhoto` 追加字段:
    - `autoLayout: IdPhotoLayout | null` —— 首次处理算出的构图,供页面回填裁剪框
    - `userOverride: boolean` —— 用户是否手动改过裁剪框
    - `markUserOverride: () => void`
    - `quality: QualityReport | null`
  - `process` 的 `opts` 追加 `autoFrame?: boolean` —— 页面在「用户没手动改过」时传 `true`

- [ ] **Step 1: 写失败测试**

追加到 `apps/web/test/lib/id-photo-local/use-local-id-photo.test.tsx`(文件不存在则新建):

```tsx
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const segmentToCutout = vi.fn();
const detectFaces = vi.fn();
const compositeIdPhoto = vi.fn();

vi.mock('@/lib/id-photo-local/segmentation', () => ({
  segmentToCutout: (...args: unknown[]) => segmentToCutout(...args),
  detectLocalEp: async () => 'wasm',
  isStaleSegmentation: () => false,
}));
vi.mock('@/lib/id-photo-local/face-detection', () => ({
  detectFaces: (...args: unknown[]) => detectFaces(...args),
}));
vi.mock('@/lib/id-photo-local/composite', () => ({
  compositeIdPhoto: (...args: unknown[]) => compositeIdPhoto(...args),
}));

const face = {
  box: { x: 100, y: 120, width: 240, height: 240 },
  landmarks: [
    [150, 200],
    [290, 200],
    [220, 240],
    [190, 280],
    [250, 280],
  ] as Array<[number, number]>,
  score: 0.95,
};

describe('useLocalIdPhoto auto framing', () => {
  beforeEach(() => {
    segmentToCutout.mockReset();
    detectFaces.mockReset();
    compositeIdPhoto.mockReset();

    segmentToCutout.mockResolvedValue({
      width: 1200,
      height: 1600,
      close: vi.fn(),
    });
    compositeIdPhoto.mockResolvedValue(new Blob(['ok'], { type: 'image/jpeg' }));
  });

  it('computes an auto layout on the first run', async () => {
    detectFaces.mockResolvedValue([face]);
    const { useLocalIdPhoto } = await import(
      '@/lib/id-photo-local/use-local-id-photo'
    );
    const { result } = renderHook(() => useLocalIdPhoto());

    await act(async () => {
      await result.current.process(
        new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
        'balanced',
        {
          preset: 'one_inch',
          backgroundColor: '#438edb',
          outputType: 'image/jpeg',
          autoFrame: true,
        }
      );
    });

    expect(result.current.autoLayout).not.toBeNull();
    expect(result.current.userOverride).toBe(false);
    const passedCrop = compositeIdPhoto.mock.calls[0]![5];
    expect(passedCrop).toBeDefined();
    expect(passedCrop.scale).toBeGreaterThanOrEqual(1);
  });

  it('stops auto framing once the user overrides the crop', async () => {
    detectFaces.mockResolvedValue([face]);
    const { useLocalIdPhoto } = await import(
      '@/lib/id-photo-local/use-local-id-photo'
    );
    const { result } = renderHook(() => useLocalIdPhoto());

    act(() => result.current.markUserOverride());

    const manual = { x: 0.4, y: 0.3, scale: 1.5 };
    await act(async () => {
      await result.current.process(
        new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
        'balanced',
        {
          preset: 'one_inch',
          backgroundColor: '#438edb',
          outputType: 'image/jpeg',
          crop: manual,
          autoFrame: false,
        }
      );
    });

    expect(detectFaces).not.toHaveBeenCalled();
    expect(result.current.autoLayout).toBeNull();
    expect(compositeIdPhoto.mock.calls[0]![5]).toEqual(manual);
  });

  it('falls back to the manual crop when no face is detected', async () => {
    detectFaces.mockResolvedValue([]);
    const { useLocalIdPhoto } = await import(
      '@/lib/id-photo-local/use-local-id-photo'
    );
    const { result } = renderHook(() => useLocalIdPhoto());

    const manual = { x: 0.5, y: 0.5, scale: 1 };
    await act(async () => {
      await result.current.process(
        new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
        'balanced',
        {
          preset: 'one_inch',
          backgroundColor: '#438edb',
          outputType: 'image/jpeg',
          crop: manual,
          autoFrame: true,
        }
      );
    });

    expect(result.current.autoLayout).toBeNull();
    expect(result.current.status).toBe('done');
    expect(compositeIdPhoto.mock.calls[0]![5]).toEqual(manual);
  });

  it('produces a quality report after compositing', async () => {
    detectFaces.mockResolvedValue([face]);
    const { useLocalIdPhoto } = await import(
      '@/lib/id-photo-local/use-local-id-photo'
    );
    const { result } = renderHook(() => useLocalIdPhoto());

    await act(async () => {
      await result.current.process(
        new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
        'balanced',
        {
          preset: 'one_inch',
          backgroundColor: '#438edb',
          outputType: 'image/jpeg',
          autoFrame: true,
        }
      );
    });

    expect(result.current.quality).not.toBeNull();
    expect(result.current.quality!.items.length).toBe(8);
  });

  it('reset clears autoLayout, userOverride and quality', async () => {
    const { useLocalIdPhoto } = await import(
      '@/lib/id-photo-local/use-local-id-photo'
    );
    const { result } = renderHook(() => useLocalIdPhoto());

    act(() => result.current.markUserOverride());
    act(() => result.current.reset());

    expect(result.current.userOverride).toBe(false);
    expect(result.current.autoLayout).toBeNull();
    expect(result.current.quality).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/web && bun run test test/lib/id-photo-local/use-local-id-photo.test.tsx
```

预期:FAIL —— `autoLayout` / `userOverride` / `quality` 都不是 hook 的返回值。

- [ ] **Step 3: 改 import 与接口**

```ts
// use-local-id-photo.ts —— 替换顶部 import
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  idPhotoPresetSpecs,
  idPhotoCropFromLayout,
  inspectIdPhoto,
  suggestBrightnessAdjustment,
  suggestIdPhotoLayout,
  type IdPhotoCrop,
  type IdPhotoLayout,
  type IdPhotoOutputType,
  type IdPhotoPreset,
  type QualityReport,
} from '@utils-plane/validators';
import { compositeIdPhoto } from './composite';
import { detectFaces } from './face-detection';
import { type ModelTier } from './model-registry';
import {
  detectLocalEp,
  isStaleSegmentation,
  segmentToCutout,
  type LocalEp,
} from './segmentation';

export type { LocalEp };

const IS_DEV = process.env.NODE_ENV !== 'production';

export type LocalStage =
  | 'idle'
  | 'loading-model'
  | 'running'
  | 'compositing'
  | 'done'
  | 'error';

export interface UseLocalIdPhoto {
  status: LocalStage;
  progress: number;
  ep: LocalEp | null;
  error: string | null;
  resultBlob: Blob | null;
  /** 首次处理算出的自动构图；页面据此回填裁剪框。 */
  autoLayout: IdPhotoLayout | null;
  /** 用户是否手动改过裁剪框；true 时后续不再自动构图。 */
  userOverride: boolean;
  /** 成片质量报告；未处理或处理中为 null。 */
  quality: QualityReport | null;
  process: (
    file: File,
    tier: ModelTier,
    opts: {
      preset: IdPhotoPreset;
      backgroundColor: string;
      outputType: IdPhotoOutputType;
      crop?: IdPhotoCrop;
      /** 用户没手动改过裁剪框时传 true，才会跑人脸自动构图。 */
      autoFrame?: boolean;
    }
  ) => Promise<void>;
  markUserOverride: () => void;
  reset: () => void;
}
```

- [ ] **Step 4: 加状态**

```ts
// 在既有 state 声明之后追加
const [autoLayout, setAutoLayout] = useState<IdPhotoLayout | null>(null);
const [userOverride, setUserOverride] = useState(false);
const [quality, setQuality] = useState<QualityReport | null>(null);

const markUserOverride = useCallback(() => {
  setUserOverride(true);
}, []);
```

- [ ] **Step 5: 重写 process 的合成段**

把原 `setStatus('compositing');` 到 `finally { cutoutBitmap.close?.(); }` 之前整段替换为:

```ts
        setStatus('compositing');

        try {
          const spec = idPhotoPresetSpecs[opts.preset];
          if (!spec) throw new Error(`unknown preset: ${opts.preset}`);
          const targetAspect = spec.widthPx / spec.heightPx;
          const sourceSize = {
            width: cutoutBitmap.width,
            height: cutoutBitmap.height,
          };

          // 1) 只在「用户没手动改过」时才自动构图
          let crop = opts.crop;
          let rotation = 0;
          let layout: IdPhotoLayout | null = null;
          let faces: Awaited<ReturnType<typeof detectFaces>> = [];

          if (opts.autoFrame) {
            faces = await detectFaces(file);
            if (isStale()) return;
            const face = faces[0] ?? null;
            if (face) {
              layout = suggestIdPhotoLayout(face, sourceSize, targetAspect);
              if (layout) {
                crop = idPhotoCropFromLayout(layout, sourceSize, targetAspect);
                rotation = layout.rotation;
              }
            }
          }

          // 2) 源图像素：亮度校正与质量检查共用同一份
          const srcCanvas = new OffscreenCanvas(
            cutoutBitmap.width,
            cutoutBitmap.height
          );
          const sctx = srcCanvas.getContext('2d')!;
          sctx.drawImage(cutoutBitmap, 0, 0);
          const srcData = sctx.getImageData(
            0,
            0,
            cutoutBitmap.width,
            cutoutBitmap.height
          );

          const pixelCount = cutoutBitmap.width * cutoutBitmap.height;
          let meanSum = 0;
          for (let i = 0; i < srcData.data.length; i += 4) {
            if ((srcData.data[i + 3] ?? 0) === 0) continue;
            meanSum +=
              ((srcData.data[i] ?? 0) +
                (srcData.data[i + 1] ?? 0) +
                (srcData.data[i + 2] ?? 0)) /
              3;
          }
          const brightness = opts.autoFrame
            ? suggestBrightnessAdjustment(meanSum / Math.max(1, pixelCount))
            : 0;

          // 3) 合成（去污染 + 旋转 + 亮度 + DPI 都在 composite 内完成）
          const blob = await compositeIdPhoto(
            cutoutBitmap,
            opts.backgroundColor,
            spec.widthPx,
            spec.heightPx,
            opts.outputType,
            crop,
            rotation,
            brightness
          );
          if (isStale()) return;

          // 4) 质量检查：源图 + 人脸 + 原始 alpha
          const alphaChannel = new Uint8ClampedArray(pixelCount);
          for (let i = 0; i < pixelCount; i += 1) {
            alphaChannel[i] = srcData.data[i * 4 + 3] ?? 0;
          }

          setAutoLayout(layout);
          setQuality(
            inspectIdPhoto({
              rgb: srcData.data,
              width: cutoutBitmap.width,
              height: cutoutBitmap.height,
              face: faces[0] ?? null,
              faceCount: faces.length,
              alpha: alphaChannel,
            })
          );
          setResultBlob(blob);
          setStatus('done');
        } finally {
          cutoutBitmap.close?.();
        }
```

- [ ] **Step 6: 更新 reset 与返回值**

```ts
// reset 内追加三行
    setAutoLayout(null);
    setUserOverride(false);
    setQuality(null);
```

```ts
// 返回
  return {
    status,
    progress,
    ep,
    error,
    resultBlob,
    autoLayout,
    userOverride,
    quality,
    process,
    markUserOverride,
    reset,
  };
```

- [ ] **Step 7: 运行测试**

```bash
cd apps/web && bun run test test/lib/id-photo-local/use-local-id-photo.test.tsx
```

预期:PASS,5 个用例全过。若 `quality.items.length` 不是 8,检查是否传了 `alpha`(没有 alpha 时是 7 项)。

- [ ] **Step 8: 提交**

```bash
git add apps/web/src/lib/id-photo-local/use-local-id-photo.ts apps/web/test/lib/id-photo-local/use-local-id-photo.test.tsx
git commit -m "feat(web): 本地路编排自动构图、userOverride 与质量报告"
```

---

### Task 14: 质量面板 UI

**Files:**
- Create: `apps/web/src/components/tools/id-photo-quality-panel.tsx`
- Modify: `apps/web/messages/zh.json`、`apps/web/messages/en.json`
- Test: `apps/web/test/components/tools/id-photo-quality-panel.test.tsx`

**Interfaces:**
- Consumes: `type QualityReport` from `@utils-plane/validators`
- Produces:
  - `export function IdPhotoQualityPanel({ report, t }: { report: QualityReport | null; t: (key: string) => string }): JSX.Element`

- [ ] **Step 1: 加 i18n 文案**

在 `apps/web/messages/zh.json` 的 `ImageIdPhoto` 段内追加:

```json
"quality": {
  "title": "质量检查",
  "score": "评分 {score}",
  "passed": "检查通过",
  "needsAttention": "需注意:{items}",
  "unavailable": "检查不可用",
  "items": {
    "faceCount": "人脸数量",
    "faceCentered": "人脸位置",
    "faceRatio": "人脸比例",
    "eyeTilt": "眼线水平",
    "headroom": "头顶留白",
    "sharpness": "清晰度",
    "exposure": "曝光",
    "matteEdge": "抠图边缘"
  },
  "hints": {
    "singleFrontalPortrait": "建议使用单人正面照片",
    "adjustHorizontalPosition": "可水平拖动裁剪框微调",
    "faceRatioRange": "建议人脸宽度约占成片 26% 至 42%",
    "levelEyes": "可重新拍摄或微调旋转",
    "headroomTooSmall": "头顶不宜贴住上边缘",
    "faceNotDetected": "未检测到清晰人脸",
    "avoidBlurrySource": "原图较模糊,会影响抠图与打印",
    "avoidUnderexposedOrBlown": "避免整体过暗或过曝",
    "checkHairAndShoulder": "请检查发丝、耳廓与肩线"
  }
}
```

`apps/web/messages/en.json` 的同段追加:

```json
"quality": {
  "title": "Quality check",
  "score": "Score {score}",
  "passed": "All checks passed",
  "needsAttention": "Needs attention: {items}",
  "unavailable": "Check unavailable",
  "items": {
    "faceCount": "Face count",
    "faceCentered": "Face position",
    "faceRatio": "Face size",
    "eyeTilt": "Eye level",
    "headroom": "Headroom",
    "sharpness": "Sharpness",
    "exposure": "Exposure",
    "matteEdge": "Cutout edge"
  },
  "hints": {
    "singleFrontalPortrait": "Use a single frontal portrait",
    "adjustHorizontalPosition": "Drag the crop box horizontally to adjust",
    "faceRatioRange": "Face width should cover 26%-42% of the photo",
    "levelEyes": "Retake the photo or adjust the rotation",
    "headroomTooSmall": "Leave some space above the head",
    "faceNotDetected": "No clear face detected",
    "avoidBlurrySource": "Blurry sources hurt cutout and print quality",
    "avoidUnderexposedOrBlown": "Avoid severely dark or blown-out photos",
    "checkHairAndShoulder": "Check hair, ears and shoulder line"
  }
}
```

- [ ] **Step 2: 写失败测试**

```tsx
// apps/web/test/components/tools/id-photo-quality-panel.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IdPhotoQualityPanel } from '@/components/tools/id-photo-quality-panel';
import type { QualityReport } from '@utils-plane/validators';

const t = (key: string) => key;

function fullReport(): QualityReport {
  return {
    items: [
      { name: 'faceCount', value: '1', passed: true, hint: 'singleFrontalPortrait' },
      { name: 'faceCentered', value: '2%', passed: true, hint: 'adjustHorizontalPosition' },
      { name: 'faceRatio', value: '35%', passed: true, hint: 'faceRatioRange' },
      { name: 'eyeTilt', value: '+0.5°', passed: true, hint: 'levelEyes' },
      { name: 'headroom', value: '12%', passed: true, hint: 'headroomTooSmall' },
      { name: 'sharpness', value: '120', passed: true, hint: 'avoidBlurrySource' },
      { name: 'exposure', value: '128/255', passed: true, hint: 'avoidUnderexposedOrBlown' },
      { name: 'matteEdge', value: '3.1%', passed: true, hint: 'checkHairAndShoulder' },
    ],
    score: 100,
    passed: true,
  };
}

describe('IdPhotoQualityPanel', () => {
  it('shows the passed summary when everything passes', () => {
    render(<IdPhotoQualityPanel report={fullReport()} t={t} />);
    expect(screen.getByText('quality.passed')).toBeTruthy();
  });

  it('names the failing items when some checks fail', () => {
    render(
      <IdPhotoQualityPanel
        report={{
          items: [
            { name: 'faceCount', value: '2', passed: false, hint: 'singleFrontalPortrait' },
            { name: 'faceRatio', value: '15%', passed: false, hint: 'faceRatioRange' },
          ],
          score: 0,
          passed: false,
        }}
        t={t}
      />
    );
    expect(screen.getByText(/quality\.needsAttention/)).toBeTruthy();
  });

  it('renders an unavailable state for a null report', () => {
    render(<IdPhotoQualityPanel report={null} t={t} />);
    expect(screen.getByText('quality.unavailable')).toBeTruthy();
  });

  it('lists every item with its measured value', () => {
    render(<IdPhotoQualityPanel report={fullReport()} t={t} />);
    expect(screen.getByText('35%')).toBeTruthy();
    expect(screen.getByText('+0.5°')).toBeTruthy();
  });

  it('shows the hint only for failing items', () => {
    render(
      <IdPhotoQualityPanel
        report={{
          items: [
            { name: 'faceRatio', value: '15%', passed: false, hint: 'faceRatioRange' },
          ],
          score: 0,
          passed: false,
        }}
        t={t}
      />
    );
    expect(screen.getByText('quality.hints.faceRatioRange')).toBeTruthy();
  });
});
```

- [ ] **Step 3: 运行确认失败**

```bash
cd apps/web && bun run test test/components/tools/id-photo-quality-panel.test.tsx
```

预期:FAIL,module not found。

- [ ] **Step 4: 实现组件**

```tsx
'use client';

/**
 * 证件照质量检查面板。
 *
 * 常驻在结果区下方、默认展开：用户最需要的是「这张图哪里不合格、该怎么改」，
 * 藏起来等于没有。每一项同时给出实测值与建议，避免只有红点没有信息。
 */

import type { QualityReport } from '@utils-plane/validators';

export function IdPhotoQualityPanel({
  report,
  t,
}: {
  report: QualityReport | null;
  t: (key: string) => string;
}) {
  if (!report) {
    return (
      <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
        {t('quality.unavailable')}
      </div>
    );
  }

  const failedNames = report.items
    .filter(item => !item.passed)
    .map(item => t(`quality.items.${item.name}`))
    .join('、');

  return (
    <details
      open
      className="rounded-md border border-border p-4 text-sm"
      data-testid="id-photo-quality-panel"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {t('quality.title')}
        </span>
        <span className={report.passed ? 'text-emerald-600' : 'text-amber-600'}>
          {report.passed
            ? t('quality.passed')
            : t('quality.needsAttention').replace('{items}', failedNames)}
        </span>
      </summary>

      <p className="mt-2 font-mono text-xs text-muted-foreground">
        {t('quality.score').replace('{score}', String(report.score))}
      </p>

      <ul className="mt-3 space-y-2">
        {report.items.map(item => (
          <li
            key={item.name}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  item.passed ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              {t(`quality.items.${item.name}`)}
            </span>
            <span className="font-mono text-xs tabular-nums">{item.value}</span>
            {!item.passed && (
              <span className="w-full text-xs text-muted-foreground">
                {t(`quality.hints.${item.hint}`)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
```

- [ ] **Step 5: 运行测试**

```bash
cd apps/web && bun run test test/components/tools/id-photo-quality-panel.test.tsx
```

预期:PASS,5 个用例全过。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/tools/id-photo-quality-panel.tsx apps/web/test/components/tools/id-photo-quality-panel.test.tsx apps/web/messages/zh.json apps/web/messages/en.json
git commit -m "feat(web): 新增证件照质量检查面板与中英文案"
```

---

### Task 15: 构图辅助线

**Files:**
- Modify: `apps/web/src/components/tools/image-crop-field.tsx`
- Modify: `apps/web/src/components/tools/id-photo-options.tsx`
- Modify: `apps/web/messages/zh.json`、`apps/web/messages/en.json`
- Test: `apps/web/test/components/tools/image-crop-field-guides.test.tsx`

**Interfaces:**
- Produces:
  - `ImageCropFieldProps` 追加 `guides?: boolean`(默认 `false`)
  - `IdPhotoOptionsState` 追加 `guides: boolean`

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/test/components/tools/image-crop-field-guides.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageCropField } from '@/components/tools/image-crop-field';

const t = (key: string) => key;

const baseProps = {
  imageUrl: 'data:image/png;base64,AAAA',
  natural: { width: 400, height: 560 },
  onNatural: vi.fn(),
  value: { x: 40, y: 40, width: 295, height: 413 },
  onChange: vi.fn(),
  aspect: 295 / 413,
  t,
};

describe('ImageCropField guides', () => {
  it('does not render guides by default', () => {
    render(<ImageCropField {...baseProps} />);
    expect(screen.queryByTestId('crop-guide-headroom')).toBeNull();
  });

  it('renders headroom, eye-line, shoulder and center guides when enabled', () => {
    render(<ImageCropField {...baseProps} guides />);
    expect(screen.getByTestId('crop-guide-headroom')).toBeTruthy();
    expect(screen.getByTestId('crop-guide-eye')).toBeTruthy();
    expect(screen.getByTestId('crop-guide-shoulder')).toBeTruthy();
    expect(screen.getByTestId('crop-guide-center')).toBeTruthy();
  });

  it('keeps guides non-interactive so dragging still works', () => {
    render(<ImageCropField {...baseProps} guides />);
    expect(
      screen.getByTestId('crop-guide-headroom').className
    ).toContain('pointer-events-none');
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/web && bun run test test/components/tools/image-crop-field-guides.test.tsx
```

预期:FAIL,找不到 `crop-guide-headroom`。

- [ ] **Step 3: 给裁剪组件加 guides prop**

```tsx
// ImageCropFieldProps 内追加
  /** 是否显示证件照构图辅助线(中心线、头顶安全区、眼部参考区、肩线)。不影响导出。 */
  guides?: boolean;
```

```tsx
// 组件签名解构追加 guides = false
export function ImageCropField({
  imageUrl,
  natural,
  onNatural,
  value,
  onChange,
  aspect,
  disabled,
  guides = false,
  t,
}: ImageCropFieldProps) {
```

- [ ] **Step 4: 渲染辅助线**

在三分线 `<div className="pointer-events-none absolute inset-0 opacity-60">…</div>` 之后、`{HANDLES.map(...)}` 之前插入:

```tsx
              {guides && (
                <div className="pointer-events-none absolute inset-0">
                  {/* 中心竖线：人脸应对准这条线 */}
                  <div
                    data-testid="crop-guide-center"
                    className="absolute inset-y-0 left-1/2 border-l border-dashed border-sky-400/70"
                  />
                  {/* 头顶安全区：顶部 8% 淡色填充 + 分界线 */}
                  <div
                    data-testid="crop-guide-headroom"
                    className="absolute inset-x-0 top-0 border-b border-dashed border-emerald-400/80 bg-emerald-400/10"
                    style={{ height: '8%' }}
                  />
                  {/* 眼部参考区：40%~50% */}
                  <div
                    data-testid="crop-guide-eye"
                    className="absolute inset-x-0 border-y border-dashed border-amber-400/80"
                    style={{ top: '40%', height: '10%' }}
                  />
                  {/* 肩线参考：75% */}
                  <div
                    data-testid="crop-guide-shoulder"
                    className="absolute inset-x-0 border-t border-dashed border-violet-400/70"
                    style={{ top: '75%' }}
                  />
                </div>
              )}
```

- [ ] **Step 5: 加开关到 options**

```tsx
// id-photo-options.tsx —— 状态类型追加
export type IdPhotoOptionsState = {
  preset: 'one_inch' | 'two_inch' | 'small_one_inch' | 'passport';
  backgroundColor: string;
  outputType: 'image/jpeg' | 'image/png';
  segmentationMode: 'local' | 'ai';
  crop: { x: number; y: number; scale: number };
  /** 是否显示构图辅助线；不影响导出。 */
  guides: boolean;
};
```

在 `outputType` 那个 block 之后追加:

```tsx
      <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
        <input
          type="checkbox"
          checked={value.guides}
          disabled={disabled}
          onChange={e => onChange({ ...value, guides: e.target.checked })}
        />
        <span>{t('guides')}</span>
      </label>
```

- [ ] **Step 6: 加文案**

`zh.json` 的 `ImageIdPhoto` 段内追加:

```json
"guides": "构图辅助线"
```

`en.json`:

```json
"guides": "Composition guides"
```

- [ ] **Step 7: 运行测试**

```bash
cd apps/web && bun run test test/components/tools/image-crop-field-guides.test.tsx
```

预期:PASS,3 个用例全过。

- [ ] **Step 8: 提交**

```bash
git add apps/web/src/components/tools/image-crop-field.tsx apps/web/src/components/tools/id-photo-options.tsx apps/web/test/components/tools/image-crop-field-guides.test.tsx apps/web/messages/zh.json apps/web/messages/en.json
git commit -m "feat(web): 裁剪组件集成证件照构图辅助线"
```

---

### Task 16: 页面接线(自动构图回填 + 质量面板 + 辅助线)

**Files:**
- Modify: `apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`
- Test: `apps/web/test/app/[locale]/(app)/image/id-photo/page.test.tsx`

**Interfaces:**
- Consumes: `useLocalIdPhoto` 的 `autoLayout` / `userOverride` / `markUserOverride` / `quality`;`IdPhotoQualityPanel`;`ImageCropField` 的 `guides`
- Produces: 无(页面层)

- [ ] **Step 1: 改默认选项**

```tsx
const DEFAULT_OPTIONS: IdPhotoOptionsState = {
  preset: 'one_inch',
  backgroundColor: '#438edb',
  outputType: 'image/jpeg',
  segmentationMode: 'local',
  crop: { x: 0.5, y: 0.5, scale: 1 },
  guides: false,
};
```

- [ ] **Step 2: 导入**

```tsx
import { useEffect } from 'react';
import { idPhotoCropFromLayout, type QualityReport } from '@utils-plane/validators';
import { IdPhotoQualityPanel } from '@/components/tools/id-photo-quality-panel';
```

- [ ] **Step 3: 自动构图回填**

在 `const local = useLocalIdPhoto();` 之后插入:

```tsx
  const autoLayout = local.autoLayout;
  // 自动构图算出结果后回填裁剪框 —— 只在用户还没手动改过时覆盖，
  // 否则用户刚拖好的框会被下一次处理冲掉。
  useEffect(() => {
    if (!autoLayout || !natural || local.userOverride) return;
    const aspect = preset.widthPx / preset.heightPx;
    const crop = idPhotoCropFromLayout(
      autoLayout,
      { width: natural.width, height: natural.height },
      aspect
    );
    setOptions(prev => ({ ...prev, crop }));
  }, [autoLayout, natural, local.userOverride, preset.widthPx, preset.heightPx]);
```

- [ ] **Step 4: process 传 autoFrame**

```tsx
// handleProcess 的本地分支内
        await local.process(file, highPrecision ? 'high' : 'balanced', {
          preset: options.preset,
          backgroundColor: options.backgroundColor,
          outputType: options.outputType,
          crop: options.crop,
          autoFrame: !local.userOverride,
        });
```

- [ ] **Step 5: 裁剪框变更时标记 override**

```tsx
// ImageCropField 的 onChange 改为
              onChange={rect => {
                local.markUserOverride();
                setOptions(prev => ({
                  ...prev,
                  crop: idPhotoCropFromBox(
                    natural!.width,
                    natural!.height,
                    preset.widthPx,
                    preset.heightPx,
                    rect
                  ),
                }));
              }}
```

- [ ] **Step 6: 裁剪组件传 guides**

```tsx
              guides={options.guides}
```

- [ ] **Step 7: 结果区下方挂质量面板**

找到渲染结果图的那块 JSX,在其后插入:

```tsx
        {hasResult && (
          <IdPhotoQualityPanel
            report={
              processingMode === 'local'
                ? local.quality
                : (((resultFile as unknown) as { quality?: QualityReport })
                    ?.quality ?? null)
            }
            t={t}
          />
        )}
```

服务端路的质量报告目前不进 blob,`resultFile` 上没有 `quality` 字段,因此服务端路会显示「检查不可用」。这与错误处理矩阵一致(不阻断)。

- [ ] **Step 8: 运行页面测试**

```bash
cd apps/web && bun run test "test/app/[locale]/(app)/image/id-photo/page.test.tsx"
```

预期:PASS。若既有用例的 options 对象因 `guides` 必填而类型报错,补 `guides: false`。

- [ ] **Step 9: 全量 web 测试与构建**

```bash
cd apps/web && bun run test && bun run build 2>&1 | tail -15
```

预期:测试全绿,构建成功。

- [ ] **Step 10: 提交**

```bash
git add "apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx" "apps/web/test/app/[locale]/(app)/image/id-photo/page.test.tsx"
git commit -m "feat(web): 证件照页接线自动构图回填、质量面板与辅助线"
```

---

### Task 17: 端到端手动核对与文档收尾

**Files:**
- Modify: `docs/id-photo-models.md`

**Interfaces:**
- Produces: 一份核对记录,确认 7 个缺口全部闭合。

- [ ] **Step 1: 跑通全仓测试**

```bash
cd packages/validators && bun test
cd ../../packages/utils && bun test
cd ../../apps/api && bun test ./test
cd ../web && bun run test
```

预期:全绿。

- [ ] **Step 2: 手动核对本地路**

启动 `bun run dev`,打开 `/zh/image/id-photo`,用三张样张各跑一次本地模式:

| 样张 | 检查点 |
| --- | --- |
| 黑帽子 + 暗背景 | 帽子实心无染色、发丝无蓝边、脸部无红雾 |
| 标准白底证件照 | 换蓝底后边缘无白边 |
| 户外复杂背景 | 肩线干净、无原背景色残留 |

每次同时确认:
- 首次处理后人脸被自动摆到标准位置(头顶留白约 8%,人脸约占 1/3)
- 手动拖动裁剪框后再次处理,不被自动构图覆盖
- 质量面板出现 8 项,数值合理
- 下载文件的属性里 DPI 为 300

- [ ] **Step 3: 手动核对服务端路**

切换到服务端模式,同一批样张再跑一次,确认:
- 结果预览与本地路视觉一致(同一组 crop 参数下构图相同)
- 下载文件 DPI 为 300

- [ ] **Step 4: 拼版物理尺寸量测**

用一寸照生成 6 寸相纸拼版,按 300dpi 打印,量测单张实际尺寸应为 25×35mm ± 0.5mm。

- [ ] **Step 5: 写核对记录**

在 `docs/id-photo-models.md` 末尾追加(把括号填成实测结果):

```markdown
## 参考对齐核对记录

| 检查项 | 本地路 | 服务端路 |
| --- | --- | --- |
| 帽子/衣服实心无染色 | (结果) | (结果) |
| 发丝边缘无原底色光晕 | (结果) | (结果) |
| 自动构图(头顶留白 / 人脸比例) | (结果) | (结果) |
| 手动 crop 不被覆盖 | (结果) | — |
| 质量面板 8 项 | (结果) | 不可用(质量报告未随 blob 返回) |
| 输出 DPI 300 | (结果) | (结果) |
| 拼版物理尺寸 25×35mm | (结果) | — |
```

- [ ] **Step 6: 提交**

```bash
git add docs/id-photo-models.md
git commit -m "docs(id-photo): 记录参考对齐端到端核对结果"
```

---

### Task 18: 亮度自动校正

**Files:**
- Modify: `packages/validators/src/id-photo-layout.ts`
- Modify: `packages/validators/test/id-photo-layout.test.ts`
- Modify: `apps/api/src/modules/tasks/services/id-photo.service.ts`
- Modify: `apps/web/src/lib/id-photo-local/composite.ts`

**Interfaces:**
- Produces:
  - `export function suggestBrightnessAdjustment(meanBrightness: number): number` —— 返回 -30..30 的整数偏移,0 表示不动
  - `compositeIdPhoto` 在 `rotation` 之后追加 `brightness?: number`

说明:`use-local-id-photo.ts` 里亮度均值与质量检查共用同一份 `srcData` 的逻辑已在 Task 13 Step 5 写好,本任务只补算法与两端的应用点。

- [ ] **Step 1: 写失败测试**

追加到 `packages/validators/test/id-photo-layout.test.ts`:

```ts
import { suggestBrightnessAdjustment } from '../src/id-photo-layout';

describe('suggestBrightnessAdjustment', () => {
  it('does nothing for a well-exposed photo', () => {
    expect(suggestBrightnessAdjustment(128)).toBe(0);
    expect(suggestBrightnessAdjustment(75)).toBe(0);
    expect(suggestBrightnessAdjustment(205)).toBe(0);
  });

  it('brightens an underexposed photo, capped at 18', () => {
    const amount = suggestBrightnessAdjustment(40);
    expect(amount).toBeGreaterThan(0);
    expect(suggestBrightnessAdjustment(0)).toBeLessThanOrEqual(18);
  });

  it('darkens an overexposed photo, capped at -12', () => {
    const amount = suggestBrightnessAdjustment(250);
    expect(amount).toBeLessThan(0);
    expect(amount).toBeGreaterThanOrEqual(-12);
  });

  it('never returns a fractional value', () => {
    for (const mean of [10, 50, 74, 210, 255]) {
      expect(Number.isInteger(suggestBrightnessAdjustment(mean))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd packages/validators && bun test test/id-photo-layout.test.ts
```

预期:FAIL,`suggestBrightnessAdjustment` is not a function。

- [ ] **Step 3: 实现**

```ts
// packages/validators/src/id-photo-layout.ts —— 追加
const UNDEREXPOSED_MEAN = 75;
const OVEREXPOSED_MEAN = 205;

/**
 * 按整体亮度给出建议的亮度偏移(-30..30,0 = 不动)。
 *
 * 照搬参考实现的阈值与系数:暗片提亮、过曝压暗,幅度都收得很紧 ——
 * 证件照要的是「还原」而不是「风格化调色」,过度提亮会让人脸发灰。
 */
export function suggestBrightnessAdjustment(meanBrightness: number): number {
  if (!Number.isFinite(meanBrightness)) return 0;
  if (meanBrightness < UNDEREXPOSED_MEAN) {
    return Math.round(Math.min(18, (90 - meanBrightness) * 0.35));
  }
  if (meanBrightness > OVEREXPOSED_MEAN) {
    return Math.round(Math.max(-12, (190 - meanBrightness) * 0.3));
  }
  return 0;
}
```

- [ ] **Step 4: 运行测试**

```bash
cd packages/validators && bun test test/id-photo-layout.test.ts
```

预期:PASS。

- [ ] **Step 5: 服务端应用**

```ts
// id-photo.service.ts —— import 追加
import { suggestBrightnessAdjustment } from '@utils-plane/validators';
```

在 `const baseRgbRaw = await sharp(base)...` 之后、底色聚类之前插入:

```ts
// 亮度自动校正：只作用于前景，透明区保持 0
let meanSum = 0;
let meanCount = 0;
for (let i = 0; i < preset.widthPx * preset.heightPx; i += 1) {
  if ((resizedAlpha[i] ?? 0) === 0) continue;
  meanSum +=
    ((baseRgbRaw[i * 3] ?? 0) +
      (baseRgbRaw[i * 3 + 1] ?? 0) +
      (baseRgbRaw[i * 3 + 2] ?? 0)) /
    3;
  meanCount += 1;
}
const brightness = suggestBrightnessAdjustment(
  meanSum / Math.max(1, meanCount)
);
const adjustedBaseRgb =
  brightness === 0
    ? baseRgbRaw
    : Buffer.from(
        baseRgbRaw.map(v => Math.max(0, Math.min(255, v + brightness)))
      );
```

把后续所有对 `baseRgbRaw` 的使用(底色聚类、rgba 组装、质量检查的 `rgb` 入参)替换为 `adjustedBaseRgb`。

- [ ] **Step 6: 本地路应用**

```ts
// composite.ts —— 签名追加第 8 个参数
export async function compositeIdPhoto(
  cutout: ImageBitmap,
  backgroundColor: string,
  presetW: number,
  presetH: number,
  outputType: 'image/jpeg' | 'image/png',
  crop?: IdPhotoCrop,
  rotation = 0,
  brightness = 0
): Promise<Blob> {
```

在 `putImageData` 之前插入:

```ts
  if (brightness !== 0) {
    for (let i = 0; i < cleaned.length; i += 4) {
      if ((cleaned[i + 3] ?? 0) === 0) continue;
      cleaned[i] = Math.max(0, Math.min(255, (cleaned[i] ?? 0) + brightness));
      cleaned[i + 1] = Math.max(0, Math.min(255, (cleaned[i + 1] ?? 0) + brightness));
      cleaned[i + 2] = Math.max(0, Math.min(255, (cleaned[i + 2] ?? 0) + brightness));
    }
  }
```

- [ ] **Step 7: 回归测试**

```bash
cd packages/validators && bun test
cd ../../apps/web && bun run test test/lib/id-photo-local
cd ../../apps/api && bun test test/modules/tasks/services/id-photo.service.spec.ts
```

预期:全绿。`composite` 的既有测试要补第 8 个参数(传 `0`)。

- [ ] **Step 8: 提交**

```bash
git add packages/validators/src/id-photo-layout.ts packages/validators/test/id-photo-layout.test.ts apps/api/src/modules/tasks/services/id-photo.service.ts apps/web/src/lib/id-photo-local/composite.ts apps/web/test/lib/id-photo-local/composite.test.ts
git commit -m "feat(id-photo): 新增亮度自动校正(暗片提亮/过曝压暗)"
```

---

## Self-Review

### 1. 规格覆盖检查

| spec 章节 | 对应任务 |
| --- | --- |
| 缺口 1 分割模型(两端换 photographic,512 保长宽比) | Task 1(实测) → Task 9(服务端) → Task 11(本地路) |
| 缺口 2 人脸检测 + 自动构图 | Task 4(算法) → Task 6(张量解析) → Task 8(服务端) → Task 11(本地路推理) → Task 13(编排) → Task 16(回填) |
| 缺口 3 边缘去污染(本地补齐 + 服务端增强) | Task 2(算法) → Task 3(底色聚类) → Task 10(服务端) → Task 12(本地路) |
| 缺口 4 亮度/旋转校正 | 旋转:Task 4 / Task 10 / Task 12;亮度:Task 18 |
| 缺口 5 质量检查 8 项 | Task 5(算法) → Task 10(服务端) → Task 13(本地路) → Task 14(UI) |
| 缺口 6 构图辅助线 | Task 15 |
| 缺口 7 输出质量 + DPI | Task 10(服务端)、Task 12(本地路) |
| 模型资产分发 | Task 7 |
| 错误处理矩阵 | Task 8(人脸失败返回空)、Task 9(分割回落)、Task 12(DPI 失败返回原 blob)、Task 13(无人脸退回手动 crop) |
| 测试计划 | 每个任务的 Step 1–2 即为对应用例 |

无遗漏。

### 2. 占位符扫描

全文已无 `TBD` / `TODO` / 「类似 Task N」/ 「适当处理」这类表述。两处需要执行者注意的地方已写成显式说明,而不是留空:

- Task 10 Step 1 的 `lastQuality` 模块级变量是迭代残留,紧跟其后给出了改用 `result.quality` 的正确写法 —— 执行时直接用 `result.quality`,不要建那个变量。
- Task 16 Step 7 说明了服务端路质量面板会显示「检查不可用」的原因(质量报告目前不随 blob 返回),这是有意的取舍,不是缺陷。

### 3. 类型一致性

- `DetectedFace`(`packages/utils`,Task 6)与 `FaceDetection`(`packages/validators`,Task 4)结构相同但分属两个包 —— 有意为之:`packages/utils` 不 import validators,避免循环依赖。Task 10 把 `DetectedFace` 直接传给 `suggestIdPhotoLayout`,靠结构化类型兼容。
- `compositeIdPhoto` 参数:`Task 12` 引入第 7 个 `rotation`,`Task 18` 引入第 8 个 `brightness`。Task 13 的调用已按 8 个参数写,Task 18 不需再改调用点。
- `IdPhotoOptionsState.guides` 在 Task 15 引入,Task 16 的 `DEFAULT_OPTIONS` 已包含。
- `isStaleSegmentation` 在 Task 11 改写 `segmentation.ts` 时保留导出,Task 13 继续使用。
- **YuNet 人脸检测（2026-10-20 Task 8 实测修正）**：真实权重是 640×640 / 12 输出 / 0..255 BGR。
  Task 6 的 `parseYunetOutput` 与 `YUNET_INPUT_SIZE`(320) 已删除；Task 11 必须 import
  `packages/utils/src/id-photo-yunet.ts` 的共享实现，并在 `model-registry.ts` 声明
  `YUNET_INPUT_SIZE = 640`。本地 canvas 给的是 RGBA，需先剥掉 A 通道再调
  `createYunetInputTensor`（步长错位不会报错，只会给出离谱的框）。
- `resetSegmentationCacheForTests` 在 Task 11 改为清空 `cachedSessions`,`apps/web/test/lib/id-photo-local/` 下若有引用它的既有测试需同步(执行 Task 11 时一并检查)。

### 4. 执行顺序提醒

Task 2–7 互相独立，可并行；Task 8 之后的任务依赖前面的产出。

**Task 1 实测结论已落地到计划（2026-10-20 修订）**：

- 破洞由「补边成 512×512」触发，不是 photographic 权重的问题。同一权重不补边时 0 洞。
- 因此 Task 9 从 `letterboxResize`（补边）改为共享的 `modnetInputSize`（动态宽高、32 对齐、不补边），Task 11 本地路同步改用同一个函数。
- `modnet.onnx` 与 photographic 逐像素等价（max abs diff = 0）。Task 11 的 `high` 档不需要真接 RMBG-1.4 —— 简化为与 `balanced` 同模型即可，RMBG 资产仅作为既有资产保留、不再作为默认回落。
- 服务端「photographic → 通用 modnet」的回落只为文件缺失兜底，不带来画质差异，文档里已写明。


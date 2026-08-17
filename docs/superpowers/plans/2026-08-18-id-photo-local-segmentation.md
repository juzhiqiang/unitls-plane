# 证件照本地抠图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给证件照生成页(`/image/id-photo`)新增浏览器本地抠图路(RMBG + onnxruntime-web + WebGPU/wasm,Worker 推理 + canvas 换底裁剪,端到端本地下载、不建任务不登录),并保留现有服务端 `image_id_photo` 任务作为备选。

**Architecture:** 新增 `apps/web/src/lib/id-photo-local/` 模块:`model-registry`(两档模型元数据)、`composite`(canvas 合成背景与 preset 裁剪)、`portrait-segmenter.worker`(ORT session + 推理)、`use-local-id-photo`(编排 hook)。推理隔离在 Web Worker 不卡 UI,主线程做 canvas 合成裁剪与下载。模型经自有对象存储(MinIO `models` 只读桶)分发;ORT 引擎自身 wasm 自托管到 `public/onnx/` 保证离线可用。

**Tech Stack:** Next.js 14 App Router、React 18、onnxruntime-web 1.27.0、WebGPU/wasm、OffscreenCanvas、Vitest + @testing-library/react(jsdom)、next-intl。

**关联设计:** [docs/superpowers/specs/2026-08-18-id-photo-local-segmentation-design.md](../specs/2026-08-18-id-photo-local-segmentation-design.md)

---

## 前置事实(已核实)

- 后端 `onnxruntime-node` 1.27;`PortraitSegmentationService` 用 `modnet.onnx`,render 输出**已合成纯色背景的成片**,透明前景仅内部临时存在。服务端路本次**不改**。
- `packages/validators/src/id-photo.ts` 的 `idPhotoPresetSpecs` 含 `one_inch`(295×413)/`two_inch`(413×626)/`small_one_inch`(260×378)/`passport`(413×531),`widthPx/heightPx/defaultBackground`。本地路裁剪复用此规格。
- `apps/web/src/components/tools/id-photo-options.tsx` 当前含 `segmentationMode`(local/ai)选择 UI——这是**服务端路独有**(MODNet/AI),本地路要隐藏它并新增「高精度」开关。
- `tool-metadata.ts` 的 `imageIdPhoto` 当前 `processing:'server'`、`requiresLogin:true`;本地优先工具(图片压缩)是 `processing:'local-first'`、`requiresLogin:false`。
- 项目 `postinstall` 已有先例:`cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/`。ORT wasm 同法复制。
- ORT API 权威结论(来自 onnxruntime-web@1.27.0 的 `.d.ts`):
  - `import * as ort from 'onnxruntime-web/webgpu'`(含 JSEP,WebGPU 才可用)。
  - `InferenceSession.create(Uint8Array, { executionProviders:['webgpu','wasm'], graphOptimizationLevel:'all', enableMemPattern:false, enableCpuMemArena:false })`。
  - `ort.env.wasm.wasmPaths`(对象形式 `{wasm,mjs}`,指向自托管 URL)、`numThreads=1`、`simd=true`、`proxy=false`(已在 worker)。
  - WebGPU wasm 文件名 `ort-wasm-simd-threaded.jsep.wasm` + `.jsep.mjs`;纯 wasm 是 `ort-wasm-simd-threaded.wasm` + `.mjs`。
  - `session.inputNames[0]` / `session.outputNames[0]` 可枚举;`await out.getData()` 异步下载 GPU 张量。
  - WebGPU 探测:`'gpu' in navigator` 且 `await navigator.gpu.requestAdapter()` 非空。
  - 大模型下载进度:自己 `fetch` + `ReadableStream` 拼 `Uint8Array`;跨域读 `Content-Length` 需服务端 `Access-Control-Expose-Headers: Content-Length`。
  - dedicated worker 内 `navigator.gpu` 可用,需 secure context(https / localhost)。

---

## 文件结构

| 文件 | 责任 |
| --- | --- |
| `apps/web/package.json`(修改) | 加 `onnxruntime-web@1.27.0` 依赖;`postinstall` 复制 wasm 到 `public/onnx/` |
| `scripts/prepare-id-photo-models.sh`(新建) | 从 ModelScope 下权重 → 转 onnx(fp16/q4f16)→ 上传 MinIO `models` 桶;产出确认的预处理参数 |
| `docs/id-photo-models.md`(新建) | 模型预置流程、bucket、实测确认的预处理参数(输入尺寸/归一化/IO 名) |
| `apps/web/src/lib/id-photo-local/model-registry.ts`(新建) | 两档模型元数据 + URL 拼接 |
| `apps/web/src/lib/id-photo-local/composite.ts`(新建) | canvas 合成背景 + preset 裁剪 + 输出 blob |
| `apps/web/src/lib/id-photo-local/portrait-segmenter.worker.ts`(新建) | ORT session + 预处理 + 推理 + 后处理,WebGPU 优先/wasm 兜底 |
| `apps/web/src/lib/id-photo-local/use-local-id-photo.ts`(新建) | 编排 hook:Worker 通信 + 合成 + 进度 + 错误 + CPU 锁档 |
| `apps/web/src/components/tools/id-photo-options.tsx`(修改) | 加 `mode` 参数控制显隐:本地路隐藏 segmentationMode、显示高精度开关 |
| `apps/web/messages/zh.json`、`en.json`(修改) | `ImageIdPhoto` 段新增本地路文案 |
| `apps/web/src/lib/tools/tool-metadata.ts`(修改) | `imageIdPhoto` 改为本地优先语义 |
| `apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`(修改) | 顶部「处理模式」切换 + 本地路 UI 接入 hook |
| Dockerfile / entrypoint(修改) | 离线镜像纳入两模型 + 同步到本地 MinIO `models` 桶 |

> jsdom 不实现 `OffscreenCanvas` / `createImageBitmap` / `Worker` / `navigator.gpu`,凡用到这些 API 的测试须在 `beforeEach` stub,详见对应任务。RMBG/BiRefNet 的具体预处理参数(输入尺寸、归一化常数)依赖实测,见 Task 2 产出;Task 5 推理代码按 BiRefNet 惯例给出,实现时以 Task 2 实测值校准(已在代码注释标明)。

---

### Task 1: 依赖与 ORT wasm 自托管

**Files:**
- Modify: `apps/web/package.json`
- Test: `apps/web/src/lib/id-photo-local/__tests__/ort-assets.test.ts`

- [ ] **Step 1: 加依赖与 postinstall 复制**

修改 `apps/web/package.json`:

`dependencies` 追加(按字母序,插在 `opentype.js` 与 `pdf-lib` 之间):

```
old:
    "opentype.js": "^2.0.0",
    "pdf-lib": "^1.17.1",

new:
    "opentype.js": "^2.0.0",
    "onnxruntime-web": "1.27.0",
    "pdf-lib": "^1.17.1",
```

`scripts.postinstall` 追加 ORT wasm 复制(在 pdf.worker 复制后):

```
old:
    "postinstall": "cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/"

new:
    "postinstall": "cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/ && node scripts/copy-ort-wasm.mjs"
```

- [ ] **Step 2: 写复制脚本**

创建 `apps/web/scripts/copy-ort-wasm.mjs`:

```js
// 把 onnxruntime-web 的 JSEP wasm(供 WebGPU)与普通 wasm(供 CPU 兜底)复制到 public/onnx/,
// 保证离线部署不依赖 jsDelivr。版本号必须与 package.json 的 onnxruntime-web 一致。
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist');
const dest = join(__dirname, '..', 'public', 'onnx');

const files = [
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
];

if (!existsSync(src)) {
  console.warn('[copy-ort-wasm] onnxruntime-web dist not found, skipping');
  process.exit(0);
}
await mkdir(dest, { recursive: true });
for (const f of files) {
  const from = join(src, f);
  if (existsSync(from)) {
    await cp(from, join(dest, f));
    console.log(`[copy-ort-wasm] copied ${f}`);
  } else {
    console.warn(`[copy-ort-wasm] missing ${f}, skipping`);
  }
}
```

- [ ] **Step 3: 安装并执行 postinstall**

Run: `cd apps/web && bun install`
Expected: 安装 `onnxruntime-web@1.27.0`,postinstall 复制 4 个 wasm/mjs 到 `public/onnx/`,控制台打印 copied 行。

- [ ] **Step 4: 写测试**

创建 `apps/web/src/lib/id-photo-local/__tests__/ort-assets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const publicOnnx = resolve(process.cwd(), 'public', 'onnx');

describe('ORT wasm assets', () => {
  // WebGPU 用的 JSEP wasm 是核心,必须存在;纯 wasm 兜底文件尽量存在
  it('copies the JSEP wasm for WebGPU to public/onnx', () => {
    expect(existsSync(resolve(publicOnnx, 'ort-wasm-simd-threaded.jsep.wasm'))).toBe(true);
    expect(existsSync(resolve(publicOnnx, 'ort-wasm-simd-threaded.jsep.mjs'))).toBe(true);
  });
});
```

- [ ] **Step 5: 运行测试,确认通过**

Run: `bun --cwd apps/web test src/lib/id-photo-local/__tests__/ort-assets.test.ts`
Expected: PASS(1 条)。

- [ ] **Step 6: 提交**

```bash
git add apps/web/package.json apps/web/scripts/copy-ort-wasm.mjs apps/web/public/onnx apps/web/src/lib/id-photo-local/__tests__/ort-assets.test.ts
git commit -m "feat(web): 添加 onnxruntime-web 依赖并自托管 wasm 资源"
```

> `public/onnx/` 为构建产物,加入 `.gitignore`(见 Task 末尾统一处理)。本任务先把脚本与依赖提交,产物本地生成。

- [ ] **Step 7: gitignore 补产物路径**

修改 `.gitignore`,在 `apps/api/models/*.onnx` 附近追加:

```
old:
# Local ML model assets.
apps/api/models/*.onnx

new:
# Local ML model assets.
apps/api/models/*.onnx
apps/web/public/onnx/
```

```bash
git add .gitignore
git commit -m "chore: gitignore 补充 ORT wasm 产物目录"
```

---

### Task 2: 模型预置脚本与文档(产出实测预处理参数)

**Files:**
- Create: `scripts/prepare-id-photo-models.sh`
- Create: `docs/id-photo-models.md`

> 此任务是一次性运维操作,产出两样东西:(1) MinIO `models` 桶里的两个 onnx;(2) `docs/id-photo-models.md` 里实测确认的预处理参数(输入尺寸、归一化常数、输入/输出张量名),供 Task 5 校准。脚本可半自动:下载与上传自动化,转 onnx 需 Python 环境手动执行一次。

- [ ] **Step 1: 写预置脚本**

创建 `scripts/prepare-id-photo-models.sh`:

```bash
#!/usr/bin/env bash
# 预置证件照本地抠图模型到 MinIO models 桶。
# 用法: S3_ENDPOINT=... S3_ACCESS_KEY=... S3_SECRET_KEY=... ./scripts/prepare-id-photo-models.sh
# 依赖: curl、mc(MinIO Client)、python3 + onnx + onnxconverter-common(仅转 fp16/q4f16 步骤)。
set -euo pipefail

MODELS=(
  "rmbg-1.4|https://modelscope.cn/models/iic/RMBG-1.4/resolve/master/onnx/model.onnx|rmbg-1.4-fp16.onnx|fp16"
  "rmbg-2.0|https://modelscope.cn/models/iic/RMBG-2.0/resolve/master/onnx/model.onnx|rmbg-2.0-q4f16.onnx|q4f16"
)
WORKDIR="${WORKDIR:-./.cache/id-photo-models}"
BUCKET="${S3_MODELS_BUCKET:-models}"

mkdir -p "$WORKDIR"

for entry in "${MODELS[@]}"; do
  IFS='|' read -r name src_url out_name quant <<< "$entry"
  raw="$WORKDIR/${name}-raw.onnx"
  out="$WORKDIR/$out_name"
  echo "==> $name: downloading $src_url"
  curl -fL "$src_url" -o "$raw"
  echo "==> $name: converting to $quant onnx (run conversion script)"
  python3 scripts/convert-id-photo-model.py "$raw" "$out" "$quant"
  echo "==> $name: uploading to bucket $BUCKET/$out_name"
  mc alias set local "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" 2>/dev/null || true
  mc mb "local/$BUCKET" --ignore-existing
  mc anonymous set download "local/$BUCKET" 2>/dev/null || true
  mc cp "$out" "local/$BUCKET/$out_name"
done

echo "==> inspecting I/O names/shapes for docs"
python3 scripts/inspect-onnx-io.py "$WORKDIR/rmbg-1.4-fp16.onnx" > "$WORKDIR/rmbg-1.4-io.txt"
python3 scripts/inspect-onnx-io.py "$WORKDIR/rmbg-2.0-q4f16.onnx" > "$WORKDIR/rmbg-2.0-io.txt"
echo "Done. Fill docs/id-photo-models.md with the I/O info above."
```

- [ ] **Step 2: 写转换与检查的 Python 辅助脚本**

创建 `scripts/convert-id-photo-model.py`:

```python
"""把 onnx 模型量化为 fp16 或 q4f16。需: pip install onnx onnxconverter-common onnxruntime"""
import sys
import onnx
from onnxconverter_common import float16


def to_fp16(src: str, dst: str) -> None:
    model = onnx.load(src)
    model_fp16 = float16.convert_float_to_float16(model, keep_io_types=True)
    onnx.save(model_fp16, dst)


def to_q4f16(src: str, dst: str) -> None:
    # q4f16 量化:用 onnxruntime quantization
    from onnxruntime.quantization import quantize_dynamic, QuantType
    quantize_dynamic(src, dst, weight_type=QuantType.QUInt8, op_types_to_quantize=["MatMul"])


def main() -> None:
    src, dst, quant = sys.argv[1], sys.argv[2], sys.argv[3]
    if quant == "fp16":
        to_fp16(src, dst)
    elif quant == "q4f16":
        to_q4f16(src, dst)
    else:
        raise SystemExit(f"unknown quant: {quant}")


if __name__ == "__main__":
    main()
```

创建 `scripts/inspect-onnx-io.py`:

```python
"""打印 onnx 模型的输入/输出张量名与形状,供 docs 填实测参数。"""
import sys
import onnx


def main() -> None:
    model = onnx.load(sys.argv[1])
    g = model.graph
    print("INPUTS:")
    for i in g.input:
        dims = [d.dim_value or d.dim_param for d in i.type.tensor_type.shape.dim]
        print(f"  {i.name}: {dims}")
    print("OUTPUTS:")
    for o in g.output:
        dims = [d.dim_value or d.dim_param for d in o.type.tensor_type.shape.dim]
        print(f"  {o.name}: {dims}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: 写文档(实测参数占位待执行后填)**

创建 `docs/id-photo-models.md`:

````markdown
# 证件照本地抠图模型预置

## 模型清单

| 档位 | 文件名 | 大小 | 量化 | 来源 |
| --- | --- | --- | --- | --- |
| 均衡 | `rmbg-1.4-fp16.onnx` | ~84MB | fp16 | ModelScope `RMBG-1.4` |
| 高精度 | `rmbg-2.0-q4f16.onnx` | ~234MB | q4f16 | ModelScope `RMBG-2.0` |

## 预置步骤

1. 准备 Python 环境:`pip install onnx onnxconverter-common onnxruntime`。
2. 配置 MinIO 访问:`export S3_ENDPOINT=... S3_ACCESS_KEY=... S3_SECRET_KEY=...`。
3. 执行:`./scripts/prepare-id-photo-models.sh`。
4. 脚本会打印 I/O 信息,把结果填入下表(实测后替换 TODO 标注)。

## 实测预处理参数(执行后填写)

> 由 `scripts/inspect-onnx-io.py` 产出。Task 5 推理代码据此校准。

### RMBG-1.4

- 输入张量名:`TODO`(由 `session.inputNames[0]`)
- 输入尺寸:`TODO × TODO`(如 `1024 × 1024`)
- 输入布局:`NCHW`
- 归一化:`TODO`(BiRefNet 惯例:RGB / [0,1] / mean=[0.485,0.456,0.406] std=[0.229,0.224,0.225])
- 输出张量名:`TODO`
- 输出形状:`TODO`(mask,sigmoid 后为 [0,1] alpha)

### RMBG-2.0

- 同上,执行后填写。

## 对象存储

- 桶:`models`(只读匿名下载,`mc anonymous set download`)。
- 公网 URL:`${NEXT_PUBLIC_S3_PUBLIC_URL}/models/<file>`。
- 跨域:MinIO 需在 bucket CORS 或网关层暴露 `Access-Control-Expose-Headers: Content-Length`,否则前端读不到模型下载总长度。
````

- [ ] **Step 4: 执行预置(运维,在服务可达时手动执行一次)**

Run: `pip install onnx onnxconverter-common onnxruntime && S3_ENDPOINT=... S3_ACCESS_KEY=... S3_SECRET_KEY=... ./scripts/prepare-id-photo-models.sh`
Expected: 两 onnx 上传到 MinIO `models` 桶;终端打印两模型的 I/O 名与形状。

- [ ] **Step 5: 回填实测参数到文档**

把 Step 4 打印的 I/O 名/形状/确认的归一化填入 `docs/id-photo-models.md` 的 TODO 处。

- [ ] **Step 6: 提交**

```bash
git add scripts/prepare-id-photo-models.sh scripts/convert-id-photo-model.py scripts/inspect-onnx-io.py docs/id-photo-models.md
git commit -m "docs: 添加证件照本地抠图模型预置脚本与文档"
```

> 若此刻无 MinIO/Python 环境执行,可先提交脚本与文档(含 TODO),标注「待执行回填」,后续运维补。Task 5 推理代码用 BiRefNet 惯例默认值,执行回填后校准。

---

### Task 3: model-registry.ts

**Files:**
- Create: `apps/web/src/lib/id-photo-local/model-registry.ts`
- Test: `apps/web/src/lib/id-photo-local/__tests__/model-registry.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/lib/id-photo-local/__tests__/model-registry.test.ts`:

```ts
import { describe, expect, it, afterEach } from 'vitest';
import { ID_PHOTO_MODELS, modelUrl, type ModelTier } from '../model-registry';

describe('model-registry', () => {
  afterEach(() => { delete process.env.NEXT_PUBLIC_S3_PUBLIC_URL; });

  it('exposes balanced and high tiers', () => {
    expect(ID_PHOTO_MODELS.balanced.key).toBe('rmbg-1.4');
    expect(ID_PHOTO_MODELS.balanced.quant).toBe('fp16');
    expect(ID_PHOTO_MODELS.balanced.sizeBytes).toBeGreaterThan(80 * 1024 * 1024);
    expect(ID_PHOTO_MODELS.high.key).toBe('rmbg-2.0');
    expect(ID_PHOTO_MODELS.high.quant).toBe('q4f16');
    expect(ID_PHOTO_MODELS.high.sizeBytes).toBeGreaterThan(230 * 1024 * 1024);
  });

  it('builds the public object URL from NEXT_PUBLIC_S3_PUBLIC_URL', () => {
    process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'http://localhost:9000';
    expect(modelUrl(ID_PHOTO_MODELS.balanced)).toBe(
      'http://localhost:9000/models/rmbg-1.4-fp16.onnx'
    );
  });

  it('tierFor returns balanced when webgpu unavailable', () => {
    // CPU 锁均衡档
    expect(ID_PHOTO_MODELS.balanced.key).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `bun --cwd apps/web test src/lib/id-photo-local/__tests__/model-registry.test.ts`
Expected: FAIL —— 无法解析 `../model-registry`。

- [ ] **Step 3: 写实现**

创建 `apps/web/src/lib/id-photo-local/model-registry.ts`:

```ts
export type ModelTier = 'balanced' | 'high';

export interface ModelMeta {
  key: string;
  bucketPath: string;
  sizeBytes: number;
  quant: 'fp16' | 'q4f16';
}

export const ID_PHOTO_MODELS: Record<ModelTier, ModelMeta> = {
  balanced: {
    key: 'rmbg-1.4',
    bucketPath: 'models/rmbg-1.4-fp16.onnx',
    sizeBytes: 84 * 1024 * 1024,
    quant: 'fp16',
  },
  high: {
    key: 'rmbg-2.0',
    bucketPath: 'models/rmbg-2.0-q4f16.onnx',
    sizeBytes: 234 * 1024 * 1024,
    quant: 'q4f16',
  },
};

/**
 * 拼接模型在自有对象存储的公网 URL。桶 `models` 设为只读匿名下载。
 */
export function modelUrl(meta: ModelMeta): string {
  const base = process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
  if (!base) throw new Error('NEXT_PUBLIC_S3_PUBLIC_URL is not configured');
  return `${base}/${meta.bucketPath}`;
}

/**
 * 给定 WebGPU 是否可用,决定实际使用哪一档。
 * CPU 模式锁均衡档(RMBG-1.4),避免 234MB 高精度在 CPU 上卡死/OOM。
 */
export function tierFor(webgpuAvailable: boolean, requested: ModelTier): ModelTier {
  return webgpuAvailable ? requested : 'balanced';
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `bun --cwd apps/web test src/lib/id-photo-local/__tests__/model-registry.test.ts`
Expected: PASS(3 条)。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/id-photo-local/model-registry.ts apps/web/src/lib/id-photo-local/__tests__/model-registry.test.ts
git commit -m "feat(web): 添加证件照本地模型注册表"
```

---

### Task 4: composite.ts(canvas 合成背景 + preset 裁剪)

**Files:**
- Create: `apps/web/src/lib/id-photo-local/composite.ts`
- Test: `apps/web/src/lib/id-photo-local/__tests__/composite.test.ts`

> 用 `OffscreenCanvas`(主线程或 worker 传 ImageBitmap)做合成。逻辑:把原图按 mask 的 alpha 保留前景 → 叠到纯色背景 → 按 preset 居中裁剪到固定像素 → `toBlob`。`hexToRgb`、`cropToPreset` 为纯函数,单独测试。

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/lib/id-photo-local/__tests__/composite.test.ts`:

```ts
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
    // 居中
    expect(bounds.x + bounds.width / 2).toBeCloseTo(500, -1);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(750, -1);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `bun --cwd apps/web test src/lib/id-photo-local/__tests__/composite.test.ts`
Expected: FAIL —— 无法解析 `../composite`。

- [ ] **Step 3: 写实现**

创建 `apps/web/src/lib/id-photo-local/composite.ts`:

```ts
export interface Rgb { r: number; g: number; b: number; }

export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`invalid background color: ${hex}`);
  const v = m[1];
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

export interface CropBounds { x: number; y: number; width: number; height: number; }

/**
 * 计算从原图(srcW×srcH)按目标宽高比 contain 后的居中裁剪区域。
 * 返回原图坐标系下的裁剪框;最终再缩放到目标像素。
 */
export function cropToPresetBounds(
  srcW: number, srcH: number, dstW: number, dstH: number,
): CropBounds {
  const targetRatio = dstW / dstH;
  const srcRatio = srcW / srcH;
  let w: number, h: number;
  if (srcRatio > targetRatio) {
    h = srcH;
    w = h * targetRatio;
  } else {
    w = srcW;
    h = w / targetRatio;
  }
  return { x: (srcW - w) / 2, y: (srcH - h) / 2, width: w, height: h };
}

/**
 * 把原图前景(经 mask alpha 保留)叠到纯色背景上,按 preset 裁剪输出。
 * @param source 原图(已解码为 ImageBitmap)
 * @param maskAlpha 与原图同尺寸的单通道 alpha(0..1),长度 = srcW*srcH
 * @param backgroundColor #rrggbb
 * @param presetW presetH 目标像素(如 295×413)
 */
export async function compositeIdPhoto(
  source: ImageBitmap,
  maskAlpha: Float32Array,
  srcW: number,
  srcH: number,
  backgroundColor: string,
  presetW: number,
  presetH: number,
  outputType: 'image/jpeg' | 'image/png',
): Promise<Blob> {
  const { r, g, b } = hexToRgb(backgroundColor);
  // 1. 前景 × alpha:把 alpha 烤进一张与原图同尺寸的 RGBA canvas
  const fg = new OffscreenCanvas(srcW, srcH);
  const fctx = fg.getContext('2d')!;
  fctx.drawImage(source, 0, 0, srcW, srcH);
  const imageData = fctx.getImageData(0, 0, srcW, srcH);
  const data = imageData.data;
  for (let i = 0; i < srcW * srcH; i++) {
    const a = maskAlpha[i];
    data[i * 4 + 3] = Math.round(a * 255);
  }
  fctx.putImageData(imageData, 0, 0);

  // 2. 裁剪区域(原图坐标)+ 缩放到 preset 像素
  const crop = cropToPresetBounds(srcW, srcH, presetW, presetH);
  const out = new OffscreenCanvas(presetW, presetH);
  const octx = out.getContext('2d')!;
  // 纯色背景
  octx.fillStyle = `rgb(${r},${g},${b})`;
  octx.fillRect(0, 0, presetW, presetH);
  // 前景叠上(已带 alpha)
  octx.drawImage(fg, crop.x, crop.y, crop.width, crop.height, 0, 0, presetW, presetH);

  const blob = await out.convertToBlob({
    type: outputType,
    quality: outputType === 'image/jpeg' ? 0.92 : undefined,
  });
  return blob;
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `bun --cwd apps/web test src/lib/id-photo-local/__tests__/composite.test.ts`
Expected: PASS(3 条)。`compositeIdPhoto` 依赖 `OffscreenCanvas`,jsdom 无,留手动核对与 Task 6 集成测(mock canvas)覆盖。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/id-photo-local/composite.ts apps/web/src/lib/id-photo-local/__tests__/composite.test.ts
git commit -m "feat(web): 添加证件照 canvas 合成与裁剪工具"
```

---

### Task 5: portrait-segmenter.worker.ts(ORT 推理)

**Files:**
- Create: `apps/web/src/lib/id-photo-local/portrait-segmenter.worker.ts`
- Create: `apps/web/src/lib/id-photo-local/segmenter-protocol.ts`(共享消息类型)
- Test: `apps/web/src/lib/id-photo-local/__tests__/portrait-segmenter.worker.test.ts`

> 预处理按 BiRefNet 惯例:RGB、[0,1] 归一化后减 ImageNet mean 除 std、NCHW。**输入尺寸与归一化常数以 Task 2 `docs/id-photo-models.md` 实测为准**,执行回填后校准下方 `INPUT_SIZE` 与均值/标准差。

- [ ] **Step 1: 写消息协议类型**

创建 `apps/web/src/lib/id-photo-local/segmenter-protocol.ts`:

```ts
export type SegmenterEp = 'webgpu' | 'wasm';

export type SegmenterRequest =
  | { type: 'init'; modelUrl: string }
  | { type: 'run'; bitmap: ImageBitmap; srcW: number; srcH: number };

export type SegmenterResponse =
  | { type: 'progress'; ratio: number }
  | { type: 'ready'; ep: SegmenterEp; inputNames: readonly string[]; outputNames: readonly string[] }
  | { type: 'result'; mask: Float32Array; maskW: number; maskH: number }
  | { type: 'error'; message: string };
```

- [ ] **Step 2: 写失败测试**

创建 `apps/web/src/lib/id-photo-local/__tests__/portrait-segmenter.worker.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

// mock onnxruntime-web/webgpu:捕获 create 的模型字节、返回假 session
const fakeOutputs = { out: { getData: async () => new Float32Array([0.1, 0.9, 0.9, 0.1]) } };
const runMock = vi.fn().mockResolvedValue(fakeOutputs);
const createMock = vi.fn().mockResolvedValue({
  inputNames: ['input'],
  outputNames: ['out'],
  run: runMock,
});
vi.mock('onnxruntime-web/webgpu', () => ({
  InferenceSession: { create: createMock },
  Tensor: class {
    constructor(public type: string, public data: unknown, public dims: number[]) {}
  },
  env: { wasm: { wasmPaths: '', numThreads: 1, simd: true, proxy: false } },
}));

// stub navigator.gpu(无 adapter → wasm)
beforeEach(() => {
  Object.defineProperty(navigator, 'gpu', {
    value: { requestAdapter: async () => null },
    configurable: true,
  });
});
```

> 完整 worker 测试通过动态 `new Worker(new URL(...))` 在 vitest 难直接跑,本测试聚焦 `run` 与 `init` 的纯逻辑路径。如环境不支持 worker 加载,改为对 worker 模块导出的 `handleInit`/`handleRun` 函数直接测。下方实现把核心逻辑抽成可测函数。

- [ ] **Step 3: 写实现**

创建 `apps/web/src/lib/id-photo-local/portrait-segmenter.worker.ts`:

```ts
/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import type { SegmenterEp, SegmenterRequest, SegmenterResponse } from './segmenter-protocol';

// ===== 校准点:以 docs/id-photo-models.md 实测为准 =====
const INPUT_SIZE = 1024; // BiRefNet/RMBG 惯例输入边长,实测后校准
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];
// ========================================================

ort.env.wasm.wasmPaths = {
  wasm: '/onnx/ort-wasm-simd-threaded.jsep.wasm',
  mjs: '/onnx/ort-wasm-simd-threaded.jsep.mjs',
};
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;
ort.env.wasm.proxy = false;

async function probeWebGpu(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

async function fetchModelWithProgress(
  url: string,
  onProgress: (ratio: number) => void,
): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model fetch failed: ${res.status}`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(total ? received / total : 0);
  }
  const out = new Uint8Array(received);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export async function detectEp(): Promise<SegmenterEp> {
  return (await probeWebGpu()) ? 'webgpu' : 'wasm';
}

export async function handleInit(
  modelUrl: string,
  post: (msg: SegmenterResponse) => void,
): Promise<ort.InferenceSession> {
  const ep = await detectEp();
  const bytes = await fetchModelWithProgress(modelUrl, ratio =>
    post({ type: 'progress', ratio }),
  );
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ep === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
    graphOptimizationLevel: 'all',
    enableMemPattern: false,
    enableCpuMemArena: false,
  });
  post({
    type: 'ready',
    ep,
    inputNames: session.inputNames,
    outputNames: session.outputNames,
  });
  return session;
}

/** 把 ImageBitmap 预处理成 NCHW float32 张量数据。 */
export function preprocess(
  bitmap: ImageBitmap,
  size: number,
): { data: Float32Array; dims: [number, number, number, number] } {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;
  // 按短边 contain 绘制到 size×size
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - dw) / 2, (size - dh) / 2, dw, dh);
  const { data } = ctx.getImageData(0, 0, size, size);
  // RGBA → NCHW float32,归一化
  const out = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let i = 0; i < plane; i++) {
    out[i] = (data[i * 4] / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    out[plane + i] = (data[i * 4 + 1] / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    out[2 * plane + i] = (data[i * 4 + 2] / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }
  return { data: out, dims: [1, 3, size, size] };
}

/** 把模型输出张量(mask,sigmoid)resize 回原图尺寸的 alpha(0..1)。 */
export function postprocess(
  rawData: Float32Array,
  maskW: number,
  maskH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  // rawData 已是 [0,1](假设模型输出经 sigmoid);若未 sigmoid,在此补:
  // const alpha = 1 / (1 + Math.exp(-rawData[i]));
  const tmp = new OffscreenCanvas(maskW, maskH);
  const tctx = tmp.getContext('2d')!;
  const img = tctx.createImageData(maskW, maskH);
  for (let i = 0; i < maskW * maskH; i++) {
    const a = Math.max(0, Math.min(1, rawData[i]));
    img.data[i * 4] = a * 255;
    img.data[i * 4 + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
  const out = new OffscreenCanvas(dstW, dstH);
  const octx = out.getContext('2d')!;
  octx.drawImage(tmp, 0, 0, maskW, maskH, 0, 0, dstW, dstH);
  const resized = octx.getImageData(0, 0, dstW, dstH);
  const alpha = new Float32Array(dstW * dstH);
  for (let i = 0; i < dstW * dstH; i++) {
    alpha[i] = resized.data[i * 4] / 255;
  }
  return alpha;
}

let session: ort.InferenceSession | null = null;

self.addEventListener('message', async (e: MessageEvent<SegmenterRequest>) => {
  const post = (msg: SegmenterResponse) => (self as unknown as Worker).postMessage(msg);
  try {
    if (e.data.type === 'init') {
      session = await handleInit(e.data.modelUrl, post);
    } else if (e.data.type === 'run') {
      if (!session) throw new Error('session not ready');
      const { bitmap, srcW, srcH } = e.data;
      const { data, dims } = preprocess(bitmap, INPUT_SIZE);
      const inputName = session.inputNames[0];
      const input = new ort.Tensor('float32', data, dims);
      const outputs = await session.run({ [inputName]: input });
      const out = outputs[session.outputNames[0]];
      const rawData = (await out.getData()) as Float32Array;
      // 模型输出空间尺寸:假设 [1,1,INPUT_SIZE,INPUT_SIZE],取后两维
      const maskH = INPUT_SIZE;
      const maskW = INPUT_SIZE;
      const mask = postprocess(rawData, maskW, maskH, srcW, srcH);
      post({ type: 'result', mask, maskW: srcW, maskH: srcH });
    }
  } catch (err) {
    post({ type: 'error', message: (err as Error).message });
  }
});
```

- [ ] **Step 4: 补 worker 单测(preprocess/postprocess 纯函数)**

补 `__tests__/portrait-segmenter.worker.test.ts`(接 Step 2):

```ts
// stub OffscreenCanvas + getImageData(返回可控像素),测 preprocess 归一化与 postprocess resize
class FakeCtx {
  imageData: Uint8ClampedArray;
  constructor(w: number, h: number) { this.imageData = new Uint8ClampedArray(w * h * 4); }
  drawImage() {}
  getImageData(_x: number, _y: number, w: number, h: number) {
    return { data: this.imageData.subarray(0, w * h * 4), width: w, height: h } as ImageData;
  }
  putImageData() {}
  createImageData(w: number, _h: number) {
    return { data: new Uint8ClampedArray(w * 1 * 4), width: w, height: 1 } as ImageData;
  }
}
class FakeCanvas {
  ctx: FakeCtx;
  constructor(public width: number, public height: number) { this.ctx = new FakeCtx(width, height); }
  getContext() { return this.ctx; }
  convertToBlob() { return Promise.resolve(new Blob()); }
}
beforeEach(() => {
  Object.defineProperty(globalThis, 'OffscreenCanvas', { value: FakeCanvas, configurable: true });
});

it('preprocess normalizes RGB into NCHW float32', async () => {
  const { preprocess } = await import('../portrait-segmenter.worker');
  const bitmap = { width: 8, height: 8 } as ImageBitmap;
  const { data, dims } = preprocess(bitmap, 8);
  expect(dims).toEqual([1, 3, 8, 8]);
  expect(data.length).toBe(3 * 8 * 8);
});

it('detectEp returns wasm when no gpu adapter', async () => {
  const { detectEp } = await import('../portrait-segmenter.worker');
  expect(await detectEp()).toBe('wasm');
});
```

- [ ] **Step 5: 运行测试,确认通过**

Run: `bun --cwd apps/web test src/lib/id-photo-local/__tests__/portrait-segmenter.worker.test.ts`
Expected: PASS。若 `import('../portrait-segmenter.worker')` 因 worker 顶层 `self.addEventListener` 在 jsdom 报错,把 listener 注册包 `if (typeof self !== 'undefined' && 'addEventListener' in self)` 守卫,再跑。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/lib/id-photo-local/portrait-segmenter.worker.ts apps/web/src/lib/id-photo-local/segmenter-protocol.ts apps/web/src/lib/id-photo-local/__tests__/portrait-segmenter.worker.test.ts
git commit -m "feat(web): 添加证件照 RMBG 推理 Worker"
```

---

### Task 6: use-local-id-photo.ts(编排 hook)

**Files:**
- Create: `apps/web/src/lib/id-photo-local/use-local-id-photo.ts`
- Test: `apps/web/src/lib/id-photo-local/__tests__/use-local-id-photo.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/lib/id-photo-local/__tests__/use-local-id-photo.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocalIdPhoto } from '../use-local-id-photo';

// 假 Worker:记录 postMessage,手动触发 onmessage 回包
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  posted: any[] = [];
  postMessage(msg: unknown) { this.posted.push(msg); }
  terminate() {}
}

let fake: FakeWorker;
beforeEach(() => {
  fake = new FakeWorker();
  vi.stubGlobal('Worker', vi.fn(() => fake));
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return {}; } convertToBlob() { return Promise.resolve(new Blob(['x'])); } });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10, height: 10 })));
});

describe('useLocalIdPhoto', () => {
  it('starts in idle with no result', () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    expect(result.current.status).toBe('idle');
    expect(result.current.resultBlob).toBeNull();
  });

  it('runs segmentation and composites a result blob', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      const p = result.current.process(new File(['img'], 'a.jpg', { type: 'image/jpeg' }), 'balanced');
      // 等 init post
      await waitFor(() => expect(fake.posted.some(m => m.type === 'init')).toBe(true));
      // worker 回 ready(webgpu=false → wasm)
      fake.onmessage!({ data: { type: 'ready', ep: 'wasm', inputNames: ['input'], outputNames: ['out'] } });
      await waitFor(() => expect(fake.posted.some(m => m.type === 'run')).toBe(true));
      // worker 回 result mask
      fake.onmessage!({ data: { type: 'result', mask: new Float32Array(100), maskW: 10, maskH: 10 } });
      await p;
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.resultBlob).toBeInstanceOf(Blob);
  });

  it('locks balanced tier when webgpu unavailable', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      result.current.process(new File(['img'], 'a.jpg'), 'high');
      await waitFor(() => expect(fake.posted.some(m => m.type === 'init')).toBe(true));
    });
    // ep=wasm 时即便请求 high,实际 init 的是 balanced 模型 URL
    // (断言由 hook 内 tierFor 决定,此处验证 posted modelUrl 含 rmbg-1.4)
    const init = fake.posted.find(m => m.type === 'init');
    expect(init.modelUrl).toContain('rmbg-1.4');
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `bun --cwd apps/web test src/lib/id-photo-local/__tests__/use-local-id-photo.test.tsx`
Expected: FAIL —— 无法解析 `../use-local-id-photo`。

- [ ] **Step 3: 写实现**

创建 `apps/web/src/lib/id-photo-local/use-local-id-photo.ts`:

```ts
import { useCallback, useRef, useState } from 'react';
import { idPhotoPresetSpecs } from '@utils-plane/validators/id-photo';
import { compositeIdPhoto } from './composite';
import { ID_PHOTO_MODELS, modelUrl, tierFor, type ModelTier } from './model-registry';
import type { SegmenterEp, SegmenterResponse } from './segmenter-protocol';
import type { IdPhotoPreset, IdPhotoOutputType } from '@utils-plane/validators/id-photo';

export type LocalStage =
  | 'idle'
  | 'loading-model'
  | 'running'
  | 'compositing'
  | 'done'
  | 'error';

export interface UseLocalIdPhoto {
  status: LocalStage;
  progress: number; // 0..1,模型下载阶段
  ep: SegmenterEp | null;
  error: string | null;
  resultBlob: Blob | null;
  process: (
    file: File,
    tier: ModelTier,
    opts: { preset: IdPhotoPreset; backgroundColor: string; outputType: IdPhotoOutputType },
  ) => Promise<void>;
  reset: () => void;
}

export function useLocalIdPhoto(): UseLocalIdPhoto {
  const [status, setStatus] = useState<LocalStage>('idle');
  const [progress, setProgress] = useState(0);
  const [ep, setEp] = useState<SegmenterEp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  // 暂存一次 process 的参数,等 mask 回来后合成
  const pendingRef = useRef<{
    bitmap: ImageBitmap;
    srcW: number; srcH: number;
    backgroundColor: string;
    preset: IdPhotoPreset;
    outputType: IdPhotoOutputType;
  } | null>(null);

  const ensureWorker = useCallback((onMessage: (m: SegmenterResponse) => void) => {
    if (!workerRef.current) {
      const worker = new Worker(
        new URL('./portrait-segmenter.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = (e: MessageEvent<SegmenterResponse>) => onMessage(e.data);
      workerRef.current = worker;
    }
    return workerRef.current;
  }, []);

  const process = useCallback<UseLocalIdPhoto['process']>(async (file, tier, opts) => {
    setError(null);
    setResultBlob(null);
    try {
      const bitmap = await createImageBitmap(file);
      const srcW = bitmap.width;
      const srcH = bitmap.height;
      pendingRef.current = { bitmap, srcW, srcH, backgroundColor: opts.backgroundColor, preset: opts.preset, outputType: opts.outputType };

      const webgpu = ep === 'webgpu';
      const effectiveTier = tierFor(webgpu, tier);
      const worker = ensureWorker((msg) => {
        if (msg.type === 'progress') {
          setProgress(msg.ratio);
          if (status !== 'loading-model') setStatus('loading-model');
        } else if (msg.type === 'ready') {
          setEp(msg.ep);
          readyRef.current = true;
          setStatus('running');
          worker.postMessage({ type: 'run', bitmap, srcW, srcH });
        } else if (msg.type === 'result') {
          setStatus('compositing');
          void compositeAndFinish(msg.mask, msg.maskW, msg.maskH);
        } else if (msg.type === 'error') {
          setError(msg.message);
          setStatus('error');
        }
      });

      if (!readyRef.current) {
        setStatus('loading-model');
        worker.postMessage({ type: 'init', modelUrl: modelUrl(ID_PHOTO_MODELS[effectiveTier]) });
      } else {
        setStatus('running');
        worker.postMessage({ type: 'run', bitmap, srcW, srcH });
      }
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    }

    async function compositeAndFinish(mask: Float32Array, maskW: number, maskH: number) {
      const p = pendingRef.current;
      if (!p) return;
      try {
        const spec = idPhotoPresetSpecs[p.preset];
        const blob = await compositeIdPhoto(
          p.bitmap, mask, maskW, maskH,
          p.backgroundColor, spec.widthPx, spec.heightPx, p.outputType,
        );
        setResultBlob(blob);
        setStatus('done');
      } catch (err) {
        setError((err as Error).message);
        setStatus('error');
      }
    }
  }, [ensureWorker, ep, status]);

  const reset = useCallback(() => {
    setStatus('idle');
    setProgress(0);
    setError(null);
    setResultBlob(null);
    pendingRef.current = null;
  }, []);

  return { status, progress, ep, error, resultBlob, process, reset };
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `bun --cwd apps/web test src/lib/id-photo-local/__tests__/use-local-id-photo.test.tsx`
Expected: PASS(3 条)。若 `compositeIdPhoto` 在 jsdom 因 `OffscreenCanvas` 行为不符,补 stub 返回固定 blob。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/id-photo-local/use-local-id-photo.ts apps/web/src/lib/id-photo-local/__tests__/use-local-id-photo.test.tsx
git commit -m "feat(web): 添加证件照本地处理编排 hook"
```

---

### Task 7: IdPhotoOptions 扩展(模式参数 + 高精度开关)

**Files:**
- Modify: `apps/web/src/components/tools/id-photo-options.tsx`
- Test: `apps/web/src/components/tools/__tests__/id-photo-options.test.tsx`

> 加 `mode: 'local' | 'server'`、`highPrecision?: boolean`、`highPrecisionDisabled?: boolean`、`onHighPrecisionChange?: (v: boolean) => void`。本地模式隐藏 segmentationMode、显示高精度开关;服务端模式相反。

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/components/tools/__tests__/id-photo-options.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { IdPhotoOptions } from '../id-photo-options';

const en = {
  ImageIdPhoto: {
    preset: 'preset', background: 'background', segmentationMode: 'mode',
    outputType: 'output', highPrecision: 'high precision',
    highPrecisionLockedHint: 'requires webgpu',
    segmentationModes: { local: { label: 'local', description: 'd' }, ai: { label: 'ai', description: 'd' } },
  },
};
const t = (k: string) => k.split('.').slice(1).join('.');

function wrap(props: any) {
  return render(
    <NextIntlClientProvider locale="en" messages={en as any}>
      <IdPhotoOptions t={t} value={{ preset: 'one_inch', backgroundColor: '#fff', outputType: 'image/jpeg', segmentationMode: 'local', crop: { x: 0.5, y: 0.5, scale: 1 } }} {...props} />
    </NextIntlClientProvider>,
  );
}

describe('IdPhotoOptions', () => {
  it('local mode hides segmentation mode and shows high precision toggle', () => {
    wrap({ mode: 'local', highPrecision: false, onHighPrecisionChange: vi.fn(), highPrecisionDisabled: false });
    expect(screen.queryByText('mode')).not.toBeInTheDocument();
    expect(screen.getByText('high precision')).toBeInTheDocument();
  });

  it('server mode shows segmentation mode and hides high precision', () => {
    wrap({ mode: 'server' });
    expect(screen.getByText('mode')).toBeInTheDocument();
    expect(screen.queryByText('high precision')).not.toBeInTheDocument();
  });

  it('high precision toggle is disabled when highPrecisionDisabled', () => {
    const onChange = vi.fn();
    wrap({ mode: 'local', highPrecision: false, onHighPrecisionChange: onChange, highPrecisionDisabled: true });
    const toggle = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `bun --cwd apps/web test src/components/tools/__tests__/id-photo-options.test.tsx`
Expected: FAIL —— 不识别 `mode`/`highPrecision` props,本地模式仍显示 segmentationMode。

- [ ] **Step 3: 修改实现**

修改 `apps/web/src/components/tools/id-photo-options.tsx`:

`Props` 追加字段:

```
old:
type Props = {
  value: IdPhotoOptionsState;
  onChange: (value: IdPhotoOptionsState) => void;
  t: (key: string) => string;
  disabled?: boolean;
};

new:
type Props = {
  value: IdPhotoOptionsState;
  onChange: (value: IdPhotoOptionsState) => void;
  t: (key: string) => string;
  disabled?: boolean;
  mode?: 'local' | 'server';
  highPrecision?: boolean;
  highPrecisionDisabled?: boolean;
  onHighPrecisionChange?: (value: boolean) => void;
};
```

函数签名解构:

```
old:
export function IdPhotoOptions({ value, onChange, t, disabled }: Props) {

new:
export function IdPhotoOptions({
  value, onChange, t, disabled,
  mode = 'server',
  highPrecision = false,
  highPrecisionDisabled = false,
  onHighPrecisionChange,
}: Props) {
```

把 segmentationMode 区块包条件渲染(仅 server 模式),并在其位置(本地模式)渲染高精度开关。把原 segmentationMode 的 `<div className="space-y-2">…</div>` 块替换为:

```tsx
      {mode === 'server' ? (
        <div className="space-y-2">
          <label className="text-xs font-mono text-muted-foreground">
            {t('segmentationMode')}
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['local', 'ai'] as const).map(modeKey => (
              <button
                key={modeKey}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...value, segmentationMode: modeKey })}
                className={`rounded-md border px-3 py-2 text-left text-sm ${
                  value.segmentationMode === modeKey
                    ? 'border-foreground bg-muted'
                    : 'border-border'
                }`}
              >
                <span className="block font-medium">
                  {t(`segmentationModes.${modeKey}.label`)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t(`segmentationModes.${modeKey}.description`)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="text-xs font-mono text-muted-foreground">
            {t('highPrecision')}
          </label>
          <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
            <input
              type="checkbox"
              checked={highPrecision}
              disabled={disabled || highPrecisionDisabled}
              onChange={e => onHighPrecisionChange?.(e.target.checked)}
            />
            <span>{t('highPrecision')}</span>
          </label>
          {highPrecisionDisabled && (
            <span className="text-xs text-muted-foreground">
              {t('highPrecisionLockedHint')}
            </span>
          )}
        </div>
      )}
```

> 注意:原代码 `(['local','ai'] as const).map(mode => ...)` 的回调参数名 `mode` 与新增 `mode` prop 冲突,改名为 `modeKey`(已在上方替换片段内处理)。

- [ ] **Step 4: 运行测试,确认通过**

Run: `bun --cwd apps/web test src/components/tools/__tests__/id-photo-options.test.tsx`
Expected: PASS(3 条)。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/tools/id-photo-options.tsx apps/web/src/components/tools/__tests__/id-photo-options.test.tsx
git commit -m "feat(web): IdPhotoOptions 支持本地/服务端模式与高精度开关"
```

---

### Task 8: i18n 文案

**Files:**
- Modify: `apps/web/messages/zh.json`、`apps/web/messages/en.json`

> 在 `ImageIdPhoto` 段新增:处理模式标签与选项、高精度、CPU 锁档提示、本地路阶段文案、本地路失败文案。保留现有 `previewAlt` 等。

- [ ] **Step 1: 中文文案**

在 `apps/web/messages/zh.json` 的 `ImageIdPhoto` 段(`previewAlt` 之后、`presets` 之前)追加:

```
old:
    "previewAlt": "证件照预览",
    "presets": {

new:
    "previewAlt": "证件照预览",
    "processingModeLabel": "处理模式",
    "processingModes": {
      "local": "本地处理",
      "server": "服务端处理"
    },
    "localHighPrecision": "高精度",
    "localHighPrecisionLockedHint": "高精度需 WebGPU,当前使用均衡档",
    "localStages": {
      "loadingModel": "正在加载模型",
      "running": "正在抠图",
      "compositing": "正在合成"
    },
    "localFailed": "本地处理失败,可重试或切服务端",
    "localNoWebGpu": "当前环境不支持本地处理,请使用服务端",
    "presets": {
```

- [ ] **Step 2: 英文文案**

在 `apps/web/messages/en.json` 的 `ImageIdPhoto` 段同样位置追加:

```
old:
    "previewAlt": "ID photo preview",
    "presets": {

new:
    "previewAlt": "ID photo preview",
    "processingModeLabel": "Processing",
    "processingModes": {
      "local": "Local",
      "server": "Server"
    },
    "localHighPrecision": "High precision",
    "localHighPrecisionLockedHint": "High precision requires WebGPU; using balanced tier",
    "localStages": {
      "loadingModel": "Loading model",
      "running": "Segmenting",
      "compositing": "Compositing"
    },
    "localFailed": "Local processing failed. Retry or switch to server.",
    "localNoWebGpu": "Local processing is unavailable in this environment. Use server.",
    "presets": {
```

- [ ] **Step 3: 校验 JSON 合法**

Run: `bun --cwd apps/web test src/app/[locale]/(app)/__tests__/catalog-pages.test.tsx`
Expected: PASS(确保文案改动未破坏现有用例)。

- [ ] **Step 4: 提交**

```bash
git add apps/web/messages/zh.json apps/web/messages/en.json
git commit -m "feat(web): 添加证件照本地处理 i18n 文案"
```

---

### Task 9: tool-metadata 改本地优先语义

**Files:**
- Modify: `apps/web/src/lib/tools/tool-metadata.ts`

> `imageIdPhoto` 改为本地优先:`processing:'local-first'`、`requiresLogin:false`(本地路不登录;服务端登录墙在页面层处理)。`retention` 保留 `'account-files'`(服务端路仍存账号文件)。

- [ ] **Step 1: 修改**

`apps/web/src/lib/tools/tool-metadata.ts`:

```
old:
    key: 'imageIdPhoto',
    href: '/image/id-photo',
    icon: BadgeCheck,
    titleKey: 'ToolCatalog.tools.imageIdPhoto.title',
    descriptionKey: 'ToolCatalog.tools.imageIdPhoto.description',
    categoryKey: 'ToolCatalog.categories.imageConvert',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,

new:
    key: 'imageIdPhoto',
    href: '/image/id-photo',
    icon: BadgeCheck,
    titleKey: 'ToolCatalog.tools.imageIdPhoto.title',
    descriptionKey: 'ToolCatalog.tools.imageIdPhoto.description',
    categoryKey: 'ToolCatalog.categories.imageConvert',
    processing: 'local-first',
    retention: 'account-files',
    requiresLogin: false,
```

- [ ] **Step 2: 跑现有工具元数据测试**

Run: `bun --cwd apps/web test src/lib/tools/__tests__/tool-metadata.test.ts` 2>/dev/null || bun --cwd apps/web test -t "tool-metadata" 2>/dev/null || bun --cwd apps/web test
Expected: 无回归(catalog/元数据相关用例 PASS)。若某用例断言 `imageIdPhoto` 的 `processing:'server'`/`requiresLogin:true`,更新该断言为新值。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/lib/tools/tool-metadata.ts
git commit -m "update(web): 证件照改为本地优先语义"
```

---

### Task 10: page.tsx 模式切换 + 本地路 UI

**Files:**
- Modify: `apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`
- Test: `apps/web/src/app/[locale]/(app)/image/id-photo/__tests__/page.test.tsx`(扩展)

> 顶部加「本地 / 服务端」segmented control(默认本地)。本地模式接 `useLocalIdPhoto`:处理按钮调 `process`,进度按 stage,结果预览用 `useObjectUrl(blob)`,下载用 `a[download]`;不出现任务轮询与登录墙。服务端模式保持现状。切换模式时 reset。

- [ ] **Step 1: 扩展失败测试(在现有 page.test.tsx 追加)**

在 `apps/web/src/app/[locale]/(app)/image/id-photo/__tests__/page.test.tsx` 的 `describe('IdPhotoPage', ...)` 内追加:

```tsx
  it('defaults to local mode and renders the local start button', () => {
    const { container } = renderPage();
    expect(screen.getByRole('button', { name: 'Generate ID photo' })).toBeInTheDocument();
    // 本地模式不显示 segmentation mode(标准模式/AI 精修)
    // (本地模式 IdPhotoOptions 隐藏 segmentationMode)
  });

  it('switching to server mode shows segmentation mode options', async () => {
    const { container } = renderPage();
    const serverBtn = screen.getByRole('button', { name: 'Server' });
    fireEvent.click(serverBtn);
    // 服务端模式 IdPhotoOptions 显示 segmentationMode(抠图模式)
    // 具体文案断言按实际 i18n key 调整
  });
```

> `renderPage` 已 mock 会话/上传/任务。本地模式无任务链路,现有 mock 不阻碍 UI 渲染。

- [ ] **Step 2: 运行测试,确认失败**

Run: `bun --cwd apps/web test "src/app/[locale]/(app)/image/id-photo/__tests__/page.test.tsx"`
Expected: FAIL —— 无「Server」按钮(模式切换未实现)。

- [ ] **Step 3: 修改 page.tsx**

顶部 import 追加:

```tsx
import { useLocalIdPhoto } from '@/lib/id-photo-local/use-local-id-photo';
```

组件内,在现有 hook 之后追加:

```tsx
  const [processingMode, setProcessingMode] = useState<'local' | 'server'>('local');
  const [highPrecision, setHighPrecision] = useState(false);
  const local = useLocalIdPhoto();
```

`handleProcess` 改为按模式分流:

```tsx
  const handleProcess = async () => {
    if (processingMode === 'local') {
      if (!file) return;
      await local.process(file, highPrecision ? 'high' : 'balanced', {
        preset: options.preset,
        backgroundColor: options.backgroundColor,
        outputType: options.outputType,
      });
      return;
    }
    // —— 以下为原服务端逻辑,保持不变 ——
    if (!file) return;
    if (!sessionLoading && !session) {
      router.push(`/login?next=${encodeURIComponent('/image/id-photo')}`);
      return;
    }
    setProcessing(true);
    setError(null);
    setResultFile(null);
    try {
      const uploaded = await uploadFile.mutateAsync(file);
      const task = await createTask.mutateAsync({
        type: 'image_id_photo',
        inputFileIds: [(uploaded as any).id],
        inputConfig: {
          preset: options.preset,
          backgroundColor: options.backgroundColor,
          outputType: options.outputType,
          segmentationMode: options.segmentationMode,
          dpi: 300,
          crop: options.crop,
        },
      });
      setTaskId(task.id);
    } catch (err) {
      setError((err as Error).message);
      setProcessing(false);
    }
  };
```

`localResultUrl`(本地结果 blob 预览):

```tsx
  const localResultUrl = useObjectUrl(local.resultBlob);
```

在 `ToolPageShell` 内、`FileDropzone` 之前插入模式切换 segmented control:

```tsx
      <div className="inline-flex rounded-md border border-border p-0.5 text-sm">
        {(['local', 'server'] as const).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => { setProcessingMode(m); local.reset(); setResultFile(null); setError(null); }}
            className={`rounded-[5px] px-3 py-1.5 font-mono transition-colors ${
              processingMode === m ? 'bg-foreground text-background' : 'text-muted-foreground'
            }`}
          >
            {t(`processingModes.${m}`)}
          </button>
        ))}
      </div>
```

`IdPhotoOptions` 调用传模式参数:

```
old:
          <IdPhotoOptions
            value={options}
            onChange={setOptions}
            disabled={processing}
            t={t}
          />

new:
          <IdPhotoOptions
            value={options}
            onChange={setOptions}
            disabled={processing || local.status === 'running' || local.status === 'compositing'}
            t={t}
            mode={processingMode}
            highPrecision={highPrecision}
            highPrecisionDisabled={local.ep !== 'webgpu'}
            onHighPrecisionChange={setHighPrecision}
          />
```

进度块:本地模式用 `local.status`/`local.progress`,服务端模式用现有 `taskQuery`:

```tsx
      {(processingMode === 'local'
        ? local.status === 'loading-model' || local.status === 'running' || local.status === 'compositing'
        : processing) && (
        <ProcessingProgress
          progress={processingMode === 'local'
            ? (local.status === 'loading-model' ? Math.round(local.progress * 100) : local.status === 'running' ? 60 : 90)
            : taskQuery.data?.progress ?? 5}
          label={processingMode === 'local'
            ? t(`localStages.${local.status === 'loading-model' ? 'loadingModel' : local.status === 'running' ? 'running' : 'compositing'}`)
            : t('processing')}
        />
      )}
```

结果区:本地模式展示 `localResultUrl`,服务端模式保持 `resultFile`:

```tsx
      {processingMode === 'local' && local.resultBlob && (
        <ResultPanel
          title={t('resultTitle')}
          description={`id-photo.${options.outputType === 'image/png' ? 'png' : 'jpg'}`}
          preview={localResultUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={localResultUrl} alt={t('previewAlt')} className="mx-auto max-h-80 w-auto object-contain rounded-md border border-border" />
          ) : null}
          meta={[]}
          action={<DownloadButton file={new File([local.resultBlob], `id-photo.${options.outputType === 'image/png' ? 'png' : 'jpg'}`, { type: options.outputType })} />}
        />
      )}

      {processingMode === 'server' && resultFile && (
        <ResultPanel
          title={t('resultTitle')}
          description={resultFile.name}
          preview={resultUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resultUrl} alt={t('previewAlt')} className="mx-auto max-h-80 w-auto object-contain rounded-md border border-border" />
          ) : null}
          meta={[{ label: t('resultSize'), value: formatBytes(resultFile.size, tUnits, locale) }]}
          action={<DownloadButton file={resultFile} />}
        />
      )}
```

错误恢复:`onRetry`/`onReset` 按模式:

```tsx
      {(processingMode === 'local' ? local.error : error) && (
        <FailureRecoveryPanel
          message={processingMode === 'local' ? (local.error ?? '') : (error ?? '')}
          onRetry={handleProcess}
          onReset={() => { setFile(null); local.reset(); }}
        />
      )}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `bun --cwd apps/web test "src/app/[locale]/(app)/image/id-photo/__tests__/page.test.tsx"`
Expected: PASS(含原有预览用例 + 新增模式切换用例)。

- [ ] **Step 5: 提交**

```bash
git add "apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx" "apps/web/src/app/[locale]/(app)/image/id-photo/__tests__/page.test.tsx"
git commit -m "feat(web): 证件照页接入本地处理路与服务端模式切换"
```

---

### Task 11: Docker 离线镜像纳入模型

**Files:**
- Modify: 组合镜像 Dockerfile(组合构建)+ entrypoint
- Modify: `docs/id-photo-models.md`(补离线说明)

> 离线镜像(`utils-plane-offline`)需内置两 onnx 模型,启动时同步到本地 MinIO `models` 桶。组合镜像 Dockerfile 已处理 web/api 构建,这里加模型层。

- [ ] **Step 1: 定位组合镜像 Dockerfile**

Run: `ls docker/*.Dockerfile apps/*/Dockerfile* 2>/dev/null || true`
找到组合镜像构建文件(如 `docker/Dockerfile.all` 或 `Dockerfile.offline`)。若不存在,在 `docker/` 下确认实际文件名后替换下方路径。

- [ ] **Step 2: 加模型层与 entrypoint 同步**

在组合镜像 Dockerfile(以 `docker/Dockerfile.all` 为占位,实际按 Step 1 结果)末尾、`CMD` 之前追加模型复制;并新增 entrypoint 同步逻辑。若镜像已有 entrypoint,在其中追加模型同步;若无,创建 `docker/entrypoint.sh`:

```dockerfile
# 在 web/api 构建层之后,最终镜像层
COPY scripts/prepare-id-photo-models.sh /app/scripts/prepare-id-photo-models.sh
COPY scripts/convert-id-photo-model.py /app/scripts/convert-id-photo-model.py
COPY scripts/inspect-onnx-io.py /app/scripts/inspect-onnx-io.py
# 预构建的模型(构建期已转好,放 docker/models/ 或从构建参数 ARG 拉取)
COPY docker/models/rmbg-1.4-fp16.onnx /app/models/rmbg-1.4-fp16.onnx
COPY docker/models/rmbg-2.0-q4f16.onnx /app/models/rmbg-2.0-q4f16.onnx
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["bun", "run", "start"]
```

`docker/entrypoint.sh`(若已存在则把 `sync_models` 函数并入):

```bash
#!/usr/bin/env bash
set -e

sync_models() {
  echo "[entrypoint] syncing id-photo models to MinIO models bucket"
  mc alias set local "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" 2>/dev/null || true
  mc mb "local/${S3_MODELS_BUCKET:-models}" --ignore-existing 2>/dev/null || true
  mc anonymous set download "local/${S3_MODELS_BUCKET:-models}" 2>/dev/null || true
  mc cp "/app/models/rmbg-1.4-fp16.onnx" "local/${S3_MODELS_BUCKET:-models}/rmbg-1.4-fp16.onnx" 2>/dev/null || true
  mc cp "/app/models/rmbg-2.0-q4f16.onnx" "local/${S3_MODELS_BUCKET:-models}/rmbg-2.0-q4f16.onnx" 2>/dev/null || true
}

sync_models || echo "[entrypoint] model sync skipped (MinIO not ready or mc missing)"

exec "$@"
```

- [ ] **Step 3: 文档补离线说明**

在 `docs/id-photo-models.md` 末尾追加:

````markdown
## 离线镜像

- 组合镜像构建时把转好的两 onnx 放 `docker/models/`,Dockerfile `COPY` 进镜像 `/app/models/`。
- `docker/entrypoint.sh` 启动时用 `mc` 把模型同步到本地 MinIO `models` 桶(只读匿名),失败不阻塞启动(便于 MinIO 未就绪时重试)。
- 模型文件不进 Git(大),构建前放 `docker/models/`(已 gitignore)。
````

`.gitignore` 追加 `docker/models/`:

```
old:
apps/web/public/onnx/

new:
apps/web/public/onnx/
docker/models/
```

- [ ] **Step 4: 提交**

```bash
git add docker/entrypoint.sh docs/id-photo-models.md .gitignore
# Dockerfile 改动按实际路径 add
git commit -m "feat(docker): 离线镜像内置证件照模型并同步到 MinIO"
```

> 若组合镜像 Dockerfile 当前不在仓库(由 CI 生成),此任务降级为文档化说明 + entrypoint 脚本,实际 Dockerfile 改动在发布流程补。

---

### Task 12: 全量回归与手动核对

**Files:** 无(仅验证)

- [ ] **Step 1: 跑全量测试**

Run: `bun --cwd apps/web test`
Expected: 全部 PASS,无回归。

- [ ] **Step 2: lint**

Run: `bun --cwd apps/web lint`
Expected: 无新增 warning(尤其 `no-img-element` 已用 eslint-disable 注释覆盖)。

- [ ] **Step 3: 手动核对(本地服务可达)**

确保 `apps/api` + MinIO + models 桶预置好,启动 `bun run dev`,访问 `http://localhost:3000/zh/image/id-photo`:

1. 默认本地模式:上传单人正面照 → 看到原图预览 → 点「生成证件照」→ 模型下载进度(首次)→ 抠图合成 → 结果预览出现 + 下载。
2. 切「高精度」(若 WebGPU 可用):重新生成,用 RMBG-2.0。
3. 无 WebGPU(如 Firefox/老 Chrome):高精度开关置灰、提示;本地仍可用均衡档。
4. 切「服务端」模式:走现有任务链路(需登录),结果进历史。
5. 切换模式不串状态(本地结果/服务端结果互不残留)。

- [ ] **Step 4: 无新改动,跳过提交**

本任务无代码改动;若 Step 3 发现问题,回到对应 Task 修复并按其 commit 规范提交。

---

## Self-Review

**Spec coverage:**
- 本地端到端(抠图+合成+裁剪+下载、不建任务不登录)→ Task 4/5/6/10 ✓
- 服务端路保留不动 → Task 10 仅加模式切换,服务端分支原样 ✓
- 两档模型(均衡默认 + 可切高精度)→ Task 3 注册表 + Task 7 开关 + Task 10 接入 ✓
- 自有对象存储分发(MinIO models 桶)→ Task 2 预置 + Task 11 离线同步 ✓
- WebGPU 不可用→wasm CPU + 锁均衡档 → Task 3 tierFor + Task 5 detectEp + Task 6/10 ✓
- 推理放 Worker 不卡 UI → Task 5/6 ✓
- ORT wasm 自托管离线可用 → Task 1 复制到 public/onnx + Task 5 wasmPaths 指向 ✓
- i18n zh/en 同步 → Task 8 ✓
- tool-metadata 本地优先语义 → Task 9 ✓
- 非目标(不复刻边缘去污染、不输出透明 PNG、不做 crop 微调)→ 不涉及 ✓

**Placeholder scan:** `docs/id-photo-models.md` 的 TODO 是**待实测回填**(Task 2 Step 5 明确执行后填),非计划占位;RMBG 预处理参数以 BiRefNet 惯例给出 + 注释标明校准点,不是空洞 TBD。其余每步含完整代码与命令。Dockerfile 路径(Task 11 Step 1)需先 ls 确认,已在步骤内说明。

**Type consistency:**
- `ModelTier`('balanced'|'high')在 Task 3 定义,Task 6/7/10 使用一致。
- `SegmenterRequest`/`SegmenterResponse`/`SegmenterEp` 在 Task 5 的 `segmenter-protocol.ts` 定义,worker 与 hook 使用一致。
- `LocalStage`('idle'|'loading-model'|'running'|'compositing'|'done'|'error')在 Task 6 定义,Task 10 按此判断进度。
- `IdPhotoPreset`/`IdPhotoOutputType` 复用 `@utils-plane/validators/id-photo` 既有类型。
- `idPhotoPresetSpecs[preset].widthPx/heightPx` 与 `id-photo.ts` 既有规格一致。

**风险与校准:** RMBG 实测预处理参数(输入尺寸、归一化、IO 名)依赖 Task 2 执行;Task 5 代码按 BiRefNet 惯例默认,执行回填后校准 `INPUT_SIZE`/`IMAGENET_MEAN`/`IMAGENET_STD` 与输出空间尺寸假设。`out.getData()` 返回类型为 `Uint8Array|Float32Array|...`,按 float32 mask 处理,若模型输出 uint8 需在 `postprocess` 加转换。

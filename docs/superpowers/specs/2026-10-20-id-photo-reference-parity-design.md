# 证件照功能参考对齐设计

- 日期：2026-10-20
- 关联页面：`apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`
- 参考实现：<https://github.com/you-xiu/id_photo_bg_changer>（`pictone/` 模块）
- 前置文档：
  - [2026-07-07-id-photo-generator-design](./2026-07-07-id-photo-generator-design.md)
  - [2026-08-18-id-photo-local-segmentation-design](./2026-08-18-id-photo-local-segmentation-design.md)
  - [`docs/id-photo-models.md`](../../id-photo-models.md)

## 背景

对照参考实现 `id_photo_bg_changer`（Python + OpenCV + MODNet photographic + YuNet）逐行核查后，本项目证件照存在 7 个效果缺口。这些缺口不是「风格差异」，而是**能力缺失**：本地路完全没有边缘去污染，两条路都没有人脸检测与自动构图。

### 缺口清单与根因

| # | 缺口 | 参考实现 | 本项目现状 | 用户感知 |
| --- | --- | --- | --- | --- |
| 1 | 分割模型 | `modnet_photographic.onnx`，512×512，保长宽比 | 服务端通用 `modnet.onnx` 256×256 `fit:fill` 拉伸；本地路 RMBG-1.4 正方形 1024 | 发丝/帽檐细节丢失、近景拉伸变形 |
| 2 | 人脸检测 + 自动构图 | YuNet + 5 关键点，人脸占 35%、头顶留白、眼线倾斜 | 无。`faceCount` 硬编码为 1，前端只能手拖 | 头偏小/歪头/留白不均的照片原样输出 |
| 3 | 边缘去污染 | GrabCut + 距离场 + 反预乘 + 溢色替换 | 本地路**完全没有**；服务端有简化版但背景估计只取四角 | 蓝/红底发丝、帽檐、肩线染色 |
| 4 | 亮度/旋转校正 | 按 `rgb.mean()` 自动提亮压暗；按眼线倾斜自动旋转 ±5° | 无 | 暗照、歪头照原样输出 |
| 5 | 质量检查 | 8 项常驻面板 + 评分 | 无 | 用户不知道原图是否合格 |
| 6 | 构图辅助线 | 中心线/眼线区/头顶安全区/肩线，默认关 | 无 | 手动微调缺少参照 |
| 7 | 输出质量 | JPEG q95 + `subsampling=0` + 写 DPI 300 | q92 + canvas 默认 4:2:0，DPI 不写入 | 纯色底色度噪声、拼版物理尺寸偏差 |

### 目标

- 上述 7 个缺口在**本地路与服务端路同时**补齐，对齐参考实现的生成质量。
- 两端共享算法，避免同一套逻辑维护两份而产生漂移。
- 消除 RMBG-1.4 的 BRIA 专有许可风险（换 MIT 许可模型）。

### 非目标

- 不实现蒙版画笔修复与撤销/重做（photographic + 去污染后，手动修蒙版需求大幅下降，投入产出比低）。
- 不实现批量处理与多背景色批量导出（独立工作流，与单张生成效果无关）。
- 不改动拼版打印（`lib/id-photo/sheet.ts`）的布局算法，只确保其输入带正确 DPI。
- 不新增任务类型或数据库迁移。

## 已确认决策

| 决策点 | 选择 | 理由 |
| --- | --- | --- |
| 升级范围 | 一次全做 7 个缺口 | 用户明确要求「全部参考升级」 |
| 人脸检测 | 两端都用 YuNet ONNX | 复用现有 onnxruntime（服务端 node / 本地 web），零新增运行时；MIT；与参考实现同款，算法可直搬 |
| 服务端分割 | 换 `modnet_photographic`，512×512，保长宽比 | 证件照专用变体；只改预处理不换模型收益太有限；RMBG 有 BRIA 许可风险 |
| 本地路分割 | 也换 `modnet_photographic` | 三端同模型统一；体积从 84MB 降到 ~25MB；先实测验证破洞，若复现则保留 RMBG 回落 |
| 本地路去污染 | 纯 JS 重写核心算法（反预乘 + BFS 距离场溢色替换），不做 GrabCut | opencv.js 8MB 代价过大；photographic 干净 alpha 下 GrabCut 收益递减 |
| 自动构图触发 | 首次自动、用户手动后尊重用户（`userOverride`） | 避免反复覆盖用户手工微调 |
| 质量检查 | 两端 8 项全做，共享纯函数 | 一致体验 + 单一实现 |
| 质量面板 UI | 结果区下方常驻折叠面板 | 信息完整且不抢主视觉 |
| 辅助线 | 集成进 `ImageCropField` | 两端天然共用，改动集中单文件 |
| 输出质量 | 两端 q95 + 4:4:4 + 写 DPI 300 | DPI 是拼版物理尺寸正确的前提 |

## 架构

### 分层

```
packages/validators                纯函数，无 DOM / Node 依赖
  src/id-photo.ts                  已有：crop 几何、preset 规格
  src/id-photo-layout.ts           新增：suggestIdPhotoLayout（人脸自动构图）
  src/id-photo-quality.ts          新增：inspectIdPhoto（8 项质量检查）
  src/id-photo-background.ts       新增：estimateSourceBackgroundColors（底色聚类）

packages/utils                     纯函数，Buffer / Uint8ClampedArray 通用
  src/id-photo-decontaminate.ts    新增：反预乘去底色 + 距离场溢色替换

apps/web/src/lib/id-photo-local/
  model-registry.ts                改：模型 id 与档位（RMBG → modnet photographic）
  segmentation.ts                  改：推理尺寸 512、保长宽比
  face-detection.ts                新增：YuNet 推理 + 关键点
  composite.ts                     改：接入去污染、q95、4:4:4
  dpi-metadata.ts                  新增：JPEG APP0 / PNG pHYg 注入
  use-local-id-photo.ts            改：编排人脸→构图→合成→质量，userOverride

apps/api/src/modules/tasks/services/
  portrait-segmentation.service.ts 改：photographic 512 保长宽比 + 回落
  face-detection.service.ts        新增：YuNet 推理
  id-photo.service.ts              改：背景估计、去污染、自动构图、质量、DPI
```

### 共享原则

几何与判定逻辑一律放 `packages/validators`（纯函数、可单测、两端 `import` 同一个），像素级搬运算法放 `packages/utils`。两端只保留「模型加载 + 数据搬运」，不保留任何算法副本。

## 数据流

### 本地路

```
File
 → segmentToCutout(file)                  MODNet photographic 512 保长宽比 → ImageBitmap（带 alpha，与原图同尺寸）
 → detectIdPhotoFace(file)                YuNet → { box, landmarks, score } | null
 → suggestIdPhotoLayout(face, size, aspect, matte)
                                          → { zoom, offsetX, offsetY, rotation, faceRatio, headroom } | null
 → [userOverride ? 用 UI 的 crop : 回填自动构图到 UI]
 → compositeIdPhoto(cutout, bg, w, h, type, crop)
      ├─ resolveIdPhotoCropBox            共享几何
      ├─ decontaminateIdPhotoForeground   反预乘 + 溢色替换
      ├─ drawImage 到纯色底
      ├─ 应用 rotation
      └─ convertToBlob(q95)
 → writeDpi(blob, 300)                    注入 DPI 元数据
 → inspectIdPhoto(source, matte, face)    8 项质量报告 → 面板
```

### 服务端路

```
任务 inputConfig（preset / bg / outputType / crop?）
 → IdPhotoService.render
      ├─ segmentation.segment(input)      MODNet photographic 512 保长宽比（失败回落通用 modnet）
      ├─ faceDetection.detect(oriented)   YuNet
      ├─ crop = config.crop ?? suggestIdPhotoLayout(...) ?? DEFAULT_ID_PHOTO_CROP
      ├─ resolveIdPhotoCropBox            共享几何（base 与 mask 必须同一框）
      ├─ refinePortraitAlphaBytes         alpha 黑白点收敛（已有）
      ├─ estimateSourceBackgroundColors   上边 28% 采样 + 量化聚类（替换四角均值）
      ├─ decontaminateIdPhotoForeground   反预乘 + 溢色替换（共享）
      ├─ sharp composite over 纯色底
      └─ jpeg({quality:95, chromaSubsampling:'4:4:4'}).withMetadata({density:300})
        | png().withMetadata({density:300})
 → inspectIdPhoto(...)                    质量报告写入任务结果 metadata
```

## 组件设计

### 1. `suggestIdPhotoLayout`（`packages/validators/src/id-photo-layout.ts`）

照搬参考实现 `face.py:suggest_layout` 的算法：

```ts
export interface FaceDetection {
  box: { x: number; y: number; width: number; height: number };
  landmarks: [number, number][]; // 5 点：左眼、右眼、鼻尖、左嘴角、右嘴角
  score: number;
}

export function suggestIdPhotoLayout(
  face: FaceDetection | null,
  source: { width: number; height: number },
  targetAspect: number,
  /** alpha 蒙版中前景最高行（像素 y），用于真实头顶位置。可选。 */
  crownY?: number
): IdPhotoLayout | null
```

算法要点（与参考实现一致）：

- `desiredFaceRatio = 0.35`，`zoom = round(0.35 * baseCropWidth / faceWidth * 100)`，夹到 `[90, 145]`
- 基准框按目标宽高比在源图内取最大
- 头顶位置：优先用 `crownY`（分割蒙版前景最高行），合理性校验 `crownY <= faceTop + faceHeight * 0.12`；否则估算 `faceTop - faceHeight * 0.28`
- `desiredTop = crownY - cropHeight * 0.08`（8% 头顶留白）
- 眼线倾斜 `> 3°` 时旋转 `clip(tilt * 1.4, -5, 5)`
- 输出 `offsetX/offsetY` 归一化到 `[-20, 20]`，与现有 `IdPhotoCrop` 语义对齐

**与现有 `IdPhotoCrop` 的关系**：`suggestIdPhotoLayout` 的输出需转换为 `IdPhotoCrop { x, y, scale }`。转换函数 `idPhotoCropFromLayout(layout, source, target)` 一并放在本文件，`scale = baseCropWidth / cropWidth`。

### 2. `inspectIdPhoto`（`packages/validators/src/id-photo-quality.ts`）

照搬 `quality.py:inspect_photo` 的 8 项：

| 项 | 计算 | 通过条件 |
| --- | --- | --- |
| 人脸数量 | 检测到的人脸数 | `=== 1` |
| 人脸位置 | 人脸中心偏离图像中心比例 | `< 0.12` |
| 人脸比例 | `faceWidth / imageWidth` | `[0.26, 0.42]` |
| 眼线水平 | 两眼连线夹角 | `<= 5°` |
| 头顶留白 | `faceTop / imageHeight` | `>= 0.03` |
| 清晰度 | Laplacian 方差（纯 JS 实现 3×3 卷积） | `>= 30` |
| 曝光 | RGB 均值 | `[35, 225]` |
| 抠图边缘 | 半透明像素占比 | `< 0.75` |

输出 `{ items: QualityItem[], score: number, passed: boolean }`，`score = round(100 * passedCount / total)`。纯函数，输入为 `{ width, height, rgb: Uint8ClampedArray | Buffer }`，两端适配各自的 buffer 类型。

### 3. `estimateSourceBackgroundColors`（`packages/validators/src/id-photo-background.ts`）

替换服务端只取四角的 `estimateSourceBackgroundRgb`：

1. 采样上边全宽 + 上 28% 的左右边（`step = max(1, min(w,h) / 80)`）
2. 锚点 = 左上 / 右上角 `patch = min(w,h)/30` 的中位数
3. 保留与锚点距离 `<= 80` 的采样
4. 量化到 16 步，`unique` + `count` 排序
5. 与锚点距离 `<= 80`、彼此距离 `>= 24` 的去重，最多取 4 个
6. 全落空时返回采样均值

返回 `RgbFloat[]`，供去污染用。

### 4. `decontaminateIdPhotoForeground`（`packages/utils/src/id-photo-decontaminate.ts`）

两端共用的像素级算法，输入 `rgba` + 背景色，原地或返回新数组：

```ts
export function decontaminateIdPhotoForeground(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  background: Rgb,
  options?: { alphaFloor?: number; spillStrength?: number }
): Uint8ClampedArray
```

三个步骤（对应参考实现 `engine.py:317-353`）：

1. **反预乘去底色**：对 `0.02 < alpha < 0.98` 的边缘像素，`c' = clamp((c - bg * (1 - alpha)) / alpha, 0, 255)`。`alpha` 下限取 0.15 避免除零放大噪声。
2. **内边缘 alpha 压制**：用距离变换得到「距最近不透明像素的距离」，`<= 3.5px` 的内边缘按颜色与底色的距离压暗 alpha，抑制原底色残留光晕。
3. **溢色替换**：用距离变换的标签（最近不透明前景像素）做源色，按 `spill = (1-alpha)*0.7 + (1-colorConfidence)*0.3` 混合替换边缘 RGB，`spill` 上限 0.85。

距离变换用**两遍扫描的近似欧氏距离变换**（Felzenszwalb 简化版，纯 JS，`O(n)`），同时记录最近前景标签。不做 GrabCut。

### 5. `writeDpi`（`apps/web/src/lib/id-photo-local/dpi-metadata.ts`）

canvas `convertToBlob` 不写 DPI，需要二进制注入：

- **JPEG**：在 SOI（`FFD8`）之后插入 APP0 JFIF 段，含 `X/Y density` = 300 与 `density unit` = 1（dpi）。若已存在 APP0 则替换。
- **PNG**：在 IHDR 之后插入 `pHYs` chunk，`pixels per unit X/Y` = `round(300 / 0.0254)` ≈ 11811，`unit` = 1（meter）。需重算 chunk CRC32（纯 JS CRC 表，~20 行）。

### 6. `detectIdPhotoFace` / `FaceDetectionService`

**本地路**（`apps/web/src/lib/id-photo-local/face-detection.ts`）：
- 从 MinIO `models/face/yunet/face_detection_yunet_2023mar.onnx` 取模型
- 复用 `segmentation.ts` 里 `tf.env.backends.onnx.wasm.wasmPaths` 已设好的 ort 运行时
- 但 YuNet 不是 transformers.js pipeline，需要用 `onnxruntime-web` 直接建 session：`@huggingface/transformers` 内部已带 ort，通过 `tf.env.backends.onnx` 拿不到裸 session —— 改为**直接把 `onnxruntime-web` 作为显式依赖引入**，与 transformers 共用同一份 wasm 路径
- 输入：`sharp` 不可用于浏览器，用 canvas 缩放 + 归一化，CHW float32
- 输出解析：`(batch, 15)` → `[x, y, w, h, 5×(lmx,lmy), score]`
- 模型缓存：模块作用域单例，与分割 session 分开

**服务端**（`apps/api/src/modules/tasks/services/face-detection.service.ts`）：
- `ort.InferenceSession.create(modelPath)`，模型路径解析同 `resolvePortraitSegmentationModelPath` 模式
- 用 `sharp` 缩放 + `raw()` 取 RGB
- 解析逻辑与本地路共享：把「`(batch,15)` 张量 → `FaceDetection[]`」抽到 `packages/utils`，两端只负责取像素

### 7. 本地路合成增强（`composite.ts`）

```ts
export async function compositeIdPhoto(
  cutout: ImageBitmap,
  backgroundColor: string,
  presetW: number,
  presetH: number,
  outputType: 'image/jpeg' | 'image/png',
  crop?: IdPhotoCrop,
  rotation?: number       // 新增：自动构图算出的旋转角
): Promise<Blob>
```

流程变化：
1. 先把 `cutout` 画到离屏 canvas，取出 `ImageData`
2. 调 `decontaminateIdPhotoForeground`（纯函数，需要原背景色 —— 从 `cutout` 的透明区采样中位数）
3. `putImageData` 回去
4. 在目标 canvas 上：先填纯色底，再按 crop 框 `drawImage`
5. 有 `rotation` 时用 `ctx.rotate` 绕中心旋转（预留边距，避免裁掉发角）
6. `convertToBlob({ quality: 0.95 })`
7. `writeDpi(blob, 300)`

### 8. 本地路状态机与 `userOverride`

沿用现有 `LocalStage`（不新增 `auto-layout` 独立状态）。`useLocalIdPhoto` 新增：

```ts
export interface UseLocalIdPhoto {
  // ...现有字段
  /** 自动构图结果，首次处理时回填给页面以更新裁剪框。 */
  autoLayout: IdPhotoLayout | null;
  /** 用户是否手动改过裁剪框；true 时后续 process 不再自动构图。 */
  userOverride: boolean;
  markUserOverride: () => void;
}
```

- `process` 内：`userOverride ? 用传入 crop : 先算 autoLayout 再转 crop`
- 页面监听 `autoLayout` 变化，调用 `setOptions({ ...crop })` 回填
- `ImageCropField.onChange` 触发时调 `markUserOverride()`
- `reset()` 时 `userOverride = false`

### 9. 质量面板 UI（`apps/web/src/components/tools/id-photo-quality-panel.tsx`）

- 结果区下方 `<details>` 折叠面板，默认 `open`
- 头部：总分 + `检查通过` / `需注意：人脸比例、抠图边缘`
- 主体：8 项每行「名称 / 实测值 / 是否通过 / 建议文案」
- 未通过项标红，通过项标灰
- 本地路与服务端路各渲染一次（服务端路质量报告从任务结果 metadata 取）

### 10. 构图辅助线（`ImageCropField` 增强）

新增 props：

```ts
guides?: boolean;      // 是否显示辅助线，默认 false
faceRatio?: number;    // 当前人脸占裁剪框宽度比例，用于显示是否达标
```

绘制（相对裁剪框，`pointer-events-none`）：
- **中心竖线**：`left-1/2`
- **头顶安全区**：裁剪框顶部往下 8% 一条横线 + 顶部区域淡色填充
- **眼部参考区**：从顶部往下 `40%~50%` 两条横线
- **肩线参考**：从顶部往下 `75%` 一条横线

开关放在 `IdPhotoOptions` 里（`guides` 布尔），文案 `辅助线`。

### 11. 输出质量与 DPI（服务端）

`id-photo.service.ts` 编码段改为：

```ts
if (config.outputType === 'image/png') {
  return {
    buffer: await background.png({ compressionLevel: 9 }).withMetadata({ density: 300 }).toBuffer(),
    mimeType: 'image/png',
    extension: 'png',
  };
}
return {
  buffer: await background
    .jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .withMetadata({ density: 300 })
    .toBuffer(),
  mimeType: 'image/jpeg',
  extension: 'jpg',
};
```

`encodeFinalResult`（AI 直出分支）同步。

## 模型资产

| 模型 | 文件 | 体积 | 许可 | 用途 |
| --- | --- | --- | --- | --- |
| MODNet photographic | `models/modnet/modnet_photographic.onnx` | ~25MB | Apache-2.0 | 两端主分割 |
| MODNet 通用（回落） | `models/modnet/modnet.onnx` | ~25MB | Apache-2.0 | 服务端回落 + 本地路 photographic 破洞时回落 |
| YuNet 人脸 | `models/face/yunet/face_detection_yunet_2023mar.onnx` | ~340KB | MIT | 两端人脸检测 |
| RMBG-1.4（保留） | `models/rmbg/1.4/…` | 84MB / 176MB | BRIA 专有 | 本地路回落（仅破洞复现时保留） |

分发沿用 `models` 只读桶 + `sync-id-photo-models` 脚本；新增目录前缀 `modnet/`、`face/`。

**前置验证（实施第一步）**：用项目样张（黑帽子 + 暗背景）实测 `modnet_photographic` 是否有「衣服破洞」。若复现，本地路保留 RMBG-1.4 作为高精度档，photographic 作为均衡档。

## 错误处理

| 场景 | 行为 |
| --- | --- |
| photographic 加载失败 | 服务端回落通用 `modnet.onnx`；本地路回落 RMBG-1.4 |
| YuNet 加载失败 / 无人脸 | `suggestIdPhotoLayout` 返回 `null`，使用默认居中 crop（不抛错） |
| 多人脸 | 取 score 最高的人脸构图；质量面板标红「人脸数量 2」 |
| 去污染异常 | try/catch 后原样合成，不阻断出图 |
| DPI 注入失败 | 返回原 blob，不阻断下载 |
| 质量检查异常 | 面板显示「检查不可用」，不阻断 |

不新增错误码；`FACE_TOO_SMALL` 仍不使用（复用质量面板的人脸比例项）。

## 测试计划

### 纯函数单测（`packages/validators`、`packages/utils`）

- `suggestIdPhotoLayout`：人脸偏左/偏右/偏小/偏大、无脸、crownY 与实际冲突、眼线倾斜 ±10° → 输出在合法区间
- `idPhotoCropFromLayout`：与 `resolveIdPhotoCropBox` 往返一致
- `inspectIdPhoto`：8 项各自边界值（人脸比例 0.25/0.26/0.42/0.43 等）
- `estimateSourceBackgroundColors`：纯色底、渐变底、多色底各自返回合理候选
- `decontaminateIdPhotoForeground`：构造边缘像素，断言蓝底 50% alpha 的反预乘结果接近真实前景色
- 距离变换：与暴力最近邻结果逐像素一致（小尺寸图）

### 前端测试（`apps/web/test`）

- `face-detection`：mock ort session，验证输入张量形状与输出解析
- `composite`：mock canvas，验证 `decontaminate` 被调用、q95 传出、rotation 生效
- `dpi-metadata`：构造最小 JPEG/PNG blob，断言注入后能解析出 300dpi
- `use-local-id-photo`：首次 process 回填 autoLayout；`markUserOverride` 后不再覆盖；reset 清除
- `IdPhotoQualityPanel`：全通过 / 部分失败 / 检查不可用三种渲染
- `ImageCropField`：`guides` 开时渲染 4 类辅助线，关时不渲染

### API 测试（`apps/api/test`）

- `portrait-segmentation.service`：512 保长宽比预处理；photographic 失败回落 modnet
- `face-detection.service`：解析 `(batch,15)` 张量
- `id-photo.service`：输出带 DPI metadata（`sharp(buf).metadata().density === 300`）；JPEG chroma 4:4:4；自动构图优先级（config.crop > autoLayout > 默认）
- 质量报告写入任务结果 metadata

### 手动核对

- 项目样张集（黑帽子暗背景 / 白底证件照 / 户外复杂背景）两端各跑一遍，与参考实现输出并排对比
- 打印拼版：6 寸相纸 + 一寸照，物理尺寸量测

## 影响范围

**新增**：

- `packages/validators/src/id-photo-layout.ts`
- `packages/validators/src/id-photo-quality.ts`
- `packages/validators/src/id-photo-background.ts`
- `packages/utils/src/id-photo-decontaminate.ts`
- `packages/utils/src/id-photo-face-tensor.ts`（两端共享的「15 列张量 → FaceDetection」解析）
- `apps/web/src/lib/id-photo-local/face-detection.ts`
- `apps/web/src/lib/id-photo-local/dpi-metadata.ts`
- `apps/web/src/components/tools/id-photo-quality-panel.tsx`
- `apps/api/src/modules/tasks/services/face-detection.service.ts`
- 模型资产：`modnet_photographic.onnx`、`face_detection_yunet_2023mar.onnx`

**修改**：

- `packages/validators/src/id-photo.ts`（导出 layout 类型）
- `apps/web/src/lib/id-photo-local/{model-registry,segmentation,composite,use-local-id-photo}.ts`
- `apps/web/src/components/tools/{id-photo-options,image-crop-field}.tsx`
- `apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`
- `apps/web/messages/{zh,en}.json`（质量面板、辅助线、新错误恢复文案）
- `apps/api/src/modules/tasks/services/{portrait-segmentation,id-photo}.service.ts`
- `apps/api/src/modules/tasks/tasks.module.ts`（注册 FaceDetectionService）
- `apps/web/package.json`（显式 `onnxruntime-web`）
- `scripts/download-rmbg-assets.cjs` / `scripts/prepare-id-photo-models.sh`（新增两个模型）
- `docker/start-all.sh` + `sync-id-photo-models.ts`（同步 `modnet/`、`face/` 前缀）
- `docs/id-photo-models.md`

## 实施顺序

1. **前置验证**：实测 `modnet_photographic` 破洞情况，确定本地路段位策略
2. **共享纯函数**：`suggestIdPhotoLayout`、`inspectIdPhoto`、`estimateSourceBackgroundColors`、`decontaminateIdPhotoForeground` + 单测
3. **模型资产**：下载、转格式（如需）、上传 MinIO、同步脚本与离线镜像
4. **服务端**：FaceDetectionService + 分割升级 + 渲染增强 + 测试
5. **本地路**：face-detection + segmentation 升级 + composite 增强 + dpi-metadata + 测试
6. **UI**：质量面板 + 辅助线 + 自动构图回填 + i18n
7. **手动核对**：样张对比 + 拼版量测

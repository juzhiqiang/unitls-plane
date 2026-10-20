# 证件照本地抠图模型预置:MODNet photographic(证件照专用,Apache-2.0)

证件照本地处理使用 **MODNet photographic(证件照专用,Apache-2.0)**,通过 `onnxruntime-web` 直接创建
`InferenceSession` 在浏览器内完成人像分割,产出透明 cutout 后再合成证件照底色; 人脸检测使用 OpenCV
Zoo 的 **YuNet 2023mar**(MIT)。两者都不再经过 `@huggingface/transformers` 的 `background-removal`
pipeline。模型资产自托管在 MinIO/S3, 离线镜像内置、启动时同步到本地 MinIO。

模型选型、alpha 指标与破洞分析以 [id-photo-model-comparison.md](./id-photo-model-comparison.md)
为**权威数据源**;本文只保留结论摘要与部署/资产说明。

## ⚠️ 许可

- **MODNet photographic**:Apache-2.0。
- **YuNet 2023mar**:MIT。
- **BRIA RMBG-1.4**:BRIA 自有许可(HF model card 标注
  `license: other`),**商用需向 BRIA 申请授权**。它现在**不再是默认模型**,仅作为历史资产保留（见下文「为什么不是 ISNet
  / BiRefNet / MODNet」）。升级或替换模型前请复核 <https://huggingface.co/briaai/RMBG-1.4>
  的许可条款。

## 为什么不是 ISNet / BiRefNet / MODNet

以下是历史选型结论与 Task 1 实测修正。完整数据、样张与复现命令见
[id-photo-model-comparison.md](./id-photo-model-comparison.md)。

- **ISNet**(上一版
  `@imgly/background-removal`):在「黑帽子 + 暗背景」低对比样张上会把整顶帽子判成背景, 换底色后帽子染色甚至消失,因此淘汰。
- **BiRefNet_lite / BiRefNet-portrait**:浏览器端内存不足(OOM,portrait 需一次分配约 490MB),无法落地。
- **RMBG-1.4**:质量可用,但权重约 84MB(fp16)/168MB(fp32)、BRIA 专有许可,且与 photographic在洞检测上没有质量优势,因此不再是默认模型。
- **MODNet 的历史结论已被 Task 1 修正**:旧结论「通用 MODNet 会让衣服破洞」来自 **通用 modnet 256×256
  fill(拉伸)+ 旧后处理管线**;Task 1 用同一批权重实测后发现:
  - 破洞的真正触发因素是**补边预处理**。photographic 按
    `512 contain`(等比缩放 + 黑边补成正方形) 会在衣服与人脸/眼睛处稳定破洞;
  - 改成参考实现口径(`refpipe`:长边 512、保持长宽比、宽高向下取 32 的倍数、**不补边**)后, 同一张样张**洞像素为 0**;
  - `apps/api/models/modnet.onnx` 与 `modnet_photographic.onnx` 在同一输入下逐像素输出完全相同 (max
    abs diff = 0),破洞不能归因于模型权重差异。

Task 1 主表摘要(样张 A:黑帽子 + 暗背景;数值来自权威数据源):

| 指标                          | photographic refpipe(当前) | RMBG-1.4 fp16        | 通用 MODNet 256 fill |
| ----------------------------- | -------------------------- | -------------------- | -------------------- |
| 半透明像素占比(0.02–0.98)     | 3.68%                      | 1.97%                | 2.42%                |
| 前景占比(alpha>0.5)           | 58.80%                     | 58.39%               | 59.60%               |
| 洞像素总数                    | **0**                      | 0                    | 7                    |
| 衣服区 alpha p05              | 0.969                      | 1.000                | 1.000                |
| 推理耗时(CPU,含加载,量级参考) | 192 ms                     | 1100 ms(fp32 808 ms) | 129 ms               |

对照的 `photographic 512 contain`
在同一张图上洞像素为 1524(衣服 347 + 人脸/眼睛 1176), 这正是当前实现**禁止 letterbox 补边**的原因。RMBG-2.0(BiRefNet 架构)在 HF 上是 gated 仓库, 未登录无法下载,故未采用。

## 档位与模型

photographic 是**单档**模型:只有一个 fp32 权重,`balanced` 与 `high`
指向同一 URL、复用同一个 session。保留 `ModelTier` 与 `high`
条目仅为了兼容既有的高精度开关调用方,不存在「high → RMBG-1.4 fp32」的代码路径。

| 档位          | dtype  | 文件                              | 大小                      | 设备         | 说明                     |
| ------------- | ------ | --------------------------------- | ------------------------- | ------------ | ------------------------ |
| 均衡 / 高精度 | `fp32` | `modnet/modnet_photographic.onnx` | 25,969,398 B(约 24.8 MiB) | CPU / WebGPU | 单档;无 WebGPU 时走 wasm |

> 档位映射与资产 URL 在 `apps/web/src/lib/id-photo-local/model-registry.ts`;`tierFor()` 恒定返回
> `balanced`,改档位/资产需同步此文件、下载脚本与本文档。

## 资产清单

| 资产                | MinIO key                                             | 体积                     | 许可       | 用途                                     |
| ------------------- | ----------------------------------------------------- | ------------------------ | ---------- | ---------------------------------------- |
| MODNet photographic | `models/modnet/modnet_photographic.onnx`              | 25,969,398 B             | Apache-2.0 | 两端主分割(长边 512、保持长宽比、不补边) |
| YuNet 人脸检测      | `models/face/yunet/face_detection_yunet_2023mar.onnx` | 232,589 B                | MIT        | 两端人脸检测与自动构图                   |
| BRIA RMBG-1.4(历史) | `models/rmbg/1.4/...`                                 | ~84MB fp16 / ~168MB fp32 | BRIA 专有  | 当前运行时**不再加载**,仅为历史资产保留  |

`prepare-id-photo-models.sh` 会一并准备；`sync-id-photo-models.ts` 的 `ASSET_PREFIXES` 已包含
`rmbg/`、`ort/`、`modnet/` 与
`face/`，离线镜像启动时自动同步。下载脚本优先从本地候选复制权重（`vendor/`、项目内相对路径，或显式设置
`ID_PHOTO_REF_ROOT` / `MODNET_LOCAL_PATH` / `YUNET_LOCAL_PATH`），本地缺失时 YuNet 回落到 OpenCV
Zoo 下载并校验 sha256。`vendor/` 已被 `.gitignore` 忽略，模型权重不进 Git。

## 资产结构

`onnxruntime-web` 直接按 URL 取文件，MinIO 上保持以下目录结构：

```text
models/rmbg/1.4/config.json
models/rmbg/1.4/preprocessor_config.json
models/rmbg/1.4/onnx/model_fp16.onnx
models/rmbg/1.4/onnx/model.onnx
models/ort/<ORT_VERSION>/ort-wasm-simd-threaded.wasm
models/ort/<ORT_VERSION>/ort-wasm-simd-threaded.mjs
models/ort/<ORT_VERSION>/ort-wasm-simd-threaded.jsep.wasm     # WebGPU 用
models/ort/<ORT_VERSION>/ort-wasm-simd-threaded.jsep.mjs
models/modnet/modnet_photographic.onnx
models/face/yunet/face_detection_yunet_2023mar.onnx
```

共 10 个文件（约 308 MiB）。RMBG 的四项是历史资产，当前代码不再加载；真正参与运行时下载的是
`modnet/`、`face/` 与 `ort/`。

**ort wasm 必须自托管**：默认从 jsDelivr 取 ort 运行时的做法在离线镜像内没有公网，会直接失败。

### ort 路径为什么带版本

ort 的 JS glue 与 `.wasm` 是**配对**的，版本错配会让 wasm 缺少 JS 期望的导出。这个坑已经踩过两次：

- `webgpuInit is not a function`（ISNet 时期，ort 1.21 与 1.27 之争）
- `_OrtGetInputOutputMetadata is not a function`（误从仓库根解析到残留的 1.21.0）

而资产按 `immutable` 长缓存发布，**路径不带版本的话，升级后浏览器会继续命中旧 wasm**。所以
`ortWasmPath()` 拼上了 `ORT_VERSION`，靠路径变化破缓存。

`scripts/download-rmbg-assets.cjs` 会校验 `model-registry.ts` 的 `ORT_VERSION`
与实际解析到的 ort 包版本是否一致，不一致直接失败并提示改哪里 ——宁可构建期炸，也不要运行期错配。

## 路径映射

前端 `model-registry.ts`：

```ts
// 主分割
`${NEXT_PUBLIC_S3_PUBLIC_URL}/models/modnet/modnet_photographic.onnx`; // modnetModelUrl()
// 人脸检测
`${NEXT_PUBLIC_S3_PUBLIC_URL}/models/face/yunet/face_detection_yunet_2023mar.onnx`; // yunetModelUrl()
// ort 运行时
`${NEXT_PUBLIC_S3_PUBLIC_URL}/models/ort/${ORT_VERSION}/`; // ortWasmPath()
```

## 预置步骤（本地开发）

1. 启动本地 MinIO：`bun run services:up`。
2. 配置访问：
   ```bash
   export S3_ENDPOINT=http://localhost:9000
   export S3_ACCESS_KEY=minioadmin
   export S3_SECRET_KEY=minioadmin
   ```
3. 执行：`./scripts/prepare-id-photo-models.sh`。
4. 脚本会：
   - `node scripts/download-rmbg-assets.cjs all` 依次准备四个目标：
     - `model`：RMBG-1.4 从 HF 下载到 `docker/models/rmbg/1.4/`（历史资产）；
     - `runtime`：ort wasm 从 `node_modules` **复制**到
       `docker/models/ort/<ORT_VERSION>/`（复制而非下载，保证与实际依赖的 ort 版本严格一致）；
     - `modnet`：`modnet_photographic.onnx` 优先从本地候选复制到
       `docker/models/modnet/`，缺失时明确报错；
     - `yunet`：`face_detection_yunet_2023mar.onnx` 优先本地复制，缺失时从 OpenCV
       Zoo 下载并校验 sha256 到 `docker/models/face/yunet/`。
   - `aws s3 sync` 把 `rmbg/`、`ort/`、`modnet/`、`face/` 四个前缀分别同步到
     `s3://models/`，设匿名只读策略与不可变缓存。

## 前端如何使用

`apps/web/src/lib/id-photo-local/segmentation.ts`：

- 挂载时探测 WebGPU（`navigator.gpu.requestAdapter()`）→ `ep: 'webgpu' | 'wasm'`。
- `tierFor(...)`：photographic 单档，恒定返回 `balanced`；session 按 `ep` 缓存。
- `segmentToCutout(file, tier, ep)`：动态尺寸走 `modnetInputSize`（长边 512、保持长宽比、32 对齐、
  **不补边**）→ 裸 `onnxruntime-web` session 推理 → matte 转 0..255 → **共享的
  `refinePortraitAlphaBytes`**（黑点 72 / 白点 144 / gamma 0.55）→ 与原图合成。
- alpha 收敛函数位于
  `packages/utils/src/id-photo-alpha.ts`，服务端 sharp 路径与浏览器本地路共用同一份实现，避免同一张图在两端出现不同的边缘。

`apps/web/src/lib/id-photo-local/face-detection.ts`：

- `detectFaces(file)` 以 640×640、0..255 BGR 输入运行 YuNet 2023mar；
- 解码、NMS、坐标映射复用 `packages/utils/src/id-photo-yunet.ts`，与服务端得出相同人脸框；
- 检测失败一律返回空数组，自动构图退回居中裁剪。

## 对象存储

- 桶：`models`（只读匿名下载，`put-bucket-policy` 允许 `s3:GetObject`）。
- 公网 URL：`${NEXT_PUBLIC_S3_PUBLIC_URL}/models/...`。
- 跨域：同步脚本会通过 `PutBucketCorsCommand` 给 `models`
  桶设置 CORS 规则（`AllowedOrigins: ['*']`、`GET/HEAD`），确保浏览器跨域拉取模型资产时收到
  `Access-Control-Allow-Origin`。
- 缓存：上传时设 `Cache-Control: public, max-age=31536000, immutable`（资产按版本不可变）。

## 离线镜像

- 组合镜像构建时把 `docker/models/` 树 `COPY` 进 `/app/models/id-photo/`
  （Dockerfile，`docker/models/` 已 gitignore，仅保留 `.gitkeep`）。
- `docker/start-all.sh` 在 migrate 之后、API 启动前调用
  `node apps/api/dist/scripts/sync-id-photo-models.js`，用 `@aws-sdk/client-s3` 递归上传
  `rmbg/`、`ort/`、`modnet/`、`face/` 前缀下的资产到本地 MinIO `models` 桶并设匿名只读策略。
- 同步脚本失败不阻塞启动（返回 0，打印 skip 日志），便于 MinIO 未就绪时下次重启重试。
- 资产不进 Git（大），构建前先跑 `scripts/prepare-id-photo-models.sh` 或
  `node scripts/download-rmbg-assets.cjs all`。

## 参考对齐核对记录（2026-10-20 自动化核验）

> 由 Task 17 自动化核验生成。样张人工视觉确认与物理打印尺量为手工环节，已单独标注待办。

### 全仓回归

| 套件                  | 结果                                | 说明                                                                                                                                                                                                                                  |
| --------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/utils`      | ✅ 88 pass / 0 fail                 | 含去污染距离场、底色聚类、MODNet 动态尺寸/JPEG 4:4:4、YuNet 解码与 DPI 等                                                                                                                                                             |
| `packages/validators` | ✅ 117 pass / 0 fail                | 含自动构图(35%脸宽+8%头顶留白+眼线旋转)、质量 8 项、亮度校正、crop 几何等                                                                                                                                                             |
| `apps/api`            | ✅ 716 pass / 1 fail(已知) / 2 skip | 证件照子集(`id-photo.service`/`portrait-segmentation`/`face-detection`) 0 fail，唯一失败为 `Tesseract integration > recognizes Latin and Chinese text from MuPDF-rendered pages`（mupdf Buffer detached，边缘集成用例，与证件照无关） |
| `apps/web`            | ✅ 713 pass / 0 fail (102 files)    | 含 $lib/id-photo-local 14 文件、质量面板、裁剪辅助线与 DPI                                                                                                                                                                            |

> 全量 `bun test` 中仅 1 个与证件照无关的预存失败，其余用例全部通过。

### 参考对齐 7 缺口闭合检查

| 缺口                                                      | 结论 | 自动化证据                                                                                                                                                                                                                                                                                       | 人工待办                                                                                             |
| --------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 1. 分割模型(两端换 photographic,长边 512 保长宽比,不补边) | ✅   | `packages/utils/test/id-photo-modnet-size.test.ts` 13 项；`packages/utils/src/id-photo-modnet-size.ts` + `portrait-segmentation.service.ts` 已改长边 512 动态尺寸；letterbox(512×512 补边)已被文档标注为唯一复现破洞的路径                                                                       | 抽一张黑帽/暗背景样张目视衣服/帽子无破洞                                                             |
| 2. 人脸检测+自动构图                                      | ✅   | 共享解码 `packages/utils/src/id-photo-yunet.ts`(640×640, 0..255 BGR, 12 输出)；两端人脸服务与 `face-detection.ts` 共用解码；`packages/validators/src/id-photo-layout.ts` + `packages/validators/test/id-photo-layout.test.ts` 覆盖 35% 脸宽、8%留白、过小/过大、不合理 crown、±3°阈值与 ±5° 限幅 | 用真人样张确认首次处理后人脸自动回填到标准位，拖框后不被覆盖                                         |
| 3. 边缘去污染(反预乘+距离场+溢色替换)                     | ✅   | `packages/utils/src/id-photo-decontaminate.ts` 与测试；`packages/utils/test/id-photo-decontaminate.test.ts` 9 项；服务端/本地路均已调用共享 `decontaminateIdPhotoForeground`                                                                                                                     | 目视发丝/耳廓/肩线无原底色光晕                                                                       |
| 4. 亮度/旋转校正                                          | ✅   | `packages/validators/test/id-photo-layout.test.ts` 中亮度阈值与限幅(`suggestBrightnessAdjustment`)；服务端 `id-photo.service.ts` 与本地 `composite.ts` 已接入；旋转由 `eyeTiltDegrees` + layout 的 rotation(3°阈值, 增益 1.4, ±5°封顶)驱动                                                       | 暗片/过曝光样张各一张确认不过度提亮/压暗                                                             |
| 5. 质量检查 8 项                                          | ✅   | `packages/validators/src/id-photo-quality.ts` + `packages/validators/test/id-photo-quality.test.ts` 覆盖 faceCount/faceCentered/faceRatio/eyeTilt/headroom/sharpness/exposure/matteEdge；`id-photo-quality-panel.tsx` 与页面已接入                                                               | 确认面板随 8 项实测值与 hint 正常展示                                                                |
| 6. 构图辅助线                                             | ✅   | `apps/web/test/components/tools/image-crop-field-guides.test.tsx` 3 项；`image-crop-field.tsx` 中 4 条线(中心/头顶 8%/眼部 40-50%/肩线 75%)，开关存于 `id-photo-options.tsx` 的 `guides`                                                                                                         | 开关辅助线拖拽不受遮挡                                                                               |
| 7. 输出质量与 DPI 300                                     | ✅   | 服务端 `id-photo.service.ts` 设 density 300 且测试断言 `metadata.density`；本地 `dpi-metadata.ts` + `dpi-metadata.test.ts` 15 项 (JPEG Exif 300 / PNG pHYs 11811 ppm, 幂等)；本地合成经 `jpeg-js` 4:4:4 编码后走 `writeDpi`                                                                      | 下载 JPEG/PNG 后用 `exiftool` / `sharp metadata` 确认 density 300，6 寸拼版打印后尺量 25×35mm ±0.5mm |

### 关键实现口径

- 分割输入：`modnetInputSize({w,h}, 512)` 长边 512、保持长宽比、32 对齐、**不补边**，两端共用
  `packages/utils/src/id-photo-modnet-size.ts`。
- 资产：photographic 单档(fp32, `modnet/modnet_photographic.onnx`)，`balanced`/`high`
  同权重；YuNet 为 `face_detection_yunet_2023mar.onnx` 640×640。
- 去污染顺序：`estimateSourceBackgroundColors` (原图上边缘采样) →
  `decontaminateIdPhotoForeground`(反预乘+溢色) → 再调亮度；服务端与本地一致。
- 成片几何：`resolveIdPhotoCropBox`/`idPhotoCropFromBox`/`idPhotoCropFromLayout`
  三者同源，container 与 extract 用同一函数解算。
- 纠错记录：已知限制与实测修订已回填 `docs/id-photo-model-comparison.md` 与本文件正文。

### 待人工确认事项

- [ ] 黑帽子+暗背景样张：帽子实心无染色、发丝无蓝边、脸部无红雾（本地与服务端各一次）。
- [ ] 标准白底照换蓝底后边缘无白边；户外复杂背景肩线干净无残留。
- [ ] 质量面板 8 项数值合理，hint 仅在失败项出现。
- [ ] 下载文件用 `sharp metadata` /`exiftool` 核验 `density: 300`。
- [ ] 一寸照 6 寸拼版按 300dpi 打印，尺量单张 25×35mm ±0.5mm（唯一无法自动化的物理量测）。

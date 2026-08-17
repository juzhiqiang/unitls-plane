# 证件照本地抠图设计

- 日期：2026-08-18
- 关联页面：`apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`
- 关联设计：[2026-07-07-id-photo-generator-design](./2026-07-07-id-photo-generator-design.md)

## 背景

证件照生成页（`/image/id-photo`）当前只在服务端完成抠图：后端 `PortraitSegmentationService` 以 `onnxruntime-node` 加载 `models/modnet.onnx`（256×256 输入，输出 alpha matte）做本地分割，或经 `ID_PHOTO_AI_SEGMENTATION_BASE_URL` 调用 OpenAI 兼容 API（`chat_mask` 返回 alpha mask，或 `image_result` 直接返回换底成片）。AI 未配置或失败时静默降级到本地 MODNet，任务总能产出。`IdPhotoService.render` 最终返回**已合成纯色背景的不透明成片**，透明前景只在管线内部临时存在，并附带一整套边缘去污染算法（`decontaminateForegroundRgb` 等）。

2026-07-07 设计文档第 34 行曾以「人像抠图质量和移动端性能不稳定」为由否定纯前端方案。本设计用 **RMBG 系列（BiRefNet 架构，质量公认优于 MODNet/ISNet）+ onnxruntime-web + WebGPU** 突破该假设，把抠图搬到浏览器本地完成，同时保留服务端链路作为备选。

后端现状关键事实：

- `apps/api` 用 `onnxruntime-node` 1.27；模型 `apps/api/models/{modnet.onnx, u2netp.onnx}` 已 gitignore。
- 任务链路：页面 → `tasks.controller` → `TasksService.create` → `image-queue` → `image.processor.handleIdPhoto` → `idPhotoService.render` → `FilesService.upload` → `markCompleted`。
- 前端：无 `onnxruntime-web`、无 WebGPU 使用先例；`apps/web/public` 无 models 目录；已实现 `useObjectUrl` hook 与 `ResultPanel` 的 `preview` 插槽可复用。

## 目标

- 新增证件照**本地处理路**：浏览器内完成人像分割 → 合成纯色背景 → 按 preset 裁剪 → 下载，端到端本地、不建任务、不要求登录，对齐项目现有本地优先工具（图片压缩等）。
- 保留现有**服务端处理路**（`image_id_photo` 任务，含 MODNet/AI 双通道与边缘去污染），不做任何破坏性改动。
- 页面提供「本地 / 服务端」模式切换，用户主动选路，本地为默认。
- 两档模型：均衡档 RMBG-1.4 fp16（84MB）默认可用，高精度档 RMBG-2.0 q4f16（234MB）由用户主动开启才下载。
- WebGPU 不可用时自动回落 wasm CPU 后端，并在 CPU 模式下锁定均衡档以保护体验。

## 非目标

- 不复刻后端的边缘去污染算法（`suppressSourceBackgroundFringe` / `decontaminateForegroundRgb` / `replaceBackgroundContaminatedEdgeRgb` 等）。依赖 RMBG 原始 mask 质量（公认优于 MODNet）；若边缘有瑕疵，留作后续增强。
- 不输出透明背景 PNG。本地路天然支持（mask 即 alpha），但沿用原设计「第一版只输出纯色背景」的约束，PNG 仅作无损格式选项。
- 不引入 crop 微调交互。原设计 `IdPhotoOptions.crop` 字段 UI 未暴露，本次维持。
- 不改动后端代码与服务端任务链路。
- 不做真实模型推理的自动化 e2e（模型大且慢），仅留手动核对。

## 约束

- **模型分发源**：用户最初提议「jsDelivr CDN 自托管分发」，但 jsDelivr 对单文件有 ~50MB 硬限制（GitHub 后端 50MB、npm tarball ~50MB），84MB/234MB 模型无法直接走 jsDelivr。改用**项目自有对象存储（MinIO/S3）**分发，前端经 `NEXT_PUBLIC_S3_PUBLIC_URL` 拉取。
- **模型获取**：HuggingFace 不可达，原始权重从 ModelScope 下载，再转为 onnx（fp16 / q4f16 量化）。
- **推理后端**：onnxruntime-web，优先 WebGPU（`navigator.gpu`），不可用回落 wasm CPU 后端。
- **线程模型**：推理放 Web Worker，避免阻塞主线程 UI；主线程负责 canvas 合成与裁剪。
- **复用**：规格、背景色、输出格式沿用现有 `IdPhotoOptions` 与 `IdPhotoPreset` 配置（`packages/validators/src/id-photo.ts`）；结果预览复用 `ResultPanel` 的 `preview` 插槽与已实现的 `useObjectUrl` hook。

## 方案

采用「本地端到端 + 服务端备选」双路并存：

- 本地路：浏览器内 RMBG 推理 → canvas 换底 → preset 裁剪 → 下载，本地优先、不建任务。
- 服务端路：`image_id_photo` 任务原样保留，需登录、进历史。
- 页面 segmented control 切换两路，本地默认。

代码组织为独立模块 + Web Worker 推理：

- 新增 `apps/web/src/lib/id-photo-local/`，内含引擎、模型注册表、合成裁剪工具与编排 hook。
- 推理隔离在 Worker，主线程做 canvas 合成裁剪与下载。

不选择主线程推理的原因是 RMBG 推理耗时百毫秒至秒级，会卡死 UI；onnxruntime-web 官方亦推荐 Worker。

## 设计

### 模块结构

| 文件 | 责任 |
| --- | --- |
| `apps/web/src/lib/id-photo-local/model-registry.ts` | 两档模型元数据：key、对象存储 path、size、quant、推荐 executionProvider |
| `apps/web/src/lib/id-photo-local/portrait-segmenter.worker.ts` | Worker：probe WebGPU、按档位 fetch 模型、创建 ORT session、预处理、推理、后处理、回传 alpha mask |
| `apps/web/src/lib/id-photo-local/composite.ts` | 主线程工具：原图 × mask 合成透明前景、叠纯色背景、按 preset 裁剪、输出 blob |
| `apps/web/src/lib/id-photo-local/use-local-id-photo.ts` | hook：编排 Worker 调用 + 合成 + 裁剪 + 输出 + 进度状态 + 错误处理 |
| `apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx` | 加「处理模式」切换，本地模式接入 hook，服务端模式不变 |
| 模型预置脚本 + 文档 | 从 ModelScope 下载权重 → 转 onnx → 上传 MinIO `models` 桶 |

### 模型分发

- 新增独立只读 public bucket `models`，与用户文件桶 `uploads` 隔离，仅放两 onnx 模型。
- 前端 URL：`${NEXT_PUBLIC_S3_PUBLIC_URL}/models/rmbg-1.4-fp16.onnx`、`${NEXT_PUBLIC_S3_PUBLIC_URL}/models/rmbg-2.0-q4f16.onnx`。
- 模型不进 Git（大文件），`.gitignore` 补对象存储模型缓存路径；转模型脚本进 Git。
- Docker 离线镜像：两模型打进镜像或挂载卷，启动 entrypoint 同步到本地 MinIO `models` 桶，保证离线部署可用。

### 推理引擎（onnxruntime-web + Worker）

- Worker 内 probe `navigator.gpu`：存在则用 WebGPU execution provider，否则用 wasm CPU 后端。
- 按档位 fetch 对应模型 URL → `ORT.InferenceSession.create(url, { executionProviders })`（懒加载、缓存 session）。
- 预处理：`ImageBitmap` → resize 到模型输入尺寸 → 归一化 → 构造输入张量。
- 推理：`session.run(inputs)` → 取输出 mask 张量。
- 后处理：mask 归一化到 0–255 alpha，回传主线程（`Transferable` 优化）。
- WebGPU 不可用 → CPU 后端 + 锁均衡档：`use-local-id-photo` 据 Worker 回报的 `ep` 信息，CPU 模式下强制使用 RMBG-1.4，高精度开关置灰并提示「高精度需 WebGPU」。
- 模型缓存靠 HTTP `Cache-Control`；首次下载有进度条，加载与推理分阶段进度。

### 本地路数据流

`File` → `ImageBitmap`（原图）→ Worker 推理得 alpha mask → 主线程 canvas：原图 × mask 合成透明前景 → 叠纯色背景（hex → rgba）→ 按 preset 裁剪到固定像素（如一寸 295×413）→ `canvas.toBlob(image/jpeg | image/png)` → 浏览器下载（`a[download]`）。规格、背景色、输出格式复用现有 `IdPhotoOptions`。

### 页面流程与 UI

- `page.tsx` 顶部加 segmented control：本地（默认）/ 服务端。
- 本地模式 UI：`FileDropzone` + `IdPhotoOptions`（preset / backgroundColor / outputType）+ 高精度开关（WebGPU 可见时可点，CPU 置灰提示）+ 处理按钮 + 进度（模型加载 / 推理 / 合成）+ 结果预览（复用 `ResultPanel` 的 `preview` 插槽与 `useObjectUrl(resultBlob)`）+ 下载按钮。无任务轮询、无登录墙。
- 服务端模式 UI：现状不变（上传 → 创建 `image_id_photo` 任务 → 轮询 → 下载，需登录）。
- 复用上阶段已实现的 `useObjectUrl` 做本地结果预览。

### 错误处理

- WebGPU 与 CPU 均不可用（极罕见）：本地模式不可用，提示切服务端。
- 模型下载失败 / 超时：重试一次，失败提示重试或切服务端。
- 推理异常：Worker 回传错误，UI 提示重试或切服务端。
- 模式切换时清理上一次本地路的临时状态（object URL 已由 `useObjectUrl` 自动 revoke）。

### i18n

- `ImageIdPhoto` 段新增文案：处理模式标签（本地 / 服务端）、高精度开关、CPU 锁档提示、本地路进度阶段文案、本地路错误恢复文案。
- 中英文 `messages/zh.json` 与 `en.json` 同步。

## 测试计划

- 引擎单测：mask → alpha 转换、canvas 合成背景（mock canvas）、preset 裁剪尺寸正确。
- `model-registry` 单测：两档元数据完整、bucket path 正确。
- `use-local-id-photo` 集成测：mock Worker，验证加载 → 推理 → 合成 → 输出 blob、进度状态流转、CPU 模式锁均衡档。
- Worker 测：mock ORT session，验证 ep 选择（WebGPU probe）、档位锁逻辑。
- 页面测：本地模式 UI 渲染、模式切换、高精度开关在 CPU 下置灰、结果预览出现。
- 不做真实模型推理 e2e（模型大且慢），留手动核对步骤。

## 影响范围

- 新增：`apps/web/src/lib/id-photo-local/*`（引擎、注册表、合成工具、hook、Worker）、页面模式切换 UI、`messages/{zh,en}.json` 文案、`apps/web` 加 `onnxruntime-web` 依赖、模型预置脚本与文档。
- 修改：`apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`、`apps/web/src/lib/tools/tool-metadata.ts`（本地路本地优先标记）、`.gitignore`。
- 后端：无改动。
- Docker：离线镜像纳入两模型 + 同步到本地 MinIO 的 entrypoint。

## 实施前置决策

- 本地路默认档为 RMBG-1.4 fp16，高精度档 RMBG-2.0 q4f16 由用户主动开启；WebGPU 不可用时锁均衡档。
- 模型分发用自有对象存储 `models` 只读 bucket，不用 jsDelivr（受其 ~50MB 单文件限制）。
- 推理放 Web Worker，主线程做 canvas 合成裁剪。
- 模型预置脚本从 ModelScope 取权重转 onnx，文档化；Docker 离线镜像内置模型。
- 不复刻后端边缘去污染，依赖 RMBG 原始 mask 质量。

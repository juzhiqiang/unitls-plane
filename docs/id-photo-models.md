# 证件照本地抠图模型预置（BRIA RMBG-1.4）

证件照本地处理使用
[`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers) 的
`background-removal` pipeline 运行 **BRIA
RMBG-1.4**，在浏览器内完成人像分割，产出透明 cutout 后再合成证件照底色。模型资产自托管在 MinIO/S3，离线镜像内置、启动时同步到本地 MinIO。

## ⚠️ 许可

RMBG-1.4 使用 **BRIA 自有许可**（HF model card 标注 `license: other`），
**商用需向 BRIA 申请授权**。本项目当前定位为免费受限公测，是否构成商用需自行判断。升级或替换模型前请复核
<https://huggingface.co/briaai/RMBG-1.4> 的许可条款。

## 为什么不是 ISNet / BiRefNet / MODNet

上一版使用
`@imgly/background-removal`（ISNet）。实测在「黑帽子 + 暗背景」这类低对比样张上，ISNet 会把整顶帽子判成背景，换底色后帽子染色甚至消失。同一张图的实测对比：

| 模型              | 许可       | 帽子         | 衣服   | 推理耗时 | 浏览器可用性              |
| ----------------- | ---------- | ------------ | ------ | -------- | ------------------------- |
| ISNet（旧）       | 无顾虑     | ✗ 半透明鬼影 | ✓ 实心 | 9~12s    | 可用                      |
| **RMBG-1.4**      | BRIA 专有  | ✓ 实心       | ✓ 实心 | **0.6s** | 可用（当前方案）          |
| MODNet            | Apache-2.0 | ✓ 实心       | ✗ 破洞 | 1.1s     | 可用                      |
| BiRefNet_lite     | MIT        | —            | —      | —        | ✗ OOM                     |
| BiRefNet-portrait | MIT        | —            | —      | —        | ✗ OOM（需一次分配 490MB） |

关键量化指标（同一张样张）：

| 指标                | ISNet            | RMBG-1.4  |
| ------------------- | ---------------- | --------- |
| 半透明像素占比      | 16.13%           | **0.63%** |
| 帽子区 alpha 中位数 | 217（44% < 102） | **249**   |
| 衣服区 alpha p05    | —                | **255**   |

RMBG-2.0（BiRefNet 架构）在 HF 上是
**gated 仓库**，未登录无法下载（`Unauthorized access`），故未采用。

## 档位与模型

| 档位   | dtype  | 文件                   | 大小   | 设备         | 说明                              |
| ------ | ------ | ---------------------- | ------ | ------------ | --------------------------------- |
| 均衡   | `fp16` | `onnx/model_fp16.onnx` | ~84MB  | CPU / WebGPU | 默认档；无 WebGPU 时强制使用      |
| 高精度 | `fp32` | `onnx/model.onnx`      | ~168MB | WebGPU       | 需 WebGPU；无 WebGPU 时回退均衡档 |

> 档位映射在 `apps/web/src/lib/id-photo-local/model-registry.ts`，改档位需同步此文件与下载脚本。

## 资产结构

transformers.js 按 HF 仓库的相对路径取文件，所以 MinIO 上保持与仓库一致的目录结构即可：

```text
models/rmbg/1.4/config.json
models/rmbg/1.4/preprocessor_config.json
models/rmbg/1.4/onnx/model_fp16.onnx
models/rmbg/1.4/onnx/model.onnx
models/ort/ort-wasm-simd-threaded.wasm
models/ort/ort-wasm-simd-threaded.mjs
models/ort/ort-wasm-simd-threaded.jsep.wasm     # WebGPU 用
models/ort/ort-wasm-simd-threaded.jsep.mjs
```

共 8 个文件（约 288MB）。相比上一版 @imgly 的 76 个 SHA256 分块，结构大幅简化。

**ort
wasm 必须自托管**：transformers.js 默认从 jsDelivr 取 ort 运行时，离线镜像内没有公网会直接失败。

## 路径映射

前端 `model-registry.ts`：

```ts
env.remoteHost = `${NEXT_PUBLIC_S3_PUBLIC_URL}/models/`; // modelsBaseUrl()
env.remotePathTemplate = '{model}/';
env.backends.onnx.wasm.wasmPaths = `${NEXT_PUBLIC_S3_PUBLIC_URL}/models/ort/`; // ortWasmPath()
// model id = 'rmbg/1.4' → 拼出 ${base}/models/rmbg/1.4/<file>
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
   - `node scripts/download-rmbg-assets.cjs all`：模型从 HF 下载到 `docker/models/rmbg/1.4/`；ort
     wasm 从 `node_modules` **复制**到 `docker/models/ort/` （复制而非下载，保证与
     `@huggingface/transformers`
     实际依赖的 ort 版本严格一致 ——版本错配会导致 wasm 与 glue 导出对不上，参见 git 历史里的
     `jsepInit`/`webgpuInit` 事故）。
   - `aws s3 sync` 把两棵树同步到 `s3://models/`，设匿名只读策略与不可变缓存。

## 前端如何使用

`apps/web/src/lib/id-photo-local/use-local-id-photo.ts`：

- 挂载时探测 WebGPU（`navigator.gpu.requestAdapter()`）→ `ep: 'webgpu' | 'wasm'`。
- `tierFor(ep === 'webgpu', requestedTier)`：无 WebGPU 时把高精度请求锁回均衡档。
- `pipeline('background-removal', 'rmbg/1.4', { dtype, device, progress_callback })`；pipeline 按档位缓存在 ref 里，同档复用（模型大，不能每次重建）。
- 进度：transformers.js 发 `{status:'progress', progress:0..100}`，映射为 `loading-model`。
- 产出 RawImage → `toCanvas()` → `createImageBitmap` → `compositeIdPhoto` 合成底色与裁剪。

`@huggingface/transformers` 在 Next.js 构建时有特殊处理，见 `apps/web/next.config.mjs` 的 `webpack`
钩子注释（server
bundle 里 stub 成空模块；client 侧对 onnxruntime-web 的预打包 .mjs 关掉 URL 改写并替换
`import.meta.url`）。

## 对象存储

- 桶：`models`（只读匿名下载，`put-bucket-policy` 允许 `s3:GetObject`）。
- 公网 URL：`${NEXT_PUBLIC_S3_PUBLIC_URL}/models/...`。
- 跨域：MinIO 2025 自动镜像请求 `Origin` 头，无需额外 bucket CORS 配置。
- 缓存：上传时设 `Cache-Control: public, max-age=31536000, immutable`（资产按版本不可变）。

## 离线镜像

- 组合镜像构建时把 `docker/models/` 树 `COPY` 进 `/app/models/id-photo/`
  （Dockerfile，`docker/models/` 已 gitignore，仅保留 `.gitkeep`）。
- `docker/start-all.sh` 在 migrate 之后、API 启动前调用
  `node apps/api/dist/scripts/sync-id-photo-models.js`，用 `@aws-sdk/client-s3` 递归上传 `rmbg/` 与
  `ort/` 前缀下的资产到本地 MinIO `models` 桶并设匿名只读策略。
- 同步脚本失败不阻塞启动（返回 0，打印 skip 日志），便于 MinIO 未就绪时下次重启重试。
- 资产不进 Git（大），构建前先跑 `scripts/prepare-id-photo-models.sh` 或
  `node scripts/download-rmbg-assets.cjs all`。

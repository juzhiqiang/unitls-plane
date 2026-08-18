# 证件照本地抠图模型预置（@imgly/ISNet）

证件照本地处理使用 [`@imgly/background-removal`](https://www.npmjs.com/package/@imgly/background-removal)
的 ISNet 引擎，在浏览器内完成人像分割，产出透明 cutout 后再合成证件照底色。模型资产自托管在
MinIO/S3，离线镜像内置、启动时同步到本地 MinIO。

## 档位与模型

| 档位 | 资源键 | 大小 | 量化 | 设备 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 均衡 | `/models/isnet_fp16` | ~84MB | fp16 | CPU / WebGPU | 默认档；无 WebGPU 时强制使用 |
| 高精度 | `/models/isnet` | ~168MB | fp32 | WebGPU | 需 WebGPU；无 WebGPU 时回退均衡档 |

> 档位映射在 `apps/web/src/lib/id-photo-local/model-registry.ts`，改档位需同步此文件与下载脚本。
> `/models/isnet_quint8`（~42MB，极速档）由 @imgly 提供，本平台不开放，下载时跳过。

## 资产结构（分块）

@imgly 的资产是**分块**的，不是单个模型文件：

- `resources.json`：清单，列出每个资源键的 `chunks`（每个 chunk 有 `name` = SHA256、`offsets`、`size`）。
- `<chunk.name>`：以 SHA256 命名的分块文件，扁平存放在 `dist/` 下。

运行时 loader 先取 `resources.json`，再按 `chunks[].name` 逐块从 publicPath 拉取，校验
`blob.size === offsets[1]-offsets[0]` 后拼接还原资源。所以本地只需把这些"分块文件 + 清单"原样上传
到 MinIO，loader 即可按 publicPath 取用。

本平台需要的 6 个资源键（跳过 `isnet_quint8`）：

| 用途 | 资源键 |
| --- | --- |
| 运行时（WebGPU jsep） | `/onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm` |
| 运行时（CPU wasm） | `/onnxruntime-web/ort-wasm-simd-threaded.wasm` |
| 运行时（jsep 加载器） | `/onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs` |
| 运行时（wasm 加载器） | `/onnxruntime-web/ort-wasm-simd-threaded.mjs` |
| 均衡档模型 | `/models/isnet_fp16` |
| 高精度档模型 | `/models/isnet` |

共 75 个分块文件 + `resources.json`（合计 76 个文件，约 285MB）。资源键与下载脚本
`scripts/download-imgly-assets.cjs` 中的 `RESOURCES` 必须保持一致。

## publicPath 映射

前端 `imglyPublicPath()`（`apps/web/src/lib/id-photo-local/model-registry.ts`）：

```text
${NEXT_PUBLIC_S3_PUBLIC_URL}/models/imgly/1.7.0/dist/
```

MinIO 对应 key：

```text
models/imgly/1.7.0/dist/resources.json
models/imgly/1.7.0/dist/<chunk.name>   # 75 个分块
```

`removeBackground(file, { publicPath })` 据此拉清单和分块。

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
   - `node scripts/download-imgly-assets.cjs all` 从 @imgly CDN 下载到
     `docker/models/imgly/1.7.0/dist/`（幂等，已存在且尺寸正确的分块跳过）。
   - `aws s3 sync` 把该目录同步到 `s3://models/imgly/1.7.0/dist/`，设匿名只读策略与不可变缓存。

## 前端如何使用

`apps/web/src/lib/id-photo-local/use-local-id-photo.ts` 在主线程调用
`removeBackground(file, { model, device, output, publicPath, progress })`：

- 挂载时探测 WebGPU（`navigator.gpu.requestAdapter()`）→ `ep: 'webgpu' | 'wasm'`。
- `tierFor(ep === 'webgpu', requestedTier)`：无 WebGPU 时把高精度请求锁回均衡档。
- `device`：WebGPU 用 `'gpu'`（走 `onnxruntime-web/webgpu` + jsep wasm）；CPU 用 `'cpu'`
  （走 `onnxruntime-web/wasm`）。
- 进度：`fetch:<key>` → 下载（映射为 `loading-model`）；`compute:decode|inference|mask|encode`
  → 推理四阶段（映射为 `running`）。
- 产出透明 PNG cutout Blob → `createImageBitmap` → `compositeIdPhoto` 合成底色与裁剪。

@imgly 的 `import("onnxruntime-web/webgpu")`（GPU 路径）与 `import("onnxruntime-web")`（CPU 路径）
在 Next.js 构建时有特殊处理，见 `apps/web/next.config.mjs` 的 `webpack` 钩子注释。

## 对象存储

- 桶：`models`（只读匿名下载，`put-bucket-policy` 允许 `s3:GetObject`）。
- 公网 URL：`${NEXT_PUBLIC_S3_PUBLIC_URL}/models/imgly/1.7.0/dist/<file>`。
- 跨域：MinIO 2025 自动镜像请求 `Origin` 头并暴露 `Content-Length`，无需额外 bucket CORS 配置
  （loader 用 `Content-Length` 校验分块大小）。
- 缓存：上传时设 `Cache-Control: public, max-age=31536000, immutable`（资产按版本不可变）。

## 离线镜像

- 组合镜像构建时把 `docker/models/` 树 `COPY` 进 `/app/models/id-photo/`
  （Dockerfile，`docker/models/` 已 gitignore，仅保留 `.gitkeep`）。
- `docker/start-all.sh` 在 migrate 之后、API 启动前调用
  `node apps/api/dist/scripts/sync-id-photo-models.js`，用 `@aws-sdk/client-s3`（镜像内已有依赖）
  递归上传 `imgly/` 前缀下的资产到本地 MinIO `models` 桶并设匿名只读策略。
- 同步脚本失败不阻塞启动（返回 0，打印 skip 日志），便于 MinIO 未就绪时下次重启重试。
- 资产不进 Git（大），构建前放 `docker/models/imgly/1.7.0/dist/`。

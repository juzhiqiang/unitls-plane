# 证件照本地抠图模型预置

## 模型清单

| 档位 | 文件名 | 大小 | 量化 | 来源 |
| --- | --- | --- | --- | --- |
| 均衡 | `rmbg-1.4-fp16.onnx` | ~84MB (88,217,533 B) | fp16 | ModelScope `briaai/RMBG-1.4` `onnx/model_fp16.onnx` |
| 高精度 | `rmbg-2.0-q4f16.onnx` | ~234MB (233,815,293 B) | q4f16 | ModelScope `briaai/RMBG-2.0` `onnx/model_q4f16.onnx` |

> ModelScope 仓库已提供预转好的 onnx 变体(fp16 / q4f16),无需本地 Python 转换。
> HuggingFace 不可达,故从 ModelScope 取权重。

## 预置步骤

1. 配置 MinIO/S3 访问:
   ```bash
   export S3_ENDPOINT=http://localhost:9000
   export S3_ACCESS_KEY=minioadmin
   export S3_SECRET_KEY=minioadmin
   export AWS_DEFAULT_REGION=us-east-1
   ```
2. (可选)安装 I/O 检查依赖:`pip install onnx`。
3. 执行:`./scripts/prepare-id-photo-models.sh`。
4. 脚本会下载两 onnx、上传到 `models` 桶、并打印 I/O 信息。

## 实测预处理参数

> 由 `scripts/inspect-onnx-io.py` 对已上传的 onnx 实测产出(2026-08-18)。
> Task 5(`portrait-segmenter.worker.ts`)推理代码据此校准。

### RMBG-1.4 (fp16)

- 输入张量名:`input`(由 `session.inputNames[0]`)
- 输入尺寸:`1024 × 1024`(固定,`[batch_size, 3, 1024, 1024]`)
- 输入布局:`NCHW`,3 通道 RGB
- 归一化:RGB / [0,1] / mean=[0.485,0.456,0.406] std=[0.229,0.224,0.225](ImageNet 惯例,BiRefNet 通用)
- 输出张量名:`output`(由 `session.outputNames[0]`)
- 输出形状:`[batch, C, H, W]`(动态,运行时通常 1024×1024)
- **输出已 sigmoid**:图中含 `Sigmoid` 节点 → Cast → 输出,输出已是 [0,1] alpha。
  worker `postprocess` **不应**再次 sigmoid。

### RMBG-2.0 (q4f16)

- 输入张量名:`pixel_values`(与 1.4 不同,但 worker 用 `inputNames[0]` 动态取,兼容)
- 输入尺寸:动态 `[1, 3, height, width]`(接受任意尺寸;worker 用 1024 合法)
- 输入布局:`NCHW`,3 通道 RGB
- 归一化:同上(ImageNet)
- 输出张量名:`alphas`(与 1.4 不同,worker 用 `outputNames[0]` 动态取,兼容)
- 输出形状:`[1, 1, height, width]`(单通道 mask,动态,与输入同尺寸)
- **输出已 sigmoid**:`alphas` 即 alpha matte,已是 [0,1]。worker `postprocess` **不应**再次 sigmoid。

### 校准结论(对 worker 代码的影响)

1. `INPUT_SIZE=1024`:RMBG-1.4 固定要求;RMBG-2.0 动态接受,1024 合法。保留 1024。
2. 输入/输出名:两模型不同,worker 已用 `session.inputNames[0]`/`outputNames[0]` 动态取,兼容。✅
3. **sigmoid**:两模型输出均已 sigmoid,worker `postprocess` 移除 sigmoid(否则重复 sigmoid 压缩对比度)。
4. mask 空间尺寸:从 `out.dims` 运行时读取(worker `inferMaskSize` 已实现),不硬编码。✅
5. dtype:两模型输出均为 float32(dtype=1),`toF32` 零拷贝正确。✅

## 对象存储

- 桶:`models`(只读匿名下载,`put-bucket-policy` 允许 `s3:GetObject`)。
- 公网 URL:`${NEXT_PUBLIC_S3_PUBLIC_URL}/models/<file>`。
- 跨域:MinIO 需在 bucket CORS 或网关层暴露 `Access-Control-Expose-Headers: Content-Length`,否则前端读不到模型下载总长度(进度条无百分比)。
- 缓存:上传时设 `Cache-Control: public, max-age=31536000, immutable`(模型不变,可长期缓存)。

## 离线镜像

- 组合镜像构建时把两 onnx 放 `docker/models/`(已 gitignore,仅保留 `.gitkeep`),Dockerfile `COPY docker/models/ ./models/id-photo/` 进镜像 `/app/models/id-photo/`。
- `docker/start-all.sh` 在 migrate 之后、API 启动之前调用 `node apps/api/dist/scripts/sync-id-photo-models.js`,用 `@aws-sdk/client-s3`(镜像内已有依赖,无需额外安装 `mc`)把模型同步到本地 MinIO `models` 桶并设匿名只读策略。
- 同步脚本失败不阻塞启动(返回 0,打印 skip 日志),便于 MinIO 未就绪时下次重启重试。
- 模型文件不进 Git(大),构建前放 `docker/models/`。

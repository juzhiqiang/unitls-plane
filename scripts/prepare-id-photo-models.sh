#!/usr/bin/env bash
# 预置证件照本地抠图资产(BRIA RMBG-1.4 + onnxruntime-web wasm 运行时)到本地 MinIO
# models 桶(匿名只读)。
#
# 本地开发用:把 @huggingface/transformers 运行 RMBG-1.4 所需的模型与 ort wasm 拉到 MinIO,
# 前端即可在浏览器本地完成证件照抠图,无需服务端。
#
# 步骤:
#   1) node scripts/download-rmbg-assets.cjs all
#      → 模型从 HF 下载到 docker/models/rmbg/1.4/
#      → ort wasm 从 node_modules 复制到 docker/models/ort/(保证与 transformers 依赖版本一致)
#   2) aws-cli 把 docker/models/{rmbg,ort} 同步到 s3://models/
#
# 公网访问 URL(与前端 model-registry.ts 对齐):
#   ${NEXT_PUBLIC_S3_PUBLIC_URL}/models/rmbg/1.4/config.json
#   ${NEXT_PUBLIC_S3_PUBLIC_URL}/models/rmbg/1.4/onnx/model_fp16.onnx
#   ${NEXT_PUBLIC_S3_PUBLIC_URL}/models/ort/ort-wasm-simd-threaded.jsep.wasm
#
# 许可提醒:RMBG-1.4 为 BRIA 自有许可(license: other),商用需向 BRIA 申请授权。
#
# 用法:
#   export S3_ENDPOINT=http://localhost:9000
#   export S3_ACCESS_KEY=minioadmin
#   export S3_SECRET_KEY=minioadmin
#   ./scripts/prepare-id-photo-models.sh
#
# 依赖:node、aws-cli(或 aws-cli-v2)、本地 MinIO 已启动(bun run services:up)。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUCKET="${S3_MODELS_BUCKET:-models}"
REGION="${AWS_DEFAULT_REGION:-${S3_REGION:-us-east-1}}"
VERSION="1.4"
MODEL_DIR="$ROOT/docker/models/rmbg/$VERSION"
ORT_DIR="$ROOT/docker/models/ort"

: "${S3_ENDPOINT:?S3_ENDPOINT is required (e.g. http://localhost:9000)}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"
export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
export AWS_DEFAULT_REGION="$REGION"
# MinIO 用 path-style
export AWS_S3_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}"

# 1. 下载模型 + 复制 ort 运行时(幂等:已存在且非空则跳过)
node "$ROOT/scripts/download-rmbg-assets.cjs" all

# 2. 确保 models 桶存在 + 匿名只读策略(允许前端公开拉取)
aws --endpoint-url "$S3_ENDPOINT" s3 mb "s3://$BUCKET" --region "$REGION" 2>/dev/null || true
aws --endpoint-url "$S3_ENDPOINT" s3api put-bucket-policy --bucket "$BUCKET" --region "$REGION" \
  --policy '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":["s3:GetObject"],"Resource":["arn:aws:s3:::'"$BUCKET"'/*"]}]}' \
  2>/dev/null || echo "[prepare] bucket policy set skipped (non-MinIO or already set)"

# 3. 同步资产树到 MinIO(按版本不可变,长期缓存)
echo "==> uploading $MODEL_DIR → s3://$BUCKET/rmbg/$VERSION/"
aws --endpoint-url "$S3_ENDPOINT" s3 sync "$MODEL_DIR" "s3://$BUCKET/rmbg/$VERSION/" \
  --region "$REGION" --no-progress \
  --cache-control "public, max-age=31536000, immutable"

echo "==> uploading $ORT_DIR → s3://$BUCKET/ort/"
aws --endpoint-url "$S3_ENDPOINT" s3 sync "$ORT_DIR" "s3://$BUCKET/ort/" \
  --region "$REGION" --no-progress \
  --cache-control "public, max-age=31536000, immutable"

echo
echo "==> 证件照 RMBG-1.4 资产已就绪。"
echo "    模型:     \${NEXT_PUBLIC_S3_PUBLIC_URL}/models/rmbg/$VERSION/"
echo "    ort wasm: \${NEXT_PUBLIC_S3_PUBLIC_URL}/models/ort/"

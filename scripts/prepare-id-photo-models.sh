#!/usr/bin/env bash
# 预置证件照本地抠图模型到 MinIO/S3 models 桶。
#
# ModelScope 的 briaai/RMBG-{1.4,2.0} 仓库已提供预转好的 onnx 变体,
# 无需本地 Python 转换,直接下载即可:
#   - RMBG-1.4: onnx/model_fp16.onnx  (~84MB, fp16)
#   - RMBG-2.0: onnx/model_q4f16.onnx (~234MB, q4f16)
#
# 用法:
#   export S3_ENDPOINT=http://localhost:9000
#   export S3_ACCESS_KEY=minioadmin
#   export S3_SECRET_KEY=minioadmin
#   export AWS_DEFAULT_REGION=us-east-1   # MinIO 默认 region
#   ./scripts/prepare-id-photo-models.sh
#
# 依赖: curl、aws-cli(S3 兼容,用于上传)、python3 + onnx(仅 inspect I/O,可选)。
set -euo pipefail

BUCKET="${S3_MODELS_BUCKET:-models}"
WORKDIR="${WORKDIR:-./.cache/id-photo-models}"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"

# name|source_url|out_name
MODELS=(
  "rmbg-1.4|https://modelscope.cn/models/briaai/RMBG-1.4/resolve/master/onnx/model_fp16.onnx|rmbg-1.4-fp16.onnx"
  "rmbg-2.0|https://modelscope.cn/models/briaai/RMBG-2.0/resolve/master/onnx/model_q4f16.onnx|rmbg-2.0-q4f16.onnx"
)

mkdir -p "$WORKDIR"

# 创建只读匿名桶(若不存在)
aws --endpoint-url "$S3_ENDPOINT" s3 mb "s3://$BUCKET" --region "$REGION" 2>/dev/null || true
# MinIO 匿名只读策略(允许前端公开拉取模型)
aws --endpoint-url "$S3_ENDPOINT" s3api put-bucket-policy --bucket "$BUCKET" --region "$REGION" \
  --policy '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":["s3:GetObject"],"Resource":["arn:aws:s3:::'"$BUCKET"'/*"]}]}' \
  2>/dev/null || echo "[prepare] bucket policy set skipped (non-MinIO or already set)"

for entry in "${MODELS[@]}"; do
  IFS='|' read -r name src_url out_name <<< "$entry"
  out="$WORKDIR/$out_name"
  if [ -f "$out" ]; then
    echo "==> $name: $out_name already exists, skipping download"
  else
    echo "==> $name: downloading $src_url"
    curl -fL "$src_url" -o "$out"
  fi
  echo "==> $name: uploading to s3://$BUCKET/$out_name"
  aws --endpoint-url "$S3_ENDPOINT" s3 cp "$out" "s3://$BUCKET/$out_name" --region "$REGION" \
    --content-type application/octet-stream \
    --cache-control "public, max-age=31536000, immutable"
done

echo "==> inspecting I/O names/shapes for docs (requires python3 + onnx)"
for out_name in rmbg-1.4-fp16.onnx rmbg-2.0-q4f16.onnx; do
  if python3 -c "import onnx" 2>/dev/null; then
    echo "--- $out_name ---"
    python3 scripts/inspect-onnx-io.py "$WORKDIR/$out_name" | tee "$WORKDIR/${out_name%.onnx}-io.txt"
  else
    echo "[prepare] python onnx not installed, skipping I/O inspect for $out_name"
  fi
done

echo "Done. Fill docs/id-photo-models.md with the I/O info above (if not already)."

#!/usr/bin/env bash
# 预置证件照本地抠图 @imgly/ISNet 资产到本地 MinIO models 桶(匿名只读)。
#
# 本地开发用:把 @imgly/background-removal 运行所需的分块资产(resources.json + 6 个资源键的
# 分块文件)拉到 MinIO,前端即可在浏览器本地完成证件照抠图,无需服务端。
#
# 步骤:
#   1) node scripts/download-imgly-assets.cjs 从 @imgly CDN 下载到 docker/models/imgly/1.7.0/dist/
#   2) aws-cli 把该目录同步到 s3://models/imgly/1.7.0/dist/(保持扁平分块结构)
#
# 公网访问 URL(与前端 imglyPublicPath() 对齐):
#   ${NEXT_PUBLIC_S3_PUBLIC_URL}/models/imgly/1.7.0/dist/resources.json
#   ${NEXT_PUBLIC_S3_PUBLIC_URL}/models/imgly/1.7.0/dist/<chunk.name>
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
VERSION="1.7.0"
DIST_DIR="$ROOT/docker/models/imgly/$VERSION/dist"
S3_KEY_PREFIX="imgly/$VERSION/dist"

: "${S3_ENDPOINT:?S3_ENDPOINT is required (e.g. http://localhost:9000)}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"
export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
export AWS_DEFAULT_REGION="$REGION"
# MinIO 用 path-style
export AWS_S3_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}"

# 1. 从 @imgly CDN 下载资产(幂等:已存在且尺寸正确的分块跳过)
node "$ROOT/scripts/download-imgly-assets.cjs" all

# 2. 确保 models 桶存在 + 匿名只读策略(允许前端公开拉取)
aws --endpoint-url "$S3_ENDPOINT" s3 mb "s3://$BUCKET" --region "$REGION" 2>/dev/null || true
aws --endpoint-url "$S3_ENDPOINT" s3api put-bucket-policy --bucket "$BUCKET" --region "$REGION" \
  --policy '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":["s3:GetObject"],"Resource":["arn:aws:s3:::'"$BUCKET"'/*"]}]}' \
  2>/dev/null || echo "[prepare] bucket policy set skipped (non-MinIO or already set)"

# 3. 同步资产树到 MinIO(分块文件保持扁平 SHA256 命名;资产按版本不可变,长期缓存)
echo "==> uploading $DIST_DIR → s3://$BUCKET/$S3_KEY_PREFIX/"
aws --endpoint-url "$S3_ENDPOINT" s3 sync "$DIST_DIR" "s3://$BUCKET/$S3_KEY_PREFIX/" \
  --region "$REGION" --no-progress \
  --cache-control "public, max-age=31536000, immutable"

echo
echo "==> 证件照 @imgly/ISNet 资产已就绪。"
echo "    publicPath: \${NEXT_PUBLIC_S3_PUBLIC_URL}/models/$S3_KEY_PREFIX/"
echo "    清单:       \${NEXT_PUBLIC_S3_PUBLIC_URL}/models/$S3_KEY_PREFIX/resources.json"

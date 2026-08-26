#!/bin/sh
set -eu

api_pid=""
web_pid=""

terminate() {
  if [ -n "$api_pid" ] && kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid"
  fi

  if [ -n "$web_pid" ] && kill -0 "$web_pid" 2>/dev/null; then
    kill "$web_pid"
  fi
}

trap terminate INT TERM

node apps/api/dist/scripts/migrate.js

# 同步证件照本地抠图模型到 MinIO models 桶(离线镜像内置模型时使用)。
# 失败不阻塞启动(MinIO 未就绪时下次重启重试)。
if [ -f apps/api/dist/scripts/sync-id-photo-models.js ]; then
  node apps/api/dist/scripts/sync-id-photo-models.js || echo "[start-all] id-photo model sync skipped (failed or MinIO not ready)"
fi

# Seed AI 生图提示词模板到 DB(image_generate_presets 表)+ MinIO presets 桶。
# 按 slug upsert,只刷新内置模板内容,不动后台改过的启用状态。失败同样不阻塞启动。
if [ -f apps/api/dist/scripts/seed-image-generate-presets.js ]; then
  node apps/api/dist/scripts/seed-image-generate-presets.js || echo "[start-all] image generate presets seed skipped (failed or MinIO not ready)"
fi

node apps/api/dist/main.js &
api_pid="$!"

HOSTNAME="${HOSTNAME:-0.0.0.0}" PORT="${WEB_PORT:-3000}" node server.js &
web_pid="$!"

status="0"

while true; do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    wait "$api_pid" || status="$?"
    break
  fi

  if ! kill -0 "$web_pid" 2>/dev/null; then
    wait "$web_pid" || status="$?"
    break
  fi

  sleep 1
done

terminate
wait "$api_pid" "$web_pid" 2>/dev/null || true

exit "$status"

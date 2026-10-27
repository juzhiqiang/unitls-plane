#!/bin/sh
set -eu

api_pid=""
worker_pid=""
web_pid=""

terminate() {
  status="${1:-0}"
  trap - INT TERM

  for pid in "$api_pid" "$worker_pid" "$web_pid"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  for pid in "$api_pid" "$worker_pid" "$web_pid"; do
    if [ -n "$pid" ]; then
      wait "$pid" 2>/dev/null || true
    fi
  done

  exit "$status"
}

trap 'terminate 0' INT TERM

# migration、模型同步和 preset seed 只执行一次，均由 API 启动阶段负责。
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

PROCESS_ROLE=api node apps/api/dist/main.js &
api_pid="$!"

HOSTNAME="${HOSTNAME:-0.0.0.0}" PORT="${WEB_PORT:-3000}" node server.js &
web_pid="$!"

# API 完成 migration/seed 并通过 readiness 后才启动 Worker，避免两边同时消费任务。
attempt=0
API_PORT="${PORT:-3001}"
until API_PORT="$API_PORT" node -e "fetch('http://127.0.0.1:' + process.env.API_PORT + '/health/ready', { signal: AbortSignal.timeout(3000) }).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; do
  attempt=$((attempt + 1))

  if ! kill -0 "$api_pid" 2>/dev/null; then
    wait "$api_pid" || terminate "$?"
    terminate 1
  fi

  if ! kill -0 "$web_pid" 2>/dev/null; then
    wait "$web_pid" || terminate "$?"
    terminate 1
  fi

  if [ "$attempt" -ge 60 ]; then
    echo "[start-all] API readiness timed out" >&2
    terminate 1
  fi

  sleep 2
done

PROCESS_ROLE=worker node apps/api/dist/main.js &
worker_pid="$!"

status="0"

while true; do
  for pid in "$api_pid" "$worker_pid" "$web_pid"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" || status="$?"
      # 任一核心子进程退出都视为整体失败；即使它自身以 0 退出，
      # 容器也不能被误判为正常结束。
      if [ "$status" -eq 0 ]; then
        status=1
      fi
      terminate "$status"
    fi
  done

  sleep 1
done

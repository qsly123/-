#!/bin/bash
set -eu

if [ "${DB_AUTO_MIGRATE_ON_BOOT:-1}" = "1" ]; then
  echo "[entrypoint] 检测到 DB_AUTO_MIGRATE_ON_BOOT=1，开始执行数据库迁移..."
  node ./docker/migrate.mjs
else
  echo "[entrypoint] 默认跳过数据库迁移。"
fi

if [ "${CORE_SCHEMA_BOOTSTRAP_ON_BOOT:-1}" = "1" ]; then
  echo "[entrypoint] 开始执行核心表结构自举..."
  node ./docker/core-schema-bootstrap.mjs
else
  echo "[entrypoint] 已关闭核心表结构自举。"
fi

if [ "${OPEN_WORLD_SCHEMA_BOOTSTRAP_ON_BOOT:-1}" = "1" ]; then
  echo "[entrypoint] 开始执行开放世界表结构自举..."
  node ./docker/open-world-bootstrap.mjs
else
  echo "[entrypoint] 已关闭开放世界表结构自举。"
fi

if [ "${MARKET_SCHEMA_BOOTSTRAP_ON_BOOT:-1}" = "1" ]; then
  echo "[entrypoint] 开始执行市场表结构自举..."
  node ./docker/market-bootstrap.mjs
else
  echo "[entrypoint] 已关闭市场表结构自举。"
fi

if [ "${SECT_SCHEMA_BOOTSTRAP_ON_BOOT:-1}" = "1" ]; then
  echo "[entrypoint] 开始执行宗门表结构自举..."
  node ./docker/sect-schema-bootstrap.mjs
else
  echo "[entrypoint] 已关闭宗门表结构自举。"
fi

if [ "${FOUR_REALMS_APPLY_ON_BOOT:-0}" = "1" ]; then
  echo "[entrypoint] 检测到 FOUR_REALMS_APPLY_ON_BOOT=1，开始导入四境离线包..."
  FOUR_REALMS_APPLY=1 FOUR_REALMS_APPLY_FORCE="${FOUR_REALMS_APPLY_FORCE:-0}" node ./docker/four-realms-apply.mjs
else
  echo "[entrypoint] 未开启四境离线包自动导入，跳过。"
fi

echo "[entrypoint] 启动双进程应用..."
export WEB_RUNTIME_PORT="${WEB_RUNTIME_PORT:-${PORT:-3000}}"
export PORT="${WEB_RUNTIME_PORT}"
export REALTIME_RUNTIME_PORT="${REALTIME_RUNTIME_PORT:-3101}"
export REALTIME_RUNTIME_ENABLED="${REALTIME_RUNTIME_ENABLED:-1}"
export REALTIME_RUNTIME_HOST="${REALTIME_RUNTIME_HOST:-127.0.0.1}"
export REALTIME_INTERNAL_TOKEN="${REALTIME_INTERNAL_TOKEN:-${INTERNAL_REALTIME_TOKEN:-$(node -e "console.log(require('crypto').randomUUID())")}}"
export INTERNAL_REALTIME_TOKEN="${REALTIME_INTERNAL_TOKEN}"
export MAP_AOI_TILE_SIZE="${MAP_AOI_TILE_SIZE:-12}"
export MAP_AOI_PRELOAD_RINGS="${MAP_AOI_PRELOAD_RINGS:-1}"
export MAP_CONNECTION_REPAIR_WINDOW="${MAP_CONNECTION_REPAIR_WINDOW:-32}"
export MAP_CONNECTION_REPAIR_MAX_GAP="${MAP_CONNECTION_REPAIR_MAX_GAP:-16}"
export MAP_SCENE_TICK_WATCH_INTERVAL_MS="${MAP_SCENE_TICK_WATCH_INTERVAL_MS:-1500}"
export MAP_SCENE_TICK_WATCH_ACTIVE_INTERVAL_MS="${MAP_SCENE_TICK_WATCH_ACTIVE_INTERVAL_MS:-400}"
export MAP_SCENE_TICK_WATCH_ACTIVE_WINDOW_MS="${MAP_SCENE_TICK_WATCH_ACTIVE_WINDOW_MS:-8000}"
export MAP_WATCHER_TRIGGER_GAP_TICKS="${MAP_WATCHER_TRIGGER_GAP_TICKS:-3}"
export MAP_WATCHER_TRIGGER_IDLE_MS="${MAP_WATCHER_TRIGGER_IDLE_MS:-1200}"
export MAP_SELF_MOVE_VISION_REFRESH_INTERVAL_MS="${MAP_SELF_MOVE_VISION_REFRESH_INTERVAL_MS:-240}"
export MAP_SCENE_SHARED_STATE_PROACTIVE_MAX_CONCURRENCY="${MAP_SCENE_SHARED_STATE_PROACTIVE_MAX_CONCURRENCY:-2}"
export MAP_SCENE_CONTEXT_CACHE_TTL_MS="${MAP_SCENE_CONTEXT_CACHE_TTL_MS:-2000}"
export MAP_PANEL_READ_MODEL_CACHE_TTL_MS="${MAP_PANEL_READ_MODEL_CACHE_TTL_MS:-8000}"
export MAP_PANEL_READ_MODEL_CACHE_STALE_MS="${MAP_PANEL_READ_MODEL_CACHE_STALE_MS:-60000}"

echo "[entrypoint] 地图 realtime 默认环境已加载：tickIdle=${MAP_SCENE_TICK_WATCH_INTERVAL_MS} tickActive=${MAP_SCENE_TICK_WATCH_ACTIVE_INTERVAL_MS} activeWindow=${MAP_SCENE_TICK_WATCH_ACTIVE_WINDOW_MS} watcherGap=${MAP_WATCHER_TRIGGER_GAP_TICKS} watcherIdle=${MAP_WATCHER_TRIGGER_IDLE_MS} selfMoveRefresh=${MAP_SELF_MOVE_VISION_REFRESH_INTERVAL_MS} sharedStateConcurrency=${MAP_SCENE_SHARED_STATE_PROACTIVE_MAX_CONCURRENCY} sceneContextCache=${MAP_SCENE_CONTEXT_CACHE_TTL_MS} panelReadModelCache=${MAP_PANEL_READ_MODEL_CACHE_TTL_MS}"

node ./realtime-server.mjs &
REALTIME_PID=$!

REALTIME_RUNTIME_ROLE=web node ./server.js &
WEB_PID=$!

cleanup() {
  kill "$REALTIME_PID" "$WEB_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

wait -n "$REALTIME_PID" "$WEB_PID"

# ---- 依赖安装阶段 ----
FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/game-server/package.json ./apps/game-server/package.json
COPY packages/shared-protocol/package.json ./packages/shared-protocol/package.json
COPY packages/game-rules/package.json ./packages/game-rules/package.json
COPY packages/db/package.json ./packages/db/package.json
RUN bun install --frozen-lockfile

# ---- 构建阶段 ----
FROM oven/bun:1 AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 构建时提供占位数据库 URL，避免模块加载报错（运行时会被真正的环境变量覆盖）
ENV DATABASE_URL="postgres://placeholder:placeholder@localhost:5432/placeholder"

# 若仓库中未包含迁移文件，则在镜像构建时生成一次
RUN if [ ! -d "./drizzle" ] || [ -z "$(ls -A ./drizzle 2>/dev/null)" ]; then bun run db:generate; fi

# 构建前校验并导出四境离线包，同时打包运行期可执行的导入脚本。
# 拆分为独立步骤，便于 CI 直接定位具体失败环节。
RUN bun run worldpack:four-realms:validate
RUN bun run worldpack:four-realms:export
RUN bun build ./scripts/apply-four-realms-pack.ts --target node --outfile ./docker/four-realms-apply.mjs

# 构建 Next.js（standalone 模式）
RUN bun run build

# ---- 运行阶段 ----
FROM node:24-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=1536
ENV DATABASE_POOL_MAX=6
ENV RUNTIME_PERSIST_DIR=/app/.runtime/persisted-state

USER root
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

RUN mkdir -p /app/.runtime/persisted-state && chown -R nextjs:nodejs /app/.runtime

# 复制 standalone 产物
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/server.js ./server.js
COPY --from=builder --chown=nextjs:nodejs /app/server.mjs ./server.mjs
COPY --from=builder --chown=nextjs:nodejs /app/realtime-server.mjs ./realtime-server.mjs

# Drizzle 迁移文件与运行时迁移依赖。
# Bun 的 node_modules 入口大量使用指向 node_modules/.bun 的链接，runner 不能只复制单个包目录，否则 Node 会遇到断链。
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs docker/migrate.mjs ./docker/migrate.mjs
COPY --chown=nextjs:nodejs docker/core-schema-bootstrap.mjs ./docker/core-schema-bootstrap.mjs
COPY --chown=nextjs:nodejs docker/open-world-bootstrap.mjs ./docker/open-world-bootstrap.mjs
COPY --chown=nextjs:nodejs docker/market-bootstrap.mjs ./docker/market-bootstrap.mjs
COPY --chown=nextjs:nodejs docker/sect-schema-bootstrap.mjs ./docker/sect-schema-bootstrap.mjs
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./docker/entrypoint.sh
COPY --from=builder --chown=nextjs:nodejs /app/docker/four-realms-apply.mjs ./docker/four-realms-apply.mjs

RUN chmod +x ./docker/entrypoint.sh
RUN node --input-type=module -e "await import('@msgpack/msgpack')"

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV WEB_RUNTIME_PORT=3000
ENV REALTIME_RUNTIME_PORT=3101
ENV REALTIME_RUNTIME_ENABLED=1
ENV REALTIME_RUNTIME_HOST="127.0.0.1"
ENV MAP_AOI_TILE_SIZE=12
ENV MAP_AOI_PRELOAD_RINGS=1
ENV MAP_CONNECTION_REPAIR_WINDOW=32
ENV MAP_CONNECTION_REPAIR_MAX_GAP=16
ENV MAP_SCENE_TICK_WATCH_INTERVAL_MS=1500
ENV MAP_SCENE_TICK_WATCH_ACTIVE_INTERVAL_MS=400
ENV MAP_SCENE_TICK_WATCH_ACTIVE_WINDOW_MS=8000
ENV MAP_WATCHER_TRIGGER_GAP_TICKS=3
ENV MAP_WATCHER_TRIGGER_IDLE_MS=1200
ENV MAP_SELF_MOVE_VISION_REFRESH_INTERVAL_MS=240
ENV MAP_SCENE_SHARED_STATE_PROACTIVE_MAX_CONCURRENCY=2
ENV MAP_SCENE_CONTEXT_CACHE_TTL_MS=2000
ENV MAP_PANEL_READ_MODEL_CACHE_TTL_MS=8000
ENV MAP_PANEL_READ_MODEL_CACHE_STALE_MS=60000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.WEB_RUNTIME_PORT || process.env.PORT || 3000) + '/api/system/health').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["./docker/entrypoint.sh"]

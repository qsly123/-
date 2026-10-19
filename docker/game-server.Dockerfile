# ---- game-server dependencies ----
FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/game-server/package.json ./apps/game-server/package.json
COPY packages/shared-protocol/package.json ./packages/shared-protocol/package.json
COPY packages/game-rules/package.json ./packages/game-rules/package.json
COPY packages/db/package.json ./packages/db/package.json
RUN bun install --frozen-lockfile

# ---- game-server runtime ----
FROM oven/bun:1 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV GAME_SERVER_HOST=0.0.0.0
ENV GAME_SERVER_PORT=3201

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY apps/game-server ./apps/game-server
COPY packages ./packages
COPY src/db ./src/db
COPY src/modules ./src/modules

EXPOSE 3201

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD bun -e "fetch('http://127.0.0.1:' + (process.env.GAME_SERVER_PORT || 3201) + '/health').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "game:start"]

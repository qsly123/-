# Game Server

`apps/game-server` 是新的多人在线底座入口，使用 Colyseus 承载地图、秘境、战斗、Boss、PVP 与社交 presence 房间。

## 当前范围

本阶段只提供可启动骨架：

- `WorldMapRoom`
- `SecretRealmRoom`
- `CombatRoom`
- `BossRoom`
- `PvpRoom`
- `SocialRoom`
- `/health` 与 `/game-server/health`
- Redis presence / driver 可选启用
- Redis 启动前 PING 预检，避免 Redis 断开时静默假在线
- 官方 `@colyseus/sdk` 本地 join + repair smoke
- Redis 故障与多实例共享房间查询 smoke
- 阶段 10 基础连接、多地图多分片、地图移动、弱网 repair、断线重连、普通战斗 command、Boss command、PVP command、settlement intent SDK 压测脚本

业务迁移仍按 `docs/current/rewrite-multiplayer-core-plan.md` 后续阶段推进。

## WebSocket transport 约束

当前入口使用 `src/colyseus-same-core-websocket-transport.ts`，不要直接替换成顶层 `@colyseus/ws-transport`。

原因是当前 Bun 安装树里曾出现 `colyseus` 与 `@colyseus/ws-transport` 加载两份不同 `@colyseus/core` 实例，导致 HTTP matchmaking 成功但 WS 消费 seat reservation 时读不到同一个本地房间表，官方 SDK 报 `seat reservation expired`。

如果后续升级依赖并想回到官方 transport，必须先用 `bun run game:smoke` 验证官方 SDK 能 join `WorldMapRoom`、发送 `repair`，并收到 ACK 与 `sector_snapshot`。

## 命令

- `bun run game:dev`
- `bun run game:start`
- `bun run game:smoke`
- `bun run game:smoke:redis-failure`
- `bun run game:smoke:redis-multi`
- `bun run game:load:basic`
- `bun run game:load:map-shards`
- `bun run game:load:map-move`
- `bun run game:load:repair`
- `bun run game:load:reconnect`
- `bun run game:load:combat-command`
- `bun run game:load:boss-command`
- `bun run game:load:pvp-command`
- `bun run game:load:settlement-intent`
- `bun run game:load:stage10-local`
- `bun run game:load:stage10-scale-local`

`game:load:reconnect` 使用 `1001 Going Away` 关闭底层连接触发服务端 reconnect grace，再用 SDK `client.reconnect(token)` 重连。它是协议层压测，不替代 iOS Safari、Android Chrome、PC 浏览器真实前后台恢复验收。

`game:load:combat-command` 每个虚拟战斗创建 2 个 SDK 客户端，先移动到命中范围，再压普通 `CombatRoom` 的 `basicAttack` ACK。它不替代 Boss / PVP 压测，也不验证 Postgres 结算落账。

普通 solo `CombatRoom` 的 `clientSceneTick` 校验只用于拦截明显未来帧或长时间未同步的输入；怪物 AI 和场景移动会在玩家未操作时推进 pending combat `sceneSnapshot.tick`，所以不能用几帧级窗口拒绝攻击。`bun run game:smoke` 已覆盖“客户端使用稍旧 ACK tick，服务端 scene tick 已继续推进后仍能出手”的回归。

`game:load:boss-command` 每个虚拟 Boss 房间默认创建 20 个 SDK 客户端，先移动到命中范围，再压 `BossRoom` 的多人 `basicAttack` ACK。当前目标暂用同房间玩家实体，不验证真实 Boss runtime、奖励、掉落或 Postgres 结算幂等。

`game:load:pvp-command` 每个虚拟 PVP 房间创建 2 个 SDK 客户端，先移动双方到命中范围，再压 `PvpRoom` 的双向 `basicAttack` ACK。它只验证 PVP command ACK 骨架，不验证旧 PVP replay 主流程、匹配、排名、结算或掉线裁定。

`game:load:settlement-intent` 每个虚拟房间创建 2 个 SDK 客户端，重复发送 `surrender` command，验证同一房间同一败者生成的 `settlementIntent.idempotencyKey` 保持稳定。它只验证 intent 幂等键，不验证 Postgres 奖励、掉落、任务推进或死亡惩罚落账。

`game:load:stage10-local` 串行运行本地单进程阶段 10 基线：100 同图连接、Boss 20 人、PVP 8 房间。该命令会分别使用 `GAME_LOAD_LOCAL_PORT=3301 / 3302 / 3303` 启动本地 game-server，避免多个压测场景抢占默认 `3201`。它不替代线上 Redis 多实例、真实 Postgres、真实 Boss / PVP 主流程和 H5 浏览器压测。

`game:load:map-shards` 会把虚拟客户端分布到多个 `mapId + shardId`，全部 join + repair 成功后保持在线并读取 health，再统一离开。它用于验证 Colyseus 多地图、多分片和多 `WorldMapRoom` 在线指标。

`game:load:stage10-scale-local` 串行运行本地单进程 scale 基线：300 多图、500 多房间、1000 连接。2026-07-08 本地结果为 300/300、500/500、1000/1000 join + repair 成功；1000 场景创建 100 个 `WorldMapRoom`。它不替代线上 Redis 多实例、真实 Postgres 或 H5 浏览器压测。

`game:smoke:redis-failure` 会对一个不可达 Redis 地址执行预检，要求返回明确 `game_server_redis_unavailable`。配置了 `REDIS_URL` 的 game-server 在 `listen()` 前也会执行同一类 PING 预检，Redis 不可用时不会启动健康假在线实例。

`game:smoke:redis-multi` 需要先提供真实 `REDIS_URL`。脚本会拉起两个不同端口的 game-server 子进程，共用 Redis Presence / Redis Driver，通过实例 A 创建房间，再从实例 B `joinById` 同一个房间，并用 RedisDriver 查询 `roomcaches`。本命令用于验证多实例房间查询一致性，不替代 100/300/500/1000 连接压测。

## 环境变量

- `GAME_SERVER_HOST`，默认 `0.0.0.0`
- `GAME_SERVER_PORT`，默认 `3201`
- `GAME_SERVER_PUBLIC_ADDRESS`，反向代理或多实例部署时必须显式配置为浏览器可访问的公网 host:port，例如 `mrsj.ren:3201`。不要填写 Docker 内网 IP，也不要依赖容器 `172.18.0.x` 尾号顺位；镜像不再内置该默认值，未配置时由 Colyseus 按请求入口推导。
- `REDIS_URL`，配置后启用 Redis Presence 与 Redis Driver
- `GAME_SERVER_PROCESS_ID`，默认当前进程 ID
- `GAME_SERVER_AUTH_MODE`，`required` / `optional` / `disabled`，生产默认 `required`，开发默认 `optional`
- `GAME_LOAD_LOCAL_PORT`，未设置 `GAME_LOAD_TARGET_URL` 时，本地压测临时 game-server 使用的端口，默认跟随 `GAME_SERVER_PORT`
- `GAME_LOAD_SUPPRESS_DEGRADED_WARNINGS=1`，仅用于本地压测时隐藏无数据库 fallback 的重复降级日志

## 鉴权

`BaseGameRoom` 已接入 Colyseus `onAuth`：

- 优先读取 join options 的 `sessionToken` / `playerId`
- 其次读取 `AuthContext.token`
- 再从 cookie header 读取 `immortality_session` 与 `immortality_active_player`

生产环境默认必须通过现有账号会话和当前角色校验。开发环境默认 optional，缺少 cookie 时使用 client session id 作为临时玩家 id，方便本地 smoke 不依赖数据库。

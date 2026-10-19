# 后台、运维与部署

## 后台职责

后台不仅是 CRUD，而是当前项目的运营与治理中枢，覆盖：

- 通用实体管理
- AI 物品分栏与清理
- 地图、怪物、任务、技能、物品、系统配置编辑
- 核心玩法固定后台配置
- 开放世界总控与预览
- 运行时性能分析与健康查看
- 实时房间监控：`/admin/game-server`

## 关键后台口径

### 物品管理

- `物品管理`
  - 只管理正式物品
- `AI物品`
  - 专门管理 `secret_realm / ai_smithing / ai_alchemy` 及兼容历史 AI 物品

### 地图与秘境

- 地图编辑要兼容传送阵、地块 ICON、运行时地图类型
- 秘境相关后台重点是模板、入口刷新、运行态清理、掉落预览

### 系统配置

所有全局规则优先走 `system_configs`：

- LLM 模型与提示词
- 登录开关
- 地图/PVP 开关
- 开局参数
- 开放世界关键词池和 AI 配置
- 核心玩法配置项

## 上传与资源目录

当前部署需要明确这几类路径：

- 上传资源宿主机目录
  - `/opt/1panel/docker/compose/lingxu/uploads`
- 容器公开目录
  - `/app/public/uploads`
- 历史插件数据目录，仅用于迁移期排查，不再作为上传入口
  - `/opt/1panel/docker/compose/lingxu/data`
- 容器历史插件数据目录，仅用于只读兼容或迁移脚本
  - `/app/data`

出现“图明明存在但读不到”时，优先排查挂载路径与 `upload-storage` 选择结果。

## 容器升级要求

- 旧库升级必须允许 schema 自举补列、补索引、补基础表
- 历史插件玩法数据不能因为升级被强制抹掉；双修、功法、灵田、论道、炼丹、炼器都应按核心模块规则迁移或只读兼容
- 运行时部署当前仍保留 `web-runtime` 与 `realtime-runtime` 双进程；其中 `realtime-runtime` 已收缩为旧 realtime health stub，不再承载旧地图 / combat / Boss 同步。
- 健康检查接口必须可直接探活，不应被登录态拦截
- 地图 realtime 相关默认环境当前已经内置镜像，不应再只依赖 1Panel 手填保存
- 独立 game-server 健康检查走 `/game-server/health`，后台通过 `/api/admin/game-server/health` 代理读取。Web 容器内优先配置 `GAME_SERVER_INTERNAL_URL=http://game-server:3201`；1Panel 当前容器名为 `immortality-game-server`，因此线上使用 `GAME_SERVER_INTERNAL_URL=http://immortality-game-server:3201`。本地单进程开发才回退到 `http://127.0.0.1:${GAME_SERVER_PORT || 3201}/game-server/health`。
- GitHub Actions 需要同时推送两个 GHCR 镜像：
  - Web：`ghcr.io/sakurazuk/immortality:<tag>`
  - game-server：`ghcr.io/sakurazuk/immortality-game-server:<tag>`
- GitHub Actions 当前先执行 `quality-gates`，再执行镜像构建：
  - `bun install --frozen-lockfile`
  - `bunx tsc --noEmit`
  - `bun run lint`
  - `bun run game:smoke`
  - PR 额外跑 `bun run build`，但不推送 GHCR 镜像。
  - push 到 `main`、tag `v*` 或手动触发时，质量门禁通过后才构建并推送 Web / game-server 双镜像；Web build 只在 Dockerfile 内执行一次，避免 quality-gates 和 Docker build 重复编译导致主分支发布耗时翻倍。
- GitHub Actions 镜像名固定使用小写 `sakurazuk/immortality` 与 `sakurazuk/immortality-game-server`。1Panel 拉取独立 game-server 时必须使用 `ghcr.io/sakurazuk/immortality-game-server:<tag>`，不要写成 Web 镜像名、仓库名大写形式或本地临时镜像名。
- `docker/compose.multiplayer.yml` 已给 `web` 和 `game-server` 写入明确镜像：
  - `WEB_IMAGE` 默认 `ghcr.io/sakurazuk/immortality:latest`
  - `GAME_SERVER_IMAGE` 默认 `ghcr.io/sakurazuk/immortality-game-server:latest`
  - 线上指定版本时优先设置这两个环境变量为同一个 commit SHA tag，避免 Web 和 game-server 版本错位。
- 独立 `game-server` 的 `GAME_SERVER_PUBLIC_ADDRESS` 必须是浏览器可访问的公网 host:port。线上当前使用 `mrsj.ren:3201`；不要把 `172.*` Docker 内网地址作为正式公网 reservation 返回给 H5，否则 Colyseus matchmake 成功后浏览器会连接不到房间并出现 4002。镜像和 compose 不再提供 `172.18.0.x` 默认值，部署时必须由环境变量或同域反代入口明确决定。
- 如果启用 Redis Driver / Presence，多实例必须全部能被同一套反代或实例路由访问。临时 smoke / 压测 game-server 不允许共用线上 Redis 后长期存活，否则 matchmake 可能把 seat reservation 分配到未被 OpenResty 路由的实例，主实例消费时会报 `seat reservation expired`。
- 1Panel / Docker Compose 正式部署时应直接拉取上述两个镜像。服务器本地临时构建或从 Web 镜像派生 game-server 只能作为排障兜底，不应作为长期上线流程。
- 2026-07-08 已验证 1Panel / OpenResty 下独立 game-server 反代：
  - `https://mrsj.ren:3201/game-server/health` 返回健康 JSON。
  - `https://mrsj.ren:3201/colyseus` WebSocket Upgrade 返回 `101 Switching Protocols`。
  - 该验证只证明代理 upgrade 可用，不代表阶段 10 大连接压测完成。

### Docker workspace 构建注意

根 `Dockerfile` 的依赖层使用 `bun install --frozen-lockfile`。项目已经是 Bun workspace，依赖层必须在执行安装前复制这些 workspace 清单：

- `apps/game-server/package.json`
- `packages/shared-protocol/package.json`
- `packages/game-rules/package.json`
- `packages/db/package.json`

如果只复制根 `package.json` 与 `bun.lock`，Bun 会在容器里看不到 workspace 子包，进而判断 lockfile 需要变化并报错：`lockfile had changes, but lockfile is frozen`。这时不要去掉 `--frozen-lockfile`，应先确认 Dockerfile 的 workspace package 清单复制完整。

`docker/game-server.Dockerfile` 的运行层除 `apps/game-server`、`packages`、`src/db` 外，也必须复制 `src/modules`。阶段 6 之后 Colyseus 战斗房间会读取核心战斗 runtime、Boss、PVP、地图与世界等模块服务；如果缺少 `src/modules`，game-server 会在启动时因 `Cannot find module '../../../src/modules/...'` 崩溃并进入 restart 循环。

runner 阶段也不能只从 deps 里挑单个包目录复制。Bun 的 `node_modules` 入口大量是指向 `node_modules/.bun` 的链接，例如 `node_modules/@msgpack/msgpack` 会指向 `.bun/@msgpack+msgpack@...`。如果只复制 `node_modules/@msgpack`、`node_modules/postgres` 等入口目录，Node 运行时会遇到断链并报 `ERR_MODULE_NOT_FOUND`。当前根 `Dockerfile` 选择复制完整 `/app/node_modules` 到 runner，优先保证运行期迁移脚本、`server.mjs` 与 realtime codec 的依赖完整。

当前内置关键项包括：

- `MAP_SCENE_CONTEXT_CACHE_TTL_MS=2000`
- `MAP_PANEL_READ_MODEL_CACHE_TTL_MS=8000`
- `MAP_PANEL_READ_MODEL_CACHE_STALE_MS=60000`

当前地图链路还内置了两条默认行为，运维排查时需要一并考虑：

- 结构性 `silent refresh` 会主动 `force` 绕过短 TTL scene context cache
- 机缘/秘境/地图结构刷新会主动失效同地图的 full 面板读模型缓存

## 性能与稳定性重点

当前运维重点不是单纯 CPU，而是：

- game-server 房间在线人数、tick 耗时、消息量和 repair 触发率
- Colyseus 房间主链是否稳定，旧地图 / combat / Boss realtime 不应再混入主链。
- `realtime-runtime` 只作为内部健康探活兼容壳观察，不再作为地图 / 战斗性能主指标。
- Colyseus 房间创建、join/leave、repair、移动拒绝原因和 Redis 健康状态
- Redis 启动预检：配置 `REDIS_URL` 后，game-server 会在 `listen()` 前执行 Redis PING，失败时明确报 `game_server_redis_unavailable`，不启动假健康实例
- Redis 运行期健康：`/game-server/health` 每次探测会返回 `redis.enabled / status / latencyMs / checkedAt / error`，后台可直接看到 PING 延迟和错误原因
- WebSocket transport 计数：upgrade 请求、成功连接、连接失败、客户端 socket error、心跳超时终止、空握手 fallback、握手超时、重连失败、进房失败和错误原因分布
- DB 落账失败统计：地图移动、地图交互、地图传送、战斗 settlement flush、PVP 断线裁定和 Boss 核心事务失败统一看 `persistFailures / persistFailuresByReason`
- `SocialRoom` 观察在线人数、消息量、repair 和拒绝原因；聊天持久化、组队事务仍看旧核心 API

### game-server 实时房间监控

`/admin/game-server` 当前展示：

- 展示 game-server 在线状态、探测延迟、进程、协议版本、Redis 正常 / 异常 / 未启用状态、PING 延迟和错误原因。
- 展示注册房间类型、活跃房间实例、每房间人数、tick 耗时、消息量、repair、地图分片状态、Boss / PVP 房间状态与累计 metrics。
- 展示房间级断线重连成功率、协议拒绝数、移动拒绝原因、DB 落账失败数和失败原因。
- 展示 WebSocket fallback / error 细分：空握手 fallback、握手超时、重连失败、进房失败、心跳超时、客户端 error 和错误原因分布。
- 展示 `processes[]` 进程聚合表；当前单进程也返回自身，为 Redis 多实例部署后的跨进程聚合保留统一结构。
- 展示 `SocialRoom` 状态表：在线人数、峰值在线、消息量、repair、拒绝次数和拒绝原因。

当前边界：

- Redis ping / latency / error 已接入；Redis 持久化、内存限制和告警仍属于上线环境检查。
- WebSocket upgrade 已完成 1Panel 反代人工验证；game-server 已输出 transport 细分计数，但代理层截图或日志仍应在每次正式部署后留档。
- 数据库热点查询
- AI 唯一物品增长速度
- AI 物品自动清理是否生效

### 线上 smoke 与反代留档样例

Redis 多实例 smoke 使用线上真实 `REDIS_URL` 执行：

```bash
REDIS_URL=redis://:<password>@<redis-host>:6379 bun run game:smoke:redis-multi
```

留档输出至少包含：

```text
[game:smoke:redis-multi] redis driver ok
[game:smoke:redis-multi] process-a room created
[game:smoke:redis-multi] process-b joinById ok
[game:smoke:redis-multi] shared room query ok
```

WebSocket 反代验证留档至少包含 health 与 Upgrade 两类日志：

```bash
curl -i https://<domain>:3201/game-server/health
```

```text
HTTP/2 200
content-type: application/json; charset=utf-8
{"ok":true,"service":"game-server","processes":[...],"metrics":{...}}
```

```text
GET /colyseus HTTP/1.1
Connection: Upgrade
Upgrade: websocket
HTTP/1.1 101 Switching Protocols
```

如果线上使用 1Panel / OpenResty，只要代理规则、证书或容器网络变化，就要重新保存上述输出或截图。`/game-server/health` 只能证明 HTTP 反代正常，`101 Switching Protocols` 才证明 WebSocket Upgrade 正常。

### 2026-07-09 线上 P0-A 留档

采集时间：`2026-07-09T14:47:41+08:00`。

当前线上容器：

- Web：`ghcr.io/sakurazuk/immortality:latest`
  - image id：`sha256:bab2be010f7803f7367ea151bc25c769c87a681ebc200315d3721cb4f1c23794`
  - revision：`cb814e885e075fc9d1d55f62a0d7b1c0552902d5`
  - image created：`2026-07-08T14:42:53.220Z`
- game-server：`ghcr.io/sakurazuk/immortality-game-server:latest`
  - image id：`sha256:ef75f10b1efece724b97614de87e2b2c8443359cb4b3c89ba45cb536ad94711c`
  - revision：`bf810eec4a780c644ec52484ab6ba7721a657d5e`
  - image created：`2026-07-09T06:08:59.631Z`
- Redis：`redis:7.4-alpine`，容器健康。
- PostgreSQL：`postgres:17`，容器运行中。
- OpenResty：`1panel/openresty:1.27.1.2-5-1-focal`，容器运行中。

当前 Compose 文件：

- `/opt/1panel/docker/compose/lingxu/docker-compose.yml`
- `/opt/1panel/docker/compose/lingxu/docker-compose.override.yml`

当前 game-server 关键部署口径：

- `GAME_SERVER_PUBLIC_ADDRESS=mrsj.ren:3201`
- OpenResty `mrsj.ren:3201` 代理到宿主机本地上游 `http://127.0.0.1:3202`，game-server 容器通过 `127.0.0.1:3202->3201` 映射提供服务。不要再把 OpenResty upstream 写成 `172.18.0.x:3201`，避免容器重建后 IP 漂移导致 502。
- `immortality-game-server-smoke` 已停止，避免共用线上 Redis 参与 matchmake。

Redis 持久化与内存限制：

- `appendonly yes`
- `appendfilename appendonly.aof`
- `save 60 1000`
- `maxmemory 268435456`，即 256MB。
- `maxmemory-policy allkeys-lru`
- `tcp-keepalive 60`
- Redis 运行期状态：`redis_version=7.4.9`，`aof_enabled=1`，`aof_last_write_status=ok`，`aof_last_bgrewrite_status=ok`，`rdb_last_bgsave_status=ok`。

线上 `game-server` health 样例：

```text
ok=true
processId=lingxu-game-server-1
roomInstancesTotal=2
redis.status=ok
redis.latencyMs=2
metrics.joins=7
metrics.onlineConnections=2
metrics.websocketUpgradeRequests=8
metrics.websocketConnections=8
metrics.websocketRoomConnectFailures=1
```

线上 Redis 多实例 smoke 输出：

```json
{
  "ok": true,
  "scenario": "redis_multi_instance_room_query",
  "portA": 3211,
  "portB": 3212,
  "roomId": "ebc-qUIQU",
  "queriedRooms": 2
}
```

本次 smoke 中 `mapId=redis-multi-smoke-*` 不存在，因此 `WorldMapRoom map data degraded(reason=map_not_found)` 是预期降级，不影响 RedisDriver 查询与跨实例 `joinById` 验证结论。脚本结束后两个临时子进程已收到 SIGTERM。

WebSocket 反代留档：

```text
GET /SN1WNFuR5/NHrlSYWq_?sessionId=Ak3n2s-gW HTTP/1.1" 101
GET /SN1WNFuR5/NHrlSYWq_?sessionId=GY3utZNby HTTP/1.1" 101
GET /SN1WNFuR5/Jx8lXNxRu?sessionId=YTsxbwzaV HTTP/1.1" 101
GET /SN1WNFuR5/cUmdefmQN?sessionId=wNXMyBFr8 HTTP/1.1" 101
GET /game-server/health HTTP/1.1" 200
```

备份与磁盘记录：

- 当前 PostgreSQL 数据库 `lingxu` 约 `4409 MB`。
- 本轮先移除已停止的 `immortality-game-server-smoke` 容器、本地旧 `immortality-game-server:latest` 镜像和 dangling image；未触碰正在运行的 Web / game-server / Redis / PostgreSQL / OpenResty。
- 清理后根分区 `/dev/vda1`：40GB 总量，约 29GB 已用，约 9.6GB 可用，使用率 75%。
- 已生成 PostgreSQL custom 格式压缩备份：
  - `/opt/1panel/backup/database/lingxu/2026-07-09/lingxu-20260709T065956Z.dump`
  - 大小：445MB。
  - `pg_restore -l` manifest：`/opt/1panel/backup/database/lingxu/2026-07-09/lingxu-20260709T065956Z.dump.manifest.txt`
  - manifest 头部显示：`dbname: lingxu`、`TOC Entries: 1216`、`Compression: gzip`。
  - sha256：`ecc9f30ff025cb0e9f99f39f2d2969fe89a91cc1934246c563c94e48cfcafd7c`。
- 当前备份位于同机磁盘，只满足阶段 P0-A 备份点留档。正式上线前仍建议额外复制到异机或对象存储，避免单机磁盘故障同时损失数据库和备份。

### 功法历史数据事务排查口径

如果看到 PostgreSQL 中出现 `plugin_gongfa_player_points`、`FOR UPDATE`、`idle in transaction` 一类迹象，先按下面口径排查：

1. 确认容器是否已经升级到移除功法全局定时结算与资料页自动结算的版本
2. 确认当前功法点只在 `claim / upgrade / hangup/settle` 这些显式入口触发
3. 如果仍有热点，再继续看是否是其他业务事务长期占着连接，误把功法事务一起放大

插件体系已退役。功法历史表只作为迁移期数据来源或兼容数据看待，后续新增功法能力必须进入核心数据驱动系统，不再恢复插件事务链。

### 后台业务调度器口径

不要把所有 `setInterval` 都混成一个问题。当前按用途分三类处理：

- 实时基础设施计时器：房间 tick、连接心跳、Colyseus repair、AOI 刷新、snapshot flush、运行时缓存 prune。这些绑定连接或房间生命周期，不强行并入业务调度器。
- 后台业务任务：周期结算、周期同步、周期清理、周期巡检。这类任务应收口到共享后台调度器，方便命名、停止和排障。
- 时间差结算：功法点、挂机点、成长点优先用 `last_settle_at` 一类时间戳按需结算，不依赖页面停留、全局定时器或插件任务。

### 地图性能面板观察口径

当前优先看 Colyseus / game-server 指标：

- `/admin/game-server` 的地图分片状态、在线人数、tick 耗时、消息量、repair 次数、移动拒绝原因。
- `/game-server/health` 的进程级 runtime metrics。
- 低频面板仍看 `map-panel:*` 读模型缓存命中率。

旧 `map hub / watcher / AOI` 指标只作为旧镜像或历史归档排查项。如果容器升级后仍然表现为：

- Realtime CPU 高
- `activePollChecks` 仍然异常高
- `deliveryHitRate` 仍然低

优先确认线上是否仍运行旧镜像、旧容器或旧反代配置；当前 H5 地图页不应再消费旧地图 SSE / WS。

### 地图实体显示问题排查

如果用户反馈“NPC/怪物正常，但其他玩家要更近才出现”或“可见区域实体晚一拍出现”，优先检查：

1. `filterMapSceneStateByVision(...)` 是否仍是统一口径
2. `MapGrid` 的浅雾实体过滤是否和服务端一致
3. AOI 订阅扇区变化后是否及时重绑
4. 结构事件后是否触发了缓存失效与强制 reload

## 排查顺序建议

### 地图不同步

1. 看 runtime 健康
2. 看 `/admin/game-server` 的地图分片、tick、消息量、repair 和移动拒绝原因
3. 看 Colyseus 是否断线、delta 是否断层、repair 是否返回 `sector_snapshot`
4. 如果确认仍是旧镜像或回滚模式，再看旧 map hub / watcher / AOI 指标和 WS/SSE 是否退化

### 战斗异常

1. 看 battle runtime 是否正确关闭
2. 看 settlement 和 claim 是否幂等
3. 看 Boss/组队是否走了统一命令返回

### AI 图标与历史内容缺失

1. 看上传根目录
2. 看历史内容是否已经迁入核心数据或仍停在 legacy 表
3. 看物品来源字段与图标目录是否符合专属规则

## 文档维护要求

- 新后台功能、新运维链路、新部署规则完成后，必须更新本文件
- 若只是临时排障记录，不再继续往 `docs/` 根目录追加日期文档，而是整合后归档历史记录

# 波次验收与 BotClient 断言索引

本目录存放本轮按 `REWRITE_PLAN_CHECKLIST.md` 波次执行的真机验收清单。
每个系统一份清单 + 一份可执行的 BotClient 断言脚本。

## 一、波次与系统映射

| 波次 | 系统 | checklist 条目 | 验收清单 | BotClient 脚本 |
| --- | --- | --- | --- | --- |
| 波次 1 | 系统A | P1-B：技能 / 丹药 / 逃跑 / 认输 / 移动统一 command 三端验收 | [`system-a-combat-command.md`](./system-a-combat-command.md) | `apps/game-server/src/bot/system-a-refresh-e2e.ts`（端到端，无 DB）+ `apps/game-server/src/bot/system-a-combat-refresh.ts`（房间级，需 DB） |
| 波次 2 | 系统B | P2-A：附近频道 `SocialRoom` 与旧聊天持久化 API 边界，不重复刷屏 | [`system-b-nearby-chat.md`](./system-b-nearby-chat.md) | `apps/game-server/src/bot/system-b-nearby-chat.ts` |
| 波次 2 | 系统C | P2-A：宗门驻地 / 成员 presence 三端验收 | [`system-c-sect-presence.md`](./system-c-sect-presence.md) | `apps/game-server/src/bot/system-c-sect-presence.ts` |
| 波次 3 | 系统D | P2-B：离线页 / iOS repair / PC 纵屏 | [`system-d-offline-repair-layout.md`](./system-d-offline-repair-layout.md) | `apps/game-server/src/bot/system-d-offline-repair.ts` |

## 二、统一契约：状态变更推送帧组

客户端是**纯渲染端**。任何资产 / 背包 / 进度的入库变更，服务端必须下发对应刷新帧，
**禁止只回 ACK 不推帧**——不推等于界面停在旧值。

### 官样组序注册表

定义于 `packages/shared-protocol/src/opcode.ts`，与字符串帧类型双向一一映射。

| opcode | 帧类型 | 含义 |
| --- | --- | --- |
| 10001 | `scene_snapshot` | 战斗场景全量快照 |
| 10002 | `sector_snapshot` | 地图 AOI 扇区快照 |
| 10003 | `sector_delta` | 地图 AOI 扇区增量 |
| 10004 | `entity_enter` | 实体进入 |
| 10005 | `entity_leave` | 实体离开 |
| 10006 | `correction` | 位置纠偏 |
| 10007 | `state_correction` | 状态纠偏 |
| 10008 | `repair` | 重连补齐 |
| 10101 | `timeline_event` | 战斗时间线事件 |
| 10102 | `damage_event` | 伤害事件 |
| 10103 | `settlement` | 结算 |
| 10201 | `social_snapshot` | 社交全量快照 |
| 10202 | `social_event` | 社交事件（presence 进出等） |
| **10302** | `inventory_refresh` | **背包刷新（强制推送）** |
| **10510** | `asset_refresh` | **资产刷新（强制推送）** |
| **12742** | `progress_refresh` | **进度刷新（强制推送）** |
| 10301 / 10501 / 12701 | `*_snapshot` | 对应域全量快照 |
| 10999 | `error` | 错误帧 |

### 关键实现

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 协议 | `packages/shared-protocol/src/opcode.ts` | 组序表、双向映射、帧组构造 `createStateRefreshFrameGroup` |
| 投递注册表 | `apps/game-server/src/state-refresh-registry.ts` | 玩家所有在线连接（`base-room` onJoin/onLeave 自动注册） |
| game-server 推送 | `apps/game-server/src/state-refresh.ts` | `pushStateRefresh(...)` 房间内落账后立即下发 |
| 内部端点 | `apps/game-server/src/state-refresh-endpoint.ts` | `POST /internal/state-refresh`，多实例经 presence 广播 |
| Next 侧推送 | `src/modules/shared/services/state-refresh-push.ts` | 内部端点投递 + **帧组回传 HTTP 响应**兜底 |
| 客户端订阅 | `src/modules/shared/ui/hooks/useStateRefreshFrames.ts` | `useStateRefreshFrames(room)`、join 前预注册 handler、响应帧消费 |

## 三、如何跑 BotClient 断言

```bash
bun run apps/game-server/src/bot/system-a-refresh-e2e.ts        # 端到端，无需 DB
bun run apps/game-server/src/bot/system-a-combat-refresh.ts     # 房间级，需 DB
bun run apps/game-server/src/bot/system-b-nearby-chat.ts
bun run apps/game-server/src/bot/system-c-sect-presence.ts
bun run apps/game-server/src/bot/system-d-offline-repair.ts
```

脚本自带离线房间与在线 game-server 两种模式，无需外部 DB / Redis 即可运行；
需要真实 DB 事务的场景会显式标记 `SKIP` 并说明原因。

## 四、推送帧门禁

```bash
bun run scripts/audit-state-refresh-push.ts           # 报告
bun run scripts/audit-state-refresh-push.ts --strict  # 有错非零退出
```

校检内容：

1. 每个帧类型都登记了 opcode（漏登记会导致客户端按号解析为 null）。
2. opcode 无重复、双向映射自洽。
3. 三个强制刷新帧（10302 / 10510 / 12742）已登记且帧组生成完整。
4. 全仓库存在实际的 `pushStateRefresh*` 调用点（防止「只定义不推送」）。

## 五、维护要求

- 新增帧类型必须**同时**登记 opcode，否则门禁报错。
- 新增资产 / 背包 / 进度写入路径，必须在该事务成功后调用推送，不允许只回 ACK。
- 真机验收完成后，回到 `REWRITE_PLAN_CHECKLIST.md` 勾选对应条目并注明日期。

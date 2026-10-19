# 离线恢复 / 自动 repair / PC 纵屏布局真机验收清单（P2-B）

> 对应 `REWRITE_PLAN_CHECKLIST.md` → P2-B「H5 三端体验和离线细节」：
>
> 1. 断网进入 `/game/*` 时离线页不贴边、不遮挡；
> 2. iOS 锁屏 / 前后台恢复后，地图、战斗、聊天 presence 都能自动 repair，不显示假在线；
> 3. PC 端继续保持纵屏游戏布局，不退化成横向后台面板。

---

## 一、改动链路总览（验收前必读）

### 1. 离线页

| 文件 | 作用 |
| --- | --- |
| `public/offline.html` | 断网 / SW 预缓存不可用时进入 `/game/*` 的落地页 |
| `public/sw.js` | scope `/game/`，`navigate` 请求失败时回退 `/offline.html` |

离线页约束（本次重写）：

- 内容壳宽度 `min(420px, calc(100% - 40px))`，**永远不贴边**；
- 四周留白统一走 `--safe-top / --safe-right / --safe-bottom / --safe-left`，
  取值 `max(20px, env(safe-area-inset-*, 0px))`，**兼容刘海 / 手势条 / 灵动岛**；
- 主卡片 `overflow: hidden` + `overflow-wrap: anywhere`，长文案不会撑破卡片；
- 联网恢复后自动重试（`online` / `pageshow(persisted)` / `visibilitychange(visible)`），
  玩家不需要手动刷新；
- 文案为游戏内状态描述，不出现服务端 / 接口 / 同步 / ACK 等实现层词汇。

### 2. 自动 repair

| 文件 | 作用 |
| --- | --- |
| `src/modules/shared/ui/hooks/useForegroundRepairTrigger.ts` | **新增**：三端统一的前后台恢复触发器 |
| `src/modules/map/ui/hooks/useWorldMapColyseusAoi.ts` | 地图：改用 shared hook，保留退避 rejoin |
| `src/modules/combat/ui/hooks/useCombatColyseusRoom.ts` | 战斗：`sendRepair(trigger, reason)` 支持传入 trigger |
| `src/modules/combat/ui/hooks/useCombatSceneController.ts` | 战斗 / Boss：前台恢复 → HTTP 权威快照 + Colyseus repair |
| `src/modules/combat/ui/hooks/usePvpBattleSceneController.ts` | PVP：同上 |
| `src/modules/social/ui/hooks/useSocialRoomPresence.ts` | 聊天 presence：前台恢复自动 repair + 暴露 `presenceStale` |
| `apps/game-server/src/player-refresh-digest.ts` | **新增**：待补刷新帧摘要（带 version，幂等） |
| `apps/game-server/src/repair-refresh-bridge.ts` | **新增**：房间 repair ↔ 刷新帧摘要桥接层 |
| `apps/game-server/src/rooms/world-map-room.ts` | repair 补齐后下发刷新帧 + 摘掉死连接投递目标 |
| `apps/game-server/src/rooms/social-room.ts` | 同上 |
| `apps/game-server/src/rooms/combat-realtime-room.ts` | 同上 |

触发原因约定（`REALTIME_REPAIR_TRIGGERS`，取自 `shared-protocol`）：

| 触发源 | trigger | 说明 |
| --- | --- | --- |
| `visibilitychange` → visible | `visibility_restore` | iOS 锁屏解锁 / 切回标签页 |
| `focus` / `pageshow` | `foreground_restore` | App 回到前台（含 bfcache 恢复） |
| `online` 事件 | `reconnect` | 断网恢复 |
| 加入房间首帧 | `initial_join` | 原有逻辑，不变 |
| 手动点「同步」 | `manual` | **不占用补齐通道**，不发刷新帧 |

三条链路共用同一个 shared hook，内部已把
`visibilitychange / pageshow / focus` 合并成一次 repair（去重窗口 800ms），
**不写任何 iOS / Android 平台分支**。

### 3. refresh 帧补齐（禁止只回 ACK）

- 事务落账侧：`WorldMapRoom` 的 interact / travel、
  `CombatRealtimeRoom` 的结算持久化成功后调用 `recordPlayerRefreshDigest`
  挂一条摘要。
- repair 补齐侧：`flushRepairRefreshForClient` 只在
  `REPAIR_FLUSH_TRIGGERS` 命中时消费摘要，通过
  `pushStateRefresh` 向该玩家**所有在线连接**下发
  `10302(inventory_refresh)` / `10510(asset_refresh)` / `12742(progress_refresh)`。
- 幂等：摘要带单调递增 `version`，flush 成功后 `lastFlushedVersion` 前进、
  pending 被清空。**连续两次 repair 不会产生重复刷新帧**；
  只有发生新的入库变更才会再次下发。

### 4. PC 纵屏舞台

- `src/app/game/layout.tsx`：游戏壳 `maxWidth: GAME_PORTRAIT_STAGE_MAX_WIDTH`、
  `margin: 0 auto`、`height: var(--app-height, 100dvh)`。
- `src/modules/shared/ui/utils/cultivation-page-theme.ts`：**新增**
  `GAME_PORTRAIT_STAGE_MAX_WIDTH = 480`，作为纵屏舞台宽度的唯一来源。
- `src/modules/map/ui/pages/game/map/page.tsx`：宽屏（> 768px）走
  `repeat(auto-fit, minmax(156px, 1fr))`，窄屏走 `1fr 1fr`，
  均限制在 480px 舞台内，不横向铺满。

---

## 二、前置条件

1. 已部署包含本次改动的前端与 game-server；
   `NEXT_PUBLIC_GAME_SERVER_WS_URL` 指向可达的 game-server。
2. 账号 A（主验收账号）已登录，并在 `/game/map` 停留过至少一次，
   使 `public/sw.js` 完成安装并缓存 `/offline.html`。
3. 账号 B、C 用于聊天 presence 验收，需与 A 处于同一 `mapId` + `shardId`。
4. 调试通道：
   - iOS Safari：Mac Safari → 开发 → 设备 → 打开网页检查器；
   - Android Chrome：`chrome://inspect`；
   - PC：DevTools Console / Network。
5. 记录基线（联网状态）：
   - 地图页：能看到自身实体与附近实体；
   - 战斗页：进入 `/game/combat/[id]` 后能看到场景快照；
   - 聊天页「附近」页签：顶部标签显示 `同图 M`（M ≥ 2）。

---

## 三、可复现的断网触发方式

按"能否进入离线页"分三档，验收时**优先用方式 1**：

| # | 方式 | 操作 | 预期 |
| --- | --- | --- | --- |
| 1 | 系统级断网 | iOS：控制中心开飞行模式；Android：快捷设置开飞行模式；PC：DevTools → Network → Offline | SW 拦截 `/game/*` 导航，返回 `/offline.html`，**显示游戏风离线页** |
| 2 | 弱网 | DevTools → Network → Slow 3G | 页面不崩，地图 / 战斗退避重试后 repair 成功，不显示假在线 |
| 3 | 进程冻结（最贴近 iOS 锁屏） | 在 `/game/map` 或 `/game/combat/[id]` 直接锁屏，30s 后解锁 | 回前台自动 repair，**不显示假在线**（详见 C 组） |

> 注意：方式 1 只在 SW 已激活时生效。若玩家**首次访问且尚未装上 SW** 就断网，
> 浏览器会直接显示系统网络错误页 —— 这是 PWA 的固有限制，
> 不属于本次验收范围，但真机走查时需确认至少访问过一次联网页面。

---

## 四、验收项

### A 组：断网离线页观感（三端通用）

**A1. 断网后进入 `/game/*`**

前置：已完成前置条件 2（SW 已缓存 `/offline.html`）。

步骤：

1. 完全退出游戏页（杀掉 Safari / Chrome 标签页）。
2. 按"方式 1"开启飞行模式。
3. 重新打开浏览器，访问 `https://<域名>/game/map`（或 `/game/chat`、`/game/character`）。

预期：

- 进入游戏风离线页，标题为「暂时无法感应到此方天地」，
  副标题徽记「灵脉未通」。
- **不贴边**：卡片左右两侧始终留有 ≥ 20px 留白；
  有刘海 / 手势条的设备上留白 ≥ 安全区高度，`status bar`、`home indicator`
  不与卡片重叠。
- **不遮挡**：卡片内文案完整可见，不出现文字被裁切、被状态栏盖住、
  被手势条压住的情况；纵向不出现第二个元素压在卡片上。
- 纵向不出横向滚动条（`document.documentElement.scrollWidth <= clientWidth`）。
- 「尝试重新感应」按钮点击后：仍离线 → 状态文案变为
  「灵气通道仍未恢复，请稍后再试。」；不白屏、不跳转。

**A2. 联网恢复后自动回到游戏**

步骤：

1. 停在 A1 的离线页。
2. 关闭飞行模式，等待网络恢复。
3. 不做任何手动刷新操作。

预期：

- 页面自动重载并回到 `/game/map`（或原访问路径），不需要玩家手动刷新；
- 若浏览器在后台，`online` 事件与 `visibilitychange` 任一触发都会完成重试；
- 重载后地图状态为最新权威状态，不出现旧坐标残留。

**A3. 窄屏与 PC 纵屏下的离线页**

步骤：

1. 断网后访问 `/game/map`。
2. 分别在：iPhone SE 宽度（375px）、iPhone 15 Pro Max（430px）、
   Android 常见宽度（412px）、PC 浏览器窗口（1440px 宽 / 900px 高）下观察。

预期：

- 所有宽度下卡片都不贴边、不遮挡，文案不溢出；
- PC 上离线页仍是**居中纵屏卡片**（不是铺满 1440px 的横向面板）；
- 旋转到横屏后卡片依然居中，不被裁剪。

---

### B 组：地图 / 战斗的自动 repair

**B1. 地图：飞行模式 → 恢复 → 自动 repair**

步骤：

1. 停在 `/game/map`，记住当前坐标。
2. 开飞行模式，停留约 10s（房间会判定连接断开）。
3. 关闭飞行模式。
4. 不做任何手动操作，观察 30s。

预期：

- 页面自动 rejoin（带退避），成功后自动发一帧
  `trigger: "foreground_restore"` 或 `"reconnect"` 的 repair；
- 地图重新显示权威实体列表，坐标与服务端一致；
- 不需要玩家手动刷新页面；
- 控制台不应持续刷 `state refresh send failed` 之类的错误。

**B2. 战斗 / Boss / PVP：飞行模式 → 恢复 → 自动 repair**

步骤：

1. 进入 `/game/combat/[id]`（或 `/game/boss/[id]`），等待战斗帧正常刷新。
2. 开飞行模式停留约 10s。
3. 关闭飞行模式，回到游戏页前台。

预期：

- 回到前台后立刻重新拉取 HTTP 权威快照，并向 Colyseus 房间补一帧
  `foreground_restore` / `visibility_restore` repair；
- 战斗界面恢复为服务端权威状态（血量、回合、技能冷却），
  不会出现"界面显示还能出手但服务端已经结算"的假在线；
- 战斗日志 / 战报不遮挡主战场，且可折叠。

---

### C 组：iOS 锁屏 30s 后回前台不假在线（重点）

**C1. 聊天 presence 不假在线**

前置：A、B 在同一地图；聊天页「附近」页签显示 `同图 M`（M ≥ 2）。

步骤：

1. iOS 设备停留在聊天页「附近」页签，确认 `同图 M` 中至少包含 B。
2. 直接按电源键锁屏。
3. 保持锁屏 **30 秒**。
4. 解锁回到 Safari，停留在聊天页。

预期：

- 回到前台后自动触发 `visibility_restore` / `foreground_restore` repair，
  房间回一帧新的 `social_snapshot`（opcode `10201`）；
- 若服务端已因连接冻结把 A 标记为离线，UI **不得**继续把 A 显示为在线；
- 在 repair 回包前，`presenceStale` 为 `true`，顶部标签显示
  「实时 同步中」而不是 `同图 M`，旧列表不会被当成实时在线展示；
- repair 完成后标签恢复 `同图 M`，且 M 与服务端权威人数一致。

**C2. 其他账号看到的 A 也不是假在线**

步骤：

1. 同 C1 步骤 1。
2. A 锁屏 30s。
3. 观察 B 的聊天页「附近」页签。

预期：

- B 侧收到 `social_event`（opcode `10202`）的 `presence_leave`；
- B 的 `同图 M` 在 A 断连后下降，不再把 A 当作在线道友展示。

**C3. 地图 / 战斗同样不假在线**

步骤：同上，只是把停留页换成 `/game/map` 或 `/game/combat/[id]`。

预期：

- 地图：回前台后自动 repair，附近实体列表刷新，已离线的道友从列表消失；
- 战斗：回前台后自动 repair，战斗帧继续刷新或正确进入结算；
- 不出现"本地还在跑但服务端已踢掉"的持续假象。

---

### D 组：repair 后资产 / 背包 / 进度刷新帧

**D1. 断连窗口里的资产变更会被补齐**

步骤：

1. A 停在 `/game/map`。
2. 锁屏 / 断网约 30s，期间由 B 触发一次会让 A 获得物品或货币的操作
   （例如组队战斗结算、交互奖励）。
3. 恢复网络 / 解锁回到前台。

预期：

- 客户端收到 `asset_refresh`（10510）与 / 或
  `inventory_refresh`（10302）、`progress_refresh`（12742）；
- 背包 / 资产 / 进度面板刷新为最新权威值；
- **不是只有一个 ACK** —— 若只回 ACK 则判失败。

**D2. 连续两次 repair 幂等**

步骤：

1. 在 D1 完成后，连续再点一次「同步」（手动 repair 不计入补齐通道），
   或再次锁屏解锁触发一次 `foreground_restore`。

预期：

- 第二次 repair 仍被接受（ACK `accepted: true`）；
- **不再重复下发** 10302 / 10510 / 12742；
- 两次 repair 返回的权威快照内容一致，不引入漂移。

---

### E 组：PC 纵屏布局不横向拉伸

**E1. PC 浏览器下的游戏壳**

步骤：

1. PC 浏览器打开 `/game/map`，窗口宽度拉到 1440px 以上。
2. 观察页面整体结构与主场景位置。

预期：

- 游戏内容被限制在 **480px 宽的居中纵屏舞台** 内，左右留白；
- 不出现「地图 / 战斗场景被压到左侧、右侧堆卡片」的横向后台布局；
- 页面整体不出现横向滚动条。

**E2. PC 下的战斗 / Boss / PVP 页**

步骤：

1. PC 浏览器进入 `/game/combat/[id]`、`/game/boss/[id]`。
2. 观察主战场、血条、技能区、日志区。

预期：

- 主战场仍是纵向构图，位于舞台上方且不被日志遮挡；
- 技能按钮、丹药按钮、撤离按钮在 PC 上可点击，不被透明覆盖层挡住；
- 战报 / 日志可折叠或收纳，默认不覆盖玩家实体与主战场；
- 不因为视口变宽而变成左右两栏的管理台样式。

**E3. 窗口缩放边界**

步骤：

1. 把 PC 浏览器窗口从 1440px 缓慢拖到 360px，再拖回。

预期：

- 全程无横向滚动条；
- 无元素溢出容器、无文字撑破按钮 / 徽记；
- 关键操作（移动、技能、发送）始终可见可达，不依赖滚动。

---

## 五、自动化断言（本地跑，无 DB / Redis）

```bash
bun run apps/game-server/src/bot/system-d-offline-repair.ts
```

覆盖 17 条断言，全部 PASS：

| # | 场景 | 断言 |
| --- | --- | --- |
| 1 | 断网后重连 join | 收到 `sector_snapshot`(10002) 或 `scene_snapshot`(10001) |
| 2 | 同图 join | 快照权威实体表含自身实体 |
| 3 | 重连快照 opcode | 落在 10001 / 10002 白名单 |
| 4 | `foreground_restore` repair | ACK `accepted: true` |
| 5 | repair 补齐 | 快照 `acceptedSequence` 与 ACK 对齐，`snapshotVersion ≥ 1` |
| 6 | repair 非只回 ACK | 快照回带自身实体权威坐标 |
| 7 | 第二次 repair | 仍被接受 |
| 8 | **幂等** | 第二次 repair **刷新帧数 = 0** |
| 9 | 幂等无漂移 | 两次快照 `authoritativeState` 完全一致 |
| 10 | 基线 repair | 下发刷新帧（禁止只回 ACK） |
| 11 | 资产变更 | 收到 `asset_refresh`(10510) |
| 12 | 资产变更 | 收到 `inventory_refresh`(10302) |
| 13 | 资产变更 | 收到 `progress_refresh`(12742) |
| 14 | 刷新帧 reason | 以 `repair:foreground_restore` 开头 |
| 15 | 刷新帧载荷 | 携带 `currencies.spirit_stone`、`changedItemIds` |
| 16 | 消费完不再下发 | 后续 repair 刷新帧数 = 0 |
| 17 | 汇总 | total 17 / passed 17 / failed 0 |

> 脚本默认用内置的本地 game-server（`withGameServerEndpoint`），
> 不依赖 `DATABASE_URL` / `REDIS_URL`。若设置了 `GAME_LOAD_TARGET_URL`
> 指向远端 game-server，资产变更注入相关的断言会显式标记为 `SKIP`
> 并提示去掉该环境变量后重跑。

---

## 六、人工验收结论落库模板

| 端 | A1 | A2 | A3 | B1 | B2 | C1 | C2 | C3 | D1 | D2 | E1 | E2 | E3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| iOS Safari 17 |  |  |  |  |  |  |  |  |  |  | — | — | — |
| Android Chrome |  |  |  |  |  |  |  |  |  |  | — | — | — |
| PC Chrome / Edge | — | — | ✅ | — | — | — | — | — | — | — |  |  |  |

---

## 七、遗留风险

1. **SW 首访盲区**：首屏尚未装上 SW 就断网，浏览器会显示系统错误页，
   看不到游戏离线页。缓解：联网首访后 SW 即缓存 `/offline.html`；
   如需覆盖首访，需要额外做 SSR 兜底页（本期未做）。
2. **摘要是进程内存储**：`player-refresh-digest` 的 pending 摘要存在
   game-server 进程内存里。多实例 / 进程重启后 pending 摘要会丢。
   跨实例一致性仍依赖 `state-refresh` 的 Redis 广播链路；
   重启窗口内的 repair 不会补发历史摘要。
3. **摘要只在三个房间的事务路径上挂**：新写入库的事务如果忘记调
   `recordPlayerRefreshDigest`，对应的刷新帧不会在 repair 时补齐。
   建议后续把记录动作收口到统一的事务出口。
4. **iOS bfcache 差异**：`pageshow(persisted)` 在部分 iOS 版本不触发，
   这时靠 `visibilitychange` / `focus` 兜底，shared hook 已合并三种事件，
   但真机仍建议按 C 组逐台走查。
5. **并行波次冲突**：本轮与 P2-A（附近频道回声）、宗门 presence 波次
   同文件改动较多（`social-room.ts`、`useSocialRoomPresence.ts`），
   合入时需注意冲突合并。

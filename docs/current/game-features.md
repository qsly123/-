# 游戏内功能点盘点

> 玩家侧（游戏内）已实现功能汇总，不含后台管理。
> 页面入口：`src/app/game/**`（26 个路由）；业务实现：`src/modules/**`；实时层：`apps/game-server/src/rooms/**`。

## 一、总览

| 域 | 页面入口 | 实时 / 权威形态 |
| --- | --- | --- |
| 角色 | `character`、`fortune`、`appearance` | HTTP 服务端权威 |
| 背包物品 | `inventory` | HTTP 服务端权威 |
| 战斗 | `combat`、`boss`、`pvp` | Boss / PVP 走 Colyseus；普通战斗 HTTP 权威 |
| 地图世界 | `map`、`world` | **Colyseus `WorldMapRoom`** |
| 任务剧情 | `quests`、`npc` | HTTP 服务端权威 |
| 养成 | `alchemy`、`smithing`、`gongfa`、`skills`、`dongfu`、`spiritual-field`、`double-cultivation` | HTTP 服务端权威 |
| 经济 | `market`、`mail` | HTTP 服务端权威 |
| 社交 | `chat` | 世界频道 SSE；附近频道 **Colyseus `SocialRoom`** |
| 宗门 | `sect` | HTTP 治理 + **Colyseus presence** |
| 排行活动 | `rankings`、`activity` | HTTP |

---

## 二、分域明细

### 角色

| 功能点 | 入口 | 核心服务 |
| --- | --- | --- |
| 创建角色 | `/create-character` | `src/modules/character/api/character/create/route.ts` |
| 选择角色 | `/select-character` | `src/modules/auth/services/auth.ts` |
| 属性面板（总属性 / 战力） | `/game/character` | `src/modules/character/services/player-stats.ts` |
| 境界突破 | `POST /api/game/cultivate` | `cultivation.ts` + `realm-service.ts` |
| 打坐恢复 | `POST /api/game/meditation` | `meditation-service.ts` |
| 气运 / 命格 | `/game/fortune` | `fortune-service.ts` |
| 外观 / 时装 | `/game/appearance` | `temporary-cosmetic-service.ts` |
| 鸿蒙至宝 | `/api/game/hongmeng-treasure/*` | `hongmeng-treasure-service.ts` |
| 体力 | 全局 | `stamina-service.ts` |
| 名声 | 角色页徽记 | `player-world-pressure-service.ts` |

### 背包与物品

| 功能点 | 入口 | 核心服务 |
| --- | --- | --- |
| 背包列表 | `/game/inventory` | `character/api/game/inventory/route.ts` |
| 使用丹药 / 参悟技能书 | `POST /api/game/inventory` (`use`) | 同上 + effect 结算 |
| 装备 / 卸下（含法宝槽位） | 同上 (`equip`/`unequip`) | `src/modules/shared/constants.ts` `ARTIFACT_EQUIP_SLOTS` |
| 丢弃 / 一键出售 | 同上 (`drop`/`quick_sell`) | `inventory-quick-sell.ts` |
| 物品来源查询 | `/api/game/items/[itemId]/sources` | `item-source-service.ts` |
| 丹毒 / 药性 | 背包与角色页展示 | `pill-toxicity-service.ts` |

### 战斗

| 功能点 | 入口 | 形态 |
| --- | --- | --- |
| 普通战斗（站桩回合制） | `/game/combat/[id]` | HTTP `/api/game/combat/start\|action\|settle`，服务端权威 |
| 战斗内技能 / 丹药 / 逃跑 / 认输 | 同上 | `battle-command.ts`、`battle-command-executor.ts` |
| 战斗内位移 | `CombatRoom` movement | `battle-spatial-runtime.ts`，服务端裁定 |
| 组队战斗 | `/game/combat/[id]`（透传 `partyCombatId`） | `party-combat-service.ts` |
| Boss 战 | `/game/boss/[id]` | **Colyseus `BossRoom`**，1.5s 广播刷新 |
| PVP（论道） | `/game/pvp/[combatId]` | **Colyseus `PvpRoom`**，含断线裁定 |
| 奖励结算与掉落 | 结算路径 | `combat-reward-claim-service.ts`、`combat-side-effect-claim-service.ts`（幂等落账） |

战斗统一房间：`apps/game-server/src/rooms/combat-realtime-room.ts`，`CombatRoom`/`BossRoom`/`PvpRoom` 共用 command / movement / useItem / surrender / repair ACK 骨架，支持 10 秒 reconnect grace。

### 地图与世界移动

| 功能点 | 入口 | 形态 |
| --- | --- | --- |
| 实时地图移动 | `/game/map` | **Colyseus `WorldMapRoom`**，坐标 ACK 前 Postgres 落账 |
| AOI 可见玩家 | `/game/map` | `world-map-aoi.ts` + `sector_snapshot`/`sector_delta` |
| 地图切图 / 传送 | `POST /api/game/map/travel` | `map-portal.ts` + 幂等 |
| 地图结构 / 阻挡刷新 | 房间内 | `map-structure-invalidation.ts`，广播 `map_refresh` |
| 神识迷雾视野 | `/game/map` | `map-scene-state.ts`（服务端给可见性） |
| 秘境 | `/api/game/secret-realm/*` | HTTP 权威；`SecretRealmRoom` 已定义但为空壳 |
| 随机事件 / 机缘 | 地图 `interact` | `random-event-service.ts`、`opportunity-service.ts` |

### 任务与剧情

| 功能点 | 入口 |
| --- | --- |
| 任务列表（主线 / 支线 / 悬赏） | `/game/quests` |
| 接取 / 完成任务 | `/api/game/quest/accept`、`/complete` |
| 主线指引 | `buildMainlineGuide`（`quest-service.ts`） |
| NPC 对话任务推进 | `/api/game/npc/[id]/quest-action` |
| 战斗击杀推进任务 | 结算侧 `combat-quest-side-effect-intent.ts` |
| 剧情推进（世界故事线） | `/api/game/world/storylines` |

### 养成

| 功能点 | 入口 | 核心服务 |
| --- | --- | --- |
| 炼丹 | `/game/alchemy` | `alchemy-service.ts`（配方 / 材料 / 软保底） |
| 炼器 | `/game/smithing` | `smithing-service.ts` |
| 功法 | `/game/gongfa` | `gongfa-service.ts`（升级 / 装配 / 属性聚合） |
| 神通 / 装配 | `/game/skills` | `player-active-skills.ts` |
| 洞府（挂机产出领取） | `/game/dongfu` | `dongfu-service.ts` |
| 灵田种植 / 收获 / 加速 | `/game/spiritual-field` | `spiritual-field-service.ts` |
| 双修 | `/game/double-cultivation` | `double-cultivation-core-api.ts` + ledger / linkage |
| 孕育 / 逐出 | `/api/game/uterus-expel` | `uterus-expel-service.ts` |

### 经济

| 功能点 | 入口 |
| --- | --- |
| 市场挂单 / 购买 | `/game/market` + `/api/game/market/listings`（含手续费、过期、NPC 收购） |
| 交易记录 | `/api/game/market/trades` |
| 邮件 | `/game/mail` |
| 商城购买 | `/api/game/shop/buy` |
| 充值 | `/api/game/recharge/create\|notify` |
| CDK 兑换 | `/api/game/cdk/redeem` |
| 奖励发放（统一出口） | `src/modules/character/services/reward-service.ts` |

### 社交

| 功能点 | 形态 |
| --- | --- |
| 世界频道（天道传音） | HTTP + SSE `/api/game/chat/sse` |
| 附近频道 | HTTP 持久化 + **Colyseus `SocialRoom` 回声**（`nearby-chat-echo.ts`） |
| 系统播报 | HTTP / SSE |
| 私聊 | HTTP（不进 `SocialRoom`） |
| 好友 / 亲密关系 | HTTP 权威 |
| 组队 | HTTP 事务；presence 由 `SocialRoom.partyMembers` 承载 |
| 同图在线 presence | **Colyseus `SocialRoom`**（`nearbyPlayers`/`partyMembers`/`sectMembers`） |
| 通知汇总 | HTTP + SSE `/api/game/social/sse` |

### 宗门

| 功能点 | 形态 |
| --- | --- |
| 创建 / 申请加入 / 审批 | HTTP 权威 |
| 宗门首页 / 驻地 | HTTP |
| 驻地编辑 | HTTP 权威 |
| 成员列表（驻地 / 在线 / 离线三态） | **Colyseus presence** + HTTP 兜底 |
| 职位任命 / 权限 | HTTP 权威 |
| 宗门仓库存取 | HTTP 权威 |
| 建筑 / 扩建 | HTTP 权威 |
| 拜访他人宗门 | HTTP |
| 宗门入口上地图 | `WorldMapRoom` 的 `sect_home` / `sect_activity` AOI 实体 |

### 活体世界

| 功能点 | 说明 |
| --- | --- |
| 世界 NPC（生成 / 成长 / 轮回 / 掉落） | `world-npc-service.ts`（65KB）；位置经 `WorldMapRoom` AOI 下发 |
| 怪物 | 秘境 / 地图实体源，AOI 下发 |
| 掉落 | `secret-realm-drop-generation-service.ts`（103KB） |
| 世界委托 / 契约 | `player-world-offer-service.ts` |
| 故事线 / 势力 | `world-faction-storyline-service.ts` |
| 名声 / 压力 / 风闻 | `player-world-pressure-service.ts`（183KB）、`world-rumor-service.ts` |
| 世界事件 / 暗袭 | `world-adult-service.ts`（89KB） |
| 区域状态 | `world-district-service.ts` |

---

## 三、实时 / HTTP 归属速查

**走 Colyseus 实时房间**
- `world-map-room.ts` — 地图移动、AOI、切图、机缘 interact、秘境入口、地图结构刷新
- `combat-realtime-room.ts` — `CombatRoom`(solo/party)、`BossRoom`、`PvpRoom` 全部战斗指令与 repair
- `social-room.ts` — 同图 / 队伍 / 宗门 presence、附近频道广播
- `nearby-chat-echo.ts` — 附近频道回声
- `secret-realm-room.ts` — 已定义但为空壳，未承载玩法

**只有 HTTP API**
角色 / 突破 / 打坐、背包与装备、普通与组队战斗、秘境进出、任务与剧情、炼丹炼器功法、市场邮件商城充值、好友私聊亲密、组队事务、宗门全部治理事务、世界 NPC / 委托 / 名声 / 双修 / 灵田。

**未实现**
- 天赋 / 加点（属性来自境界、装备、功法、气运聚合）
- 背包容量上限（仅初始背包配置）
- 天气 / 昼夜 / 世界时间（`schema.ts` 无对应字段，仅后台编辑器与离线包出现）

---

## 四、状态刷新帧覆盖现状（重要）

`10302` 背包 / `10510` 资产 / `12742` 进度三类强制刷新帧，定义于 `packages/shared-protocol/src/opcode.ts`。

**已接入的域（3 个）**

| 域 | 帧 | 触发点 |
| --- | --- | --- |
| 宗门 · 仓库存取 / 捐献 | `10302` + `10510` | `/api/game/sect/storage`（`sect-state-refresh-service.ts`） |
| 宗门 · 任命 / 审批 / 建筑 / 权限 / 退出 | `12742`（scopes 含 `sect`，推给全宗门成员） | `/appoint`、`/buildings`、`/applications/respond` 等 |
| 宗门 · 扩建（资源变更） | `10510` + `12742` | `/api/game/sect/expand` |
| 战斗 · 战斗内消耗丹药 | `10302` | `battle-command-executor.ts`（`combat-state-refresh-publish.ts`） |
| 战斗 · Boss 用丹 / 奖励结算 | `10302` + `10510`/`12742` | `boss-command-route-service.ts` |
| 聊天 · 附近频道发言 | `12742` | `/api/game/chat/nearby`（`nearby_message_sent`） |

**未接入的域（仍是"只回 ACK、靠页面自己重拉"）**

炼丹、炼器、功法升级、市场挂单/购买、邮件领取、任务完成、灵田收获、双修、洞府领取、背包普通使用 / 装备 / 出售 / 丢弃、境界突破、充值与 CDK 兑换、探索与秘境结算。

> 这些域改完库后客户端收不到任何帧，界面刷新依赖页面自身重新拉取——
> 与「资产 / 背包 / 进度变更必须推对应刷新帧」的目标仍有差距，属于后续波次待补范围。

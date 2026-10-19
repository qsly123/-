# 开放世界

## 当前定位

开放世界承载“修仙社会化”内容，不只是地图扩容，还包括：

- 世界 NPC
- 名声与世界压力
- 天道风闻与附近频道
- 灰线轻委托
- 市场与世界 NPC 联动
- 成人互动与双修/孕育核心链路对接

## 世界地图

- 运行时地图池，不直接等同于静态主地图
- 当前以多张地图、冷热分层、界域标签和旅行路网组织
- 地图首屏强调：
  - 主目标
  - 次级动态
  - 世界动静折叠入口
- 首屏动态条应按“主目标优先、可响应事件补位、同源事件去重”展示，避免同一封来信或同一条邀约重复出现

## 世界 NPC

### 当前规则

- 世界 NPC 已接入地图场景实体链路
- 阶段 7 已让 `WorldMapRoom` 低频重读 NPC / 怪物 / 世界 NPC 实体源，出现、消失和位置变化会通过 AOI delta 同步；刷新移动实体会带 `velocityX / velocityY`，供 H5 插值。
- 名字、人格、身世、关键词等都应来自可配置关键词池
- NPC 不应长期扎堆固定点，应在开放世界普通地图分散出现
- 宗门地图与临时地图不参与通用分散逻辑

### 当前联动

- NPC 可进入普通战斗链路
- NPC 可参与市场低价扫货
- NPC 会通过附近频道、风闻、目击传播与名声系统和玩家交互

## 世界 NPC 与市场

当前已支持世界 NPC 购买低价商品，治理逻辑为：

- 针对正式物品
- 以参考价为基准
- 低于阈值且挂单存在一定时间后，允许被 NPC 买走

目的是让市场不是完全静态死板列表，而是与世界行为产生联动。

## 名声、压力与事件

- 名声摘要已经并入玩家主资料链
- 高堕落、高魅力、高冲突行为会影响 NPC 反应
- 高名声/恶名不仅是描述文本，还会转化成真实可触发事件
- 世界压力与灰线事件不再只是日志，而会影响互动选项和后续链路
- 任务型事件邀约接受后，必须生成可见的世界委托；具体 contract 口径见 `docs/current/open-world-contracts.md`
- 地图页的名声卡不应只给文字描述；当存在 `牙子递话 / 赔礼送礼 / 合意双修 / 探宝修关系` 等真实门路时，必须给出可点击的接取、推进或跳转引导
- 地图页的 `可响应` 事件也必须直接告诉玩家：
  - 先不先接受
  - 找谁
  - 去哪
  - 坐标或至少街区/地图
  - 当前该做什么
- 这个口径不能只给 `可响应` 来信；`私密邀约 / 暗线委托 / 街区故事链 / 暗袭弹窗 / 主目标` 也必须复用同一套引导块
- 世界 NPC 详情页在出现“因名声不愿搭理你”的场景时，也必须给出返回地图或查看世界委托的明确入口
- 阶段 7 已把 `player_world_incidents` 映射为玩家私有 `reputation_event` AOI 实体。事件优先读取 payload 中的地图坐标；没有坐标时会按事件 key 在当前地图中稳定落点，避免每次刷新漂移。
- 阶段 7 已把 active `world_storylines` 和 pending `player_world_event_offers` 映射为 `world_commission` AOI 实体。公共故事线对所有玩家可见，玩家事件邀约只进入对应玩家的私有 AOI；旧委托详情、接取和落账仍走核心 API。
- P2-A 起，`WorldMapRoom` 可从 `map_opportunity_spawns + random_events.eventType`、`world_storylines.payloadJson`、`player_world_event_offers.payloadJson`、`player_world_incidents.payloadJson` 读取更复杂临时入口：`limited_opportunity`、`sect_activity`、`event_portal`、额外 `world_commission` 和额外 `reputation_event`。payload 可通过 `mapEntrances / eventEntrances / activityEntrances / commissionEntrances / reputationEntrances / objectiveEntrances / temporaryEntrances` 扩展多个地图入口。
- P2-A 临时阻挡同样走 payload：`temporaryBlockers / blockedAreas / sealedAreas / portalPlaceholders`，或单条 payload 上的 `blocksMovement / temporaryBlocked / sealedArea / portalPlaceholder`。支持 `mapId`、`startsAt / activeFrom`、`expiresAt / activeUntil`、`radius / blockRadius`，最终合并进 `WorldMapRoom.map.blockedTiles`，不把后台剧情 payload 下发到 H5。

## 成人互动

### 当前方向

- 与 `world` 核心双修模块共享成人画像主链
- 开放世界只负责场景入口、试探、协商、结果叙事和世界影响
- 真实双修/孕育数据由 `world`、`character`、`social` 等固定核心模块共同落账，不恢复插件 Hook

### 当前要求

- 玩家看见的是前台友好文案，不暴露后台管理字段
- 试探不可点击时必须说明原因
- 同意、拒绝、回信链路要完整
- 移动端弹窗和长文本必须可收纳、可滚动、不超屏

## 关键词池

开放世界所有 AI 生成内容当前都应支持后台关键词池控制，至少覆盖：

- 名字
- 出身
- 人格
- 势力
- 职业
- 特性
- 传闻风格
- 成人互动相关词汇

## 与其他模块的关系

- `map`
  - 提供地图承载、实体展示、附近交互入口
- `chat`
  - 提供附近频道与系统/天道广播
- `social`
  - 提供私聊、组队等玩家间关系链路
- `character`
  - 玩家属性、奖励、资料面板、状态系统

## 当前易错点

- 世界 NPC 若只做后台数据不接场景刷新，会出现“实际存在但地图不刷新”
- 玩家静止时看不到别人/NPC 移动，通常不是世界逻辑错，而是地图 AOI / realtime 链路问题
- 临时入口和临时阻挡必须先进入 payload/地图实体协议，再由 `WorldMapRoom` AOI 输出；不要把限时机缘、宗门活动、委托入口或封锁区硬编码回地图 React 页面。
- 成人互动如果只改前端不改后台判定，会出现文本与实际解锁条件不一致
- 关键词池若没接到后台，会让 AI NPC 长期缺少差异化人格与出身描述

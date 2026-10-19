# 阶段 7 社交 Presence 房间接入记录

本文记录阶段 7 第一轮 `SocialRoom` 接入范围。当前只建立实时 presence 与附近消息同步底座，不替代旧私聊、好友、组队、宗门治理等低频 API。

## 当前完成

- `SocialRoom` 不再是空房间。
- 加入房间时记录：
  - `playerId`
  - `name`
  - `mapId`
  - `shardId`
  - `partyId`
  - `sectId`
  - `joinedAt`
  - `updatedAt`
- `repair` 返回 `social_snapshot`：
  - 当前玩家
  - 同地图同分片 `nearbyPlayers`
  - 同队伍 `partyMembers`
  - 同宗门 `sectMembers`
- `nearbyMessage` 返回成功 ACK，并向同 `mapId + shardId` 的在线玩家广播 `social_event`。
- `partyInvite / partyCommand` 当前只返回明确 `unsupported_input` ACK，并附带迁移边界说明，不伪造组队数据库成功。
- `JoinRoomOptions` 新增 `sectId`，用于宗门成员 presence。
- H5 聊天页已通过 `useSocialRoomPresence(...)` 接入 `SocialRoom`：
  - 附近频道仍先走旧 `/api/game/chat/nearby` 持久化。
  - 旧 API 发送成功后再发 `nearbyMessage` 到 `SocialRoom`。
  - 收到 `social_event.nearby_message` 后刷新旧持久化列表，避免未落库消息成为主链。
  - 页面显示同图在线 presence，并提供手动 `repair` 同步按钮。
- H5 宗门页已消费 `sectMembers`：
  - 宗门页进入 `sect:<sectId>` presence 上下文。
  - 成员列表显示在线 / 离线状态。
  - 宗门仓库、建筑、任命、审批、扩建仍走低频核心 API。
- `bun run game:smoke` 已覆盖：
  - `sectId` join option 规范化。
  - 同图附近玩家 presence。
  - 同队伍 presence。
  - 同宗门 presence。
  - 附近消息同图分片广播。
  - 组队业务命令未迁移时返回明确拒绝。

## 当前边界

- 旧 `/api/game/chat/*`、`/api/game/social/*` 仍是线上业务主链。
- 私聊继续保留低频 API 或旧轻量实时链路，不进入战斗房间主循环。
- `SocialRoom` 当前不写 Postgres，不创建队伍，不接受邀请，不处理好友关系。
- 组队邀请、接受、离队事务仍由旧核心 API 写库；地图页已经在成功后刷新 `/api/game/social/party` 快照，`SocialRoom` 只负责 presence 显示。
- H5 客户端已接入 `SocialRoom`，但 iOS Safari / Android Chrome / PC 真实浏览器 WebSocket 与 cookie 鉴权仍要在灰度前人工验收。
- 宗门驻地作为地图实体和 presence 上下文已接入；宗门地图画面仍复用 `homeMapId` 对应的普通地图房间，不迁移宗门治理事务。

## 后续任务

- 真机验证 H5 聊天页加入 `SocialRoom` 后，旧附近 SSE 与房间事件不会重复刷屏。
- 真机验证宗门页 `sectMembers` 在线状态在前后台恢复后能自动修复。
- 组队 service 与 `partyId` presence 后续可继续增强，但邀请、接受、离队仍由核心 API 事务落账。
- 给后台监控补 SocialRoom 在线人数、消息量、拒绝原因。

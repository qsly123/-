# Social 模块

## 模块定位

负责私聊、好友、亲密关系、组队和社交通知。

## 当前重点

- 私聊
- 好友与亲密关系
- 组队创建、邀请、响应
- 社交通知与 SSE
- 地图组队悬浮入口
- 阶段 7 `SocialRoom` presence 底座

## 关键入口

- 页面
  - `/game/chat`
- 接口
  - `/api/game/social/*`

## 核心服务

- `social-service.ts`
- `party-service.ts`
- `social-rate-limit.ts`
- `social-presence.ts`

## 当前 Colyseus 接入

- `apps/game-server/src/rooms/social-room.ts`
  - 已维护同图分片 `nearbyPlayers`、同队伍 `partyMembers`、同宗门 `sectMembers`。
  - 已支持 `repair` 返回 `social_snapshot`。
  - 已支持 `nearbyMessage` 房间级广播 `social_event`。
  - `partyInvite / partyCommand` 当前只返回明确 `unsupported_input` ACK，不伪造旧组队事务成功。
- H5 聊天页已通过 `useSocialRoomPresence(...)` 接入 `SocialRoom`：
  - 旧 `/api/game/chat/nearby` 仍负责附近消息持久化。
  - 旧 API 成功后发送 `nearbyMessage`，同图玩家收到 `social_event` 后只刷新旧持久化列表，不直接 append 到本地消息数组，避免 SocialRoom 广播和旧 SSE 双写导致重复刷屏。
  - 页面显示同图在线 presence，并可手动触发 `repair`。
- H5 地图页已接入 `useSocialRoomPresence(...)` 的地图上下文：组队邀请、接受、离队、请离仍走 `/api/game/social/party*` 核心 API；API 成功后刷新 party snapshot，`partyId` 变化会让 SocialRoom 按新上下文重连并 repair。
- H5 宗门页已复用 `useSocialRoomPresence(...)` 消费 `sectMembers`，成员列表显示在线 / 离线。
- 旧 `/api/game/chat/*` 与 `/api/game/social/*` 仍是线上业务主链；私聊、好友、组队事务不写入 `SocialRoom`。
- 聊天 / 通知 SSE 已有 P2-A 专门审计脚本：`bun run stage-p2:social-sse:audit` 报告现役依赖，`bun run stage-p2:social-sse:check` 用作严格门禁。不要把聊天、附近频道或通知 SSE 混入地图 / combat / Boss 旧 realtime 退役结论。

## 关联文档

- [`docs/current/combat.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/combat.md)
- [`docs/current/open-world.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/open-world.md)

## 注意点

- `/game/chat` 是聚合页，改动时通常要同时看 `chat`、`social`、`shared`。
- 组队逻辑和战斗、地图都有强耦合，改动要连带验证。
- 新实时社交接入必须复用 `src/modules/shared/services/colyseus-game-client.ts`，不要在页面里裸连 WebSocket。
- `SocialRoom` 只做 presence 和轻量广播，不负责创建队伍、接受邀请、离队或宗门治理落账。
- iOS Safari / Android Chrome / PC H5 的附近频道不重复刷屏、组队 presence 和宗门 presence 仍需要人工真机验收后再在根清单中勾选对应验收项。

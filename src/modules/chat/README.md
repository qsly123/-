# Chat 模块

## 模块定位

负责天道传音、附近频道和系统消息，不负责私聊和好友关系。

## 当前重点

- 天道传音
- 附近频道
- 系统播报
- 消息回放与 SSE/实时更新

## 关键入口

- `/api/game/chat`
- `/api/game/chat/nearby`
- `/api/game/chat/system`
- `/api/game/chat/sse`
- `/api/game/chat/nearby/sse`

## 核心服务

- `chat-service.ts`
- `chat-presence.ts`
- `nearby-chat-service.ts`
- `nearby-chat-presence.ts`

## 关联文档

- [`docs/current/open-world.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/open-world.md)
- [`docs/current/map-secret-realm.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/map-secret-realm.md)

## 注意点

- `/game/chat` 是 `chat + social` 聚合页，改展示时通常要同时看两个模块。
- 系统、天道、附近三条消息线都应保持独立回放与滚动逻辑。
- P2-A 已把聊天页、地图聊天公告入口和通知中心 SSE 依赖单独审计：`bun run stage-p2:social-sse:audit`。这些 SSE 仍是聊天 / 通知现役链路，不属于地图 / combat / Boss 旧 realtime 已退役结论。
- 附近频道边界：旧 `/api/game/chat/nearby` 和 `/api/game/chat/nearby/sse` 负责持久化与回放；`SocialRoom.nearbyMessage` 只做同图轻量广播并触发刷新，不直接写聊天表，也不直接 append 本地消息。

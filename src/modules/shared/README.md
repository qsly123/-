# Shared 模块

## 模块定位

负责 realtime 通道、codec、上传资源、多端运行时、公共 UI 与全局常量。

## 当前重点

- SSE / WS 统一封装
- Colyseus game-server client 抽象入口
- `JSON / MessagePack` codec
- 场景协议与 entity schema
- 上传目录与资源 URL 解析
- 通知中心与公共玩家组件

## 核心服务

- `realtime-channel.ts`
- `colyseus-game-client.ts`
- `realtime-codec.mjs`
- `realtime-scene-schema.mjs`
- `realtime-transport.ts`
- `legacy-realtime-retirement.ts`
- `server-background-scheduler.ts`
- `runtime-persisted-store.ts`
- `upload-storage.ts`
- `action-request.ts`

## 关联文档

- [`docs/current/realtime-runtime.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/realtime-runtime.md)
- [`docs/current/admin-ops-deployment.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/admin-ops-deployment.md)
- [`docs/current/server-background-scheduler-and-timer-policy-2026-03-19.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/server-background-scheduler-and-timer-policy-2026-03-19.md)

## 注意点

- 业务页面如果想直接手写 `WebSocket` / `EventSource`，先检查是否应该复用本模块。
- 新 Colyseus 玩法页应通过 `colyseus-game-client.ts` 进入，不要直接裸连 `WebSocket` 或在页面里手写 Colyseus join 细节。
- ESLint 已对 `src/app/game/**/*` 与 `src/modules/**/ui/**/*` 禁止 `new WebSocket` / `new EventSource`；新增玩法页必须通过 `realtime-channel.ts` 或 `colyseus-game-client.ts`。
- `colyseus-game-client.ts` 已接入 `@colyseus/sdk` 动态加载 adapter，业务 hook 优先通过 shared 封装 join 房间，避免第三方 SDK 类型泄漏到玩法页。
- `colyseus-game-client.ts` 在浏览器端解析 `NEXT_PUBLIC_GAME_SERVER_*` 时会避免把当前域名页面连到裸 IP endpoint；生产登录 cookie 是 `HttpOnly`，Colyseus join 必须走同 host / 同站点入口才能让浏览器自动携带 cookie。
- Colyseus 房间如果会在 join / repair 早期主动下发业务消息，业务 hook 必须通过 `joinGameRoomWithSdkClient(..., messageHandlers)` 预注册消息类型，避免首帧到达时 SDK 报 `onMessage() not registered` 并漏掉权威快照。
- `sendInputAndWaitForAck(...)` 的等待匹配必须按 `inputType + clientSequence` 定位 ACK，不能只按序号匹配；repair / command / movement 可能使用相同序号，误匹配会让业务拿到不含对应权威状态的 ACK。服务端拒绝当前输入时也要用当前输入序号返回 ACK，权威端已接受的最后序号应放入业务态字段，避免前端 promise 等到超时后触发假重连。
- realtime envelope 的 `serverTick` 是房间消息时钟；战斗玩法校验使用 `authoritativeState.sceneSnapshot.tick`。业务 action meta 生成和 Colyseus command / movement 默认值都必须优先取业务快照 tick，不允许用 room `serverTick` 充当 `clientSceneTick`。H5 玩法页不要把页面渲染 state 里的 `clientSceneTick` 显式覆盖给 Colyseus send；应让业务 hook 基于最新 envelope 生成，HTTP fallback 才使用 action meta 中的 tick。
- `packages/shared-protocol` 已定义 legacy HTTP adapter 和 `RealtimeRepairPayload`，旧地图 / 战斗 route 也要先归一化成共享 envelope，再进入各自兼容业务逻辑。
- `legacy-realtime-retirement.ts` 只负责阶段 9 显式退役门禁；默认不关闭 active legacy，必须等 Colyseus 主链和 H5 三端验收完成后再打开相关环境变量。
- 阶段 7 已在 `packages/shared-protocol` 增加 `social_snapshot / social_event` 与 `SocialPresenceEnvelope`，H5 聊天页和宗门页已通过 shared Colyseus client 接入 `SocialRoom`。
- 上传资源异常优先排查实际挂载根目录与 `upload-storage` 结果。
- 周期性后台业务任务优先走 `server-background-scheduler.ts`，不要在插件 runtime 里各自散落一套常驻 `setInterval`。

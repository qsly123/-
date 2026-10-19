# 架构总览

## 项目定位

本项目是纵向 H5 修仙游戏，核心特点是：

- 纵屏优先，移动端体验优先于后台式宽屏布局
- Web H5 是一等客户端，必须保证 iOS Safari / Android Chrome / PC 浏览器三端互通；Capacitor 只能作为可选包装层
- 地图、战斗、Boss、后续 PVP 走服务端权威实时链路
- `src/modules/*` 是真实业务核心，`src/app/*` 主要承担路由壳与薄适配
- 插件体系已经退役；后续新增玩法必须进入固定核心模块
- 多人在线底座将从自研 WS/SSE 双 runtime 迁向 `Colyseus + Phaser + Redis + Postgres`
- 系统配置、后台编辑器、核心模块服务是一等能力，不是边缘扩展

## 模块分层

- `src/modules/auth`
  - 账号、会话、当前角色、后台鉴权
- `src/modules/character`
  - 角色成长、背包、装备、市场、邮件、鸿蒙至宝、玩家资料
- `src/modules/map`
  - 地图场景、移动同步、传送、秘境、随机事件、NPC 入口
- `src/modules/combat`
  - 单人战斗、组队战、Boss 战、PVP 接入、统一战斗视图
- `src/modules/world`
  - 开放世界、世界 NPC、名声、轻委托、成人互动、天道叙事
- `src/modules/social`
  - 私聊、好友、亲密关系、组队、社交通知
- `src/modules/chat`
  - 天道传音、附近频道、系统消息与回放
- `src/modules/system`
  - 全局配置、功能开关、运行时健康、部署版本
- `src/modules/admin`
  - 后台实体管理、性能分析、地图/内容编辑、核心系统配置和 game-server 监控；不再提供插件管理入口
- `src/modules/shared`
  - 实时通道、codec、上传资源、多端运行时、公共 UI
- `src/modules/quest`
  - 主线、支线、悬赏、世界委托展示与推进
- `src/modules/sect`
  - 宗门、驻地、仓库、驻地传送与治理
- `src/modules/ai`
  - OpenAI 接入、提示词组织、场景化 AI 调用封装

## 当前架构共识

- 地图与战斗都采用服务端权威，客户端只负责输入、预测、插值与纠偏。
- 实时页面优先复用 `shared` 中的通道封装与场景协议，不直接手写裸 `WebSocket` / `EventSource`。
- 运行时状态、快照协议、结算幂等与补偿逻辑应优先沉到 `services/*`，不要重新塞回页面组件。
- 文案、运营配置、AI 模型配置等全局规则统一从 `system` 和后台读取。
- 玩家侧复杂内容优先通过模块服务协作完成，不走页面级跨模块拼接。
- 新玩法不再通过插件 Hook、动态宿主或插件路由扩展；必须改核心模块、共享协议和权威文档。
- 后续大型多人在线能力以独立 `game-server`、房间分片、AOI、Redis presence、Postgres 持久化为主线。
- 客户端演进以 H5 为主线，详见 `docs/current/h5-client-cross-platform-2026-07-07.md`。
- 旧地图 / combat scene / Boss realtime 入口已归档；聊天、附近频道、通知 SSE 不属于本轮退役范围，后续单独规划。退役边界见 `docs/current/legacy-realtime-retirement-stage9-2026-07-07.md`。
- 旧插件源码已归档到 `src/modules/.bak/2026-07-08/plugin`，不再是当前模块边界。

## 当前重点系统

- 实时地图
  - AOI、快照、传送、迷雾、附近实体与开放世界入口
- AI 秘境
  - 实例地图、临时怪、Boss 封印、玩家独立掉落、野狼谷特殊逻辑
- 统一战斗内核
  - `BattleRuntime + BattleRuleset + BattleViewState`
- AI 生成内容
  - AI 炼丹、AI 炼器、AI 唯一物品、AI 物品治理
- 开放世界
  - 世界 NPC、名声与压力、成人互动、天道播报、市场联动
- 核心玩法扩展
  - 双修、功法、灵田、论道、炼丹、炼器等历史插件玩法已按固定核心模块承接，后续只继续补核心能力，不恢复插件体系
- 多人在线底座重构
  - `Colyseus + Phaser + Redis + Postgres`，详见 `docs/current/rewrite-multiplayer-core-plan.md`

## 推荐阅读顺序

1. `docs/current/rewrite-multiplayer-core-plan.md`
2. `docs/current/architecture-overview.md`
3. `docs/current/h5-client-cross-platform-2026-07-07.md`
4. `docs/current/h5-ui-content-and-runtime-rules.md`
5. `docs/current/realtime-runtime.md`
6. `docs/current/legacy-realtime-retirement-stage9-2026-07-07.md`
7. `docs/current/map-secret-realm.md`
8. `docs/current/combat.md`
9. `docs/current/ai-generation-and-crafting.md`
10. `docs/current/open-world.md`
11. `docs/current/plugins-and-progression.md`
12. `docs/current/admin-ops-deployment.md`
13. 对应模块 `src/modules/*/README.md`

## 维护要求

- 新功能优先更新当前权威文档，再补模块 `README.md`。
- 历史阶段记录不要继续散落在根 `docs/`；完成整合后移入 `.bak`。
- 若规则涉及地图、战斗、掉落、核心成长或 AI 生成，必须同步确认前后端、后台与结算链路口径一致。
- 不再为新插件能力补底层同步逻辑；需要扩玩法时，先写核心模块设计与共享协议。

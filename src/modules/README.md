# Modules

`src/modules/*` 是项目的真实业务核心，`src/app/*` 主要只做路由壳与薄转发。

## 当前模块分工

- `admin`
  - 后台实体、性能分析、内容管理、核心系统配置
- `ai`
  - OpenAI 接入与场景化 AI 调用
- `auth`
  - 账号、会话、当前角色、后台鉴权
- `character`
  - 角色成长、功法 / 神通、背包、装备、市场、邮件、鸿蒙至宝
- `chat`
  - 天道传音、附近频道、系统消息
- `combat`
  - 统一战斗内核、单人/组队/Boss/PVP 接入
- `map`
  - 地图场景、移动同步、AI 秘境、随机事件、NPC 入口
- `quest`
  - 主线、支线、悬赏、世界委托接入
- `sect`
  - 宗门、驻地、仓库、治理
- `shared`
  - realtime、codec、上传资源、公共 UI、运行时基础设施
- `social`
  - 私聊、好友、亲密关系、组队、通知
- `system`
  - 全局配置、功能开关、健康检查、部署版本
- `world`
  - 开放世界、世界 NPC、名声、轻委托、成人互动、双修核心账本

## 推荐阅读

1. [`docs/current/rewrite-multiplayer-core-plan.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/rewrite-multiplayer-core-plan.md)
2. [`docs/current/architecture-overview.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/architecture-overview.md)
3. [`docs/current/realtime-runtime.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/realtime-runtime.md)
4. [`docs/current/map-secret-realm.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/map-secret-realm.md)
5. [`docs/current/combat.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/combat.md)
6. [`docs/current/ai-generation-and-crafting.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/ai-generation-and-crafting.md)
7. [`docs/current/core-gameplay-data-driven-design-2026-07-07.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/core-gameplay-data-driven-design-2026-07-07.md)
8. [`docs/current/open-world.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/open-world.md)
9. [`docs/current/plugins-and-progression.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/plugins-and-progression.md)
10. [`docs/current/admin-ops-deployment.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/admin-ops-deployment.md)

## README 维护规则

- 模块 `README.md` 只保留模块定位、关键入口、关键协作关系和当前文档索引。
- 历史阶段修复不要继续堆到模块 README 中。
- 规则类、运行时类、掉落类说明统一收口到 `docs/current/*`。
- `plugin` 已在阶段 9 归档到 `src/modules/.bak/2026-07-08/plugin`，不再属于当前业务模块。

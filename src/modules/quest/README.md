# Quest 模块

## 模块定位

负责主线、支线、悬赏和世界委托展示与推进。

## 关键入口

- 页面
  - `/game/quests`
- 接口
  - `/api/game/quest/list`
  - `/api/game/quest/accept`
  - `/api/game/quest/complete`
  - `/api/game/npc/[id]/quest-action`

## 核心服务

- `quest-service.ts`
- `quest-requirement.ts`
- `npc-task-tools.ts`

## 战斗推进口径

- `quest-service.ts` 同时提供普通推进函数和 tx 版本推进函数。
- 战斗、Boss、PVP、组队结算等 settlement side effect 必须通过 `src/modules/combat/services/combat-quest-side-effect-intent.ts` 进入，由 `combat_side_effect_claims` 事务型 runner 锁定 effect key 后调用 tx 版本推进。
- 非战斗 NPC 对话类交互仍可直接调用普通 `advanceTalkQuestProgress(...)`，但不要把战斗房间或结算 route 里的任务推进重新散落回普通服务调用。

## 关联文档

- [`docs/current/open-world.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/open-world.md)
- [`docs/current/architecture-overview.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/architecture-overview.md)

## 注意点

- 主线状态不能只看任务表，还要结合玩家当前主线指引字段。
- 世界委托是并列体系，不应简单混同为传统 `player_quests`。
- 战斗重复 reconnect / retry 不应重复推进任务；新增战斗任务进度来源必须先设计稳定 `effectKey`。

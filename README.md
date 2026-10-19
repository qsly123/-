# Immortality

纵向 H5 修仙项目，核心形态已经收口为：

- `src/modules/*` 驱动的领域架构
- 服务端权威的地图与战斗实时链路
- AI 秘境、开放世界、核心成长玩法并存
- 插件体系进入退役流程，剩余插件源码已归档，后续新增玩法进入固定核心模块
- 多人在线底座计划迁向 Colyseus + Phaser + Redis + Postgres
- 面向移动端优先的地图、战斗和角色界面

## 先读哪里

当前文档入口已经统一，后续接手请优先读：

1. [`REWRITE_PLAN_CHECKLIST.md`](./REWRITE_PLAN_CHECKLIST.md)
2. [`docs/README.md`](./docs/README.md)
3. [`docs/current/rewrite-multiplayer-core-plan.md`](./docs/current/rewrite-multiplayer-core-plan.md)
4. [`docs/current/architecture-overview.md`](./docs/current/architecture-overview.md)
5. [`docs/current/realtime-runtime.md`](./docs/current/realtime-runtime.md)
6. [`docs/current/legacy-realtime-retirement-stage9-2026-07-07.md`](./docs/current/legacy-realtime-retirement-stage9-2026-07-07.md)
7. [`docs/current/stage10-loadtest-gray-release-checklist-2026-07-07.md`](./docs/current/stage10-loadtest-gray-release-checklist-2026-07-07.md)
8. [`docs/current/map-secret-realm.md`](./docs/current/map-secret-realm.md)
9. [`docs/current/combat.md`](./docs/current/combat.md)
10. [`docs/current/ai-generation-and-crafting.md`](./docs/current/ai-generation-and-crafting.md)
11. [`docs/current/open-world.md`](./docs/current/open-world.md)
12. [`docs/current/plugins-and-progression.md`](./docs/current/plugins-and-progression.md)
13. [`docs/current/admin-ops-deployment.md`](./docs/current/admin-ops-deployment.md)
14. [`src/modules/README.md`](./src/modules/README.md)

## 开发命令

- `bun run dev`
- `bun run build`
- `bun run start`
- `bun run game:dev`
- `bun run game:start`
- `bun run game:smoke`
- `bun run game:load:basic`
- `bun run game:load:map-shards`
- `bun run game:load:map-move`
- `bun run game:load:repair`
- `bun run game:load:reconnect`
- `bun run game:load:combat-command`
- `bun run game:load:boss-command`
- `bun run game:load:pvp-command`
- `bun run game:load:settlement-intent`
- `bun run game:load:stage10-local`
- `bun run game:load:stage10-scale-local`
- `bun run lint`
- `bun run db:setup`

## 当前文档规则

- `docs/current/*`
  - 当前权威文档
- `docs/.bak/2026-07-07/plugin/*`
  - 历史插件系统参考，不再作为新开发入口
- `src/modules/.bak/2026-07-08/plugin`
  - 阶段 9 归档的旧插件源码，只作迁移追溯，不作为运行时模块
- `docs/.bak/*`
  - 历史归档，不作为当前规则依据
- 阶段 9 旧 realtime 退役前必须先看 `docs/current/legacy-realtime-retirement-stage9-2026-07-07.md`，避免误删仍被 H5 客户端使用的 active legacy 链路。

## 许可证

本项目采用 MIT License，完整条款见 [LICENSE](./LICENSE)。

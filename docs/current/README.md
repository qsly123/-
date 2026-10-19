# 当前权威文档导航

`docs/current/*` 是项目当前实现和后续执行的权威文档区。

新开线程、继续排障、准备部署或执行阶段清单时，先读本页，再按专题跳转。不要直接从日期热修记录开始执行。

## 推荐阅读顺序

1. `../../REWRITE_PLAN_CHECKLIST.md`
   - 根目录唯一阶段执行清单。继续开发时必须先按“当前执行优先级：底层优先门禁”从上到下推进；“2026-07-09 大整合后未完成来源池”只作追溯，不作执行顺序。
2. `architecture-overview.md`
   - 项目整体定位、分层与核心模块边界。
3. `realtime-runtime.md`
   - 当前 realtime / Colyseus / 旧入口退役后的运行口径。
4. `admin-ops-deployment.md`
   - 部署、容器、1Panel、后台与运维注意点。

## 当前权威专题

### 全局架构与多人在线

- `game-server-colyseus-foundation-2026-07-07.md`
- `h5-client-cross-platform-2026-07-07.md`
- `h5-ui-content-and-runtime-rules.md`
- `realtime-runtime.md`

### 地图 / 开放世界 / 社交

- `map-secret-realm.md`
- `open-world.md`
- `open-world-contracts.md`
- `social-stage7-presence-room-2026-07-07.md`
- `map-first-load-read-model-and-refresh.md`

### 战斗 / Boss / PVP

- `combat.md`

### 后台 / 运维

- `admin-stage8-game-server-monitor-2026-07-07.md`
- `admin-ops-deployment.md`
- `h5-ui-content-and-runtime-rules.md`

### 真机验收清单

- `acceptance/system-b-nearby-chat.md` — 附近频道边界（P2-A）
- `acceptance/system-d-offline-repair-layout.md` — 离线恢复 / 自动 repair / PC 纵屏布局（P2-B）

### 角色 / 成长 / AI 物品

- `core-gameplay-data-driven-design-2026-07-07.md`
- `plugins-and-progression.md`
- `ai-generation-and-crafting.md`
- `h5-ui-content-and-runtime-rules.md`

## 当前重构口径

- 插件体系已经退役，不再作为新增玩法扩展方向；剩余 `src/modules/plugin` 源码已归档到 `src/modules/.bak/2026-07-08/plugin`。
- 新玩法必须进入固定核心模块，并同步 schema、service、页面、后台入口和 MD。
- 双修、功法、灵田、论道、炼丹、炼器的当前归属以 `core-gameplay-data-driven-design-2026-07-07.md` 为准。
- 地图、战斗、Boss、PVP 的多人在线底座迁向 `Colyseus + Phaser + Redis + Postgres`。
- 阶段 9 本轮地图 / combat / Boss 旧 realtime 入口已按 `.bak/<日期>/` 规则归档；聊天、附近频道、通知 SSE 不属于本轮退役范围，后续单独规划。
- 继续推进到成品时，只按根目录 `REWRITE_PLAN_CHECKLIST.md` 顶部“当前执行优先级：底层优先门禁”执行；P0/P0-B 未过时，不得直接开高层玩法或上线灰度项。
- 旧 PVP replay 主流程已归档到 `src/modules/.bak/2026-07-08/combat/pvp-replay/`。

## 已归档的误导性旧文档

以下文档已经移出 `docs/current`，只作为历史追溯，不再作为当前执行依据：

- 旧地图 / 战斗 realtime 热修：`docs/.bak/2026-07-08/realtime-legacy-hotfixes/`
- 旧双修插件宿主 / Hook / runtime 资料：`docs/.bak/2026-07-08/plugin-legacy-double-cultivation/`
- 旧插件专题文档：`docs/.bak/2026-07-07/plugin/`
- 旧移动端 UI、前台文案、开放世界引导和后台计时器单点热修：`docs/current/.bak/2026-07-09/current-md-consolidation/`
- 旧阶段 2 插件退役记录与 2026-07-08 清单审计历史：`docs/current/.bak/2026-07-09/current-md-consolidation/`
- 旧阶段详单、成品剩余总表、阶段 9 前置门禁和阶段 10 压测清单：`docs/current/.bak/2026-07-09/root-checklist-consolidation/`

归档原因：

- 旧文档描述的是 `server.mjs`、`realtime-server.mjs`、旧 SSE / WS、shared watcher 或插件宿主时代的修复。
- 当前执行主线已经切到 Colyseus 阶段清单和核心模块开发规则。
- 后续不能再把 ACK 骨架、灰度壳、旧 runtime 热修误判为“旧入口可删除”。

## 文档维护规则

- 规则级内容优先更新 `docs/current/*`。
- 阶段执行状态只更新 `../../REWRITE_PLAN_CHECKLIST.md`。
- 模块内入口、服务、职责说明优先更新 `src/modules/*/README.md`。
- 日期型热修文档只有在无法归入现有权威文档时才新增；新增后必须同步补索引。
- 过期文档先移动到 `.bak/<YYYY-MM-DD>/`，不要硬删。
- 中文文档必须保持 UTF-8，不允许乱码回写。

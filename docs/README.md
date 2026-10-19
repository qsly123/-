# 文档总览

这份文件只回答一件事：现在应该从哪里开始读项目文档。

当前权威阅读入口集中在：

- `docs/current/README.md`
- `REWRITE_PLAN_CHECKLIST.md`

后续开发、排查和 AI 阅读默认都应从这两个入口开始，不要直接翻日期热修文档。执行任务时必须以 `REWRITE_PLAN_CHECKLIST.md` 顶部“当前执行优先级：底层优先门禁”为准，不得跳过 P0 / P0-B 直接做高层玩法项。

## 当前文档分层

### 1. 当前权威文档

- `docs/current/*`

这里存放：

- 当前仍然生效的系统规则
- 跨模块实现口径
- 当前专题总览和运行口径
- 专题总览与阅读导航

### 2. 历史归档

- `docs/.bak/<日期>/*`

这里存放：

- 已被当前文档吸收的历史热修
- 不再适合作为当前权威入口的旧专题记录
- 插件、旧 realtime、旧 host / hook 资料

已归档重点：

- `docs/.bak/2026-07-07/plugin/`：历史插件系统参考。
- `docs/.bak/2026-07-08/realtime-legacy-hotfixes/`：旧地图 / 战斗 realtime 热修记录。
- `docs/.bak/2026-07-08/plugin-legacy-double-cultivation/`：旧双修插件宿主、Hook、runtime 资料。

这些资料只能用于追溯，不得作为新功能开发或阶段 9 删除旧入口的执行依据。

## 当前推荐阅读入口

### 全局入口

- `REWRITE_PLAN_CHECKLIST.md`
- `docs/current/README.md`
- `docs/current/game-server-colyseus-foundation-2026-07-07.md`
- `docs/current/realtime-runtime.md`
- `docs/current/h5-ui-content-and-runtime-rules.md`

### 高频专题

- `docs/current/social-stage7-presence-room-2026-07-07.md`
- `docs/current/admin-stage8-game-server-monitor-2026-07-07.md`
- `docs/current/core-gameplay-data-driven-design-2026-07-07.md`
- `docs/current/plugins-and-progression.md`
- `docs/current/h5-ui-content-and-runtime-rules.md`

阶段推进、未完成项、阶段 9 旧 realtime 退役边界和阶段 10 上线检查都已收口到：

- `REWRITE_PLAN_CHECKLIST.md`

其中“当前执行优先级：底层优先门禁”是唯一执行顺序；历史阶段段落和来源池只用于追溯、核对和补文档。

## 文档维护规则

- 规则级内容优先更新 `docs/current/*`。
- 阶段状态优先更新 `REWRITE_PLAN_CHECKLIST.md`。
- 模块内入口、服务、职责说明优先更新 `src/modules/*/README.md`。
- 某次单独热修允许新增日期文档，但若该主题已有专题总览，必须同步补索引。
- 根目录 `docs/` 不再继续堆放零散热修文档；过期内容统一进 `.bak/<日期>/`。
- 禁止把旧插件、旧 SSE / WS、旧 shared watcher 文档重新放回当前执行入口。
- 日期型单点 UI、文案、开放世界引导和计时器热修记录已经整合到 `docs/current/h5-ui-content-and-runtime-rules.md`，不要再把旧散文档放回 `docs/current`。
- 旧阶段详单已经整合进 `REWRITE_PLAN_CHECKLIST.md`，不要再新建同类日期型阶段清单。

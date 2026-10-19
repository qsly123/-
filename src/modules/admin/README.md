# Admin 模块

## 模块定位

后台负责运营、治理与系统级编辑，不只是表单 CRUD。

## 当前重点

- 通用实体管理
- `AI物品` 与正式物品分栏
- 地图、秘境、怪物、物品、任务、技能、系统配置编辑
- 固定核心模块后台配置
- 性能分析与健康检查
- 开放世界后台总控
- 阶段 8 实时房间监控

## 关键入口

- 页面
  - `/admin`
  - `/admin/dashboard`
  - `/admin/open-world`
  - `/admin/game-server`
  - `/admin/[entity]`
- 接口
  - `/api/admin/[entity]`
  - `/api/admin/performance`
  - `/api/admin/game-server/health`
  - `/api/admin/system-config-items`

## 核心服务

- `admin-entities.ts`
- `admin-entity-access.ts`
- `admin-ui-config.ts`
- `realm-config-mutation.ts`
- `game-server-health.ts`

## 关联文档

- [`docs/current/admin-ops-deployment.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/admin-ops-deployment.md)
- [`docs/current/admin-stage8-game-server-monitor-2026-07-07.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/admin-stage8-game-server-monitor-2026-07-07.md)
- [`docs/current/core-gameplay-data-driven-design-2026-07-07.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/core-gameplay-data-driven-design-2026-07-07.md)
- [`docs/current/map-secret-realm.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/map-secret-realm.md)
- [`docs/current/open-world.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/open-world.md)

## 注意点

- 后台新增配置必须走固定页面、固定实体或 `SYSTEM_CONFIG_ITEMS`，不再通过插件菜单或插件配置 Hook 注册。
- `AI物品` 是唯一的 AI 物品治理入口，不能再把 AI 清理塞回正式物品页。
- 地图类型、秘境类型、运行时类型调整后，要同步检查后台筛选与编辑器。
- `/admin/game-server` 当前读取独立 `game-server` 的 `/game-server/health`，不等于旧 web runtime 性能面板。
- Web 容器内优先通过 `GAME_SERVER_INTERNAL_URL` 读取健康状态；1Panel 当前使用 `http://immortality-game-server:3201`。不要把后台探测地址固定到 `172.18.0.x` Docker 内网 IP。
- `/admin/game-server` 已接入 P1-A 观测字段：房间人数、分片、tick、消息量、repair、移动拒绝原因、房间级重连成功率、落账失败、WebSocket fallback/error 细分、`SocialRoom` 在线与拒绝原因，以及 `processes[]` 跨进程聚合表。

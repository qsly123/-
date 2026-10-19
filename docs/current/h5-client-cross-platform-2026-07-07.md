# H5 客户端三端互通口径（2026-07-07）

## 当前结论

客户端主形态是 Web H5，不是 iOS/Android 原生工程。

三端互通默认指：

- iOS Safari / iOS 添加到主屏幕的 PWA
- Android Chrome / Android WebView 包装
- PC Chrome / Edge 等现代浏览器

Capacitor 只作为可选 Android 包装层存在，不能成为游戏前端运行前提。后续地图、战斗、Boss、PVP 接入 `Phaser + Colyseus` 时，浏览器 H5 仍然是一等客户端。

## 本轮检查到的准确缺口

- `src/app/layout.tsx` 已有 manifest 与 `viewport-fit=cover`，但缺少 iOS 主屏幕 H5 常用的 `appleWebApp`、Apple touch icon 与格式识别关闭配置。
- `public/manifest.webmanifest` 没有声明 `orientation`，不利于维持纵屏优先的 H5 游戏形态。
- `public/offline.html` 没有 `viewport-fit=cover` 与 safe-area 留白，离线页在 iPhone 刘海屏 / 灵动岛区域可能贴边。
- `ClientRuntimeBoot` 只用 `window.innerHeight` 写入 `--app-height`，iOS Safari 地址栏、底栏和横竖屏切换时不如 `visualViewport` 稳定。
- 真实 `WebSocket` / `EventSource` 创建点只出现在 `src/modules/shared/services/realtime-channel.ts`，玩法页面没有直接裸连，符合共享实时封装要求。

## 已加固内容

- 根布局增加：
  - `applicationName`
  - `appleWebApp.capable`
  - `appleWebApp.statusBarStyle = black-translucent`
  - Apple touch icon
  - 电话、日期、地址、邮箱、URL 自动识别关闭
- Manifest 增加：
  - `id`
  - `display_override`
  - `orientation = portrait-primary`
- 离线页增加：
  - `viewport-fit=cover`
  - `theme-color`
  - iOS standalone meta
  - safe-area padding
  - `100dvh`
- 客户端运行时高度变量改为优先使用 `window.visualViewport`，并在 resize、visualViewport resize/scroll、orientationchange 后同步。
- `/game/map` 的 Colyseus AOI hook 增加 H5 前后台恢复 repair：`visibilitychange`、`pageshow`、`focus`。
- `/game/map` 的 Colyseus AOI hook 在发现 `sector_delta` 版本断层时自动发送 `repair`，避免 H5 弱网或后台恢复后实体残留。
- 阶段 5 `/game/map` 的 iOS Safari、iOS 添加到主屏幕、Android Chrome、PC 浏览器三端人工验收已由用户确认通过。

## 地图 Colyseus 灰度模式

地图页新增客户端环境变量：

- `NEXT_PUBLIC_WORLD_MAP_COLYSEUS_MODE=off`
  - 关闭 Colyseus AOI / 影子同步。
- `NEXT_PUBLIC_WORLD_MAP_COLYSEUS_MODE=shadow`
  - 默认值。旧 `/api/game/map/move` 仍是线上落账主链，Colyseus 只做 AOI 展示和旧移动成功后的影子同步。
- `NEXT_PUBLIC_WORLD_MAP_COLYSEUS_MODE=main`
  - 预留给后续正式切 Colyseus 移动主链。当前不要把它理解为已完成主链切换。

## 后续开发规则

- 新客户端能力必须先保证 Web H5 可运行，再考虑 Capacitor 包装。
- 不能把地图、战斗、Boss、PVP 的主流程写成只依赖原生桥能力。
- 新实时玩法页必须通过共享客户端封装接入，旧链路用 `realtime-channel.ts`，新 Colyseus 链路用 `colyseus-game-client.ts`。
- 游戏页继续保持纵屏优先。PC 端是更宽视口下的 H5 适配，不改造成后台面板式横向游戏。
- iOS 相关布局必须考虑：
  - `viewport-fit=cover`
  - `env(safe-area-inset-*)`
  - `visualViewport`
  - Safari 地址栏高度变化

## 验收清单

- [x] iPhone Safari 直接打开 `/game/map`，顶部和底部不被系统安全区遮挡。
- [x] iPhone 添加到主屏幕后打开，仍进入 H5 游戏而不是原生依赖页。
- [x] Android Chrome 打开 `/game/map`，底部导航和操作区可点击。
- [x] PC 浏览器打开 `/game/map`，仍保持纵向游戏布局。

剩余验收项已收口到根目录 `REWRITE_PLAN_CHECKLIST.md` 的“P2：H5 三端体验和离线细节”，本专题不再单独维护可执行复选框，避免后续重复漏勾。

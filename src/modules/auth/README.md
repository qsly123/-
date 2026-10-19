# Auth 模块

## 模块定位

负责账号认证、会话、当前角色选择与后台鉴权。

## 关键入口

- 页面
  - `/login`
  - `/register`
  - `/select-character`
  - `/create-character`
- 接口
  - `/api/auth/login`
  - `/api/auth/register`
  - `/api/auth/logout`
  - `/api/auth/me`
  - `/api/auth/linuxdo/*`

## 核心服务

- `services/auth.ts`
- `services/admin-auth.ts`

## 当前规则

- `SESSION_COOKIE` 保存账号会话
- `ACTIVE_PLAYER_COOKIE` 保存当前角色
- 任何依赖当前玩家的接口都要同时校验账号和当前角色
- OAuth 是否可用由 `system` 配置控制

## 关联文档

- [`docs/current/architecture-overview.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/architecture-overview.md)
- [`docs/current/admin-ops-deployment.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/admin-ops-deployment.md)

## 注意点

- 认证链路会影响所有玩家接口与后台接口，改动时不要只测登录页。

# System 模块

## 模块定位

负责全局配置、功能开关、运行时健康与部署版本。

## 当前重点

- `system_configs` 统一读取
- 配置 key 注册
- OAuth / LLM / 游戏规则 / Prompt / 核心玩法配置
- `/api/system/health`
- `/api/system/version`

## 核心服务

- `system-config.ts`
- `system-config-keys.ts`
- `feature-switch.ts`
- `deployment-version.ts`
- `runtime-performance.ts`

## 关联文档

- [`docs/current/admin-ops-deployment.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/admin-ops-deployment.md)
- [`docs/current/realtime-runtime.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/realtime-runtime.md)

## 注意点

- 新增全局配置先注册 key，再做后台与调用方接入。
- 插件配置 Hook 已退役，后台系统配置项只从 `SYSTEM_CONFIG_ITEMS` 固定注册读取。
- `/api/system/health` 是探活口，不能被登录态拦截。

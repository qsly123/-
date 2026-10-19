# 地图首载、读模型缓存与结构刷新

## 本轮目标

这轮不是继续压 ACK，也不是继续改 codec，而是收口地图第三阶段里的第一批高价值问题：

- full 首载仍会等待大量低频面板数据
- 结构变化类同步仍会被静默刷新防抖拖慢
- 短时间重复进图/重复 full 时，上下文仍会重复组装

## 主要改动

### 1. full 面板读模型缓存

新增：

- `src/modules/map/services/map-read-model-cache.ts`
- `src/modules/map/services/map-full-panel-data.ts`

当前 `/api/game/map` 的 full 模式改成：

- 主场景 `sceneResponseData` 继续优先组装
- travel、linked maps、开放世界摘要、成人邀约、追杀提示等低频面板数据改由 `loadFullMapPanelData(...)` 统一承载
- 同一玩家在同一地图内的重复 full 请求，会优先命中读模型缓存并复用 in-flight promise

### 1.1 full 面板缓存继续拆成分段 key

这轮继续把 full 面板缓存从“大整包 key”拆成了多个独立 section：

- `travel`
  - linked maps、portal 列表、travel mode
- `secret-realm`
  - 可见秘境入口、当前秘境态
- `world-base`
  - 公告、PVP 可用性、开放世界探索摘要、objective points
- `world-player`
  - 玩家压力、邀约、街区状态、故事线、事件 offer、合同

统一前缀现在收口为：

```text
map:panel:${mapId}:
```

这样做的目的不是只让缓存条目变多，而是让：

- 结构变化时仍能按地图统一前缀批量失效
- 玩家相关和地图公共数据不再强绑成同一包
- 后台读模型命中率能更真实反映哪些 section 在复用

### 2. scene-loader 上下文缓存适度放宽

`map-scene-loader.ts` 当前支持：

- `MAP_SCENE_CONTEXT_CACHE_TTL_MS`

默认值从更短的旧口径提升到 `2000ms`，用于降低短时间重复进图和重复 full 刷新的重复组装。

### 3. 结构变化即时 silent refresh

`useMapSceneController.ts` 当前把 `map_refresh` 分成更明确的处理：

- `monster_defeat`
- 其他结构刷新信号

这类消息现在允许在非移动态下直接触发 silent refresh，不再一律被 `900ms debounce + 2500ms min interval` 拖住。

### 4. 结构性刷新会 force 绕过旧 scene context cache

当前 `refreshMode=silent` 并不是所有情况都复用短 TTL scene context cache。

当原因属于结构性变化时，会改成 `force: true` 重新加载：

- `map_changed`
- `runtime_restart`
- `snapshot_chain_break`
- `scene_version_gap`
- `missing_connection_window`
- `monster_defeat_signal`
- `map_refresh_signal`
- `event_modal_close`
- `ack_timeout_resync`

这样做是为了把“怪物已击败但图上还残留”“机缘触发/关闭后图标没及时消失”“跨图后旧场景短时间残影”都收回到同一条强同步链里。

### 5. 结构事件会主动失效地图缓存

`map-presence.ts` 当前在以下事件里会主动失效当前进程缓存：

- `publishMapOpportunitySpawned(...)`
- `publishMapOpportunityClaimed(...)`
- `publishMapSecretRealmChanged(...)`
- `publishMapRefresh(...)`

失效范围包括：

- `map-scene-loader` 的 scene context cache
- `map-full-panel-data` 的分段面板读模型缓存

其中面板缓存 key 当前按 `map:panel:${mapId}:...` 分段，方便按地图前缀批量失效。

### 6. 地图实体可见性口径已对齐

本轮把“其他玩家”的可见性改成与 NPC/怪物一致的 `clear + shallow`，并同步收口了两层逻辑：

- 服务端 `filterMapSceneStateByVision(...)`
- 前端 `MapGrid` 的浅雾实体过滤

这一步修的是之前的口径不一致问题：接口或 scene snapshot 里玩家已经进入可见区域，但 Canvas 仍把浅雾中的玩家吞掉，表现为“NPC/怪物正常，玩家要再靠近一格才出现”。

### 7. 机缘触发先做本地即时移除

当前地图页在机缘确认触发时，会先把“玩家当前落脚点上的机缘图标”从本地 `sceneData + sceneSnapshot` 里同步移除，再继续走 `silent refresh` 做权威对齐。

这样做的目的，是把“机缘事件已经弹出来了，但地图上旧图标还残留一小会儿”的窗口先压掉，减少纯前端可见的残影。

### 8. 秘境当前态改为轻量补齐，不再只等 full

当前 `currentSecretRealm` 这类秘境当前态字段，包括：

- `canLeaveNow`
- `bossDefeatedAt`
- `bossGateStatus`
- `dropIntelPreview`

之前实际上挂在 `panelData`，而 `panelData` 只在 full 更新，导致这类情况会出现明显滞后：

- 怪物/Boss 已击败，但秘境门状态仍旧落后
- 已经满足离开条件，但面板仍显示不可离开
- 掉落情报、Boss 状态需要等下一次 full 才刷新

本轮地图页新增了一个轻量同步器：

- 接口：`/api/game/secret-realm/current`
- 触发时机：
  - `silent refresh` 成功后
  - 页面重新聚焦 / 从后台切回前台
  - 玩家身处秘境或本地仍持有秘境当前态时的短轮询
- 更新范围：
  - 只 patch `rawPanelData.currentSecretRealm`
  - 不重新拉 full
  - 不参与 realtime 主热链

这样做的目标，是把秘境内“场景实体已经同步，但侧栏/面板当前态还停在旧值”的窗口压掉，同时避免重新把 full 面板组装拖回高频路径。

## 运行时默认环境

当前已内置到镜像与 entrypoint：

```env
MAP_SCENE_CONTEXT_CACHE_TTL_MS=2000
MAP_PANEL_READ_MODEL_CACHE_TTL_MS=8000
MAP_PANEL_READ_MODEL_CACHE_STALE_MS=60000
```

## 预期收益

- 首次进图后的重复 full 刷新更快
- full 模式下重复组装开放世界低频面板的成本下降
- 怪物击败、秘境切换后的残影/晚消失减少
- full 面板不同 section 的缓存命中更稳定，不再一 miss 就整包重建
- 为下一步“实体生命周期统一 + 首帧最小 scene bootstrap”打基础

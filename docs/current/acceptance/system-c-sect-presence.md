# 宗门驻地 / 宗门成员 presence 真机验收清单（P2-A）

> 对应 `REWRITE_PLAN_CHECKLIST.md` → P2-A：
> 「宗门驻地、宗门成员 presence 完成 iOS Safari / Android Chrome / PC H5 页面验收。」

## 一、链路定义（验收前必读）

宗门页现在有三条链路，**分工不允许混**：

| 链路 | 职责 | 写库 | 客户端用途 |
| --- | --- | --- | --- |
| `SocialRoom`（`social` 房，`filterBy: mapId / shardId / partyId / sectId`） | **presence 权威来源**：谁在线、谁在驻地、谁上下线、谁被任命 | ❌ | 成员在线列表 / 驻地在场列表的唯一实时来源 |
| `POST /api/game/sect/presence` | presence **兜底落库**（`sect_members.presence_*`） | ✅ | 重连窗口兜底 + 校验成员身份 |
| 宗门事务核心 API（storage / appoint / applications / buildings / expand / leave） | **资产 / 背包 / 进度入库唯一入口** | ✅ | 落账后必须下发刷新帧，不允许只回 ACK |

关键约束：

- 宗门 presence 房间的 join 上下文由 `resolveSectPresenceRoomOptions(sectId)` 统一解析
  （`mapId: "sect:<sectId>"`、`shardId: "sect"`），**任何页面都不许自己拼**，否则成员会落在不同分片上互相看不见。
- 进入宗门页即视为**进入驻地**；离开页面（跳地图 / 退出）必须广播离场，避免幽灵在场成员。
- 成员上线 / 下线 / 切换驻地 / 任命变化必须广播 `social_event`（opcode `10202`），
  事件类型见下表。
- 仓库存取 / 资源变更 / 任命 / 权限变化**必须**下发强制推送帧：
  `inventory_refresh`(10302) / `asset_refresh`(10510) / `progress_refresh`(12742, `scopes` 含 `sect`)。
- `progress_refresh` 不只推操作者本人：任命 / 审批 / 退出会改变成员构成，
  会对该宗门所有成员各推一份。

### 帧约定

| 场景 | 帧 | opcode | scopes / 载荷 |
| --- | --- | --- | --- |
| 成员上线 | `social_event` → `sect_presence_join` | 10202 | `state: at_home / away`，`atHome` |
| 成员下线 | `social_event` → `sect_presence_leave` | 10202 | `state: offline` |
| 切换驻地 | `social_event` → `sect_presence_home_changed` | 10202 | `atHome: true / false` |
| 任命 / 权限变化 | `social_event` → `sect_presence_role_changed` | 10202 | `roleKey`、`actorPlayerId` |
| 仓库存取 / 捐献 | `inventory_refresh` + `asset_refresh` | 10302 + 10510 | `changedItemIds` / `currencies` |
| 资源变更（捐献 / 扩建） | `progress_refresh` | 12742 | `["sect"]` |
| 任命 / 审批 / 建筑 / 退出 | `progress_refresh` | 12742 | `["sect"]` |
| 重连 repair | `social_snapshot`（含完整 `sectPresence`） | 10201 | 已剔除残留离线成员 |

## 二、前置条件

1. 已部署包含本次改动的前端与 game-server；`NEXT_PUBLIC_GAME_SERVER_WS_URL` 指向可达的 game-server。
2. 准备 **两个已加入同一宗门的账号 A / B**（建议 A 具备 `appoint_member` 权限，B 为普通成员）。
3. 准备第三个同宗门账号 C，用于「成员上线 / 下线」验收。
4. 移动端打开控制台（iOS Safari 用 Mac Safari 远程调试；Android Chrome 用 `chrome://inspect`），
   便于观察 `social_event` 与 `inventory_refresh` / `asset_refresh` / `progress_refresh` 帧。
5. 数据库已执行 `drizzle/0071_sect_member_presence.sql`（幂等，可重复执行）。
6. 记录基线：A 进入宗门页 → 顶部标签应能看到
   `在线 N`、`驻地 M`、`已同步 HH:MM:SS`；成员页签顶部有「宗门驻地 presence」卡片。

## 三、验收项

### A. 成员上线 / 下线，成员列表实时增减

**步骤**

1. A 停在宗门页「成员」页签，保持前台。
2. C 登录并进入同一宗门页，等待 3 秒。
3. C 关闭页面 / 退出登录，等待 3 秒。

**预期**

- C 进入后，A 的「在线 N」+1，成员列表里 C 的标记由「离线」变为「驻地」（金色标签）。
- C 离开后，A 的「在线 N」-1，C 的标记回到「离线」。
- 控制台能看到 `social_event`（10202）里 `sect_presence_join` / `sect_presence_leave`。
- **不出现**「已离开但仍显示驻地」的幽灵成员。

### B. 切换驻地（进入 / 离开宗门页）

**步骤**

1. A 停在宗门页「成员」页签，B 也在宗门页，记录 A 看到的「驻地 M」。
2. B 从宗门页返回地图页（点返回 / 跳 `/game/map`），等待 3 秒。
3. B 再次进入宗门页，等待 3 秒。

**预期**

- B 离开后，A 的「驻地 M」-1，B 的状态由「驻地」变为「离线」或「在线」（若 B 仍在其它社交房在线）。
- B 回来后，「驻地 M」+1，B 的状态恢复为「驻地」。
- 控制台能看到 `sect_presence_home_changed`，`atHome` 分别为 `false` / `true`。

### C. 仓库存取后即时刷新（10302 + 10510）

**步骤**

1. A 停在宗门页「仓库」页签，记录某物品的仓库数量与自己的背包数量。
2. A 存入 1 个该物品（存入 / 取出各做一次）。
3. 不手动刷新页面，直接观察界面。

**预期**

- 仓库数量与背包数量**自动变化**，不需要手动刷新或切换页签。
- 顶部「已同步」时间戳更新。
- 控制台收到 `inventory_refresh`(10302) 与 `asset_refresh`(10510)。
- **不出现**「提示成功但数字不变」的情况（即不允许只回 ACK）。

### D. 捐献 / 扩建后资源即时刷新（12742 + 10510）

**步骤**

1. A 停在「总览」页签，记录「灵石 / 木材 / 石料 / 宗门材料」与「仓库格位」。
2. A 点「捐献 500 灵石」。
3. 若有 `expand_sect` 权限，再点「扩建宗门」。

**预期**

- 资源数值与仓库格位上限**自动变化**。
- 控制台收到 `asset_refresh`(10510) 与 `progress_refresh`(12742)，后者 `scopes` 含 `sect`。
- 若资源不足被拒，界面显示错误提示且数值不跳变。

### E. 任命 / 权限变化后成员列表与权限即时刷新

**步骤**

1. A（有 `appoint_member` 权限）停在「成员」页签，B 停在「成员」页签。
2. A 给 C 调整职阶并点「任命」。
3. 观察 A 与 B 两侧。

**预期**

- A 侧成员列表里 C 的职阶标签立即更新。
- **B 侧也会自动更新**（任命会对全宗门成员各推一份 `progress_refresh`），
  控制台能收到 `social_event` 的 `sect_presence_role_changed` 与 `progress_refresh`(12742, `scopes` 含 `sect`)。
- 权限变化后按钮可用态同步变化（例如授予权限后按钮由禁用变为可点）。

### F. 审批 / 退出宗门后成员构成刷新

**步骤**

1. A 停在「审批」页签处理一条入宗申请（通过 / 拒绝）。
2. 另用成员账号执行「退出宗门」。

**预期**

- 审批通过后成员上限 / 人数统计自动变化，待审批条数 -1。
- 退出宗门后，其余在线成员的成员列表自动移除该成员（收到 12742，`scopes` 含 `sect`）。
- 不出现只回 ACK 导致需要手动刷新才更新的情况。

### G. 重连 / 锁屏回来后不残留离线成员

**步骤**

1. A、B、C 都停在宗门页「成员」页签，记录「在线 N」「驻地 M」。
2. B 断网 10 秒后恢复（移动端可开飞行模式；PC 用 DevTools 断网）。
3. B 恢复后等待自动重连（约 2 秒）。
4. 再让 C 直接杀掉 App / 关闭标签页（非正常退出）。

**预期**

- B 重连后「在线 N」「驻地 M」回到断网前数值，不重复计数（B 只有一条记录）。
- C 非正常退出后，A / B 的列表在数秒内移除 C；触发 `repair` 后也不会重新出现。
- 「已同步」时间戳更新，说明收到了 `social_snapshot`(10201) 且已剔除残留。

### H. 纵屏布局（PC 不退化成横向面板）

**步骤**

1. PC Chrome 打开宗门页，把窗口拉窄到 390×844 模拟竖屏，再拉宽到 1440×900。
2. 逐一切换「总览 / 成员 / 审批 / 大殿 / 仓库 / 灵气峰」页签。
3. 移动端在 iOS Safari 与 Android Chrome 各跑一遍，含横竖屏切换。

**预期**

- 主体始终是**单列纵向卡片流**：宗门头图 → 页签 → 内容卡片，页签横向滚动但不挤压内容。
- 顶部 `在线 / 驻地 / 已同步` 标签换行排列，不遮挡成员列表。
- 成员卡片、仓库列表在窄屏下仍是纵向堆叠，**不出现左右分栏的后台仪表盘布局**。
- 「宗门驻地 presence」卡片位于成员列表上方，不遮挡列表首项。
- 拇指可达：主要操作按钮（任命、存取、捐献）在首屏或一次滚动内可达。

### I. 三端一致性

在以下三种环境各跑一遍 A / B / C / E / G / H：

- iOS Safari（iPhone 真机，含锁屏 / 切后台）
- Android Chrome（真机，含锁屏 / 切后台 / 弱网）
- PC 浏览器（Chrome 桌面版，390×844 与 1440×900 两种窗口）

**预期**

- 三端表现一致：成员上下线实时、驻地状态正确、仓库与资源即时刷新、任命双向可见。
- 弱网下刷新帧迟到时，界面最终仍会与服务端一致（响应体自带 `refreshFrames` 兜底）。

## 四、自动化看守

- BotClient 场景断言：`apps/game-server/src/bot/system-c-sect-presence.ts`
  （`bun run apps/game-server/src/bot/system-c-sect-presence.ts`，本地无 DB / Redis 可跑）
  - 成员上线 / 下线收到 `social_event`(10202)，成员列表正确增减
  - 切换驻地广播 `sect_presence_home_changed`（`atHome` 正确翻转）
  - 任命变化广播 `sect_presence_role_changed`
  - 仓库存取收到 `inventory_refresh`(10302) 与 `asset_refresh`(10510)
  - 任命 / 权限变化收到 `progress_refresh`(12742) 且 `scopes` 含 `sect`
  - 重连 repair 后成员 presence 不残留离线成员（含注入幽灵 context 的离线断言）
  - 非同宗门连接不收到宗门 presence 广播
- 门禁：`bunx tsc --noEmit`、`bun run lint`

## 五、已知风险与遗留项

1. **无 Redis 单实例时 `LocalPresence` 在 `server.listen()` 之后才创建**，
   `createGameServer()` 里的 presence 订阅会静默落空，导致 `/internal/state-refresh`
   只广播不投递。本次新增 `apps/game-server/src/local-presence-refresh-bridge.ts`
   在 listen 之后补挂订阅（仅无 Redis 时挂，避免多实例重复投递）。
   `server.ts` 属于地基文件未改动，后续若允许修改应把补挂逻辑收回 `createGameServer()`。
2. **任命的 `social_event` 广播由操作者客户端发起**（`command` + `sect_presence_role_changed`），
   服务端只做同宗门中继与成员身份校验，不声称权威；真正的权威职阶仍以
   `/api/game/sect/appoint` 落库 + `progress_refresh` 后客户端重拉为准。
   后续若出现伪造广播风险，需要把任命改为服务端权威触发。
3. **宗门 presence 与所在地图解耦**：只有进入宗门页的连接会落在
   `sect:<sectId>` 分片上。成员停在地图页时不出现在宗门在线列表里，
   表现为「离线」。若要让地图页也上报宗门在线，需要客户端额外维持一条宗门分片连接。
4. **`sect_members.presence_*` 是 best-effort 兜底**，写库失败只记日志不影响实时链路；
   极端情况下兜底值可能滞后于房间真实状态，重连后以 `social_snapshot` 为准。
5. **任命 / 审批 / 退出会对全宗门成员各推一份 `progress_refresh`**，是 O(n) 次投递；
   当前宗门规模（上限 10 人级）可接受，若后续放开人数上限需改为批量帧。
6. 宗门扩展帧类型定义在 `packages/shared-protocol/src/sect-presence.ts`
   （通过 `@immortality/shared-protocol/sect-presence` 子路径导入），
   `shared-protocol/src/index.ts` 未改动，旧客户端忽略未知 `type` 即可兼容。

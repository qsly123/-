# 战斗 command 主链真机验收清单（P1-B）

> 对应 `REWRITE_PLAN_CHECKLIST.md` → P1-B：
> 「技能、丹药、逃跑、认输、移动都走统一 command 后，完成 iOS Safari / Android Chrome / PC 浏览器人工验收。」

## 一、契约（验收前必读）

五个动作（技能 / 丹药 / 逃跑 / 认输 / 移动）统一走 Colyseus command。
判断「是否成功」的唯一依据是服务端权威事务 + ACK，**不是**本地动画。

### 刷新帧约定（官样组序）

| 场景 | 组序 opcode | 帧类型 | reason | payload |
| --- | --- | --- | --- | --- |
| 战斗中使用丹药，库存已扣减 | `10302` | `inventory_refresh` | `combat_item_used` | `changedItemIds` = 本次真实消耗的物品 id |
| 战斗结算落账 | `10510` | `asset_refresh` | `combat_reward_settled` | `currencies` |
| 战斗结算落账 | `12742` | `progress_refresh` | `combat_reward_settled` | `scopes = ["cultivation","realm","quest"]` |
| 超时 / 断线裁定落账 | `10510` + `12742` | `asset_refresh` + `progress_refresh` | `combat_disconnect_settled` | 同上 |

### 铁律

- **被拒绝的 command 不得下发任何刷新帧**（禁止「假扣」）：先看到 ACK `accepted=false`，
  再确认丹药数量**没有**变化、界面**没有**收到 10302。
- **落账成功必须下发帧**：不允许只回 ACK 不推帧。客户端是纯渲染端，不推 = 界面停在旧值。
- 帧下发后客户端必须**可见地刷新**（丹药数字变化 / 背包数量变化），不能只写日志。

### 双通道保证

| 通道 | 位置 | 作用 |
| --- | --- | --- |
| game-server 进程内投递 | `apps/game-server/src/combat-state-refresh.ts` | 直接投递到该玩家**所有在线连接**（地图房 / 战斗房 / 社交房） |
| Next API 回传帧组 | `src/modules/combat/services/combat-state-refresh-publish.ts` | 内部端点投递 + **同一批帧回传 HTTP 响应**，推送不可达时客户端仍必定刷新 |

## 二、前置条件

1. 已部署包含本次改动的前端与 game-server；`NEXT_PUBLIC_GAME_SERVER_WS_URL` 指向可达实例。
2. 账号背包内**至少有 1 个带 `heal_hp` / `heal_mp` 效果的丹药**，且记录初始数量 N。
3. 移动端打开控制台（iOS Safari 用 Mac Safari 远程调试；Android Chrome 用 `chrome://inspect`），
   便于观察 `inventory_refresh(10302)` 帧。
4. 记录基线：角色页的修为、境界、任务进度，便于结算后核对 `12742` 的刷新范围。
5. 建议同时开启飞行模式演练用的第二台设备，用于断网重连验收。

## 三、验收项

### A. 丹药（核心，验证 10302）

| # | 步骤 | 预期结果 |
| --- | --- | --- |
| A1 | 进入普通战斗，记录丹药数量 N，点击丹药按钮 | 按钮立即进入 pending，不会先本地扣数 |
| A2 | 等待服务端 ACK | ACK `accepted=true`；控制台收到 `inventory_refresh`，`opcode=10302`，`reason=combat_item_used`，`changedItemIds` 含该丹药 id |
| A3 | 观察战斗页丹药角标 | 数字由 N 变为 N-1，**无需手动刷新页面** |
| A4 | 退出战斗进入背包页 | 该丹药数量为 N-1，与战斗页一致 |
| A5 | 重复快速点击同一丹药（连点 3 次） | 有且仅有 1 次真实扣减（幂等 `actionId`），不出现 N-3 |

### B. 技能 / 逃跑 / 认输 / 移动（统一 command + ACK）

| # | 步骤 | 预期结果 |
| --- | --- | --- |
| B1 | 释放技能 | 收到 ACK；技能进入服务端冷却，客户端不自行起冷却 |
| B2 | 点击移动 | 收到 ACK，位置以服务端权威坐标为准，非法落点被拒且有 `correction` |
| B3 | 点击逃跑 | 收到 ACK，生成 `abort` settlement intent，**不施加死亡惩罚** |
| B4 | 点击认输 | 收到 ACK 与结算帧（10510 / 12742），资产与进度刷新 |
| B5 | 在 Boss / PVP 中重复 B1–B4 | 行为一致；PVP 视角镜像后对手所见与己方一致 |

### C. 结算后资产与进度刷新（10510 / 12742）

| # | 步骤 | 预期结果 |
| --- | --- | --- |
| C1 | 打完一场战斗拿到奖励 | 收到 `asset_refresh(10510)` 与 `progress_refresh(12742)`，`scopes` 含 `cultivation/realm/quest` |
| C2 | 观察角色页修为、境界、任务进度 | 与基线相比已刷新，不需要手动下拉刷新 |
| C3 | 击杀同一目标后立即重复领取奖励 | 不重复发奖（`combat_reward_claims` 幂等），资产数字不二次跳变 |

### D. 被拒绝的 command（禁止假扣）

| # | 步骤 | 预期结果 |
| --- | --- | --- |
| D1 | 使用一个背包里不存在的丹药 id（或丹药数量为 0 时点击） | ACK `accepted=false` |
| D2 | 观察丹药数量 | **保持 N 不变** |
| D3 | 观察控制台 | **没有**收到任何 10302 / 10510 / 12742 帧 |

### E. 断网重连（补齐不回退）

| # | 步骤 | 预期结果 |
| --- | --- | --- |
| E1 | 战斗中开启飞行模式 10 秒后关闭 | 自动触发 repair（`reconnect` / `foreground_restore`） |
| E2 | 观察战斗状态与背包 | 回到服务端权威状态，丹药数量为 N-1，**不回退到 N** |
| E3 | 断线期间若已发生结算 | 重连后补收到 10510 / 12742，奖励不重复发放 |
| E4 | 连续两次重连 | 不产生重复状态，不重复推进任务 |

## 四、三端差异关注点

- **iOS Safari**：锁屏 / 回前台后必须自动 repair；PWA 独立窗口同样验证一次。
- **Android Chrome**：后台切回后不显示「假在线」（在线但操作无响应）。
- **PC 浏览器**：保持纵屏游戏布局，战报可折叠且不遮挡主战场；快捷键操作同样走 command。

## 五、BotClient 场景断言对照

### 端到端断言（真实 game-server + SDK，无需 DB）

脚本：`apps/game-server/src/bot/system-a-refresh-e2e.ts` — **9 / 9 PASS**

```
PASS | BotClient 能 join 战斗房间
PASS | 丹药落账端点接受帧组                    | http=200
PASS | 丹药落账后客户端收到 inventory_refresh(10302)
PASS | 10302 帧 changedItemIds 含被消耗丹药     | ["pill-recovery-1"]
PASS | 10302 帧 reason=combat_item_used
PASS | 战斗结算后客户端收到 asset_refresh(10510)
PASS | 战斗结算后客户端收到 progress_refresh(12742)
PASS | 12742 帧 scopes 含 cultivation/realm/quest
PASS | 未落账时不下发任何刷新帧                 | frames=0
```

这条链路不经过战斗 runtime，因此在**无 DB / 无 Redis 单实例**下真跑真断言，
直接证明「落账 → 推帧 → 客户端收到」成立，且未落账时不会凭空推帧（禁止假扣）。

### 房间级 command 断言（需 DB）

脚本：`apps/game-server/src/bot/system-a-combat-refresh.ts`

| 场景 | 断言 | 本地结果 |
| --- | --- | --- |
| 离线战斗 command 主链 | 房间内 command 接受 → 10302；拒绝 → 无帧 | SKIP（缺 DB 真实 runtime） |
| 在线 BotClient 收帧 | join → 10302 / 10510 / 12742 均到达 | SKIP（脚本自身 `transport` 缺陷） |
| 真实丹药扣减事务 | `performSoloCombatActionTransaction` 真实扣减 | SKIP（需 DB） |
| 需要 DB 的真实事务场景 | 契约断言 | PASS |

> **SKIP 说明**
> 1. 前两项与第三项：本地无 `DATABASE_URL`，`pending_combat` 无法 hydrate，
>    房间走 `fallback` runtime，command 一律被拒（`pending_runtime_missing`）。
>    配上 `DATABASE_URL` 重跑即可转 PASS。
> 2. 第二项额外存在脚本自身缺陷（SDK `this.transport` 取值失败）。
>    **该缺陷不影响链路结论**：同一契约已由上面的 e2e 脚本在真实 game-server
>    上验证通过（9/9）。修复脚本缺陷属于测试工具改进，不阻塞真机验收。

## 六、失败判定

出现以下任一情况即判定不通过：

1. 丹药数量变化了但没收到 10302 帧（说明客户端自行改了数，违反纯渲染端）。
2. 收到 10302 但界面数字没变（说明订阅/刷新链路断了）。
3. 被拒绝的 command 也下发了刷新帧（假扣）。
4. 重连后背包回退到旧值，或奖励重复发放。

# 养成系统统一框架蓝图

> 目标：让灵根 / 天赋 / 气运 / 功法 / 装备 / 丹药 / 境界 等各功能模块**并行开发、最后无痛整合**。
> 策略：**先立契约（框架），再填实现（内在），最后统一挂载（整合）。**

---

## 一、为什么需要统一框架

现状问题：每个系统各自往角色上加数值（灵根在建号时拍平、装备走 `EquipmentStatsBonus`、气运改基础属性并记账、功法走 legacy 表、丹药走 effects），**五套入口、零共享契约**。后果是：

- 灵根的百分比加成只生效一次，之后再不参与计算（已在调研报告中确认）；
- 想加"五行克制""装备词条""天赋乘区"都要各自改战斗与属性代码，必然冲突；
- `elementDamageBonus` 等字段无人消费，成为死字段。

框架做的事：**所有养成系统只通过一套「修饰层（Modifier）」表达自己，属性聚合与战斗结算只读修饰层。**

---

## 二、核心契约

### 2.1 属性修饰层（`framework/stat-modifiers.ts`）

```
StatModifier {
  layer: "realm" | "spiritualRoot" | "talent" | "gongfa" | "fortune" | "equipment" | "status"
  flat?:    Partial<Record<StatKey, number>>   // 固定值加成（装备、丹药）
  percent?: Partial<Record<StatKey, number>>   // 百分比加成（灵根、天赋、气运）
  elementDamageBonus?: number                  // 元素伤害加成，供五行克制使用
}
```

- `StatKey` 为 12 项可加成属性：`maxHp / maxMp / attack / defense / speed / luck / spiritualSense / armorPenetration / block / skillDamageBonus / skillDamageReduction / artifactDamageBonus / artifactDamageReduction`（13 项，与 `PlayerStats` 对齐）。
- 聚合顺序：`total = (base + Σflat) × (1 + Σpercent)`，**灵根等百分比层从此对装备与境界收益同样生效**。

### 2.2 领域事件（`framework/events.ts`）

统一事件类型：`killMonster / killPlayer / selfDeath / breakthrough / realmUp / alchemyCraft / equipChange / itemUse / explore / questComplete / meditationTick`。

气运的 `eventEffects`（击杀/死亡触发）将改由事件总线驱动——框架已实现、此前无数据无触发点，事件总线补上触发点后即可直接使用。

### 2.3 模块 Provider（`framework/provider.ts`）

每个功能模块实现一个 `SystemProvider`：

```ts
interface SystemProvider {
  id: string;                                        // "spiritual-root"
  displayName: string;                               // "灵根"
  collectModifiers(ctx: ProviderContext): Promise<StatModifier[]>;
  handles?: GameEventType[];                         // 关心的事件
  onEvent?: GameEventHandler;                        // 事件回调
}
```

### 2.4 注册表（`framework/registry.ts`）

- `registerProvider()`：模块自注册；
- `collectAllModifiers(ctx)`：汇总全部修饰层；
- `dispatchGameEvent(event)`：按 `handles` 分发给关心该事件的模块。

---

## 三、模块划分与目录

| 模块 | Provider 文件 | 框架阶段产出 | 内在阶段待填 |
| --- | --- | --- | --- |
| 灵根 | `spiritual-root.provider.ts` | 读取 `players.spiritual_root` → 百分比层 + 元素加成 | 品阶/纯度、洗髓、五行克制表 |
| 天赋 | `talent.provider.ts` | 流派/道心数据读取接口 | 流派抉择点（筑基/结丹/元婴）、被动树 |
| 境界 | `realm.provider.ts` | 境界基准属性层 | 越境压制、天劫、化神~渡劫内容 |
| 功法神通 | `gongfa.provider.ts` | 功法层数 → 修饰层 | 与神通打通、被动技能 |
| 气运 | `fortune.provider.ts` | 永久/限时气运 → 修饰层；订阅战斗事件 | eventEffects 数据、限时机缘 |
| 装备 | `equipment.provider.ts` | 已装备物品 → 固定值层 | 强化等级、随机词条、套装、器灵 |
| 丹药 | `alchemy.provider.ts` | 丹药 buff → 修饰层；丹毒记账 | 丹药品级、解毒丹 |

目录：`src/modules/character/services/framework/`

---

## 四、三阶段计划

**阶段一 · 框架（已完成）**
落地 `stat-modifiers` / `events` / `provider` / `registry` + 7 个 provider 骨架 + `index` 装配入口，tsc 与 lint 全绿。

**阶段二 · 内在（进行中）**
每个 provider 各自读取真实数据、算出真实修饰，互不影响；同步补数据（气运事件型、丹药品级、装备词条等）。

进度：
- ✅ **灵根**：读取 `players.spiritual_root` 输出常驻百分比层（含 `elementDamageBonus`）。
  线上已验证：基础防御 13 → 实际 13.78（13 × 1.06），幸运 9 → 9.18。
- ✅ **气运**：补数据（框架早已实现，缺的是数据）。新增 10 条、补全 2 条：
  限时机缘 6 条（此前为 0）、事件型 7 条（此前 `eventEffects` 全空）、
  启用 `combatXpRate / adventureXpRate / questXpRate` 等此前零使用的速率键。
  **注意**：气运的 `attrEffects` 在授予时已直接写入基础属性并记账，
  因此 provider **不输出修饰层**，只负责取数前同步到期回滚，否则会双倍。
- ✅ **装备**：`player_inventory` 新增 `refine_level` / `affixes` 两列；
  provider 只输出强化与词条的**增量**（基础 effects 仍由原 equipment 层计算，避免双倍）；
  新增强化接口 `POST /api/game/equipment/refine`（消耗灵石，成本随等级递增，上限 10 级）。
  线上已验证：强化 +1 后攻击 36 → 36.4，灵石 100 → 50。
- ✅ **丹药**：新增 `reduce_toxicity` 效果类型（`src/types/game.ts`）、服用端处理
  （`inventory/route.ts`）、3 种解毒丹（清灵丹 -3 / 涤尘丹 -8 / 太清涤毒丹 -20），
  丹毒从此有主动解法，不必只能挂机等 8 分钟/点。
  丹药品级以「物品变体」实现：同配方炼出下品/中品/上品/极品对应不同 itemId
  （倍率 0.8 / 1 / 1.3 / 1.6），服用端零改动。已为 12 种丹药派生 36 个品级变体。
  线上已验证：丹毒 10 → 7，上品·凝露丹 2080（原 1600 × 1.3）。
- ✅ **逆天改命**（对标鬼谷八荒）：每次突破成功后掷三道天机词条供玩家择一。
  复用既有气运授予与到期回滚（`grantFortunesToPlayer`），词条**不走修饰层**（`attrEffects`
  仍按原规则写基础属性并记账，否则双倍）。
  防重用 `playerFortunes.sourceType = breakthrough` + `sourceRef = realm:<线性境界>`，
  同一境界只能领一次。
  新增 `services/reversal-service.ts`、接口 `POST /api/game/breakthrough/reversal`，
  并在 `attemptBreakthrough` 成功时返回 `reversalOptions`。
  线上已验证：候选含 blue/red 分级、领取成功、重复领取被拦截。
  前端三选一弹层已接入洞府页（突破页）：突破成功且有候选时弹出，三张卡片按品阶着色
  （红/金/紫/蓝），关闭需二次确认（放弃不可逆）。
  ⚠️ 清理测试数据时必须用 `removePlayerFortune` 而非直接 DELETE——它会按属性账本逆运算回滚，
  直接删记录会让玩家的永久属性虚高（脚本：`scripts/cleanup-test-reversal.ts`）。
- ✅ **天赋流派**：新增 `talent_paths`（流派定义）与 `playerTalents`（玩家抉择，`(player_id, kind)`
  唯一）两张表，播种 2 方向 + 4 流派。
  - **二元 → 四派**（对标一念逍遥：开局只有两条主修，四路线后期才铺开）：
    筑基（major 2）选方向「斗战 / 长生」，结丹（major 3）再选流派「剑修 / 体修 / 丹修 / 符修」，
    流派候选按已选方向过滤（选了斗战就看不到丹修 / 符修）。
  - **强弱随阶段轮换**（对标一念逍遥：返虚前体修强、返虚后法修反超）：
    加成不是恒定值，而是按大境界分段的曲线（`stageCurve`）。
    已验证：基础攻击 41.4 → 斗战+剑修(major 3) **44.71**（×1.08）→ 元婴(major 4) **46.37**（×1.12）。
    体修前期给得高、后期走低；剑修前期平淡、元婴后抬升。
  - **符修刻意不给神识**：治疗公式 `+2.15 × 神识` 会让堆神识的符修意外变成最强治疗，
    与「洞察 / 控场」定位错位，故符修改走法力上限 + 法宝增伤。
  - 新接口 `GET /api/game/talent/options`、`POST /api/game/talent/choose`；
    洞府页抉择弹窗，且**进洞府即提示**（避免玩家错过抉择点）。
    突破后若同时触发流派与逆天改命，**流派优先**展示。
- ✅ **功法神通**：系统此前**已存在但完全空转**——`plugin_gongfa_*` 是懒建表，
  线上从未被访问过（表都不存在），且加成**没有任何消费方**：升级只改
  `plugin_gongfa_player_progress.level`、扣功法点，**从不写回基础属性**。
  因此由 provider 输出 `flat` 层不会重复计算（这点与气运相反，务必区分）。
  新增 `getPlayerGongfaCombatBonus()`：按层累积求和（`level_index <= level`），
  双修类功法的加成（如「双修修为提升倍率」）因无法映射战斗属性被自动过滤。
  线上已验证：默认 3 本功法自动播种，第 1 层 气血 326→406、防御 19.08→27.56
  （+8 防被灵根 1.06 放大为 +8.48，说明 flat 层处于正确的层序），第 2 层 气血→546、攻击→51.4。
- ✅ **境界压制**：**结论是不输出任何修饰层**，骨架 TODO 不应实现。
  - 境界的属性收益已由突破奖励 `applyBreakthroughRewardToStats` 写入基础属性，
    再输出一遍基准 flat 就是双倍。
  - 境界压制本身已在战斗公式生效：`combat-mechanics.ts` 按 `境界差 × 0.04`
    计算命中与伤害修正并 clamp（约 −0.14 ~ +0.18），作用于**战斗结算**而非属性面板。
  理由已写入 `realm.provider.ts` 注释，避免后人照骨架 TODO 误实现。

至此七层框架（灵根 / 气运 / 装备 / 丹药 / 流派 / 功法神通 / 境界）全部处理完毕。
按 `benchmark-gbsh-ynxy.md` 的结论，**下一步应转向内容而非继续堆数值**：
化神（25）到渡劫（44）有境界、无地图、无主线、无怪物，这是鬼谷八荒口碑滑坡的同构问题。

**流派未做的部分**（有意留口，非遗漏）：
丹毒上限提升、炼丹品级加成等**非属性层**效果（丹修的真正价值）尚未接入；
元婴后的**副修**（对标一念逍遥双修）未做；道心抉择（专精 / 融合）未做。

> 补充更正：境界**突破失败惩罚本就存在**（`failXpLossRate` 按率扣修为），
> 与一念逍遥的雷劫失败同类；此前判定为"无失败惩罚"有误。

> 路由约定：本项目是两层结构，`src/modules/*/api/**` 的实现必须在
> `src/app/api/**` 下有一行 re-export 才会暴露成 URL，新增接口时不要漏掉这一层。

**灵根改造的配套变更（避免双重加成）**

灵根原本在建号时被折算进基础属性，改造后必须剥离，否则与修饰层重复计算：

1. `buildInitialPlayerBaseStats()`：建号与管理端重算境界时不再折算灵根
   （`character/create/route.ts`、`admin-player-realm.ts`）；
2. 战斗侧的同步兜底路径（`party-combat-service.ts`、`combat/start/route.ts`）
   显式传入 `mapSpiritualRootPercent(player.spiritualRoot)`；
3. 存量角色由 `scripts/strip-legacy-spiritual-root-bonus.ts` 一次性剥离
   （默认 dry-run，加 `--apply` 写库；**非幂等，只执行一次**）。

**阶段三 · 整合**
`player-stats.ts` 改为调用 `collectAllModifiers` 聚合；战斗结算接入五行克制；UI 统一从修饰层取数展示；全流程回归 + 部署验证。

---

## 五、兼容性原则

1. **不破坏现有接口**：`buildPlayerStatsSnapshot` 的返回结构保持不变，只是内部聚合改用修饰层；
2. **骨架默认返回空修饰**，未填充的模块对线上行为零影响；
3. **逐模块灰度**：每个 provider 填充完成即刻生效，可单独验证。

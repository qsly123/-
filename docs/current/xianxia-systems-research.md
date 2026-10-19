# 仙侠品类系统调研：灵根 / 天赋 / 境界 / 气运 / 神通功法 / 装备 / 道具 / 材料 / 丹药

> 调研日期：2026-10-17。对象：本项目（世界名「灵墟·长生劫」，领域包名 `four-realms` 四境线）。
> 方法：全量代码实勘 + 世界包 `src/db/offline-packs/four-realms-pack.ts`（224KB）数据盘点 + 品类范式对照。
> 本文所有"现状"结论均带文件路径证据，可直接复核。

---

## 零、一句话结论

**项目的"骨架"（境界、气运、物品、炼丹、丹毒）已经搭好且能跑，但"灵魂"——即玩家能感知到"我在修仙"的那几个系统——还停在数值层面，没有形成品类辨识度。**

最关键的三个洞，按性价比排序：

1. **灵根是"一次性折算"，不是成长放大器**：灵根的百分比加成在建号瞬间就拍平进基础属性，之后再不参与计算。品类里灵根应贯穿一生（影响修炼速度、功法适配、突破率、元素克制），这是修仙感的第一来源。
2. **天赋系统完全不存在**（官方 `docs/current/game-features.md` 已列为"未实现"）。现在的替代方案是"境界基准 + 装备 + 功法 + 气运"四层叠加，但这四层全是**被动数值**，缺的是玩家**主动的构筑选择（build）**——即"我走剑修还是丹修"这类抉择。
3. **没有任何世界观设定文档**：世界名「灵墟·长生劫」只存在于 `src/types/game.ts` 第 4 行的一条注释里，全仓库仅此一处。所有设定碎片散落在 224KB 的世界包 `description` 字段中。**没有锚点，后续所有内容扩展都会漂移。**

---

## 一、品类范式：仙侠修仙品类的通用骨架

仙侠/修仙品类（凡人修仙传、一念逍遥、鬼谷八荒、觅长生、修仙模拟器等）经过多年沉淀，形成了一套玩家默认认知的骨架。偏离这套骨架会让玩家"出戏"，补足它则能立刻提升品类辨识度。

| 系统 | 品类通行做法 | 玩家的核心预期 |
| --- | --- | --- |
| **灵根 / 资质** | 五行（金木水火土）+ 变异（风雷冰暗）；品阶（天/地/玄/黄）或纯度值（0-100）；决定修炼速度、功法适配、突破成功率、元素克制 | "我是什么根骨" —— 身份认同的第一来源，且**必须长期有感知** |
| **天赋 / 命格** | 先天命格（剑心通明、天煞孤星、红鸾星动）+ 境界抉择点（道心/流派）+ 被动树 | "我走什么路" —— 主动构筑，区别于此账号彼账号 |
| **境界** | 练气→筑基→结丹→元婴→化神→炼虚→合体→大乘→渡劫；每境小层；突破有成功率、失败惩罚、天劫 | "我进步了" —— 长线目标与仪式感 |
| **机缘 / 气运** | 随机事件驱动的临时增益、因果值、凶吉转化；**事件钩子型**（击杀、死亡、探索触发）远多于纯数值型 | "仙缘天降" —— 不确定性与惊喜 |
| **功法 / 神通** | 功法=被动心法（长期成长、分品阶层数），神通=主动技能；境界解锁 + 技能树 | "我学会了新本事" |
| **装备 / 法宝** | 本命法宝、飞剑、护身法器、丹炉；强化/精炼/镶嵌/套装/**器灵**；法宝有成长性与故事 | "我的法宝在长大" —— 长线留存核心 |
| **丹药** | 修为丹、突破丹、疗伤丹、**解毒丹**、淬体丹；丹方分品阶；**丹药品级（下/中/上/极品）**；丹毒/药力沉淀 | "嗑药也要讲策略" |
| **材料** | 灵草、矿石、妖兽材料；灵田种植；**产地 + 品质**结构化 | "采集与囤积" |
| **经济** | 灵石本位；坊市/交易行；宗门贡献 | "修仙也要过日子" |

**数值层面的通行规律**：属性聚合通常是 `基础（境界）×（1+百分比层）＋ 固定加成层`，百分比层承载灵根、功法、气运的乘算。纯加法聚合（本项目现状）会导致后期装备数值碾压一切、百分比型设计失去意义。

---

## 二、本项目现状勘测

### 2.1 灵根

- 类型 `src/types/game.ts:8-29`：五行 `element` + 变异 `variant` + 14 项**百分比** `bonuses`。
- 落库 `src/db/schema.ts:159`：`players.spiritual_root jsonb`，**无独立灵根表、无品阶/纯度字段**。
- 合法值：五行 `金木水火土`；变异通用 `雷冰风光暗`（`constants.ts:5`），AI 白名单额外含「淫」（`ai.ts:48` 成人玩法）。
- 生成：LLM 路径 `ai.ts:342-395`（temperature 0.9，bonuses clamp `[0,0.15]`）；离线兜底 `ai.ts:431-472`（本次新加，FNV-1a 哈希心愿 → 同一句心愿必得同一灵根，约 30% 概率带变异）。
- **消费方式（关键问题）**：`player-initial-stats.ts:29-68 applySpiritualRootBonusToStats()` 在**建号时一次性折算进 base**，之后 `buildPlayerStatsSnapshot` 直接读 `players` 裸值，灵根不再出现在任何公式里。

> `elementDamageBonus` 是**死字段**：全仓库仅 `types/game.ts`、`system-config-keys.ts`（提示词）、`ai.ts`（写入）三处出现，**无任何读取方**（已 grep 验证）。
> `variant` **纯装饰**：只在角色页与建角页渲染成 tag，不参与数值、技能或克制。

### 2.2 天赋

**不存在。** 全仓库 grep `天赋|talent` 仅命中 `map-scene-state.ts` 一处无关词（已验证）。
`docs/current/game-features.md:168` 官方口径：*未实现 —— 天赋/加点（属性来自境界、装备、功法、气运聚合）*。

### 2.3 境界

- **9 大境界 × 44 小境界**（`four-realms-pack.ts:989-1063`）：练气(12层) / 筑基 / 结丹 / 元婴 / 化神 / 炼虚 / 合体 / 大乘 / 渡劫(各4层)。每大境界属性 ×2（练气 260HP → 渡劫 71680HP）。
- 突破 `cultivation.ts:86-193`：成功率 0.98(练气) → 0.024(渡劫)，失败扣 xp（扣率 0.04 → 0.76），失败累积保底 `breakthroughBonusRate +0.05`（上限 0.95）。
- 修为来源：洞府打坐（`dongfu-service.ts`，5%/小时、上限 36 小时、四源加成：气运+状态+宗门灵气峰+功法）、修为丹（每日上限 20）、战斗/任务/奇遇/双修。
- **缺口**：无境界压制系数（高境打低境无额外倍率，只有属性差）；无境界专属被动/神通解锁；渡劫期无天劫玩法；`realmDisplayByLinear` 只映射到线性 24，**化神~渡劫（25-44）有境界而无任何内容**（无地图、无主线、无技能、无怪物）；突破奖励只含 6 项基础属性，不含神识/穿甲/格挡/增减伤。

### 2.4 气运

- 表 `schema.ts:1548-1616`：`fortunes`（品阶 red/gold/purple/blue/white，`durationSeconds` 0=永久，`attrEffects`/`eventEffects`/`specialEffects` 三段）+ `player_fortunes` + `player_fortune_attr_ledger`（幂等记账）。
- 框架**相当完整**：属性型直接改基础属性并记账；事件型 `killPlayer/killMonster/selfDeath` 由战斗结算触发（`fortune-service.ts:1009-1059`）；特殊型 11 个速率键（突破率、各类 xp 率、灵气率、双修相关）求和读取。
- 开局：`getStarterFortuneOptions(5, gender)` 加权抽 5、玩家选 3。
- **数据现状（33 条，全部 `isStarter:true`）**：白 6 / 蓝 15 / 紫 8 / 金 3 / 红 1；**100% 永久**（无一条限时）；**`eventEffects` 全部为空**（框架已实现、数据零使用，已 grep 验证）；`specialEffects` 仅 10 条使用，且只用到 `breakthroughSuccessRate`/`pillXpRate`/`dongfuLingqiRate` 三个键，`combatXpRate`/`adventureXpRate`/`questXpRate`/`doubleCultivationXpRate` **零使用**。

> 结论：33 条气运本质都是"被动数值 buff"，**没有一条剧情型/抉择型/因果型**，也**没有"限时机缘"**——而这恰恰是仙侠"机缘感"的来源。

### 2.5 神通 / 功法

- `skills` 表 `schema.ts:1091-1106`：7 种 `skillType`（attack/buff/debuff/heal/dot/aoe/shield）、element、伤害、mp、cd、effects、境界上下限。世界包 **16 个技能**（4 境界 × 4 个）。开局 `skill_four_realms_qianchao_jianqi`（牵潮剑气）。
- 装配：`MAX_EQUIPPED_SHENTONG_SKILLS=8`、法宝槽 `artifact_1..4`、`skillRotation` 轮转。
- **`player_skills.level` 是死字段**：只 insert 时写 1，全仓库无升级逻辑。
- **功法是独立第二套系统**：`plugin_gongfa_*` 6 张 legacy 表（运行时 `CREATE TABLE IF NOT EXISTS`，**不在 drizzle schema**），有 tier/层数/升级点数/升级条件，内置仅 3 本（太初炼体诀、御风凝神篇、阴阳同参诀）。
- **缺口**：无被动技能类型；神通与功法完全割裂（两套表、两套加成路径）；化神~渡劫零技能；无元素克制、无连招。

### 2.6 装备

- **无独立装备表**：`player_inventory` 背包装备合一（`equipped` + `equipSlot`）。
- 部位：基础四件 `weapon/helmet/armor/shoes` + 法宝 4 槽 `artifact_1..4`（`constants.ts:51-60`）。
- 加成：`ItemEffect` 的 13 个 `boost_*` → `EquipmentStatsBonus`（绝对值），并入 `PlayerStatsSnapshot.equipment` 层（`player-stats.ts:151-244`），带境界上下限校验。
- 稀有度：`common 凡品 / uncommon 良品 / rare 上品 / epic 极品 / legendary 仙品 / hongmeng 鸿蒙`。
- **缺口（已 grep 验证为 0 命中）**：**无强化/精炼、无耐久、无词条随机、无套装、无镶嵌**。已有的是 `hongmeng_treasure_configs`（掌天瓶 5 星升星）——这套"升星+能量"机制其实就是**器灵/本命法宝**的现成范式，可以复用。
- 枚举不一致：`ITEM_TYPE_NAMES` 有 `ring 戒指`/`necklace 项链`，但 `ITEM_TYPES` 没有——饰品位预留未实现。

### 2.7 道具 / 材料

- `items` 表（唯一物品主表，`schema.ts:1108-1136`）：itemType / rarity / effects(jsonb) / pillToxicity / price / stackable / isBound / min-maxRealm / 溯源字段。
- 世界包 **122 件**：材料 50、法宝 24、兵器 16、消耗品 12、护甲/头盔/鞋 各 4、神通书 4、任务道具 4。稀有度按境界阶梯（练气 uncommon → 元婴 legendary）+ 1 件鸿蒙。
- 掉落 = `monsters.drops` JSON、商店 = `npcs.shopItems` JSON —— **无独立掉落表/商店表**，做不了权重掉落表、商店库存刷新与限购。
- **材料无品质/产地结构化字段**（`effects: []`，只靠 id 约定被配方引用）。
- 已有：`market_listings`（玩家交易行）、`item-source-service`（来源反查）、`secret-realm-drop-generation-service`（秘境动态造物，带 `generatedSeed` —— 这个种子就是做**随机词条**的现成入口）。

### 2.8 丹药与丹毒

- 丹药 = `itemType:"consumable"` + effects，无独立 pill 表。世界包三类：修为丹 `pill_xp`（`boost_xp`）、突破辅丹 `pill_break`（`boost_breakthrough`，0.04+0.02×系数）、恢复丹 `pill_heal`。
- **丹毒机制已有**：`pill_toxicity_configs` 上限 20、每 8 分钟自然恢复 1 点；仅 `boost_xp>0` 的消耗品计毒（官方固定 1 点）；满毒拒服并提示等待时间（`inventory/route.ts:497-524`）。
- **缺口**：**无解毒/化毒道具**（`ItemEffect` 无 `reduce_toxicity`）——丹毒只能挂机等；无丹药品级（下/中/上/极品）维度。

### 2.9 炼丹 / 炼器

- **配方表不在 `schema.ts`**：`alchemy_recipes` / `smithing_recipes` 由 `alchemy-service.ts:231-262`、`smithing-service.ts:233` **运行时裸 SQL 懒建表**（`CREATE TABLE IF NOT EXISTS`），因此 `drizzle-kit push` 管不到、无迁移历史、无 drizzle 类型。
- 世界包**有配方数据**（4 境界丹方 + 炼器方，含主材/辅材 A-C/基础成功率/辅材加成/排序）。
- 部署时输出 `seededAlchemyRecipes: false` 的**真实原因**：`scripts/apply-four-realms-pack.ts:516-523` 的 `rebuildRecipeTable()` 在表不存在时直接 `return false`；而表要等首次访问才创建。
- **但有自愈**：`ensureAlchemyCoreSchema()` 末尾会调 `seedBuiltinAlchemyRecipes()` 按 `recipe_code` 幂等灌入。所以**首次访问 `/api/game/alchemy` 后配方会自动齐全**——文档里"配方可能为空"是未触发懒初始化的观察值，不是真缺数据。
- 已有：成功率 + 辅材加成 + **保底 pity**（每次失败 +0.03，上限 +0.18）+ 炼制日志。

### 2.10 属性与战力

- 14 项属性（`schema.ts:168-182`）：hp/mp/攻/防/速/幸运/神识/穿甲/格挡/技能增减伤/法宝增减伤。
- 聚合 `player-stats.ts:279-293`：`base + equipment + plugin + status` **四层纯加法**，带下限保护。
- 战力权重 `combat-power.ts:17-31`：攻 20 / 防 15 / 速 120 / 幸运 120 / 神识 6 / 穿甲·格挡 10 / 技能增减伤 8 / 法宝增减伤 6。

> **核心结构问题：没有百分比/乘算层。** 灵根的 `%` 在建号时被拍平成整数，之后境界提升、换装备都**不会被灵根再放大**。这直接导致：越到后期，灵根的存在感越趋近于 0。

### 2.11 世界观

- 世界名 **「灵墟·长生劫」**，唯一出处 `src/types/game.ts:4` 注释（全仓库 1 处命中）。
- 开局 **蓬莱岛**（18×26，`mapType city`），出生点 (3,22)：*"海雾终年不散的海岛坊市，散修、渔民与低阶修士混居，是练气主线的主舞台。"*
- **13 张地图**按境界分层：练气（蓬莱岛/青石里/柳渡集/黑松林/石骨洞）→ 筑基（太行山/赤砂驿/地火谷）→ 结丹（雾海泽/夜河古冢）→ 元婴（边锋城/云门峰/裂天墟）。
- **主线 61 条**（练气 12 + 筑基 14 + 结丹 15 + 元婴 20）。练气首环「海风第一问」：*「你是来求长生，还是先求活命？」*
- 势力线索：宗门/高门大宗（云门峰）、散修与劫修、魔修血罗刹、凡人聚落、宗门灵气峰。
- 主题分层：练气=生存与规矩 / 筑基=斩魔与献祭 / 结丹=心魔外化 / 元婴=守城与大劫。
- **缺口**：**零设定文档**（grep 世界观/设定/背景 → 0 命中，14 篇权威文档全是架构与部署）；无地理层级（只有平级地图 + 邻接表，无"域/州/界"）；阵营字段 `world_npc_profiles.faction` 存在但无玩法消费；化神~渡劫有境界无内容。

---

## 三、差距诊断总表

| 系统 | 品类预期 | 项目现状 | 判定 |
| --- | --- | --- | --- |
| 灵根 | 长期成长放大器 + 身份标识 + 元素克制 | 建号一次性折算，之后失效；variant 纯装饰；`elementDamageBonus` 死字段 | **严重偏弱** |
| 天赋 | 主动构筑（流派/道心/被动树） | 不存在（官方列未实现） | **缺失** |
| 境界 | 长线目标 + 仪式感 + 越境压制 | 9 境 44 层、成功率/保底/洞府齐全 | **扎实**，但无压制/无天劫/后期无内容 |
| 气运 | 事件驱动的机缘、凶吉、限时机缘 | 框架完整，但 33 条全是永久数值 buff，eventEffects 零使用 | **框架好、数据弱** |
| 神通 | 主动技能 + 元素克制 + 成长 | 16 个技能、装配/轮转齐全；level 死字段、无被动、后期无技能 | **中等** |
| 功法 | 被动心法、长期成长 | legacy 6 表 + tier/层数/点数，仅 3 本；与神通割裂、不在 schema | **半成品** |
| 装备 | 强化/词条/套装/器灵/耐久 | 6 部位 + 境界门禁 + 掌天瓶升星；**无强化/词条/套装/耐久** | **偏薄** |
| 道具材料 | 品质、产地、掉落表 | 122 件、交易行、秘境动态造物（带 seed）；材料无品质/产地，无掉落表/商店表 | **中等** |
| 丹药 | 品级分级 + 丹毒策略 + 解毒 | 三丹齐全、丹毒 20/8min + 保底炼制；**无品级、无解药** | **中等** |
| 炼丹炼器 | 火候/炉鼎/品级/时间成本 | 成功率+辅材+保底+日志齐全；**配方表是影子表**（不在 schema） | **可用但有结构风险** |
| 属性 | 百分比层 × 固定层 | 四层纯加法，无百分比层 | **结构性问题** |
| 世界观 | 设定文档 + 地理层级 + 阵营 | 内容丰满（13 图 61 主线），但**零文档、无锚点** | **内容好、文档缺失** |

---

## 四、建议：做什么、按什么顺序

### P0 — 低成本、高辨识度（先把"修仙感"做出来）

**1. 灵根从"一次性折算"升级为常驻乘算层**
- 在 `PlayerStatsSnapshot` 增加 `spiritualRoot` 层，`total = (base + equipment + plugin + status) × (1 + rootPercent)`。
- 同步激活 `elementDamageBonus`：建立五行克制表（金克木、木克土、土克水、水克火、火克金，变异系自成一环），让技能 `element` 打对应弱点属性时吃到该加成。
- 涉及：`player-stats.ts`、`player-initial-stats.ts`、`types/game.ts`、战斗结算。
- 成本：中（需回归战力与战斗平衡）。收益：**最高**——灵根终于"活"在整个生命周期里。

**2. 补一份 `docs/current/world-setting.md`**
- 把散落在世界包里的碎片固化：世界名、九境体系、地理层级（建议补"四境 = 东/南/西/北"或类似顶层结构）、势力关系图、主线四境线年表、命名规范（境界/稀有度/物品命名）。
- 成本：低（纯文档）。收益：**后续所有内容扩展的锚点**，也是给 AI 生成（NPC 对话、灵根描述）的统一口径。

**3. 气运数据补齐事件型与限时机缘**
- 框架已实现、只差数据：为现有 33 条补 `eventEffects`（击杀/死亡触发），新增 10-15 条**限时机缘**（如"七日灵犀：7 天内洞府灵气 +40%"）。
- 补 `combatXpRate`/`adventureXpRate`/`questXpRate` 的使用，让气运真正区分"战斗型/探索型/任务型"玩法倾向。
- 成本：低（纯数据）。收益：立刻把白板 buff 变成有"机缘感"的系统。

### P1 — 长线深度（留存与构筑）

**4. 装备成长线**：优先做**强化/精炼**（可复用掌天瓶"升星+能量"范式）+ **随机词条**（复用秘境掉落已有的 `generatedSeed`）。套装与器灵可后置。涉及：新增装备实例表或在 `player_inventory` 上加 `refineLevel`/`affixJson`。

**5. 天赋的落地路径**：不建议从零新建。建议把已有的**功法系统**（已有 tier/层数/点数/升级条件）提升为天赋载体，或引入"**道心/流派抉择**"（剑修/丹修/符修/体修），在筑基、结丹、元婴各给一个抉择点。这样比新建一套表省一半工作量，且能与已有功法/神通打通。

**6. 丹药品级 + 解毒丹**：炼丹成功率映射到丹药品级（下/中/上/极品，对应效果倍率）；新增 `reduce_toxicity` 效果类型与对应道具（如"清蕴丹"），给丹毒一个**主动解法**而非只能挂机等。

**7. 材料结构化**：给 `items` 的材料类补 `quality`（品质）与 `origin`（产地/来源类型），让炼丹配方的辅材加成有据可依，也让采集/灵田有产出差异。

### P2 — 后期内容（等前两批落地后）

**8. 化神~渡劫（线性 25-44）内容填充**：目前"有境界无内容"，需要地图、主线、技能、怪物。同时补 `realmDisplayByLinear` 到 44。

**9. 天劫玩法**：渡劫期的仪式感事件（雷劫次数、护身法宝消耗、失败重来），是品类里最有记忆点的高光设计。

**10. 影子表收编**：把 `alchemy_recipes`/`smithing_recipes`/`plugin_gongfa_*` 纳入 `src/db/schema.ts` 统一管理（当前 `drizzle-kit push` 管不到它们，是真实的运维风险）。

---

## 五、立即可执行的最小动作清单

| # | 动作 | 类型 | 预计 |
| --- | --- | --- | --- |
| 1 | 写 `docs/current/world-setting.md`，固化世界观与命名规范 | 文档 | 半天 |
| 2 | 气运补 `eventEffects` + 新增 10-15 条限时机缘 | 数据 | 半天 |
| 3 | 新增解毒丹（`reduce_toxicity`）+ 4 条配方 | 数据 + 少量代码 | 半天 |
| 4 | 灵根乘算层改造 + 五行克制表 | 代码 | 1-2 天 |
| 5 | 装备强化（`refineLevel`）+ 随机词条 | 代码 + 数据 | 2-3 天 |
| 6 | 流派抉择点（筑基/结丹/元婴） | 代码 + 数据 | 2-3 天 |

---

## 附：关键文件索引

| 域 | 文件 |
| --- | --- |
| 灵根 | `src/types/game.ts`、`src/modules/ai/services/ai.ts`、`src/modules/character/services/player-initial-stats.ts` |
| 气运 | `src/modules/character/services/fortune-service.ts`、`src/db/schema.ts`(fortunes 段) |
| 境界 | `src/modules/character/services/realm-service.ts`、`cultivation.ts`、`dongfu-service.ts` |
| 神通/功法 | `src/db/schema.ts`(skills)、`src/modules/character/services/player-active-skills.ts`、`gongfa-service.ts` |
| 属性 | `src/modules/character/services/player-stats.ts`、`combat-power.ts` |
| 物品/装备 | `src/db/schema.ts`(items/player_inventory)、`src/modules/character/api/game/inventory/route.ts` |
| 丹药/丹毒 | `src/modules/character/services/pill-toxicity-service.ts`、`alchemy-balance.ts` |
| 炼丹/炼器 | `src/modules/character/services/alchemy-service.ts`、`smithing-service.ts`、`scripts/apply-four-realms-pack.ts` |
| 世界包 | `src/db/offline-packs/four-realms-pack.ts`、`docs/generated/four-realms-offline-pack.json` |

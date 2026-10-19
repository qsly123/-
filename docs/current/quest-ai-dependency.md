# 任务系统对 AI 的依赖现状（2026-10-17 实测与修复）

> **2026-10-18 更新：已重新接入 LLM（DeepSeek）。** 人设对白与工具调用均已恢复，
> 固定化任务对话**保留为兜底**（AI 失败时自动降级，不再 500）。本文的排查结论仍然有效。

结论：**任务数据与推进逻辑本就是固定化的，不依赖 AI。撤掉 LLM 后原本唯一的硬伤是「NPC 对话接口 500」，现已补上固定化任务对话，主线与悬赏均可不接 AI 完整办理。**

## 一、先纠正一处误判

先前判断「前端未接入 `quest-action`，玩家只能靠对话办任务」是**错的**——那次用 `**/ui/**`
glob 搜索零命中是搜索语法问题。实际上 `map/ui/pages/game/npc/[id]/page.tsx` 早就有
`handleQuestAction`，任务卡片上「接取 / 完成」按钮一直存在，提示文案还专门区分了
「该NPC未配置AI人格，请点击右侧按钮办理任务」。

**任务办理的按钮链路一直是通的。** 真正残缺的只有对话本身。

## 二、固定化的部分（不依赖 AI）

- **任务数据**：`four-realms-pack` 离线包提供 **61 条主线**
  （talk 22 / kill 18 / detect 11 / collect 10），含接取/完成 NPC、需求、奖励、前置与剧情文案。
- **推进逻辑**：`quest-service.ts` 的 `computeQuestProgress` / `advanceTalkQuestProgress` /
  `advanceKillQuestProgress` 均为确定性计算，进度落在 `player_quests.progress`。
- **支线（悬赏）**：本项目**没有静态支线表**。支线即 bounty 悬赏，由 NPC 悬赏板随机生成
  （`questCategory = side`，`acceptRandomBountyQuestForPlayer`），同样是确定性逻辑。
  线上 `npc_four_realms_dingxunhai` 已开启（每日上限 2）。

## 三、撤掉 LLM 后原本会坏的地方，以及修复

### 1. NPC 对话接口 500（唯一硬伤）

`POST /api/game/npc/[id]` 原流程必经 `tryHandleQuestAgent`（LLM 意图识别）与
`chatCompletionWithTools`（LLM 回复）。库里根本没有 `LLM_API_KEY` 配置行，
`createChatRuntime` 必然失败 → 整个接口 500，玩家看到「对话失败」。

**修复**：在 `advanceTalkQuestProgress` 之后、AI 流程之前插入 `isLlmConfigured()` 判断，
未配置时改走 `tryStaticQuestDialogue()`——完全规则化，不碰 LLM：

- 「接任务 / 领任务 / 委托…」→ 直接接取（走与按钮相同的 `accept_npc_quest`）
- 「交差 / 完成 / 复命…」→ 直接交任务
- **直接说任务名**（如「海风第一问」）→ 按其当前状态办理
- 识别不出意图 → 按任务状态给固定台词，不报错

关键细节：
- 推进传话进度的调用在固定化分支**之前**，所以传话类任务在这里也能直接交差，不会「条件未达」。
- 用 `buildNpcQuestVisibleList` 而非原始列表——悬赏会被合成为「悬赏板」一项，
  传它的 id 才能走随机接取；传原始悬赏项 id，accept 工具会查不到。
- 词表必须包含 `我要接` / `我要交`，因为那是固定快捷回复的措辞，否则玩家点快捷回复不生效。

### 2. 快捷回复空转

`GET` 的 `includeQuickReplies` 原本会调 LLM 生成三句快捷回复（虽然内部有 try/catch 兜底，
不会 500，但每次都要白跑一次必然失败的请求）。现在无 LLM 时直接用 `buildFallbackQuickReplies`，
产出「我要接『海风第一问』」这类措辞，正好能被上面的规则意图命中。

### 3. 按钮路径「接取后立刻完成」失败

`quest-action` 的 `complete` 原先不推进传话进度（该推进只在 NPC **无人格**时才做），
而线上 14 个 NPC **全部带人格**，于是 `accept` 后立刻 `complete` 必定报「条件未达」，
必须先触发一次对话推进进度才行。

已在 `quest-action/route.ts` 的 `complete` 动作前无条件调用 `advanceTalkQuestProgress`
（推进函数内部只会对「talk 需求且目标为当前 NPC」的生效任务累加，故无需按类型判断）。

## 四、数据完整性核查（这些若不通过，无 AI 也救不了）

```
需求目标存在性：collect 13/13  kill 18/18  realm 10/10  talk 11/11
```

- 曾误报「kill 目标缺失 1 个」，实为查询未按需求类型过滤——`npc_four_realms_old_wangergou`
  是 **talk** 需求里的 NPC（垂暮王二狗），作为谈话目标是正确的。
- `item_four_realms_quest_magic_rope`（带血麻绳）无任何怪物掉落，
  但由前置任务 `quest_main_zhuji_01`（太行山来信）作为**奖励**发放，属任务链设计，非缺陷。

## 五、线上实测（无 LLM 环境）

```
GET  NPC 页面         → 可办任务 [('海风第一问','可接取')]，快捷回复 ['我要接「海风第一问」', …]
对话「接任务」         → 200  quest.accepted   「好，这『海风第一问』的活儿就交给你了。」
对话「交差」           → 200  quest.completed  奖励 gold 18 + 凝露丹×2，主线→quest_main_lianqi_02
对话「最近有什么消息」 → 200  固定台词「渔翁看了你一眼，未多言语。」（不再 500）
对话「我要接『海风第一问』」→ 200  接取成功（快捷回复措辞命中）
对话「海风第一问」     → 200  接取成功（只说任务名也认）
按钮 quest-action      → 200  接取 + 完成均正常（回归通过）
```

## 六点五、AI 接入（DeepSeek，2026-10-18）

模型列表里 `deepseek-flash` 的显示名就是 **DeepSeek-V4.1-Flash**，另有 `deepseek-v4-pro`。

只配了**通用（CORE）三个 key**，其余场景按 `createChatRuntime` 的
`pickOverrideOrFallback` 自动回退，无需逐场景配置：

| key | 值 |
|---|---|
| `LLM_BASE_URL` | `https://api.deepseek.com` |
| `LLM_MODEL` | `deepseek-flash` |
| `LLM_API_KEY` | 系统配置中（`is_secret = true`，不入库日志、不入文档） |

配置位置：`system_configs` 表（管理端「系统配置 → 通用模型」亦可改，改后需重启以清缓存）。

实测 8 个场景全部可用（约 1 秒）：default / npc / event / worldFlavor / openWorld /
smithing / alchemy / spiritualRoot。脚本：`scripts/verify-llm-scenes.ts`。

**关键：AI 失败不再 500。** 已把对话接口的 LLM 调用包进 try/catch，
超时 / 限流 / 服务故障时自动降级到固定化任务对话，玩家仍能正常办任务。
同理 `quest-action` 按钮链路与固定化对话都保留着，AI 只是"锦上添花"而非唯一路径。

## 六、仍未做的部分

- **自由闲聊仍无 AI 风味**：固定台词只覆盖任务相关场景，闲聊是通用句。
  这是"不接 AI"的固有代价，需接 LLM 才能恢复人设对白。
- **无静态支线任务**：支线只有随机悬赏，没有设计好的支线剧情线。
- 主线只到元婴（61 条），化神之后无内容（见 `system-framework-blueprint.md`）。

## 七、调试教训

曾误判「修改未生效」，实际是**两次 rebuild 并发执行**，后启动的构建与前一个互相破坏
`.next`（日志 `ENOENT required-server-files.json`），服务跑的是旧产物。**不要并发触发 rebuild。**

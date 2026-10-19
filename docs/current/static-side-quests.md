# 静态支线与日常任务（2026-10-18）

全部为**固定文本**，不依赖 AI：接取台词、完成台词、需求、奖励都写死在种子脚本里。

## 一、内容

`scripts/seed-side-quests.ts`（`bun run scripts/seed-side-quests.ts --apply`）

- **支线 13 条**（`quest_side_*`，不可重复）：覆盖 7 个有 NPC 的地图、四个境界段
- **日常 6 条**（`quest_daily_*`，每日一次）：练气 2 / 筑基 2 / 结丹 1 / 元婴 1

任务总数由此从 61（仅主线）增至 **80**。

需求目标（怪物 / 物品 / NPC）**全部取自离线包已有数据**，已校验：

```
collect 6/6   kill 12/12   talk 1/1   缺失 NPC 的任务数 = 0
```

支线基调沿用主线的冷峻——「这里没有人会白白护着你」，所以支线少有感激，多是各取所需：
孟老给钱不说谢、周娘子贴钱救码头苦力却不肯承认、王二狗直到死也没对那人说出口。

## 二、每日限制（新增机制，非纯数据）

`repeatable` 字段本就存在，但**只表示"可重复接取"，没有任何频率限制**——
完成后立刻可再接，等于无限刷奖励。这是接日常任务前必须补的洞。

新增 `quests.repeatCycle` 字段（`none` / `daily`），接取时校验：

```ts
if (quest.repeatCycle === "daily"
    && existing.completedAt
    && getShanghaiDateKey(new Date(existing.completedAt)) === getShanghaiDateKey()) {
  return { success: false, error: "今日已办过，明日再来" };
}
```

按 **Asia/Shanghai 自然日**计算（复用既有的 `getShanghaiDateKey`，与悬赏日限同一口径）。
NPC 侧话术：「这活儿你今日已做过一趟，明日再来。」

**不改字段只加数据的后果**：日常任务会被无限刷，修为与灵石产出失控。

## 三、上线注意

`repeatCycle` 是新增列，**必须先 ALTER 再部署代码**——drizzle 的 select 会列出全部列，
列不存在时所有任务接口都会报错。

```sql
alter table quests add column if not exists repeat_cycle text not null default 'none';
```

## 四、线上验证

```
日常：接取 → 完成 → 当日再接 → 拒绝「这活儿你今日已做过一趟，明日再来。」   ← 日限生效
支线：接取 → 完成 → 再接     → 拒绝「此委托已了结。」                       ← 不可重复
要求校验：未打怪直接交差     → 拒绝「条件未达，办妥了再来交差。」           ← 不能白嫖
任务列表：总数 80，支线/日常 19 条全部可见
```

## 五、尚未做

- 支线**没有跨地图的长链**，都是单条闭环；
- 元婴段只有 3 条支线，化神之后仍然无内容（见 `system-framework-blueprint.md`）；
- 日常任务的奖励偏低（刻意），若要让日课成为主要玩法需再调数值。

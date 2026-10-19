/**
 * 气运数据扩展：补「限时机缘」「事件型气运」「凶吉取舍型」，并启用尚未使用的速率键。
 *
 * 背景：气运框架（attrEffects / eventEffects / specialEffects）已完整实现，
 * 但世界包内 33 条气运全部是永久数值 buff——eventEffects 零使用，
 * combatXpRate / adventureXpRate / questXpRate / doubleCultivationXpRate 也从未启用。
 *
 * 用法：
 *   bun run scripts/seed-fortune-expansion.ts            # 打印将执行的变更
 *   bun run scripts/seed-fortune-expansion.ts --apply    # 写库
 *
 * 幂等：按 name 做 upsert，重复执行不会产生重复数据；已存在的气运只补全空字段。
 *
 * 设计约束：事件型气运只作用于 hp / mp 这类有天然上限的属性（会被上限截断），
 * 不使用会无限累积的攻击/防御等字段，避免击杀数增长导致数值失控。
 */

import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { fortunes } from "../src/db/schema";
import type { AttributeDelta, FortuneEventEffects, FortuneSpecialEffects } from "../src/types/game";

const apply = process.argv.includes("--apply");

interface FortuneSeed {
  name: string;
  description: string;
  grade: "white" | "blue" | "purple" | "gold" | "red";
  /** 0 表示永久；否则为持续秒数。 */
  durationSeconds: number;
  isStarter: boolean;
  starterWeight: number;
  attrEffects?: AttributeDelta;
  eventEffects?: FortuneEventEffects;
  specialEffects?: FortuneSpecialEffects;
}

/** 限时机缘：给「仙缘天降」的不确定感，到期由 syncExpiredFortunes 自动回滚。 */
const TIMED_FORTUNES: FortuneSeed[] = [
  {
    name: "七日灵犀",
    description: "七日内心窍大开，洞府灵气格外充盈。七日后自行消散。",
    grade: "gold",
    durationSeconds: 7 * 24 * 3600,
    isStarter: true,
    starterWeight: 0.6,
    specialEffects: { dongfuLingqiRate: 0.4 },
  },
  {
    name: "剑心通明",
    description: "三日间剑意澄澈，历战斗而有所悟，战斗所得修为增益。",
    grade: "purple",
    durationSeconds: 3 * 24 * 3600,
    isStarter: true,
    starterWeight: 1,
    specialEffects: { combatXpRate: 0.25 },
  },
  {
    name: "踏雪寻梅",
    description: "五日内脚步不停，游历四方所得修为增益。",
    grade: "blue",
    durationSeconds: 5 * 24 * 3600,
    isStarter: true,
    starterWeight: 1,
    specialEffects: { adventureXpRate: 0.3 },
  },
  {
    name: "贵人相逢",
    description: "三日间机缘不断，完成师长所托所得修为增益。",
    grade: "purple",
    durationSeconds: 3 * 24 * 3600,
    isStarter: true,
    starterWeight: 1,
    specialEffects: { questXpRate: 0.3 },
  },
  {
    name: "丹火纯青",
    description: "七日间炉火纯青，丹药效力与突破机率皆有所增。",
    grade: "purple",
    durationSeconds: 7 * 24 * 3600,
    isStarter: true,
    starterWeight: 0.9,
    specialEffects: { pillXpRate: 0.15, breakthroughSuccessRate: 0.03 },
  },
];

/** 事件型气运：战斗事件触发，只作用于 hp / mp 这类有上限的属性。 */
const EVENT_FORTUNES: FortuneSeed[] = [
  {
    name: "血战余勇",
    description: "每斩一敌便精神一振，伤势能随之收敛几分。",
    grade: "purple",
    durationSeconds: 0,
    isStarter: true,
    starterWeight: 0.8,
    eventEffects: {
      killMonster: { hp: "5%" },
      killPlayer: { hp: "10%" },
    },
  },
  {
    name: "灵泉不竭",
    description: "每斩一敌，法力便如泉涌般回补一分。",
    grade: "blue",
    durationSeconds: 0,
    isStarter: true,
    starterWeight: 1,
    eventEffects: { killMonster: { mp: "4%" } },
  },
  {
    name: "龟息归元",
    description: "濒死之时反能收敛心神，重伤之后法力回升。",
    grade: "blue",
    durationSeconds: 0,
    isStarter: true,
    starterWeight: 0.9,
    eventEffects: { selfDeath: { mp: "25%" } },
  },
];

/**
 * 凶吉取舍型：带明确代价，不进开局池（isStarter=false），
 * 留给后续随机事件 / 剧情获取，形成「福祸相依」的选择感。
 */
const TRADEOFF_FORTUNES: FortuneSeed[] = [
  {
    name: "天煞孤星",
    description: "亲缘淡薄，命数孤绝，却也因此心无旁骛，斗战所得修为远超常人。",
    grade: "red",
    durationSeconds: 0,
    isStarter: false,
    starterWeight: 0,
    attrEffects: { luck: -3, maxHp: -20 },
    specialEffects: { combatXpRate: 0.5 },
  },
  {
    name: "福祸相依",
    description: "七日间护身气机散乱，却也因此搏命苦修，战斗所得修为暴涨。",
    grade: "purple",
    durationSeconds: 7 * 24 * 3600,
    isStarter: false,
    starterWeight: 0,
    attrEffects: { defense: -3 },
    specialEffects: { combatXpRate: 0.4 },
  },
];

/** 为已有气运补事件型效果（按名字匹配，不存在则跳过）。 */
const EXISTING_EVENT_PATCHES: Record<string, FortuneEventEffects> = {
  凡骨坚忍: { killMonster: { hp: "2%" } },
  目明心静: { killMonster: { mp: "2%" } },
};

const ALL_SEEDS: FortuneSeed[] = [...TIMED_FORTUNES, ...EVENT_FORTUNES, ...TRADEOFF_FORTUNES];

function isEmptyObject(value: unknown): boolean {
  return !value || typeof value !== "object" || Object.keys(value).length === 0;
}

async function main(): Promise<void> {
  console.log(`气运扩展：${ALL_SEEDS.length} 条待处理，模式：${apply ? "写入" : "dry-run"}`);

  const existing = await db.select().from(fortunes);
  const byName = new Map(existing.map((row) => [row.name, row]));

  let inserted = 0;
  let patched = 0;
  let skipped = 0;

  for (const seed of ALL_SEEDS) {
    const current = byName.get(seed.name);

    if (current) {
      const patch: Record<string, unknown> = {};
      if (isEmptyObject(current.eventEffects) && seed.eventEffects) {
        patch.eventEffects = seed.eventEffects;
      }
      if (isEmptyObject(current.specialEffects) && seed.specialEffects) {
        patch.specialEffects = seed.specialEffects;
      }

      if (Object.keys(patch).length === 0) {
        skipped += 1;
        continue;
      }

      patched += 1;
      console.log(`  ~ 补全 ${seed.name}：${Object.keys(patch).join(", ")}`);
      if (apply) {
        await db.update(fortunes).set(patch).where(eq(fortunes.id, current.id));
      }
      continue;
    }

    inserted += 1;
    console.log(`  + 新增 ${seed.name}（${seed.grade}，${seed.durationSeconds === 0 ? "永久" : `${seed.durationSeconds / 86400} 天`}）`);
    if (apply) {
      await db.insert(fortunes).values({
        name: seed.name,
        description: seed.description,
        gender: null,
        enabled: true,
        isHidden: false,
        isStarter: seed.isStarter,
        starterWeight: seed.starterWeight,
        grade: seed.grade,
        durationSeconds: seed.durationSeconds,
        attrEffects: seed.attrEffects ?? {},
        eventEffects: seed.eventEffects ?? {},
        specialEffects: seed.specialEffects ?? {},
      });
    }
  }

  for (const [name, eventEffects] of Object.entries(EXISTING_EVENT_PATCHES)) {
    const current = byName.get(name);
    if (!current) {
      console.log(`  ? 未找到气运「${name}」，跳过`);
      continue;
    }
    if (!isEmptyObject(current.eventEffects)) {
      skipped += 1;
      continue;
    }
    patched += 1;
    console.log(`  ~ 为已有气运「${name}」补事件型效果`);
    if (apply) {
      await db.update(fortunes).set({ eventEffects }).where(eq(fortunes.id, current.id));
    }
  }

  console.log(`\n新增 ${inserted} / 补全 ${patched} / 无需变更 ${skipped}${apply ? "，已写入" : "（加 --apply 生效）"}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("气运扩展失败：", error);
    process.exit(1);
  });

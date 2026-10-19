import { inArray } from "drizzle-orm";
import { db } from "../index";
import { fortunes } from "../schema";
import type { AttributeDelta, FortuneEventEffects, FortuneSpecialEffects } from "@/types/game";

type StarterFortuneSeed = {
  name: string;
  description: string;
  grade: "white" | "blue" | "purple";
  starterWeight: number;
  gender?: "男" | "女" | null;
  attrEffects?: AttributeDelta;
  eventEffects?: FortuneEventEffects;
  specialEffects?: FortuneSpecialEffects;
};

const STARTER_FORTUNES: StarterFortuneSeed[] = [
  {
    name: "福缘初开",
    description: "天生带一点福气，遇事更容易逢凶化吉。",
    grade: "white",
    starterWeight: 14,
    attrEffects: { luck: 2 },
  },
  {
    name: "心境清明",
    description: "心神安稳，灵力运转更顺畅。",
    grade: "white",
    starterWeight: 13,
    attrEffects: { maxMp: 12, mp: 12 },
  },
  {
    name: "身轻如燕",
    description: "步伐轻快，行动先人一步。",
    grade: "white",
    starterWeight: 12,
    attrEffects: { speed: 2 },
  },
  {
    name: "铜皮木骨",
    description: "体魄结实，抗打能力略强。",
    grade: "white",
    starterWeight: 12,
    attrEffects: { maxHp: 18, defense: 1 },
  },
  {
    name: "吐纳有序",
    description: "呼吸绵长，基础恢复更稳。",
    grade: "white",
    starterWeight: 11,
    attrEffects: { hp: 8, mp: 8 },
  },
  {
    name: "机敏过人",
    description: "反应敏捷，出手更果断。",
    grade: "white",
    starterWeight: 11,
    attrEffects: { attack: 2 },
  },
  {
    name: "驱厄小运",
    description: "战后运势微涨，能少沾些晦气。",
    grade: "white",
    starterWeight: 10,
    eventEffects: { killMonster: { luck: 1 } },
  },
  {
    name: "学徒悟性",
    description: "任务中更容易抓住要点。",
    grade: "white",
    starterWeight: 10,
    specialEffects: { questXpRate: 0.04 },
  },
  {
    name: "采药熟手",
    description: "外出历练时更懂取舍。",
    grade: "white",
    starterWeight: 9,
    specialEffects: { adventureXpRate: 0.04 },
  },
  {
    name: "山野福星",
    description: "野战运气不错，收益略有提升。",
    grade: "white",
    starterWeight: 9,
    specialEffects: { combatXpRate: 0.03 },
  },
  {
    name: "玄息流转",
    description: "灵息循环更顺，续航能力更强。",
    grade: "blue",
    starterWeight: 8,
    attrEffects: { maxMp: 22, mp: 18 },
    specialEffects: { questXpRate: 0.05 },
  },
  {
    name: "先机一线",
    description: "关键时刻常能快半拍。",
    grade: "blue",
    starterWeight: 8,
    attrEffects: { speed: 3, luck: 2 },
  },
  {
    name: "稳如磐石",
    description: "根基扎实，防守端更可靠。",
    grade: "blue",
    starterWeight: 7,
    attrEffects: { maxHp: 28, defense: 3 },
  },
  {
    name: "战中回元",
    description: "斩敌后可回补些许气血与灵力。",
    grade: "blue",
    starterWeight: 7,
    eventEffects: { killMonster: { hp: 6, mp: 6 } },
  },
  {
    name: "福星照命",
    description: "命里自带小吉，气运更稳。",
    grade: "blue",
    starterWeight: 7,
    attrEffects: { luck: 4 },
    specialEffects: { adventureXpRate: 0.06 },
  },
  {
    name: "游历见闻",
    description: "阅历增长快，任务与历练收益更高。",
    grade: "blue",
    starterWeight: 6,
    specialEffects: { adventureXpRate: 0.08, questXpRate: 0.05 },
  },
  {
    name: "丹炉亲和",
    description: "对丹道更敏感，炼丹修行更顺。",
    grade: "blue",
    starterWeight: 6,
    specialEffects: { pillXpRate: 0.12 },
  },
  {
    name: "紫霄灵眸",
    description: "洞察敏锐，战斗与运势双向提升。",
    grade: "purple",
    starterWeight: 4,
    attrEffects: { attack: 5, luck: 4 },
    specialEffects: { combatXpRate: 0.08 },
  },
  {
    name: "命途偏护",
    description: "命数偏向守成，生存能力大幅增强。",
    grade: "purple",
    starterWeight: 4,
    attrEffects: { maxHp: 32, maxMp: 24, defense: 3 },
    specialEffects: { questXpRate: 0.06 },
  },
  {
    name: "破境灵感",
    description: "悟性突增，对突破相关修行更有感觉。",
    grade: "purple",
    starterWeight: 3,
    attrEffects: { speed: 4, luck: 5 },
    specialEffects: { pillXpRate: 0.15 },
  },
];

function assertSeedConfig() {
  if (STARTER_FORTUNES.length !== 20) {
    throw new Error(`开局气运数量错误，期望 20 条，实际 ${STARTER_FORTUNES.length} 条`);
  }
}

async function main() {
  assertSeedConfig();
  const now = new Date().toISOString();
  const names = STARTER_FORTUNES.map((item) => item.name);

  const existing = await db.select({
    name: fortunes.name,
  }).from(fortunes).where(inArray(fortunes.name, names)).all();

  const existingNames = new Set(existing.map((row) => row.name));
  let insertCount = 0;
  let updateCount = 0;

  for (const item of STARTER_FORTUNES) {
    const row = {
      name: item.name,
      description: item.description,
      gender: item.gender ?? null,
      enabled: true,
      isStarter: true,
      starterWeight: item.starterWeight,
      grade: item.grade,
      durationSeconds: 0,
      attrEffects: item.attrEffects ?? {},
      eventEffects: item.eventEffects ?? {},
      specialEffects: item.specialEffects ?? {},
      updatedAt: now,
    };

    if (existingNames.has(item.name)) {
      updateCount += 1;
    } else {
      insertCount += 1;
    }

    await db.insert(fortunes).values(row).onConflictDoUpdate({
      target: fortunes.name,
      set: {
        description: row.description,
        gender: row.gender,
        enabled: row.enabled,
        isStarter: row.isStarter,
        starterWeight: row.starterWeight,
        grade: row.grade,
        durationSeconds: row.durationSeconds,
        attrEffects: row.attrEffects,
        eventEffects: row.eventEffects,
        specialEffects: row.specialEffects,
        updatedAt: row.updatedAt,
      },
    }).run();
  }

  console.log(`开局气运脚本执行完成：新增 ${insertCount} 条，更新 ${updateCount} 条。`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "开局气运脚本执行失败");
  process.exit(1);
});

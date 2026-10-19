import { inArray } from "drizzle-orm";
import { db } from "../index";
import { skills } from "../schema";
import type { SkillEffect } from "@/types/game";
import { buildSkillEffectsPayload } from "@/modules/shared/services/skill-visual-effect";

type SkillSeed = {
  id: string;
  name: string;
  description: string;
  skillType: "attack" | "buff" | "debuff" | "heal" | "dot" | "aoe";
  element: string | null;
  damageBase: number;
  damageMultiplier: number;
  mpCost: number;
  cooldown: number;
  effects: SkillEffect[];
  minRealm: number | null;
  maxRealm: number | null;
  target: "self" | "enemy" | "all_enemies";
};

const REQUIRED_EFFECT_TYPES = [
  "poison",
  "burn",
  "freeze",
  "stun",
  "defDown",
  "atkUp",
  "regen",
  "defUp",
  "atkDown",
  "speedDown",
] as const;

const BUFF_SKILLS: SkillSeed[] = [
  {
    id: "skill_buff_zixiao_zhanyi",
    name: "紫霄战意",
    description: "引紫霄真气入体，激发杀伐之势。",
    skillType: "buff",
    element: "雷",
    damageBase: 0,
    damageMultiplier: 0,
    mpCost: 14,
    cooldown: 2,
    effects: [{ type: "atkUp", value: 22, duration: 3, chance: 1 }],
    minRealm: 1,
    maxRealm: null,
    target: "self",
  },
  {
    id: "skill_buff_xuanyue_huti",
    name: "玄岳护体",
    description: "以厚重灵罡护身，短时间内防御大增。",
    skillType: "buff",
    element: "土",
    damageBase: 0,
    damageMultiplier: 0,
    mpCost: 14,
    cooldown: 2,
    effects: [{ type: "defUp", value: 25, duration: 3, chance: 1 }],
    minRealm: 1,
    maxRealm: null,
    target: "self",
  },
  {
    id: "skill_buff_qingmu_huichun",
    name: "青木回春诀",
    description: "催动木灵生机，持续恢复气血。",
    skillType: "buff",
    element: "木",
    damageBase: 0,
    damageMultiplier: 0,
    mpCost: 16,
    cooldown: 2,
    effects: [{ type: "regen", value: 18, duration: 3, chance: 1 }],
    minRealm: 1,
    maxRealm: null,
    target: "self",
  },
  {
    id: "skill_buff_longxiang_fenmai",
    name: "龙象焚脉功",
    description: "燃脉换力，攻守俱增，气势如虹。",
    skillType: "buff",
    element: "火",
    damageBase: 0,
    damageMultiplier: 0,
    mpCost: 22,
    cooldown: 3,
    effects: [
      { type: "atkUp", value: 18, duration: 3, chance: 1 },
      { type: "defUp", value: 18, duration: 3, chance: 1 },
    ],
    minRealm: 1,
    maxRealm: null,
    target: "self",
  },
  {
    id: "skill_buff_taixu_ningshen",
    name: "太虚凝神印",
    description: "心神归一，兼具进攻加持与回气之效。",
    skillType: "buff",
    element: "风",
    damageBase: 0,
    damageMultiplier: 0,
    mpCost: 22,
    cooldown: 3,
    effects: [
      { type: "atkUp", value: 16, duration: 3, chance: 1 },
      { type: "regen", value: 14, duration: 3, chance: 1 },
    ],
    minRealm: 1,
    maxRealm: null,
    target: "self",
  },
  {
    id: "skill_buff_jinzhong_zhenpo",
    name: "金钟镇魄诀",
    description: "金钟护魂，稳固道躯并缓慢回春。",
    skillType: "buff",
    element: "金",
    damageBase: 0,
    damageMultiplier: 0,
    mpCost: 22,
    cooldown: 3,
    effects: [
      { type: "defUp", value: 22, duration: 3, chance: 1 },
      { type: "regen", value: 16, duration: 3, chance: 1 },
    ],
    minRealm: 1,
    maxRealm: null,
    target: "self",
  },
  {
    id: "skill_debuff_shiyuan_shigu",
    name: "噬元蚀骨咒",
    description: "噬元侵体，令敌方气力衰竭。",
    skillType: "debuff",
    element: "暗",
    damageBase: 8,
    damageMultiplier: 0.8,
    mpCost: 16,
    cooldown: 2,
    effects: [{ type: "atkDown", value: 22, duration: 3, chance: 1 }],
    minRealm: 1,
    maxRealm: null,
    target: "enemy",
  },
  {
    id: "skill_debuff_duanyue_pojia",
    name: "断岳破甲印",
    description: "真印轰落，削弱敌方护体罡气。",
    skillType: "debuff",
    element: "土",
    damageBase: 10,
    damageMultiplier: 0.85,
    mpCost: 16,
    cooldown: 2,
    effects: [{ type: "defDown", value: 25, duration: 3, chance: 1 }],
    minRealm: 1,
    maxRealm: null,
    target: "enemy",
  },
  {
    id: "skill_debuff_fufeng_chiying",
    name: "缚风迟影诀",
    description: "风丝缠身，压制身法与步伐。",
    skillType: "debuff",
    element: "风",
    damageBase: 0,
    damageMultiplier: 0,
    mpCost: 15,
    cooldown: 2,
    effects: [{ type: "speedDown", value: 28, duration: 2, chance: 1 }],
    minRealm: 1,
    maxRealm: null,
    target: "enemy",
  },
  {
    id: "skill_debuff_xuanyin_suomai",
    name: "玄阴锁脉咒",
    description: "锁脉封窍，敌人攻势与身法同时下滑。",
    skillType: "debuff",
    element: "冰",
    damageBase: 6,
    damageMultiplier: 0.75,
    mpCost: 18,
    cooldown: 3,
    effects: [
      { type: "atkDown", value: 16, duration: 3, chance: 1 },
      { type: "speedDown", value: 20, duration: 3, chance: 1 },
    ],
    minRealm: 1,
    maxRealm: null,
    target: "enemy",
  },
  {
    id: "skill_dot_jiuyou_shixin",
    name: "九幽蚀心毒",
    description: "幽毒入体，连回合腐蚀敌人气血。",
    skillType: "dot",
    element: "暗",
    damageBase: 12,
    damageMultiplier: 0.9,
    mpCost: 18,
    cooldown: 2,
    effects: [{ type: "poison", value: 14, duration: 3, chance: 0.9 }],
    minRealm: 1,
    maxRealm: null,
    target: "enemy",
  },
  {
    id: "skill_dot_chilian_yehuo",
    name: "赤莲业火咒",
    description: "赤莲业火附体，持续焚灼神魂。",
    skillType: "dot",
    element: "火",
    damageBase: 14,
    damageMultiplier: 0.95,
    mpCost: 18,
    cooldown: 2,
    effects: [{ type: "burn", value: 15, duration: 3, chance: 0.9 }],
    minRealm: 1,
    maxRealm: null,
    target: "enemy",
  },
  {
    id: "skill_debuff_hanpo_bingfeng",
    name: "寒魄冰封术",
    description: "寒魄骤降，冻结敌方经脉行动。",
    skillType: "debuff",
    element: "冰",
    damageBase: 8,
    damageMultiplier: 0.85,
    mpCost: 20,
    cooldown: 3,
    effects: [{ type: "freeze", value: 1, duration: 1, chance: 0.6 }],
    minRealm: 1,
    maxRealm: null,
    target: "enemy",
  },
  {
    id: "skill_debuff_tianfa_zhenhun",
    name: "天罚镇魂击",
    description: "雷意入识，短暂震慑敌方心神。",
    skillType: "debuff",
    element: "雷",
    damageBase: 10,
    damageMultiplier: 0.9,
    mpCost: 20,
    cooldown: 3,
    effects: [{ type: "stun", value: 1, duration: 1, chance: 0.55 }],
    minRealm: 1,
    maxRealm: null,
    target: "enemy",
  },
  {
    id: "skill_attack_pojun_liejia",
    name: "破军裂甲斩",
    description: "刀意直透护体，先破后斩。",
    skillType: "attack",
    element: "金",
    damageBase: 24,
    damageMultiplier: 1.15,
    mpCost: 19,
    cooldown: 2,
    effects: [{ type: "defDown", value: 14, duration: 2, chance: 0.7 }],
    minRealm: 1,
    maxRealm: null,
    target: "enemy",
  },
  {
    id: "skill_attack_chiyang_fentian",
    name: "炽阳焚天式",
    description: "炽阳剑气附炎，命中后留灼烧之患。",
    skillType: "attack",
    element: "火",
    damageBase: 26,
    damageMultiplier: 1.2,
    mpCost: 20,
    cooldown: 2,
    effects: [{ type: "burn", value: 12, duration: 2, chance: 0.75 }],
    minRealm: 1,
    maxRealm: null,
    target: "enemy",
  },
  {
    id: "skill_attack_biluo_dulong",
    name: "碧落毒龙指",
    description: "指劲藏毒，入体后阴损绵长。",
    skillType: "attack",
    element: "木",
    damageBase: 22,
    damageMultiplier: 1.1,
    mpCost: 19,
    cooldown: 2,
    effects: [{ type: "poison", value: 12, duration: 3, chance: 0.75 }],
    minRealm: 1,
    maxRealm: null,
    target: "enemy",
  },
  {
    id: "skill_aoe_wanren_fengyu",
    name: "万刃风狱阵",
    description: "风刃成阵，压制敌方身法节奏。",
    skillType: "aoe",
    element: "风",
    damageBase: 20,
    damageMultiplier: 0.95,
    mpCost: 23,
    cooldown: 3,
    effects: [{ type: "speedDown", value: 18, duration: 2, chance: 0.7 }],
    minRealm: 1,
    maxRealm: null,
    target: "all_enemies",
  },
  {
    id: "skill_heal_huitian_xuming",
    name: "回天续命诀",
    description: "回天之术，立刻疗伤并留下回春效果。",
    skillType: "heal",
    element: "水",
    damageBase: 0,
    damageMultiplier: 0,
    mpCost: 20,
    cooldown: 3,
    effects: [{ type: "regen", value: 20, duration: 2, chance: 1 }],
    minRealm: 1,
    maxRealm: null,
    target: "self",
  },
  {
    id: "skill_attack_zhenyu_leiji",
    name: "镇狱雷殛",
    description: "雷殛镇狱，重击后有概率震晕敌人。",
    skillType: "attack",
    element: "雷",
    damageBase: 30,
    damageMultiplier: 1.3,
    mpCost: 24,
    cooldown: 4,
    effects: [{ type: "stun", value: 1, duration: 1, chance: 0.35 }],
    minRealm: 1,
    maxRealm: null,
    target: "enemy",
  },
];

function assertSkillConfig() {
  if (BUFF_SKILLS.length !== 20) {
    throw new Error(`技能数量错误，期望 20 条，实际 ${BUFF_SKILLS.length} 条`);
  }

  const idSet = new Set(BUFF_SKILLS.map((row) => row.id));
  if (idSet.size !== BUFF_SKILLS.length) {
    throw new Error("技能 ID 存在重复");
  }

  const nameSet = new Set(BUFF_SKILLS.map((row) => row.name));
  if (nameSet.size !== BUFF_SKILLS.length) {
    throw new Error("技能名称存在重复");
  }

  const covered = new Set<string>();
  for (const row of BUFF_SKILLS) {
    for (const effect of row.effects) {
      covered.add(effect.type);
    }
  }

  const missing = REQUIRED_EFFECT_TYPES.filter((type) => !covered.has(type));
  if (missing.length > 0) {
    throw new Error(`技能效果覆盖不完整，缺少：${missing.join("、")}`);
  }
}

async function main() {
  assertSkillConfig();
  const now = new Date().toISOString();
  const ids = BUFF_SKILLS.map((row) => row.id);
  const existing = await db.select({ id: skills.id }).from(skills).where(inArray(skills.id, ids)).all();
  const existingIds = new Set(existing.map((row) => row.id));

  let insertCount = 0;
  let updateCount = 0;

  for (const row of BUFF_SKILLS) {
    if (existingIds.has(row.id)) {
      updateCount += 1;
    } else {
      insertCount += 1;
    }

    await db.insert(skills).values({
      id: row.id,
      name: row.name,
      description: row.description,
      skillType: row.skillType,
      element: row.element,
      damageBase: row.damageBase,
      damageMultiplier: row.damageMultiplier,
      mpCost: row.mpCost,
      cooldown: row.cooldown,
      effects: buildSkillEffectsPayload(row.effects, {}, row),
      minRealm: row.minRealm,
      maxRealm: row.maxRealm,
      target: row.target,
      createdAt: now,
    }).onConflictDoUpdate({
      target: skills.id,
      set: {
        name: row.name,
        description: row.description,
        skillType: row.skillType,
        element: row.element,
        damageBase: row.damageBase,
        damageMultiplier: row.damageMultiplier,
        mpCost: row.mpCost,
        cooldown: row.cooldown,
        effects: buildSkillEffectsPayload(row.effects, {}, row),
        minRealm: row.minRealm,
        maxRealm: row.maxRealm,
        target: row.target,
      },
    }).run();
  }

  console.log(`技能脚本执行完成：新增 ${insertCount} 条，更新 ${updateCount} 条。`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "技能脚本执行失败");
  process.exit(1);
});

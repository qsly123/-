/**
 * 技能扩充：36 → 60。
 *
 * 现状：技能偏攻击向，且流派分化不明显——剑修/体修/符修/丹修拿到的招式差别不大。
 *
 * 本脚本新增 24 个（每段 6 个），每段固定按流派铺开：
 *   剑修（高攻破防）/ 体修（硬碰硬、控场）/ 符修（减益压制）/ 丹修（回复续航）/ 持续伤害 / 群攻。
 *   这样配装、天赋、技能三者才对得上。
 *
 * 数值对标库里既有技能（练气 attack dmg22-30 / 筑基 dmg42 / 元婴 dmg74-88）。
 * 效果键只用既有 11 种：defDown / speedDown / defUp / regen / stun / atkDown /
 * shield / atkUp / burn / poison / freeze（注意：没有 heal，治疗走 regen）。
 *
 * 用法：
 *   bun run scripts/seed-skills.ts --apply
 */
import { db } from "@/db";
import { skills } from "@/db/schema";

type SkillRow = typeof skills.$inferInsert;
type EffectType =
  | "defDown" | "speedDown" | "defUp" | "regen" | "stun"
  | "atkDown" | "shield" | "atkUp" | "burn" | "poison" | "freeze";

interface SkillBlueprint {
  slug: string;
  name: string;
  desc: string;
  skillType: "attack" | "buff" | "debuff" | "dot" | "aoe" | "heal" | "shield";
  element: string;
  damageBase: number;
  damageMultiplier: number;
  mpCost: number;
  cooldown: number;
  target: "enemy" | "self" | "all_enemies";
  effect: { type: EffectType; value: number; chance: number; duration: number };
}

const SEGMENTS = [
  { key: "lianqi", label: "练气", minRealm: 1, maxRealm: 12 },
  { key: "zhuji", label: "筑基", minRealm: 13, maxRealm: 16 },
  { key: "jiedan", label: "结丹", minRealm: 17, maxRealm: 20 },
  { key: "yuanying", label: "元婴", minRealm: 21, maxRealm: 44 },
] as const;

const BLUEPRINTS: Record<string, SkillBlueprint[]> = {
  lianqi: [
    { slug: "duanchao_zhan", name: "断潮斩", skillType: "attack", element: "水", damageBase: 26, damageMultiplier: 1.18, mpCost: 18, cooldown: 1, target: "enemy",
      desc: "一剑斩断潮头。练气期的剑修多半从这一式起手，简单，但挡不住。",
      effect: { type: "defDown", value: 12, chance: 0.4, duration: 1 } },
    { slug: "yangu_zhuang", name: "岩骨撞", skillType: "attack", element: "土", damageBase: 22, damageMultiplier: 1.05, mpCost: 14, cooldown: 1, target: "enemy",
      desc: "以肩背硬撞。体修不讲究好看，讲究对手还站不站得起来。",
      effect: { type: "atkDown", value: 8, chance: 0.35, duration: 1 } },
    { slug: "yinlei_fu", name: "引雷符", skillType: "attack", element: "雷", damageBase: 24, damageMultiplier: 1.2, mpCost: 22, cooldown: 2, target: "enemy",
      desc: "符成雷落。符修的第一课是承认自己身板脆，所以要先让对手慢下来。",
      effect: { type: "speedDown", value: 10, chance: 0.4, duration: 1 } },
    { slug: "wenyang_jue", name: "温养诀", skillType: "heal", element: "木", damageBase: 0, damageMultiplier: 0, mpCost: 18, cooldown: 2, target: "self",
      desc: "慢慢养，不急着好。丹修都知道：伤是养好的，不是治好的。",
      effect: { type: "regen", value: 18, chance: 1, duration: 2 } },
    { slug: "shigu_san", name: "蚀骨散", skillType: "dot", element: "木", damageBase: 10, damageMultiplier: 0.6, mpCost: 16, cooldown: 2, target: "enemy",
      desc: "毒入骨，一时半刻不显。等显出来，人已经跑不动了。",
      effect: { type: "poison", value: 12, chance: 0.6, duration: 2 } },
    { slug: "chaoyin_xiao", name: "潮音啸", skillType: "aoe", element: "水", damageBase: 15, damageMultiplier: 0.9, mpCost: 24, cooldown: 3, target: "all_enemies",
      desc: "一口真气化作潮声，压向四面。声势大，伤害浅——但对付成群的东西够用。",
      effect: { type: "speedDown", value: 8, chance: 0.3, duration: 1 } },
  ],
  zhuji: [
    { slug: "duanyue_zhan", name: "断岳斩", skillType: "attack", element: "金", damageBase: 46, damageMultiplier: 1.24, mpCost: 26, cooldown: 2, target: "enemy",
      desc: "筑基之后剑势沉了，斩下去带金声。山都能断，何况是人。",
      effect: { type: "defDown", value: 18, chance: 0.45, duration: 1 } },
    { slug: "tieshan_kao", name: "铁山靠", skillType: "attack", element: "土", damageBase: 40, damageMultiplier: 1.1, mpCost: 20, cooldown: 2, target: "enemy",
      desc: "整个人撞过去。体修的招式没有名字流传，因为它确实就是撞。",
      effect: { type: "atkDown", value: 14, chance: 0.4, duration: 1 } },
    { slug: "fuling_fuzhen", name: "缚灵符阵", skillType: "debuff", element: "风", damageBase: 0, damageMultiplier: 0, mpCost: 28, cooldown: 3, target: "enemy",
      desc: "符阵落地，气机被缚。对手还在，只是慢得让自己心慌。",
      effect: { type: "speedDown", value: 16, chance: 0.5, duration: 2 } },
    { slug: "huichun_lin", name: "回春霖", skillType: "heal", element: "木", damageBase: 0, damageMultiplier: 0, mpCost: 24, cooldown: 2, target: "self",
      desc: "如春雨落身，不快，但一直在。丹修的仗都是这么熬赢的。",
      effect: { type: "regen", value: 30, chance: 1, duration: 2 } },
    { slug: "fenxin_xuezhou", name: "焚心血咒", skillType: "dot", element: "火", damageBase: 18, damageMultiplier: 0.65, mpCost: 26, cooldown: 2, target: "enemy",
      desc: "以血为引，烧的是对方的血。用多了自己也不好受。",
      effect: { type: "burn", value: 20, chance: 0.6, duration: 2 } },
    { slug: "chisha_nutao", name: "赤砂怒涛", skillType: "aoe", element: "土", damageBase: 30, damageMultiplier: 0.95, mpCost: 32, cooldown: 3, target: "all_enemies",
      desc: "卷起一地赤砂扑向四面。砂里带煞，进了伤口就别想干净。",
      effect: { type: "defDown", value: 12, chance: 0.35, duration: 1 } },
  ],
  jiedan: [
    { slug: "wenxin_yijian", name: "问心一剑", skillType: "attack", element: "光", damageBase: 68, damageMultiplier: 1.3, mpCost: 36, cooldown: 2, target: "enemy",
      desc: "出剑前先问自己一句：该不该杀。答得上来，这一剑才快。",
      effect: { type: "defDown", value: 26, chance: 0.5, duration: 2 } },
    { slug: "panlong_zhuang", name: "磐龙撞", skillType: "attack", element: "土", damageBase: 62, damageMultiplier: 1.15, mpCost: 30, cooldown: 2, target: "enemy",
      desc: "如龙盘身，一撞即中。中者多半当场懵住，然后才倒。",
      effect: { type: "stun", value: 1, chance: 0.3, duration: 1 } },
    { slug: "shehun_fu", name: "摄魂符", skillType: "debuff", element: "暗", damageBase: 0, damageMultiplier: 0, mpCost: 38, cooldown: 3, target: "enemy",
      desc: "符摄其魂，令其出手失据。结丹之后，符修开始能正面压人。",
      effect: { type: "atkDown", value: 28, chance: 0.5, duration: 2 } },
    { slug: "lianhua_lu", name: "莲华露", skillType: "heal", element: "水", damageBase: 0, damageMultiplier: 0, mpCost: 34, cooldown: 2, target: "self",
      desc: "灵莲上的一滴露，落在伤口上，疼就退了。",
      effect: { type: "regen", value: 55, chance: 1, duration: 2 } },
    { slug: "shimai_duhuo", name: "蚀脉毒火", skillType: "dot", element: "火", damageBase: 28, damageMultiplier: 0.7, mpCost: 34, cooldown: 3, target: "enemy",
      desc: "毒火顺着经脉走。走得慢，但每一寸都在烧。",
      effect: { type: "poison", value: 34, chance: 0.65, duration: 3 } },
    { slug: "wuhai_lingyin", name: "雾海铃音", skillType: "aoe", element: "水", damageBase: 45, damageMultiplier: 1.0, mpCost: 42, cooldown: 3, target: "all_enemies",
      desc: "铃声起，雾里的人脚步都乱了。柳渡集的人说：听见铃就别往前走。",
      effect: { type: "speedDown", value: 20, chance: 0.4, duration: 2 } },
  ],
  yuanying: [
    { slug: "tianlie_zhan", name: "天裂斩", skillType: "attack", element: "金", damageBase: 92, damageMultiplier: 1.4, mpCost: 50, cooldown: 3, target: "enemy",
      desc: "剑势上行，据说连天都能划开一道。裂天墟里有人见过类似的痕。",
      effect: { type: "defDown", value: 38, chance: 0.55, duration: 2 } },
    { slug: "hantian_zhuang", name: "撼天撞", skillType: "attack", element: "土", damageBase: 85, damageMultiplier: 1.25, mpCost: 44, cooldown: 3, target: "enemy",
      desc: "元婴体修的一撞，地面要响。响过之后，对面多半起不来。",
      effect: { type: "stun", value: 1, chance: 0.35, duration: 1 } },
    { slug: "zhenhun_fuzhao", name: "镇魂符诏", skillType: "debuff", element: "雷", damageBase: 0, damageMultiplier: 0, mpCost: 52, cooldown: 3, target: "enemy",
      desc: "一纸符诏镇下，气机立滞。元婴修士也躲不开这道滞。",
      effect: { type: "speedDown", value: 34, chance: 0.55, duration: 2 } },
    { slug: "yusui_shengji", name: "玉髓生肌", skillType: "heal", element: "木", damageBase: 0, damageMultiplier: 0, mpCost: 48, cooldown: 3, target: "self",
      desc: "玉髓入体，肉重新长。疼是疼，但命还在。",
      effect: { type: "regen", value: 90, chance: 1, duration: 3 } },
    { slug: "mosui_shixin", name: "魔髓蚀心", skillType: "dot", element: "暗", damageBase: 40, damageMultiplier: 0.75, mpCost: 50, cooldown: 3, target: "enemy",
      desc: "魔髓蚀心，从里往外烂。用它的人，手上也会沾一点。",
      effect: { type: "poison", value: 55, chance: 0.7, duration: 3 } },
    { slug: "beiming_hanchao", name: "北溟寒潮", skillType: "aoe", element: "冰", damageBase: 65, damageMultiplier: 1.05, mpCost: 56, cooldown: 4, target: "all_enemies",
      desc: "北溟的寒潮扑过战场，站着的都慢下来，慢下来的就冻住。",
      effect: { type: "freeze", value: 1, chance: 0.3, duration: 1 } },
  ],
};

function buildRows(): SkillRow[] {
  const rows: SkillRow[] = [];
  for (const segment of SEGMENTS) {
    for (const bp of BLUEPRINTS[segment.key] || []) {
      rows.push({
        id: `skill_four_realms_${segment.key}_${bp.slug}`,
        name: bp.name,
        description: bp.desc,
        skillType: bp.skillType,
        element: bp.element,
        damageBase: bp.damageBase,
        damageMultiplier: bp.damageMultiplier,
        mpCost: bp.mpCost,
        cooldown: bp.cooldown,
        effects: {
          effects: [bp.effect],
        },
        minRealm: segment.minRealm,
        maxRealm: segment.maxRealm,
        target: bp.target,
      });
    }
  }
  return rows;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = buildRows();
  console.log(`新增技能 ${rows.length} 个`);
  if (!apply) {
    for (const row of rows.slice(0, 6)) {
      console.log(`  [${row.skillType}/${row.element}] ${row.name} dmg${row.damageBase} mp${row.mpCost} cd${row.cooldown}`);
    }
    console.log("  …（加 --apply 写入）");
    return;
  }
  for (const row of rows) {
    await db.insert(skills).values(row)
      .onConflictDoUpdate({ target: skills.id, set: row })
      .run();
  }
  console.log("写入完成");
}

void main();

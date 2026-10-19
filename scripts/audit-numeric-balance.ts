/**
 * 离线数值审计：bun run scripts/audit-numeric-balance.ts
 * 不连接数据库、不执行种子脚本。通过 AST 提取现有纯函数，避免复制公式和触发写库入口。
 * FAIL 表示复现了数值契约问题；WARN 表示配置/设计风险，不能代替线上数据验证。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { fourRealmsPack } from "@/db/offline-packs/four-realms-pack";
import { calculateCombatDamageOutcome } from "@/modules/combat/services/combat-mechanics";
import { applyModifiers } from "@/modules/character/services/framework/stat-modifiers";
import type { CombatUnit } from "@/types/game";
import { buildCombatDamageCalculator, type DamageCalculator } from "@immortality/game-rules";
import { scaleEquipmentEffects, collectEquipmentAffixBonus, getEquipmentRefineBonus } from "@/modules/character/services/equipment-stat-rules";

function pure<T>(path: string, names: string[], injected: Record<string, unknown> = {}): T {
  const source = readFileSync(resolve(path), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const selected = ast.statements.filter((node) => {
    if (ts.isFunctionDeclaration(node)) return !!node.name && names.includes(node.name.text);
    if (ts.isVariableStatement(node)) {
      return node.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && names.includes(d.name.text));
    }
    return false;
  });
  const code = selected.map((node) => node.getText(ast).replace(/^export\s+/, "")).join("\n")
    + `\nglobalThis.result = { ${names.join(", ")} };`;
  const context = { ...injected, result: undefined };
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.result as T;
}

const equipment = pure<{
  computeStageMult: (p: { itemMinRealm: number; itemMaxRealm: number; playerRealm: number; rarity: string }) => number;
}>("src/modules/character/services/equipment-instance-service.ts", [
  "STAGE_STEP", "RARITY_EFFECTIVE_MULT", "RARITY_SEED_MULT", "SEGMENT_SEED_MULT",
  "powerOfRealm", "segmentSeedMult", "computeStageMult",
]);
type Reference = { atk: number; def: number; hp: number; speed: number; luck: number; pen: number };
type MonsterStats = { hp: number; attack: number; defense: number; armorPenetration: number; speed: number; luck: number; spiritualSense: number; block: number };
const seed = pure<{
  gearedPlayer: (level: number, rarity: string) => Reference;
  buildStats: (level: number, type: string) => MonsterStats;
  GEAR_VALUE: Record<string, { sense: number }>;
}>("scripts/seed-high-realm-content.ts", [
  "BANDS", "HP_BASE", "ATK_BASE", "DEF_BASE", "XP_BASE", "GOLD_BASE", "interpolate", "TYPE_MULT",
  "CRIT_MULT", "PLAYER_SKILL_MUL", "MONSTER_SKILL_MUL", "RARITY_SEED", "TARGET_ROUNDS",
  "ANCHOR_RARITY", "clampInt32", "effectiveDefense", "gearedPlayer", "expectedDamage", "buildStats", "GEAR_VALUE",
], { computeStageMult: equipment.computeStageMult });

type Check = { id: string; status: "PASS" | "FAIL" | "WARN"; detail: string };
const checks: Check[] = [];
function check(id: string, ok: boolean, detail: string) {
  checks.push({ id, status: ok ? "PASS" : "FAIL", detail });
}
function unit(stats: Partial<CombatUnit>): CombatUnit {
  return {
    id: "audit", name: "audit", hp: 1000, maxHp: 1000, mp: 0, maxMp: 0,
    attack: 100, defense: 0, speed: 0, luck: 0, spiritualSense: 0,
    armorPenetration: 0, block: 0, skillDamageBonus: 0, skillDamageReduction: 0,
    artifactDamageBonus: 0, artifactDamageReduction: 0, activeEffects: [],
    ...stats,
  } as CombatUnit;
}
function playerUnit(p: Reference, realm: number, bonus: number) {
  return unit({ hp: p.hp, maxHp: p.hp, attack: p.atk, defense: p.def, speed: p.speed,
    luck: p.luck, armorPenetration: p.pen, realm, skillDamageBonus: bonus });
}
function meanDamage(attacker: CombatUnit, defender: CombatUnit, multiplier: number, damageCalculator?: DamageCalculator) {
  const original = Math.random;
  let randomState = 20261019;
  Math.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  try {
    let damage = 0;
    for (let index = 0; index < 4096; index += 1) {
      damage += calculateCombatDamageOutcome({ attacker, defender: { ...defender },
        damageBase: 0, damageMultiplier: multiplier, damageCalculator }).totalDamage;
    }
    return damage / 4096;
  } finally {
    Math.random = original;
  }
}

const bands = ["huashen", "lianxu", "heti", "dacheng", "dujie"];
const packFormula = fourRealmsPack.systemConfigs.find((config) => config.key === "COMBAT_DAMAGE_FORMULA")!.value;
const packCalculator = buildCombatDamageCalculator(packFormula);
const combatRows = [];
for (let realm = 25; realm <= 44; realm += 1) {
  const bandIndex = Math.floor((realm - 25) / 4);
  const min = 25 + bandIndex * 4;
  const stageMult = equipment.computeStageMult({ itemMinRealm: min, itemMaxRealm: min + 3,
    playerRealm: realm, rarity: "epic" });
  const baseBonus = Math.max(1, Math.round(seed.GEAR_VALUE[bands[bandIndex]].sense * 1.5));
  const bonus = Number(scaleEquipmentEffects([{ type: "boost_skill_damage_bonus", value: baseBonus }], stageMult)[0].value);
  for (const type of ["normal", "elite", "boss"]) {
    const rarity = { normal: "rare", elite: "epic", boss: "legendary" }[type]!;
    const p = seed.gearedPlayer(realm, rarity);
    const monster = seed.buildStats(realm, type);
    const m = unit({ ...monster, maxHp: monster.hp, realm });
    // 隔离增伤字段的影响：参考玩家沿用种子脚本的属性假设，非真实玩家快照。
    const noBonus = meanDamage(playerUnit(p, realm, 0), m, 1.4);
    const damage = meanDamage(playerUnit(p, realm, bonus), m, 1.4);
    const incoming = meanDamage(m, playerUnit(p, realm, bonus), 1.3);
    const packDamage = meanDamage(playerUnit(p, realm, bonus), m, 1.4, packCalculator);
    combatRows.push({ realm, type, stageMult, bonusPercent: bonus, monsterAttack: monster.attack,
      monsterHp: monster.hp, referenceMaxHp: p.hp, meanDamage: damage,
      hitsToKillWithoutBonus: monster.hp / noBonus, hitsToKillWithBonus: monster.hp / damage,
      hitsToKillWithPackFormula: monster.hp / packDamage,
      hitsToDieAtFullHp: p.hp / incoming });
  }
}
check("percentage-effect-scaling", combatRows.every((r) => r.bonusPercent <= 100),
  `高段极品法宝增伤：25级 ${combatRows[0].bonusPercent}%，44级 ${combatRows.at(-1)!.bonusPercent}%。100%为审计阈值，不是设计规范。`);
const capped = combatRows.filter((r) => r.monsterAttack === 2147483647);
check("monster-attack-int32-cap", capped.length === 0,
  `${capped.length}/60 个等级×类型样本攻击触顶；首个 ${capped[0]?.realm ?? "无"}级 ${capped[0]?.type ?? ""}。`);
const epicRows = combatRows.filter((r) => r.type === "elite");
const singleHits = epicRows.filter((r) => r.hitsToKillWithBonus < 1);
check("seed-target-rounds", singleHits.length === 0,
  `${singleHits.length}/20 个极品整套对同级精英参考样本期望伤害超过怪物满血（原目标10次）。不含移动、技能冷却、MP、真实玩家成长加成。其他品级行仅为沿用种子参考属性的敏感性比较。`);
check("pack-formula-target-rounds", epicRows.every((r) => r.hitsToKillWithPackFormula >= 1),
  `换用内容包配置公式仍有 ${epicRows.filter((r) => r.hitsToKillWithPackFormula < 1).length}/20 个极品参考样本期望单次伤害超过满血。`);

const affixResult = applyModifiers({ skillDamageBonus: 0 }, {
  ...collectEquipmentAffixBonus([{ key: "skillDamageBonus", percent: 0.02 }]), elementDamageBonus: 0,
}).skillDamageBonus;
check("zero-base-damage-affix", affixResult === 2, `零基础神通增伤 + 存量percent:0.02 后为 ${affixResult} 个百分点，目标为2。`);
const refineStageMult = equipment.computeStageMult({ itemMinRealm: 25, itemMaxRealm: 28, playerRealm: 25, rarity: "epic" });
const refinedAttack = getEquipmentRefineBonus([{ type: "boost_atk", value: 54 }], refineStageMult, 10).attack ?? 0;
const refineRatio = refinedAttack / (Math.round(54 * refineStageMult));
check("refine-scaled-base", Math.abs(refineRatio - 0.5) < 0.01,
  `25级攻击54的武器精炼10级：追加${refinedAttack}，实例攻击${Math.round(54 * refineStageMult)}；实际提升 ${(refineRatio * 100).toFixed(4)}%，约定50%。`);

const xpZero = fourRealmsPack.monsters.filter((m) => m.xpReward === 0);
check("offline-pack-monster-xp", xpZero.length === 0, `基础内容包 ${xpZero.length}/${fourRealmsPack.monsters.length} 只怪修为奖励为0；补齐种子脚本是否部署须查库。`);
const itemIds = new Set(fourRealmsPack.items.map((item) => item.id));
const badDrops = fourRealmsPack.monsters.flatMap((monster) => monster.drops.filter((drop) => (
  !itemIds.has(drop.itemId) || drop.chance < 0 || drop.chance > 1
  || drop.minQuantity < 1 || drop.maxQuantity < drop.minQuantity
)).map((drop) => ({ monster: monster.id, drop })));
check("pack-drop-integrity", badDrops.length === 0, `掉落物引用、概率和数量异常 ${badDrops.length} 条。`);
const recipes = [...fourRealmsPack.alchemyRecipes, ...fourRealmsPack.smithingRecipes];
const badRecipes = recipes.filter((recipe) => !itemIds.has(recipe.resultItemId)
  || !itemIds.has(recipe.mainItemId) || recipe.resultQuantity < 1 || recipe.mainQuantity < 1
  || recipe.baseSuccessRate < 0 || recipe.baseSuccessRate > 1
  || [recipe.auxAItemId, recipe.auxBItemId, recipe.auxCItemId].some((id) => id && !itemIds.has(id)));
check("pack-recipe-integrity", badRecipes.length === 0, `${recipes.length} 条配方，材料/产物引用和数量/成功率异常 ${badRecipes.length} 条。`);
checks.push({ id: "pill-pacing-budget", status: "WARN", detail: "门槛按每日20枚丹估算，运行时是20丹毒容量+每8分钟恢复1点；供应充足时持续吞吐约180枚/日，另有初始容量，20不是每日硬限额。" });
const pacing = fourRealmsPack.realmMajors.flatMap((major) => major.stages.map((stage, index) => ({
  major: major.name, minor: index + 1, requiredXp: stage.requiredXp,
  probability: Math.min(0.95, stage.successRate), failLoss: stage.failXpLossRate,
  expectedXpAtThreshold: stage.requiredXp * (1 + (1 - Math.min(0.95, stage.successRate)) / Math.min(0.95, stage.successRate) * stage.failXpLossRate),
})));
checks.push({ id: "pacing-ignores-breakthrough-failure", status: "WARN",
  detail: "目标天数公式只求攒满门槛；例如化神初期成功率32%、失败损失44%，每次攒到门槛立即重试的期望总消耗为门槛的1.935倍（未计加成）。" });
checks.push({ id: "database-unavailable", status: "WARN", detail: "本地无 DATABASE_URL，未检查数据库覆盖配置、实际玩家、部署种子执行情况。" });

const report = { scope: "offline-source-and-reference-simulation", samplesPerDamage: 4096,
  checks, counts: { realmStages: pacing.length, packMonsters: fourRealmsPack.monsters.length,
    packItems: fourRealmsPack.items.length, packSkills: fourRealmsPack.skills.length }, pacing, combatRows };
const output = resolve("docs/numeric-balance-after-data.json");
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", "utf8");
for (const entry of checks) console.log(`[${entry.status}] ${entry.id}: ${entry.detail}`);
console.log(`明细：${output}`);
process.exitCode = checks.some((entry) => entry.status === "FAIL") ? 1 : 0;

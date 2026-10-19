/** 数据库读入口与非装备provider使用fixture；属性快照、装备provider和战斗结算调用真实代码。 */
import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyModifiers, mergeStatModifiers, type StatPercentBonus } from "@/modules/character/services/framework/stat-modifiers";
import { getEquipmentDisplayEffects, type EquipmentStatAffix } from "@/modules/character/services/equipment-stat-rules";
import { calculateCombatDamageOutcome } from "@/modules/combat/services/combat-mechanics";
import type { CombatUnit, ItemEffect } from "@/types/game";

type MockInventoryRow = {
  playerId: string; effects: ItemEffect[]; stageMult: number; refineLevel: number; affixes: EquipmentStatAffix[];
};
let inventory: MockInventoryRow[] = [];
let rootPercent: StatPercentBonus = {};
let reads = 0;
const rows: Array<Record<string, unknown>> = [];
const emptyBonus = () => ({ maxHp: 0, maxMp: 0, attack: 0, defense: 0, speed: 0, luck: 0,
  spiritualSense: 0, armorPenetration: 0, block: 0, skillDamageBonus: 0, skillDamageReduction: 0,
  artifactDamageBonus: 0, artifactDamageReduction: 0 });

mock.module("@/db", () => ({ db: {
  select: (projection: Record<string, unknown>) => {
    const query = {
      from: () => query, innerJoin: () => query, where: () => query,
      all: async () => {
        reads += 1;
        // 严格按调用方select字段返回，漏查stageMult时不会被fixture偷偷补上。
        return inventory.map((row) => Object.fromEntries(Object.keys(projection).map((key) => [key, row[key as keyof MockInventoryRow]])));
      },
    };
    return query;
  },
  insert: () => { throw new Error("mock验证禁止写库"); },
  update: () => { throw new Error("mock验证禁止写库"); },
  delete: () => { throw new Error("mock验证禁止写库"); },
  execute: () => { throw new Error("mock验证禁止执行SQL"); },
} }));
mock.module("@/modules/shared/services/legacy-plugin-compat", () => ({
  collectPlayerStatsBonusByPlugins: async () => emptyBonus(),
  collectPlayersStatsBonusMapByPlugins: async () => new Map(),
}));
mock.module("@/modules/character/services/player-status", () => ({
  getPlayerStatusAttrBonus: async () => emptyBonus(),
}));
const { collectEquipmentModifiers } = await import("@/modules/character/services/framework/equipment.provider");
mock.module("@/modules/character/services/framework", () => ({
  applyModifiers,
  registerBuiltinProviders: () => {},
  collectMergedModifiers: async () => mergeStatModifiers([
    ...await collectEquipmentModifiers("mock-player"),
    { layer: "spiritualRoot", percent: rootPercent },
  ]),
}));
const { buildPlayerStatsSnapshot } = await import("@/modules/character/services/player-stats");

const base = { id: "mock-player", hp: 1000, maxHp: 1000, mp: 100, maxMp: 100,
  attack: 100, defense: 0, speed: 0, luck: 0 };
const weapon = (refineLevel = 0, affixes: EquipmentStatAffix[] = []): MockInventoryRow => ({
  playerId: base.id, stageMult: 257.55, refineLevel, affixes,
  effects: [{ type: "boost_atk", value: 54 }, { type: "boost_skill_damage_bonus", value: 5 }],
});
function combatUnit(stats: Partial<CombatUnit> = {}): CombatUnit {
  return { id: "target", name: "mock", isPlayer: false, realm: 25, hp: 1000000000, maxHp: 1000000000,
    mp: 0, maxMp: 0, attack: 100, defense: 0, speed: 0, luck: 0, spiritualSense: 0,
    armorPenetration: 0, block: 0, skillDamageBonus: 0, skillDamageReduction: 0,
    artifactDamageBonus: 0, artifactDamageReduction: 0, skills: [], skillCooldowns: {},
    activeEffects: [], isStunned: false, ...stats };
}
function damage(attacker: CombatUnit, sourceType?: "artifact", defender = combatUnit()) {
  const random = spyOn(Math, "random").mockReturnValue(0.5);
  try {
    return calculateCombatDamageOutcome({ attacker, defender,
      damageBase: 0, damageMultiplier: 1, sourceType }).totalDamage;
  } finally {
    random.mockRestore();
  }
}

beforeEach(() => { inventory = []; rootPercent = {}; reads = 0; });
afterAll(() => {
  writeFileSync(resolve("docs/numeric-balance-mock-results.json"), JSON.stringify({
    scope: "mock inventory reads, real equipment provider + player snapshot + damage settlement",
    limitations: "不验证SQL过滤、真实数据库、其他provider、完整技能轮换或线上战斗", rows,
  }, null, 2) + "\n", "utf8");
});

describe("mock库存 → 真实属性快照 → 真实战斗结算", () => {
  test("裸装基准不变，快照不凭空恢复HP/MP", async () => {
    const snapshot = await buildPlayerStatsSnapshot(base);
    expect(snapshot.total.attack).toBe(100);
    expect(snapshot.total.maxHp).toBe(1000);
    expect(snapshot.total.hp).toBe(1000);
    expect(snapshot.total.mp).toBe(100);
    expect(damage(combatUnit(snapshot.total))).toBe(100);
    expect(reads).toBe(2);
    rows.push({ scenario: "裸装", attack: snapshot.total.attack, damage: 100 });
  });

  test("大倍率装备不会把5%增伤放大为1288%，实战伤害恢复正常", async () => {
    inventory = [weapon()];
    const snapshot = await buildPlayerStatsSnapshot(base);
    expect(snapshot.total.attack).toBe(14008);
    expect(snapshot.total.skillDamageBonus).toBe(5);
    expect(damage(combatUnit(snapshot.total))).toBe(14708);
    rows.push({ scenario: "25级武器无精炼", attack: snapshot.total.attack,
      bonusPercent: snapshot.total.skillDamageBonus, damage: 14708,
      historicalFixture: { bonusPercent: 1288, damage: 194431 } });
  });

  test("精炼10级只追加一次实例攻击，展示与快照固定属性一致", async () => {
    inventory = [weapon(10)];
    const snapshot = await buildPlayerStatsSnapshot(base);
    expect(snapshot.equipment.attack).toBe(13908);
    expect(snapshot.total.attack).toBe(20962);
    expect(snapshot.total.skillDamageBonus).toBe(5);
    expect(getEquipmentDisplayEffects(inventory[0].effects, 257.55, 10)[0].value).toBe(snapshot.total.attack - base.attack);
    expect(damage(combatUnit(snapshot.total))).toBe(22010);
    rows.push({ scenario: "25级武器精炼10级", attack: snapshot.total.attack, damage: 22010 });
  });

  test("旧词条与新词条在真实快照和伤害中完全一致", async () => {
    inventory = [weapon(10, [{ key: "skillDamageBonus", percent: 0.02 }])];
    const legacy = await buildPlayerStatsSnapshot(base);
    inventory = [weapon(10, [{ kind: "stat", key: "skillDamageBonus", flat: 2 }])];
    const current = await buildPlayerStatsSnapshot(base);
    expect(legacy.total).toEqual(current.total);
    expect(current.total.skillDamageBonus).toBe(7);
    expect(damage(combatUnit(current.total))).toBe(22429);
    rows.push({ scenario: "精炼10级+新旧增伤词条", bonusPercent: 7, damage: 22429 });
  });

  test("零基础伤害词条生效，神通与法宝乘区正确区分", async () => {
    inventory = [{ ...weapon(), effects: [], affixes: [
      { key: "skillDamageBonus", percent: 0.02 }, { kind: "stat", key: "artifactDamageBonus", flat: 11 },
    ] }];
    const snapshot = await buildPlayerStatsSnapshot(base);
    expect(snapshot.total.skillDamageBonus).toBe(2);
    expect(damage(combatUnit(snapshot.total))).toBe(102);
    expect(damage(combatUnit(snapshot.total), "artifact")).toBe(111);
    rows.push({ scenario: "零基础词条与法宝区分", skillDamage: 102, artifactDamage: 111 });
  });

  test("灵根、百分比攻击词条与精炼相加后统一乘算", async () => {
    inventory = [weapon(10, [{ key: "attack", flat: 10 }, { key: "attack", percent: 0.1 }])];
    rootPercent = { attack: 0.1 };
    const snapshot = await buildPlayerStatsSnapshot(base);
    expect(snapshot.total.attack).toBe(25166.4);
    expect(snapshot.total.skillDamageBonus).toBe(5);
    rows.push({ scenario: "精炼+攻击词条+灵根", attack: snapshot.total.attack });
  });

  test("多件装备分别缩放精炼，HP上限成长不自动加满当前HP", async () => {
    inventory = [weapon(10), { ...weapon(10), effects: [{ type: "boost_hp", value: 272 }] }];
    const snapshot = await buildPlayerStatsSnapshot(base);
    expect(snapshot.total.attack).toBe(20962);
    expect(snapshot.total.maxHp).toBe(106081);
    expect(snapshot.total.hp).toBe(1000);
    expect(getEquipmentDisplayEffects(inventory[1].effects, 257.55, 10)[0].value).toBe(105081);
    rows.push({ scenario: "武器+护甲精炼10级", attack: snapshot.total.attack, maxHp: snapshot.total.maxHp, hp: snapshot.total.hp });
  });

  test("防守方旧减伤词条转为百分点，真实承伤随之降低", async () => {
    inventory = [{ ...weapon(), effects: [], affixes: [{ key: "skillDamageReduction", percent: 0.02 }] }];
    const snapshot = await buildPlayerStatsSnapshot(base);
    const defender = combatUnit(snapshot.total);
    expect(snapshot.total.skillDamageReduction).toBe(2);
    expect(damage(combatUnit(), undefined, defender)).toBe(98);
    expect(defender.hp).toBe(902);
    rows.push({ scenario: "零基础减伤词条", damageReductionPercent: 2, incomingDamage: 98, hpAfter: defender.hp });
  });

  test("护盾优先消耗MP，致死后HP与MP保持非负", async () => {
    inventory = [weapon()];
    const snapshot = await buildPlayerStatsSnapshot(base);
    const defender = combatUnit({ hp: 100, maxHp: 100, mp: 50, maxMp: 50,
      activeEffects: [{ type: "shield", value: 50, remainingTurns: 2, sourceSkillId: "mock-shield" }] });
    expect(damage(combatUnit(snapshot.total), undefined, defender)).toBe(14708);
    expect(defender.mp).toBe(0);
    expect(defender.hp).toBe(0);
    rows.push({ scenario: "护盾及致死结算", damage: 14708, hpAfter: defender.hp, mpAfter: defender.mp });
  });
});

/**
 * 真实管线平衡实测：化神 epic 一套（精炼0 / 精炼10）→ 真实属性快照 → 真实伤害结算 → 真实怪物。
 * 目的：属性聚合修正（增伤 1288%→5%）+ 精炼 ×1.5 之后，怪物数值还命中 4/10/15 回合目标吗。
 * 全程只写测试道友的背包并在结束时按记录还原。
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { players, items, playerInventory, monsters } from "@/db/schema";
import { computeStageMult } from "@/modules/character/services/equipment-instance-service";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";
import { calculateCombatDamageOutcome } from "@/modules/combat/services/combat-mechanics";
import type { CombatUnit } from "@/types/game";

const SLOTS = ["weapon", "armor", "helmet", "shoes", "artifact"] as const;
const PLAYER_SKILL_MUL = 1.4;
const MONSTER_SKILL_MUL = 1.3;

function fmt(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return String(Math.round(n));
}

type Total = Record<string, number | undefined>;
function pick(t: Total, k: string): number { return Number(t[k] ?? 0); }

function toUnit(total: Total, isPlayer: boolean): CombatUnit {
  return {
    id: isPlayer ? "player" : "monster",
    name: isPlayer ? "测试道友" : "怪物",
    isPlayer,
    realm: 25,
    hp: pick(total, "hp") || pick(total, "maxHp"),
    maxHp: pick(total, "maxHp") || pick(total, "hp"),
    mp: 500, maxMp: 500,
    attack: pick(total, "attack"),
    defense: pick(total, "defense"),
    speed: pick(total, "speed"),
    luck: pick(total, "luck"),
    spiritualSense: pick(total, "spiritualSense"),
    armorPenetration: pick(total, "armorPenetration"),
    block: pick(total, "block"),
    skillDamageBonus: pick(total, "skillDamageBonus"),
    skillDamageReduction: pick(total, "skillDamageReduction"),
    artifactDamageBonus: pick(total, "artifactDamageBonus"),
    artifactDamageReduction: pick(total, "artifactDamageReduction"),
    skills: [], skillCooldowns: {}, activeEffects: [], isStunned: false,
  };
}

function oneRound(attacker: Total, defender: Total, mul: number, attackerIsPlayer: boolean): number {
  const a = toUnit(attacker, attackerIsPlayer);
  const d = toUnit(defender, !attackerIsPlayer);
  return calculateCombatDamageOutcome({
    attacker: a, defender: d, damageBase: 0, damageMultiplier: mul,
  }).totalDamage;
}

function brief(t: Total): string {
  return `atk=${fmt(pick(t, "attack"))} hp=${fmt(pick(t, "maxHp"))} def=${fmt(pick(t, "defense"))} 破防=${fmt(pick(t, "armorPenetration"))} 神伤=${pick(t, "skillDamageBonus")}%`;
}

async function main() {
  // 固定随机数，保证可复现（与 mock 验证同一做法）
  const realRandom = Math.random;
  Math.random = () => 0.5;

  try {
    const pRow = await db.select().from(players)
      .where(sql`${players.name} = '测试道友'`).get();
    if (!pRow) { console.log("找不到测试道友"); return; }
    const p = pRow;

    const before = await db.select({
      itemId: playerInventory.itemId, quantity: playerInventory.quantity,
      equipped: playerInventory.equipped, equipSlot: playerInventory.equipSlot,
      stageMult: playerInventory.stageMult, stageRealm: playerInventory.stageRealm,
      refineLevel: playerInventory.refineLevel, affixes: playerInventory.affixes,
    }).from(playerInventory)
      .where(sql`${playerInventory.playerId} = ${p.id} and ${playerInventory.itemId} like 'item_four_realms_huashen_%'`).all();

    const baseSnap = (await buildPlayerStatsSnapshot(p)).total as unknown as Total;

    async function equip(refineLevel: number) {
      await db.delete(playerInventory)
        .where(sql`${playerInventory.playerId} = ${p.id} and ${playerInventory.itemId} like 'item_four_realms_huashen_%'`).run();
      for (const slot of SLOTS) {
        const itemId = `item_four_realms_huashen_${slot}`;
        const it = await db.select({ rarity: items.rarity, minRealm: items.minRealm, maxRealm: items.maxRealm })
          .from(items).where(sql`${items.id} = ${itemId}`).get();
        if (!it) continue;
        const mult = computeStageMult({
          itemMinRealm: it.minRealm, itemMaxRealm: it.maxRealm, playerRealm: p.realm, rarity: String(it.rarity),
        });
        await db.insert(playerInventory).values({
          playerId: p.id, itemId, quantity: 1, equipped: true, equipSlot: slot,
          refineLevel, stageMult: mult, stageRealm: p.realm,
        }).run();
      }
    }

    async function restore() {
      await db.delete(playerInventory)
        .where(sql`${playerInventory.playerId} = ${p.id} and ${playerInventory.itemId} like 'item_four_realms_huashen_%'`).run();
      for (const row of before) {
        await db.insert(playerInventory).values({
          playerId: p.id, itemId: row.itemId, quantity: row.quantity ?? 1,
          equipped: row.equipped ?? false, equipSlot: row.equipSlot,
          refineLevel: row.refineLevel ?? 0, stageMult: row.stageMult ?? 1,
          stageRealm: row.stageRealm, affixes: row.affixes ?? null,
        }).run();
      }
    }

    const loaded = await db.select().from(monsters)
      .where(sql`${monsters.level} = 25 and ${monsters.monsterType} in ('normal','elite','boss')`).all();
    const byType = new Map(loaded.map((m) => [m.monsterType, m]));

    const anchor = { normal: 4, elite: 10, boss: 15 } as const;

    for (const refineLevel of [0, 10] as const) {
      await equip(refineLevel);
      const snap = (await buildPlayerStatsSnapshot(p)).total as unknown as Total;
      console.log(`\n=== 化神 epic 一套 · 精炼${refineLevel} ===\n  玩家 ${brief(snap)}`);
      for (const t of ["normal", "elite", "boss"] as const) {
        const m = byType.get(t);
        if (!m) continue;
        const mon: Total = {
          hp: Number(m.hp), maxHp: Number(m.hp), attack: Number(m.attack), defense: Number(m.defense),
          armorPenetration: Number(m.armorPenetration), block: Number(m.block),
          speed: Number(m.speed), luck: Number(m.luck),
        };
        const pdmg = oneRound(snap, mon, PLAYER_SKILL_MUL, true);
        const mdmg = oneRound(mon, snap, MONSTER_SKILL_MUL, false);
        const toKill = Number(m.hp) / pdmg;
        const toDie = pick(snap, "maxHp") / mdmg;
        const mark = Math.abs(toKill - anchor[t]) / anchor[t] < 0.25 ? "✓" : "✗";
        console.log(`  ${mark} ${t.padEnd(6)} 打死怪 ${toKill.toFixed(1)} 回合(目标${anchor[t]}) | 每回合伤害 ${fmt(pdmg)} | 自己撑 ${toDie.toFixed(1)} 回合 | 怪每回合 ${fmt(mdmg)}`);
      }
    }

    await restore();
    const afterSnap = (await buildPlayerStatsSnapshot(p)).total as unknown as Total;
    const same = JSON.stringify(afterSnap) === JSON.stringify(baseSnap);
    console.log(`\n回滚一致性: ${same ? "OK" : "不一致（已按记录恢复）"}`);
  } finally {
    Math.random = realRandom;
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERR:", String(e)); process.exit(1); });

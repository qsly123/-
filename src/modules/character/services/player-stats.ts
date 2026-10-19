import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { items, playerInventory, players } from "@/db/schema";
import {
  collectPlayerStatsBonusByPlugins,
  collectPlayersStatsBonusMapByPlugins,
} from "@/modules/shared/services/legacy-plugin-compat";
import { getPlayerStatusAttrBonus } from "@/modules/character/services/player-status";
import {
  applyModifiers,
  collectMergedModifiers,
  registerBuiltinProviders,
} from "@/modules/character/services/framework";
import type { StatFlatBonus, StatPercentBonus } from "@/modules/character/services/framework";
import type { ItemEffect } from "@/types/game";
import { scaleEquipmentEffects } from "@/modules/character/services/equipment-stat-rules";

export interface PlayerStats {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  spiritualSense: number;
  armorPenetration: number;
  block: number;
  skillDamageBonus: number;
  skillDamageReduction: number;
  artifactDamageBonus: number;
  artifactDamageReduction: number;
}

export interface EquipmentStatsBonus {
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  spiritualSense: number;
  armorPenetration: number;
  block: number;
  skillDamageBonus: number;
  skillDamageReduction: number;
  artifactDamageBonus: number;
  artifactDamageReduction: number;
}

export interface PlayerStatsSnapshot {
  base: PlayerStats;
  equipment: EquipmentStatsBonus;
  plugin: EquipmentStatsBonus;
  status: EquipmentStatsBonus;
  total: PlayerStats;
}

type PlayerStatsSource = {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  spiritualSense?: number;
  armorPenetration?: number;
  block?: number;
  skillDamageBonus?: number;
  skillDamageReduction?: number;
  artifactDamageBonus?: number;
  artifactDamageReduction?: number;
};

const EMPTY_EQUIPMENT_BONUS: EquipmentStatsBonus = {
  maxHp: 0,
  maxMp: 0,
  attack: 0,
  defense: 0,
  speed: 0,
  luck: 0,
  spiritualSense: 0,
  armorPenetration: 0,
  block: 0,
  skillDamageBonus: 0,
  skillDamageReduction: 0,
  artifactDamageBonus: 0,
  artifactDamageReduction: 0,
};

function cloneEmptyBonus(): EquipmentStatsBonus {
  return { ...EMPTY_EQUIPMENT_BONUS };
}

function mergeStatsBonus(base: EquipmentStatsBonus, delta: EquipmentStatsBonus): EquipmentStatsBonus {
  return {
    maxHp: base.maxHp + delta.maxHp,
    maxMp: base.maxMp + delta.maxMp,
    attack: base.attack + delta.attack,
    defense: base.defense + delta.defense,
    speed: base.speed + delta.speed,
    luck: base.luck + delta.luck,
    spiritualSense: base.spiritualSense + delta.spiritualSense,
    armorPenetration: base.armorPenetration + delta.armorPenetration,
    block: base.block + delta.block,
    skillDamageBonus: base.skillDamageBonus + delta.skillDamageBonus,
    skillDamageReduction: base.skillDamageReduction + delta.skillDamageReduction,
    artifactDamageBonus: base.artifactDamageBonus + delta.artifactDamageBonus,
    artifactDamageReduction: base.artifactDamageReduction + delta.artifactDamageReduction,
  };
}

export function pickPlayerBaseStats(source: PlayerStatsSource): PlayerStats {
  return {
    hp: source.hp,
    maxHp: source.maxHp,
    mp: source.mp,
    maxMp: source.maxMp,
    attack: source.attack,
    defense: source.defense,
    speed: source.speed,
    luck: source.luck,
    spiritualSense: source.spiritualSense ?? 0,
    armorPenetration: source.armorPenetration ?? 0,
    block: source.block ?? 0,
    skillDamageBonus: source.skillDamageBonus ?? 0,
    skillDamageReduction: source.skillDamageReduction ?? 0,
    artifactDamageBonus: source.artifactDamageBonus ?? 0,
    artifactDamageReduction: source.artifactDamageReduction ?? 0,
  };
}

export function mergePlayerStats(base: PlayerStats, equipment: EquipmentStatsBonus): PlayerStats {
  const maxHp = Math.max(1, base.maxHp + equipment.maxHp);
  const maxMp = Math.max(0, base.maxMp + equipment.maxMp);
  return {
    hp: Math.max(0, Math.min(base.hp, maxHp)),
    maxHp,
    mp: Math.max(0, Math.min(base.mp, maxMp)),
    maxMp,
    attack: Math.max(1, base.attack + equipment.attack),
    defense: Math.max(0, base.defense + equipment.defense),
    speed: Math.max(0, base.speed + equipment.speed),
    luck: Math.max(0, base.luck + equipment.luck),
    spiritualSense: Math.max(0, base.spiritualSense + equipment.spiritualSense),
    armorPenetration: Math.max(0, base.armorPenetration + equipment.armorPenetration),
    block: Math.max(0, base.block + equipment.block),
    skillDamageBonus: base.skillDamageBonus + equipment.skillDamageBonus,
    skillDamageReduction: Math.max(0, base.skillDamageReduction + equipment.skillDamageReduction),
    artifactDamageBonus: base.artifactDamageBonus + equipment.artifactDamageBonus,
    artifactDamageReduction: Math.max(0, base.artifactDamageReduction + equipment.artifactDamageReduction),
  };
}

function applyEffectToBonus(effects: ItemEffect[] | null | undefined, bonus: EquipmentStatsBonus) {
  if (!effects || effects.length === 0) {
    return;
  }

  for (const effect of effects) {
    const effectType: string = typeof effect.type === "string" ? effect.type : "";
    const value = Number(effect.value);
    if (!Number.isFinite(value) || value === 0) {
      continue;
    }

    if (effectType === "boost_atk") {
      bonus.attack += value;
      continue;
    }
    if (effectType === "boost_def") {
      bonus.defense += value;
      continue;
    }
    if (effectType === "boost_hp") {
      bonus.maxHp += value;
      continue;
    }
    if (effectType === "boost_mp") {
      bonus.maxMp += value;
      continue;
    }
    if (effectType === "boost_speed") {
      bonus.speed += value;
      continue;
    }
    if (effectType === "boost_luck") {
      bonus.luck += value;
      continue;
    }
    if (effectType === "boost_spiritual_sense") {
      bonus.spiritualSense += value;
      continue;
    }
    if (effectType === "boost_armor_penetration") {
      bonus.armorPenetration += value;
      continue;
    }
    if (effectType === "boost_block") {
      bonus.block += value;
      continue;
    }
    if (effectType === "boost_skill_damage_bonus") {
      bonus.skillDamageBonus += value;
      continue;
    }
    if (effectType === "boost_skill_damage_reduction") {
      bonus.skillDamageReduction += value;
      continue;
    }
    if (effectType === "boost_artifact_damage_bonus") {
      bonus.artifactDamageBonus += value;
      continue;
    }
    if (effectType === "boost_artifact_damage_reduction") {
      bonus.artifactDamageReduction += value;
    }
  }
}

export async function getPlayersEquipmentBonusMap(playerIds: string[]): Promise<Map<string, EquipmentStatsBonus>> {
  const map = new Map<string, EquipmentStatsBonus>();
  if (playerIds.length === 0) {
    return map;
  }

  const rows = await db.select({
    playerId: playerInventory.playerId,
    effects: items.effects,
    stageMult: playerInventory.stageMult,
  }).from(playerInventory)
    .innerJoin(items, eq(playerInventory.itemId, items.id))
    .innerJoin(players, eq(playerInventory.playerId, players.id))
    .where(and(
      eq(playerInventory.equipped, true),
      or(isNull(items.minRealm), lte(items.minRealm, players.realm)),
      or(isNull(items.maxRealm), gte(items.maxRealm, players.realm)),
      inArray(playerInventory.playerId, playerIds),
    ))
    .all();

  for (const row of rows) {
    const playerId = row.playerId;
    const current = map.get(playerId) || cloneEmptyBonus();
    // 装备基础值按「拿到它时的境界」缩放（见 equipment-instance-service 的阶段系数）
    applyEffectToBonus(scaleEquipmentEffects((row.effects || []) as ItemEffect[], row.stageMult), current);
    map.set(playerId, current);
  }

  return map;
}

export async function getPlayerEquipmentBonus(playerId: string): Promise<EquipmentStatsBonus> {
  const map = await getPlayersEquipmentBonusMap([playerId]);
  return map.get(playerId) || cloneEmptyBonus();
}

export async function getPlayersPluginBonusMap(playerIds: string[]): Promise<Map<string, EquipmentStatsBonus>> {
  return await collectPlayersStatsBonusMapByPlugins(playerIds);
}

export async function getPlayerPluginBonus(playerId: string): Promise<EquipmentStatsBonus> {
  const bonus = await collectPlayerStatsBonusByPlugins({ playerId });
  return {
    maxHp: bonus.maxHp,
    maxMp: bonus.maxMp,
    attack: bonus.attack,
    defense: bonus.defense,
    speed: bonus.speed,
    luck: bonus.luck,
    spiritualSense: bonus.spiritualSense,
    armorPenetration: bonus.armorPenetration,
    block: bonus.block,
    skillDamageBonus: bonus.skillDamageBonus,
    skillDamageReduction: bonus.skillDamageReduction,
    artifactDamageBonus: bonus.artifactDamageBonus,
    artifactDamageReduction: bonus.artifactDamageReduction,
  };
}

export async function buildPlayerStatsSnapshot(player: { id: string } & PlayerStatsSource): Promise<PlayerStatsSnapshot> {
  return await buildPlayerStatsSnapshotWithOptions(player);
}

/** 把框架的固定值加成并入装备加成层。 */
function combineFlatBonus(base: EquipmentStatsBonus, extra: StatFlatBonus): EquipmentStatsBonus {
  const result = { ...base };
  for (const key of Object.keys(result) as (keyof EquipmentStatsBonus)[]) {
    const value = (extra as Record<string, number | undefined>)[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      result[key] += value;
    }
  }
  return result;
}

/** 按 `(base + Σflat) × (1 + Σpercent)` 聚合，灵根等百分比层对装备与境界收益同样生效。 */
export function mergePlayerStatsWithModifiers(
  base: PlayerStats,
  flat: EquipmentStatsBonus,
  percent?: StatPercentBonus | null,
): PlayerStats {
  if (!percent || Object.keys(percent).length === 0) {
    return mergePlayerStats(base, flat);
  }

  const scaled = applyModifiers(
    {
      maxHp: base.maxHp,
      maxMp: base.maxMp,
      attack: base.attack,
      defense: base.defense,
      speed: base.speed,
      luck: base.luck,
      spiritualSense: base.spiritualSense,
      armorPenetration: base.armorPenetration,
      block: base.block,
      skillDamageBonus: base.skillDamageBonus,
      skillDamageReduction: base.skillDamageReduction,
      artifactDamageBonus: base.artifactDamageBonus,
      artifactDamageReduction: base.artifactDamageReduction,
    },
    { flat, percent, elementDamageBonus: 0 },
  );

  const maxHp = Math.max(1, scaled.maxHp);
  const maxMp = Math.max(0, scaled.maxMp);

  return {
    hp: Math.max(0, Math.min(base.hp, maxHp)),
    maxHp,
    mp: Math.max(0, Math.min(base.mp, maxMp)),
    maxMp,
    attack: Math.max(1, scaled.attack),
    defense: Math.max(0, scaled.defense),
    speed: Math.max(0, scaled.speed),
    luck: Math.max(0, scaled.luck),
    spiritualSense: Math.max(0, scaled.spiritualSense),
    armorPenetration: Math.max(0, scaled.armorPenetration),
    block: Math.max(0, scaled.block),
    skillDamageBonus: scaled.skillDamageBonus,
    skillDamageReduction: Math.max(0, scaled.skillDamageReduction),
    artifactDamageBonus: scaled.artifactDamageBonus,
    artifactDamageReduction: Math.max(0, scaled.artifactDamageReduction),
  };
}

export async function buildPlayerStatsSnapshotWithOptions(
  player: { id: string } & PlayerStatsSource,
  options?: {
    equipmentBonus?: EquipmentStatsBonus | null;
    pluginBonus?: EquipmentStatsBonus | null;
    statusBonus?: EquipmentStatsBonus | null;
  },
): Promise<PlayerStatsSnapshot> {
  const base = pickPlayerBaseStats(player);
  const [equipment, plugin, status, frameworkModifiers] = await Promise.all([
    options?.equipmentBonus || getPlayerEquipmentBonus(player.id),
    options?.pluginBonus || getPlayerPluginBonus(player.id),
    options?.statusBonus || getPlayerStatusAttrBonus(player.id),
    (async () => {
      try {
        registerBuiltinProviders();
        return await collectMergedModifiers({ playerId: player.id });
      } catch (error) {
        console.error(
          "[player-stats] 框架修饰层采集失败，回退纯加法聚合：",
          error instanceof Error ? error.message : String(error),
        );
        return null;
      }
    })(),
  ]);

  const flat = mergeStatsBonus(mergeStatsBonus(equipment, plugin), status);
  const combinedFlat = frameworkModifiers ? combineFlatBonus(flat, frameworkModifiers.flat) : flat;
  const total = mergePlayerStatsWithModifiers(base, combinedFlat, frameworkModifiers?.percent);

  return { base, equipment, plugin, status, total };
}

export function buildPlayerStatsSnapshotWithEquipment(
  player: PlayerStatsSource,
  equipment: EquipmentStatsBonus | null | undefined,
  plugin?: EquipmentStatsBonus | null,
  status?: EquipmentStatsBonus | null,
  percent?: StatPercentBonus | null,
): PlayerStatsSnapshot {
  const base = pickPlayerBaseStats(player);
  const safeEquipment = equipment || cloneEmptyBonus();
  const safePlugin = plugin || cloneEmptyBonus();
  const safeStatus = status || cloneEmptyBonus();
  const total = mergePlayerStatsWithModifiers(
    base,
    mergeStatsBonus(mergeStatsBonus(safeEquipment, safePlugin), safeStatus),
    percent,
  );
  return { base, equipment: safeEquipment, plugin: safePlugin, status: safeStatus, total };
}

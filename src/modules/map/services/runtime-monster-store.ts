import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { monsters, temporaryMonsters } from "@/db/schema";
import type { DropItem } from "@/types/game";

const MONSTER_ICON_PREFIX = "/uploads/cosmetics/monster/";
const ICON_POOL_CACHE_TTL_MS = 5 * 60 * 1000;

type RuntimeMonsterPoolState = typeof globalThis & {
  __runtimeMonsterIconPoolCache?: {
    loadedAtMs: number;
    byType: Record<string, string[]>;
    preferredByType: Record<string, string[]>;
    all: string[];
    preferredAll: string[];
  };
};

export type RuntimeMonsterRecord = {
  id: string;
  name: string;
  iconUrl: string | null;
  description: string | null;
  monsterType: string;
  level: number;
  hp: number;
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
  skills: string[] | null;
  drops: DropItem[] | null;
  xpReward: number;
  goldReward: number;
  mapId: string;
  positionX: number;
  positionY: number;
  currentPositionX: number | null;
  currentPositionY: number | null;
  nextAiMoveAt: string | null;
  positionUpdatedAt: string | null;
  aiMoveIntervalMinSeconds: number | null;
  aiMoveIntervalMaxSeconds: number | null;
  aiMoveRange: number | null;
  respawnSeconds: number;
  createdAt: string;
  updatedAt: string | null;
  isTemporary: boolean;
};

function toRuntimeMonsterRecord(
  row: {
    id: string;
    name: string;
    iconUrl: string | null;
    description: string | null;
    monsterType: string;
    level: number;
    hp: number;
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
    skills: string[] | null;
    drops: DropItem[] | null;
    xpReward: number;
    goldReward: number;
    mapId: string;
    positionX: number;
    positionY: number;
    currentPositionX: number | null;
    currentPositionY: number | null;
    nextAiMoveAt: string | null;
    positionUpdatedAt: string | null;
    aiMoveIntervalMinSeconds: number | null;
    aiMoveIntervalMaxSeconds: number | null;
    aiMoveRange: number | null;
    respawnSeconds: number;
    createdAt: string;
    updatedAt?: string | null;
  },
  isTemporary: boolean,
): RuntimeMonsterRecord {
  return {
    ...row,
    updatedAt: row.updatedAt || null,
    isTemporary,
  };
}

async function loadMonsterIconPool() {
  const globalStore = globalThis as RuntimeMonsterPoolState;
  const cached = globalStore.__runtimeMonsterIconPoolCache;
  if (cached && (Date.now() - cached.loadedAtMs) < ICON_POOL_CACHE_TTL_MS) {
    return cached;
  }

  const rows = await db.select({
    monsterType: monsters.monsterType,
    iconUrl: monsters.iconUrl,
  }).from(monsters).where(sql`${monsters.iconUrl} is not null and ${monsters.iconUrl} <> ''`).all();

  const byType: Record<string, string[]> = {};
  const preferredByType: Record<string, string[]> = {};
  const all: string[] = [];
  const preferredAll: string[] = [];

  rows.forEach((row) => {
    const monsterType = String(row.monsterType || "").trim() || "normal";
    const iconUrl = String(row.iconUrl || "").trim();
    if (!iconUrl) {
      return;
    }

    byType[monsterType] = byType[monsterType] || [];
    byType[monsterType].push(iconUrl);
    all.push(iconUrl);

    if (iconUrl.startsWith(MONSTER_ICON_PREFIX)) {
      preferredByType[monsterType] = preferredByType[monsterType] || [];
      preferredByType[monsterType].push(iconUrl);
      preferredAll.push(iconUrl);
    }
  });

  const nextCache = {
    loadedAtMs: Date.now(),
    byType,
    preferredByType,
    all,
    preferredAll,
  };
  globalStore.__runtimeMonsterIconPoolCache = nextCache;
  return nextCache;
}

function randomPick(values: string[]) {
  if (values.length === 0) {
    return null;
  }
  const index = Math.floor(Math.random() * values.length);
  return values[index] || null;
}

async function getTemporaryMonsterById(monsterId: string) {
  return await db.select({
    id: temporaryMonsters.id,
    name: temporaryMonsters.name,
    iconUrl: temporaryMonsters.iconUrl,
    description: temporaryMonsters.description,
    monsterType: temporaryMonsters.monsterType,
    level: temporaryMonsters.level,
    hp: temporaryMonsters.hp,
    attack: temporaryMonsters.attack,
    defense: temporaryMonsters.defense,
    speed: temporaryMonsters.speed,
    luck: temporaryMonsters.luck,
    spiritualSense: temporaryMonsters.spiritualSense,
    armorPenetration: temporaryMonsters.armorPenetration,
    block: temporaryMonsters.block,
    skillDamageBonus: temporaryMonsters.skillDamageBonus,
    skillDamageReduction: temporaryMonsters.skillDamageReduction,
    artifactDamageBonus: temporaryMonsters.artifactDamageBonus,
    artifactDamageReduction: temporaryMonsters.artifactDamageReduction,
    skills: temporaryMonsters.skills,
    drops: temporaryMonsters.drops,
    xpReward: temporaryMonsters.xpReward,
    goldReward: temporaryMonsters.goldReward,
    mapId: temporaryMonsters.mapId,
    positionX: temporaryMonsters.positionX,
    positionY: temporaryMonsters.positionY,
    currentPositionX: temporaryMonsters.currentPositionX,
    currentPositionY: temporaryMonsters.currentPositionY,
    nextAiMoveAt: temporaryMonsters.nextAiMoveAt,
    positionUpdatedAt: temporaryMonsters.positionUpdatedAt,
    aiMoveIntervalMinSeconds: temporaryMonsters.aiMoveIntervalMinSeconds,
    aiMoveIntervalMaxSeconds: temporaryMonsters.aiMoveIntervalMaxSeconds,
    aiMoveRange: temporaryMonsters.aiMoveRange,
    respawnSeconds: temporaryMonsters.respawnSeconds,
    createdAt: temporaryMonsters.createdAt,
    updatedAt: temporaryMonsters.updatedAt,
  }).from(temporaryMonsters).where(eq(temporaryMonsters.id, monsterId)).get();
}

async function getNormalMonsterById(monsterId: string) {
  return await db.select({
    id: monsters.id,
    name: monsters.name,
    iconUrl: monsters.iconUrl,
    description: monsters.description,
    monsterType: monsters.monsterType,
    level: monsters.level,
    hp: monsters.hp,
    attack: monsters.attack,
    defense: monsters.defense,
    speed: monsters.speed,
    luck: monsters.luck,
    spiritualSense: monsters.spiritualSense,
    armorPenetration: monsters.armorPenetration,
    block: monsters.block,
    skillDamageBonus: monsters.skillDamageBonus,
    skillDamageReduction: monsters.skillDamageReduction,
    artifactDamageBonus: monsters.artifactDamageBonus,
    artifactDamageReduction: monsters.artifactDamageReduction,
    skills: monsters.skills,
    drops: monsters.drops,
    xpReward: monsters.xpReward,
    goldReward: monsters.goldReward,
    mapId: monsters.mapId,
    positionX: monsters.positionX,
    positionY: monsters.positionY,
    currentPositionX: monsters.currentPositionX,
    currentPositionY: monsters.currentPositionY,
    nextAiMoveAt: monsters.nextAiMoveAt,
    positionUpdatedAt: monsters.positionUpdatedAt,
    aiMoveIntervalMinSeconds: monsters.aiMoveIntervalMinSeconds,
    aiMoveIntervalMaxSeconds: monsters.aiMoveIntervalMaxSeconds,
    aiMoveRange: monsters.aiMoveRange,
    respawnSeconds: monsters.respawnSeconds,
    createdAt: monsters.createdAt,
  }).from(monsters).where(eq(monsters.id, monsterId)).get();
}

export async function getRuntimeMonsterById(monsterId: string): Promise<RuntimeMonsterRecord | null> {
  const temporaryMonster = await getTemporaryMonsterById(monsterId);
  if (temporaryMonster) {
    return toRuntimeMonsterRecord(temporaryMonster, true);
  }

  const normalMonster = await getNormalMonsterById(monsterId);
  return normalMonster ? toRuntimeMonsterRecord(normalMonster, false) : null;
}

export async function listRuntimeMonstersByIds(monsterIds: string[]): Promise<RuntimeMonsterRecord[]> {
  const uniqueIds = Array.from(new Set(monsterIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return [];
  }

  const [temporaryRows, normalRows] = await Promise.all([
    db.select({
      id: temporaryMonsters.id,
      name: temporaryMonsters.name,
      iconUrl: temporaryMonsters.iconUrl,
      description: temporaryMonsters.description,
      monsterType: temporaryMonsters.monsterType,
      level: temporaryMonsters.level,
      hp: temporaryMonsters.hp,
      attack: temporaryMonsters.attack,
      defense: temporaryMonsters.defense,
      speed: temporaryMonsters.speed,
      luck: temporaryMonsters.luck,
      spiritualSense: temporaryMonsters.spiritualSense,
      armorPenetration: temporaryMonsters.armorPenetration,
      block: temporaryMonsters.block,
      skillDamageBonus: temporaryMonsters.skillDamageBonus,
      skillDamageReduction: temporaryMonsters.skillDamageReduction,
      artifactDamageBonus: temporaryMonsters.artifactDamageBonus,
      artifactDamageReduction: temporaryMonsters.artifactDamageReduction,
      skills: temporaryMonsters.skills,
      drops: temporaryMonsters.drops,
      xpReward: temporaryMonsters.xpReward,
      goldReward: temporaryMonsters.goldReward,
      mapId: temporaryMonsters.mapId,
      positionX: temporaryMonsters.positionX,
      positionY: temporaryMonsters.positionY,
      currentPositionX: temporaryMonsters.currentPositionX,
      currentPositionY: temporaryMonsters.currentPositionY,
      nextAiMoveAt: temporaryMonsters.nextAiMoveAt,
      positionUpdatedAt: temporaryMonsters.positionUpdatedAt,
      aiMoveIntervalMinSeconds: temporaryMonsters.aiMoveIntervalMinSeconds,
      aiMoveIntervalMaxSeconds: temporaryMonsters.aiMoveIntervalMaxSeconds,
      aiMoveRange: temporaryMonsters.aiMoveRange,
      respawnSeconds: temporaryMonsters.respawnSeconds,
      createdAt: temporaryMonsters.createdAt,
      updatedAt: temporaryMonsters.updatedAt,
    }).from(temporaryMonsters).where(inArray(temporaryMonsters.id, uniqueIds)).all(),
    db.select({
      id: monsters.id,
      name: monsters.name,
      iconUrl: monsters.iconUrl,
      description: monsters.description,
      monsterType: monsters.monsterType,
      level: monsters.level,
      hp: monsters.hp,
      attack: monsters.attack,
      defense: monsters.defense,
      speed: monsters.speed,
      luck: monsters.luck,
      spiritualSense: monsters.spiritualSense,
      armorPenetration: monsters.armorPenetration,
      block: monsters.block,
      skillDamageBonus: monsters.skillDamageBonus,
      skillDamageReduction: monsters.skillDamageReduction,
      artifactDamageBonus: monsters.artifactDamageBonus,
      artifactDamageReduction: monsters.artifactDamageReduction,
      skills: monsters.skills,
      drops: monsters.drops,
      xpReward: monsters.xpReward,
      goldReward: monsters.goldReward,
      mapId: monsters.mapId,
      positionX: monsters.positionX,
      positionY: monsters.positionY,
      currentPositionX: monsters.currentPositionX,
      currentPositionY: monsters.currentPositionY,
      nextAiMoveAt: monsters.nextAiMoveAt,
      positionUpdatedAt: monsters.positionUpdatedAt,
      aiMoveIntervalMinSeconds: monsters.aiMoveIntervalMinSeconds,
      aiMoveIntervalMaxSeconds: monsters.aiMoveIntervalMaxSeconds,
      aiMoveRange: monsters.aiMoveRange,
      respawnSeconds: monsters.respawnSeconds,
      createdAt: monsters.createdAt,
    }).from(monsters).where(inArray(monsters.id, uniqueIds)).all(),
  ]);

  const resultMap = new Map<string, RuntimeMonsterRecord>();
  temporaryRows.forEach((row) => {
    resultMap.set(row.id, toRuntimeMonsterRecord(row, true));
  });
  normalRows.forEach((row) => {
    if (!resultMap.has(row.id)) {
      resultMap.set(row.id, toRuntimeMonsterRecord(row, false));
    }
  });

  return uniqueIds
    .map((monsterId) => resultMap.get(monsterId) || null)
    .filter((row): row is RuntimeMonsterRecord => Boolean(row));
}

export async function listRuntimeMonstersByMapId(mapId: string): Promise<RuntimeMonsterRecord[]> {
  const [temporaryRows, normalRows] = await Promise.all([
    db.select({
      id: temporaryMonsters.id,
      name: temporaryMonsters.name,
      iconUrl: temporaryMonsters.iconUrl,
      description: temporaryMonsters.description,
      monsterType: temporaryMonsters.monsterType,
      level: temporaryMonsters.level,
      hp: temporaryMonsters.hp,
      attack: temporaryMonsters.attack,
      defense: temporaryMonsters.defense,
      speed: temporaryMonsters.speed,
      luck: temporaryMonsters.luck,
      spiritualSense: temporaryMonsters.spiritualSense,
      armorPenetration: temporaryMonsters.armorPenetration,
      block: temporaryMonsters.block,
      skillDamageBonus: temporaryMonsters.skillDamageBonus,
      skillDamageReduction: temporaryMonsters.skillDamageReduction,
      artifactDamageBonus: temporaryMonsters.artifactDamageBonus,
      artifactDamageReduction: temporaryMonsters.artifactDamageReduction,
      skills: temporaryMonsters.skills,
      drops: temporaryMonsters.drops,
      xpReward: temporaryMonsters.xpReward,
      goldReward: temporaryMonsters.goldReward,
      mapId: temporaryMonsters.mapId,
      positionX: temporaryMonsters.positionX,
      positionY: temporaryMonsters.positionY,
      currentPositionX: temporaryMonsters.currentPositionX,
      currentPositionY: temporaryMonsters.currentPositionY,
      nextAiMoveAt: temporaryMonsters.nextAiMoveAt,
      positionUpdatedAt: temporaryMonsters.positionUpdatedAt,
      aiMoveIntervalMinSeconds: temporaryMonsters.aiMoveIntervalMinSeconds,
      aiMoveIntervalMaxSeconds: temporaryMonsters.aiMoveIntervalMaxSeconds,
      aiMoveRange: temporaryMonsters.aiMoveRange,
      respawnSeconds: temporaryMonsters.respawnSeconds,
      createdAt: temporaryMonsters.createdAt,
      updatedAt: temporaryMonsters.updatedAt,
    }).from(temporaryMonsters).where(eq(temporaryMonsters.mapId, mapId)).all(),
    db.select({
      id: monsters.id,
      name: monsters.name,
      iconUrl: monsters.iconUrl,
      description: monsters.description,
      monsterType: monsters.monsterType,
      level: monsters.level,
      hp: monsters.hp,
      attack: monsters.attack,
      defense: monsters.defense,
      speed: monsters.speed,
      luck: monsters.luck,
      spiritualSense: monsters.spiritualSense,
      armorPenetration: monsters.armorPenetration,
      block: monsters.block,
      skillDamageBonus: monsters.skillDamageBonus,
      skillDamageReduction: monsters.skillDamageReduction,
      artifactDamageBonus: monsters.artifactDamageBonus,
      artifactDamageReduction: monsters.artifactDamageReduction,
      skills: monsters.skills,
      drops: monsters.drops,
      xpReward: monsters.xpReward,
      goldReward: monsters.goldReward,
      mapId: monsters.mapId,
      positionX: monsters.positionX,
      positionY: monsters.positionY,
      currentPositionX: monsters.currentPositionX,
      currentPositionY: monsters.currentPositionY,
      nextAiMoveAt: monsters.nextAiMoveAt,
      positionUpdatedAt: monsters.positionUpdatedAt,
      aiMoveIntervalMinSeconds: monsters.aiMoveIntervalMinSeconds,
      aiMoveIntervalMaxSeconds: monsters.aiMoveIntervalMaxSeconds,
      aiMoveRange: monsters.aiMoveRange,
      respawnSeconds: monsters.respawnSeconds,
      createdAt: monsters.createdAt,
    }).from(monsters).where(eq(monsters.mapId, mapId)).all(),
  ]);

  return [
    ...temporaryRows.map((row) => toRuntimeMonsterRecord(row, true)),
    ...normalRows.map((row) => toRuntimeMonsterRecord(row, false)),
  ];
}

export async function pickTemporaryMonsterIconUrl(monsterType: string) {
  const pool = await loadMonsterIconPool();
  const normalizedType = String(monsterType || "").trim() || "normal";

  return (
    randomPick(pool.preferredByType[normalizedType] || [])
    || randomPick(pool.byType[normalizedType] || [])
    || randomPick(pool.preferredAll)
    || randomPick(pool.all)
    || null
  );
}

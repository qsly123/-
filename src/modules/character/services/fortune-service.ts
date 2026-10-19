import { and, eq, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { fortunes, playerFortuneAttrLedger, playerFortunes, players } from "@/db/schema";
import { getPlayerEquipmentBonus, getPlayerPluginBonus } from "@/modules/character/services/player-stats";
import {
  FORTUNE_ATTRIBUTE_KEYS,
  type FortuneAttributeKey,
  normalizeFortuneModifierValue,
  normalizeFortuneRateValue,
} from "@/modules/shared/services/fortune-effect";
import type {
  AttributeDelta,
  FortuneEventAttributeDelta,
  FortuneEventEffects,
  FortuneModifierValue,
  FortuneRateModifierValue,
  FortuneSpecialEffects,
} from "@/types/game";

type DbExecutor = Pick<typeof db, "select" | "update" | "insert" | "delete">;

export type FortuneSourceType = "starter" | "quest" | "random_event" | "admin" | "system";
export type FortuneEventTrigger = "kill_player" | "kill_monster" | "self_death";
export type FortuneLedgerTrigger = "grant" | FortuneEventTrigger;
export type FortuneXpChannel = string;

export interface FortuneGrantResult {
  fortuneId: string;
  action: "granted" | "extended" | "permanent" | "skipped";
  playerFortuneId?: number;
  expiresAt?: string | null;
  reason?: string;
}

export interface ActiveFortuneView {
  playerFortuneId: number;
  fortuneId: string;
  name: string;
  description: string | null;
  grade: string;
  enabled: boolean;
  isHidden: boolean;
  expiresAt: string | null;
  acquiredAt: string;
  attrEffects: AttributeDelta;
  eventEffects: FortuneEventEffects;
  specialEffects: FortuneSpecialEffects;
  accumulatedAttrEffects: Required<AttributeDelta>;
}

export interface AppliedXpRateResult {
  baseXp: number;
  rateSum: number;
  finalXp: number;
  bonusXp: number;
}

export interface StarterFortuneOption {
  id: string;
  name: string;
  description: string | null;
  grade: string;
  durationSeconds: number;
  attrEffects: AttributeDelta;
  eventEffects: FortuneEventEffects;
  specialEffects: FortuneSpecialEffects;
}

const ZERO_DELTA: Required<AttributeDelta> = {
  hp: 0,
  maxHp: 0,
  mp: 0,
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

function normalizePlayableGender(value: string | null | undefined) {
  if (value === "男" || value === "女") {
    return value;
  }
  return null;
}

function pickWeightedStarterFortunes<
  T extends { starterWeight: number },
>(pool: T[], limit: number) {
  if (limit <= 0 || pool.length === 0) {
    return [];
  }

  const remainingPool = [...pool];
  const selected: T[] = [];
  while (selected.length < limit && remainingPool.length > 0) {
    const totalWeight = remainingPool.reduce((sum, item) => sum + item.starterWeight, 0);
    let random = Math.random() * totalWeight;
    let pickedIndex = 0;
    for (let index = 0; index < remainingPool.length; index += 1) {
      random -= remainingPool[index].starterWeight;
      if (random <= 0) {
        pickedIndex = index;
        break;
      }
    }
    selected.push(remainingPool[pickedIndex]);
    remainingPool.splice(pickedIndex, 1);
  }

  return selected;
}

function mapStarterFortuneOption(row: {
  id: string;
  name: string;
  description: string | null;
  grade: string;
  durationSeconds: number;
  attrEffects: AttributeDelta | null;
  eventEffects: FortuneEventEffects | null;
  specialEffects: FortuneSpecialEffects | null;
}): StarterFortuneOption {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    grade: row.grade,
    durationSeconds: row.durationSeconds,
    attrEffects: row.attrEffects || {},
    eventEffects: row.eventEffects || {},
    specialEffects: row.specialEffects || {},
  };
}

function toInt(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.floor(parsed);
}

function isZeroDelta(delta: Required<AttributeDelta>) {
  return delta.hp === 0
    && delta.maxHp === 0
    && delta.mp === 0
    && delta.maxMp === 0
    && delta.attack === 0
    && delta.defense === 0
    && delta.speed === 0
    && delta.luck === 0
    && delta.spiritualSense === 0
    && delta.armorPenetration === 0
    && delta.block === 0
    && delta.skillDamageBonus === 0
    && delta.skillDamageReduction === 0
    && delta.artifactDamageBonus === 0
    && delta.artifactDamageReduction === 0;
}

function parseIsoMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return ms;
}

function pickEventDelta(
  eventEffects: FortuneEventEffects | null | undefined,
  trigger: FortuneEventTrigger,
): FortuneEventAttributeDelta | undefined {
  if (!eventEffects || typeof eventEffects !== "object") {
    return undefined;
  }
  if (trigger === "kill_player") {
    return eventEffects.killPlayer;
  }
  if (trigger === "kill_monster") {
    return eventEffects.killMonster;
  }
  return eventEffects.selfDeath;
}

function pickRateByChannel(specialEffects: FortuneSpecialEffects | null | undefined, channel: FortuneXpChannel) {
  if (!specialEffects || typeof specialEffects !== "object") {
    return 0;
  }
  const record = specialEffects as Record<string, unknown>;
  const mappedKeys = channel === "combat"
    ? ["combatXpRate"]
    : channel === "adventure"
      ? ["adventureXpRate"]
      : channel === "quest"
        ? ["questXpRate"]
        : channel === "pill"
          ? ["pillXpRate"]
          : channel === "dualCultivation" || channel === "doubleCultivation"
            ? ["doubleCultivationXpRate", "dualCultivationXpRate"]
            : [`${channel}XpRate`];
  return mappedKeys.reduce(
    (sum, key) => sum + normalizeFortuneRateValue(record[key] as FortuneRateModifierValue | null | undefined),
    0,
  );
}

function pickSpecialEffectValue(
  specialEffects: FortuneSpecialEffects | null | undefined,
  key: string,
  aliases: string[] = [],
) {
  if (!specialEffects || typeof specialEffects !== "object") {
    return 0;
  }
  const record = specialEffects as Record<string, unknown>;
  return [key, ...aliases].reduce(
    (sum, currentKey) => sum + normalizeFortuneRateValue(record[currentKey] as FortuneRateModifierValue | null | undefined),
    0,
  );
}

function truncSigned(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? Math.ceil(value) : Math.floor(value);
}

function getPercentBaseByKey(current: {
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
}, resourceBonus: {
  maxHp: number;
  maxMp: number;
}, key: FortuneAttributeKey) {
  if (key === "hp") {
    return Math.max(1, current.maxHp + toInt(resourceBonus.maxHp));
  }
  if (key === "maxHp") {
    return Math.max(1, current.maxHp);
  }
  if (key === "mp") {
    return Math.max(0, current.maxMp + toInt(resourceBonus.maxMp));
  }
  if (key === "maxMp") {
    return Math.max(0, current.maxMp);
  }
  return current[key];
}

function resolveRequestedDelta(params: {
  current: {
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
  };
  requestedDelta: AttributeDelta | FortuneEventAttributeDelta;
  resourceBonus: {
    maxHp: number;
    maxMp: number;
  };
}) {
  const output: Required<AttributeDelta> = { ...ZERO_DELTA };
  const raw = (params.requestedDelta || {}) as Record<string, unknown>;

  for (const key of FORTUNE_ATTRIBUTE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      continue;
    }
    const modifier = normalizeFortuneModifierValue(raw[key] as FortuneModifierValue | null | undefined);
    const percentBase = getPercentBaseByKey(params.current, params.resourceBonus, key);
    output[key] = truncSigned(modifier.flat + percentBase * (modifier.percent / 100));
  }

  return output;
}

function applyDeltaToPlayer(current: {
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
}, delta: Required<AttributeDelta>, resourceBonus: {
  maxHp: number;
  maxMp: number;
}) {
  const nextMaxHp = Math.max(1, current.maxHp + delta.maxHp);
  const nextMaxMp = Math.max(0, current.maxMp + delta.maxMp);
  const nextAttack = Math.max(1, current.attack + delta.attack);
  const nextDefense = Math.max(0, current.defense + delta.defense);
  const nextSpeed = Math.max(0, current.speed + delta.speed);
  const nextLuck = Math.max(0, current.luck + delta.luck);
  const nextSpiritualSense = Math.max(0, current.spiritualSense + delta.spiritualSense);
  const nextArmorPenetration = Math.max(0, current.armorPenetration + delta.armorPenetration);
  const nextBlock = Math.max(0, current.block + delta.block);
  const nextSkillDamageBonus = current.skillDamageBonus + delta.skillDamageBonus;
  const nextSkillDamageReduction = Math.max(0, current.skillDamageReduction + delta.skillDamageReduction);
  const nextArtifactDamageBonus = current.artifactDamageBonus + delta.artifactDamageBonus;
  const nextArtifactDamageReduction = Math.max(0, current.artifactDamageReduction + delta.artifactDamageReduction);
  const nextEffectiveMaxHp = Math.max(1, nextMaxHp + toInt(resourceBonus.maxHp));
  const nextEffectiveMaxMp = Math.max(0, nextMaxMp + toInt(resourceBonus.maxMp));
  const nextHp = Math.max(0, Math.min(nextEffectiveMaxHp, current.hp + delta.hp));
  const nextMp = Math.max(0, Math.min(nextEffectiveMaxMp, current.mp + delta.mp));

  return {
    hp: nextHp,
    maxHp: nextMaxHp,
    mp: nextMp,
    maxMp: nextMaxMp,
    attack: nextAttack,
    defense: nextDefense,
    speed: nextSpeed,
    luck: nextLuck,
    spiritualSense: nextSpiritualSense,
    armorPenetration: nextArmorPenetration,
    block: nextBlock,
    skillDamageBonus: nextSkillDamageBonus,
    skillDamageReduction: nextSkillDamageReduction,
    artifactDamageBonus: nextArtifactDamageBonus,
    artifactDamageReduction: nextArtifactDamageReduction,
  };
}

function diffPlayerDelta(before: {
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
}, after: {
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
}): Required<AttributeDelta> {
  return {
    hp: after.hp - before.hp,
    maxHp: after.maxHp - before.maxHp,
    mp: after.mp - before.mp,
    maxMp: after.maxMp - before.maxMp,
    attack: after.attack - before.attack,
    defense: after.defense - before.defense,
    speed: after.speed - before.speed,
    luck: after.luck - before.luck,
    spiritualSense: after.spiritualSense - before.spiritualSense,
    armorPenetration: after.armorPenetration - before.armorPenetration,
    block: after.block - before.block,
    skillDamageBonus: after.skillDamageBonus - before.skillDamageBonus,
    skillDamageReduction: after.skillDamageReduction - before.skillDamageReduction,
    artifactDamageBonus: after.artifactDamageBonus - before.artifactDamageBonus,
    artifactDamageReduction: after.artifactDamageReduction - before.artifactDamageReduction,
  };
}

async function applyPlayerDelta(params: {
  tx: DbExecutor;
  playerId: string;
  requestedDelta: AttributeDelta | FortuneEventAttributeDelta;
}): Promise<Required<AttributeDelta>> {
  const { tx, playerId, requestedDelta } = params;

  const player = await tx.select({
    hp: players.hp,
    maxHp: players.maxHp,
    mp: players.mp,
    maxMp: players.maxMp,
    attack: players.attack,
    defense: players.defense,
    speed: players.speed,
    luck: players.luck,
    spiritualSense: players.spiritualSense,
    armorPenetration: players.armorPenetration,
    block: players.block,
    skillDamageBonus: players.skillDamageBonus,
    skillDamageReduction: players.skillDamageReduction,
    artifactDamageBonus: players.artifactDamageBonus,
    artifactDamageReduction: players.artifactDamageReduction,
  }).from(players).where(eq(players.id, playerId)).get();

  if (!player) {
    throw new Error("玩家不存在");
  }

  const [equipmentBonus, pluginBonus] = await Promise.all([
    getPlayerEquipmentBonus(playerId),
    getPlayerPluginBonus(playerId),
  ]);

  const delta = resolveRequestedDelta({
    current: player,
    requestedDelta,
    resourceBonus: {
      maxHp: equipmentBonus.maxHp + pluginBonus.maxHp,
      maxMp: equipmentBonus.maxMp + pluginBonus.maxMp,
    },
  });
  if (isZeroDelta(delta)) {
    return { ...ZERO_DELTA };
  }

  const next = applyDeltaToPlayer(player, delta, {
    maxHp: equipmentBonus.maxHp + pluginBonus.maxHp,
    maxMp: equipmentBonus.maxMp + pluginBonus.maxMp,
  });
  const actualDelta = diffPlayerDelta(player, next);
  if (isZeroDelta(actualDelta)) {
    return actualDelta;
  }

  await tx.update(players).set({
    hp: next.hp,
    maxHp: next.maxHp,
    mp: next.mp,
    maxMp: next.maxMp,
    attack: next.attack,
    defense: next.defense,
    speed: next.speed,
    luck: next.luck,
    spiritualSense: next.spiritualSense,
    armorPenetration: next.armorPenetration,
    block: next.block,
    skillDamageBonus: next.skillDamageBonus,
    skillDamageReduction: next.skillDamageReduction,
    artifactDamageBonus: next.artifactDamageBonus,
    artifactDamageReduction: next.artifactDamageReduction,
    updatedAt: new Date().toISOString(),
  }).where(eq(players.id, playerId)).run();

  return actualDelta;
}

/**
 * 给已拥有的气运追加一笔属性（逆天改命「精进」用）。
 *
 * 不新增气运记录，把追加的 delta 记到**已有那条** playerFortune 的账上，
 * 这样将来该气运到期/被移除时，回滚会把精进的部分一起算对。
 */
export async function appendFortuneAttrBonus(params: {
  playerId: string;
  playerFortuneId: number;
  baseDelta: AttributeDelta;
  /** 追加比例：0.5 = 在原效果上再加 50%。 */
  rate: number;
}): Promise<boolean> {
  const base = params.baseDelta || {};
  // 属性体系是整数：缩放后不足 1 的给 ±1 保底，否则小词条精进会整个被取整吞掉
  const scaled = Object.fromEntries(
    Object.entries(base).map(([key, value]) => {
      const numeric = Number(value || 0);
      let scaledValue = Math.round(numeric * params.rate);
      if (numeric !== 0 && scaledValue === 0) {
        scaledValue = numeric > 0 ? 1 : -1;
      }
      return [key, scaledValue];
    }),
  ) as AttributeDelta;
  const hasDelta = Object.values(scaled).some((value) => Number(value || 0) !== 0);
  if (!hasDelta) {
    return false;
  }

  await applyPlayerDeltaWithLedger({
    tx: db,
    playerId: params.playerId,
    playerFortuneId: params.playerFortuneId,
    triggerType: "grant",
    requestedDelta: scaled,
  });
  return true;
}

async function applyPlayerDeltaWithLedger(params: {
  tx: DbExecutor;
  playerId: string;
  playerFortuneId: number;
  triggerType: FortuneLedgerTrigger;
  requestedDelta: AttributeDelta | FortuneEventAttributeDelta;
}) {
  const actualDelta = await applyPlayerDelta({
    tx: params.tx,
    playerId: params.playerId,
    requestedDelta: params.requestedDelta,
  });

  if (isZeroDelta(actualDelta)) {
    return actualDelta;
  }

  await params.tx.insert(playerFortuneAttrLedger).values({
    playerId: params.playerId,
    playerFortuneId: params.playerFortuneId,
    triggerType: params.triggerType,
    deltaHp: actualDelta.hp,
    deltaMaxHp: actualDelta.maxHp,
    deltaMp: actualDelta.mp,
    deltaMaxMp: actualDelta.maxMp,
    deltaAttack: actualDelta.attack,
    deltaDefense: actualDelta.defense,
    deltaSpeed: actualDelta.speed,
    deltaLuck: actualDelta.luck,
    deltaSpiritualSense: actualDelta.spiritualSense,
    deltaArmorPenetration: actualDelta.armorPenetration,
    deltaBlock: actualDelta.block,
    deltaSkillDamageBonus: actualDelta.skillDamageBonus,
    deltaSkillDamageReduction: actualDelta.skillDamageReduction,
    deltaArtifactDamageBonus: actualDelta.artifactDamageBonus,
    deltaArtifactDamageReduction: actualDelta.artifactDamageReduction,
  }).run();

  return actualDelta;
}

async function rollbackFortuneById(params: {
  tx: DbExecutor;
  playerFortuneId: number;
  playerId: string;
  nextStatus: "expired" | "removed";
}) {
  const ledgerRows = await params.tx.select({
    deltaHp: playerFortuneAttrLedger.deltaHp,
    deltaMaxHp: playerFortuneAttrLedger.deltaMaxHp,
    deltaMp: playerFortuneAttrLedger.deltaMp,
    deltaMaxMp: playerFortuneAttrLedger.deltaMaxMp,
    deltaAttack: playerFortuneAttrLedger.deltaAttack,
    deltaDefense: playerFortuneAttrLedger.deltaDefense,
    deltaSpeed: playerFortuneAttrLedger.deltaSpeed,
    deltaLuck: playerFortuneAttrLedger.deltaLuck,
    deltaSpiritualSense: playerFortuneAttrLedger.deltaSpiritualSense,
    deltaArmorPenetration: playerFortuneAttrLedger.deltaArmorPenetration,
    deltaBlock: playerFortuneAttrLedger.deltaBlock,
    deltaSkillDamageBonus: playerFortuneAttrLedger.deltaSkillDamageBonus,
    deltaSkillDamageReduction: playerFortuneAttrLedger.deltaSkillDamageReduction,
    deltaArtifactDamageBonus: playerFortuneAttrLedger.deltaArtifactDamageBonus,
    deltaArtifactDamageReduction: playerFortuneAttrLedger.deltaArtifactDamageReduction,
  }).from(playerFortuneAttrLedger)
    .where(eq(playerFortuneAttrLedger.playerFortuneId, params.playerFortuneId))
    .all();

  const rollbackDelta = ledgerRows.reduce<Required<AttributeDelta>>((acc, row) => ({
    hp: acc.hp - toInt(row.deltaHp),
    maxHp: acc.maxHp - toInt(row.deltaMaxHp),
    mp: acc.mp - toInt(row.deltaMp),
    maxMp: acc.maxMp - toInt(row.deltaMaxMp),
    attack: acc.attack - toInt(row.deltaAttack),
    defense: acc.defense - toInt(row.deltaDefense),
    speed: acc.speed - toInt(row.deltaSpeed),
    luck: acc.luck - toInt(row.deltaLuck),
    spiritualSense: acc.spiritualSense - toInt(row.deltaSpiritualSense),
    armorPenetration: acc.armorPenetration - toInt(row.deltaArmorPenetration),
    block: acc.block - toInt(row.deltaBlock),
    skillDamageBonus: acc.skillDamageBonus - toInt(row.deltaSkillDamageBonus),
    skillDamageReduction: acc.skillDamageReduction - toInt(row.deltaSkillDamageReduction),
    artifactDamageBonus: acc.artifactDamageBonus - toInt(row.deltaArtifactDamageBonus),
    artifactDamageReduction: acc.artifactDamageReduction - toInt(row.deltaArtifactDamageReduction),
  }), { ...ZERO_DELTA });

  if (!isZeroDelta(rollbackDelta)) {
    await applyPlayerDelta({
      tx: params.tx,
      playerId: params.playerId,
      requestedDelta: rollbackDelta,
    });
  }

  const now = new Date().toISOString();
  await params.tx.update(playerFortunes).set({
    status: params.nextStatus,
    endedAt: now,
    updatedAt: now,
  }).where(eq(playerFortunes.id, params.playerFortuneId)).run();
}

export function applyXpRate(baseXp: number, rateSum: number) {
  const base = Math.max(0, Math.floor(Number(baseXp) || 0));
  if (base <= 0) {
    return 0;
  }
  const rate = Number(rateSum || 0);
  const raw = Math.max(0, Math.floor(base * (1 + rate)));
  // 当倍率为正时，避免因向下取整导致看起来“完全没加成”
  if (rate > 0 && raw <= base) {
    return base + 1;
  }
  return raw;
}

export async function syncExpiredFortunes(params?: {
  playerId?: string;
  tx?: DbExecutor;
}) {
  const tx = params?.tx || db;
  const now = new Date().toISOString();
  const whereConditions = [
    eq(playerFortunes.status, "active"),
    isNotNull(playerFortunes.expiresAt),
    lte(playerFortunes.expiresAt, now),
  ];
  if (params?.playerId) {
    whereConditions.push(eq(playerFortunes.playerId, params.playerId));
  }

  const expiredRows = await tx.select({
    id: playerFortunes.id,
    playerId: playerFortunes.playerId,
  }).from(playerFortunes).where(and(...whereConditions)).all();

  for (const row of expiredRows) {
    await rollbackFortuneById({
      tx,
      playerFortuneId: row.id,
      playerId: row.playerId,
      nextStatus: "expired",
    });
  }

  return expiredRows.length;
}

export async function removePlayerFortune(params: {
  playerId: string;
  playerFortuneId: number;
  tx?: DbExecutor;
}) {
  const tx = params.tx || db;
  await syncExpiredFortunes({ playerId: params.playerId, tx });

  const row = await tx.select({
    id: playerFortunes.id,
    playerId: playerFortunes.playerId,
    status: playerFortunes.status,
  }).from(playerFortunes).where(and(
    eq(playerFortunes.id, params.playerFortuneId),
    eq(playerFortunes.playerId, params.playerId),
  )).get();

  if (!row) {
    throw new Error("玩家气运记录不存在");
  }

  if (row.status !== "active") {
    return false;
  }

  await rollbackFortuneById({
    tx,
    playerFortuneId: row.id,
    playerId: row.playerId,
    nextStatus: "removed",
  });
  return true;
}

export async function grantFortunesToPlayer(params: {
  playerId: string;
  fortuneIds: string[];
  sourceType: FortuneSourceType;
  sourceRef?: string | null;
  allowDisabled?: boolean;
  allowGenderMismatch?: boolean;
  tx?: DbExecutor;
}): Promise<FortuneGrantResult[]> {
  const tx = params.tx || db;
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const sourceRef = params.sourceRef?.trim() || null;
  const targetIds = [...new Set(
    params.fortuneIds
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  )];

  if (targetIds.length === 0) {
    return [];
  }

  await syncExpiredFortunes({ playerId: params.playerId, tx });
  const targetPlayer = await tx.select({
    id: players.id,
    gender: players.gender,
  }).from(players).where(eq(players.id, params.playerId)).get();
  if (!targetPlayer) {
    throw new Error("玩家不存在");
  }
  const targetPlayerGender = normalizePlayableGender(targetPlayer.gender);
  const results: FortuneGrantResult[] = [];

  for (const fortuneId of targetIds) {
    const fortune = await tx.select({
      id: fortunes.id,
      enabled: fortunes.enabled,
      gender: fortunes.gender,
      durationSeconds: fortunes.durationSeconds,
      attrEffects: fortunes.attrEffects,
    }).from(fortunes).where(eq(fortunes.id, fortuneId)).get();

    if (!fortune) {
      results.push({ fortuneId, action: "skipped", reason: "not_found" });
      continue;
    }

    if (!fortune.enabled && !params.allowDisabled) {
      results.push({ fortuneId, action: "skipped", reason: "disabled" });
      continue;
    }

    const fortuneGender = normalizePlayableGender(fortune.gender);
    if (!params.allowGenderMismatch && fortuneGender && fortuneGender !== targetPlayerGender) {
      results.push({ fortuneId: fortune.id, action: "skipped", reason: "gender_mismatch" });
      continue;
    }

    const activeRows = await tx.select({
      id: playerFortunes.id,
      expiresAt: playerFortunes.expiresAt,
      acquiredAt: playerFortunes.acquiredAt,
    }).from(playerFortunes).where(and(
      eq(playerFortunes.playerId, params.playerId),
      eq(playerFortunes.fortuneId, fortune.id),
      eq(playerFortunes.status, "active"),
    )).all();

    const permanentRow = activeRows.find((row) => !row.expiresAt);
    if (permanentRow) {
      results.push({
        fortuneId: fortune.id,
        action: "skipped",
        playerFortuneId: permanentRow.id,
        reason: "already_permanent",
      });
      continue;
    }

    const timedRow = activeRows
      .filter((row) => !!row.expiresAt)
      .sort((a, b) => (parseIsoMs(b.expiresAt) || 0) - (parseIsoMs(a.expiresAt) || 0))[0];

    if (timedRow) {
      if (fortune.durationSeconds <= 0) {
        await tx.update(playerFortunes).set({
          expiresAt: null,
          updatedAt: nowIso,
        }).where(eq(playerFortunes.id, timedRow.id)).run();
        results.push({
          fortuneId: fortune.id,
          action: "permanent",
          playerFortuneId: timedRow.id,
          expiresAt: null,
        });
        continue;
      }

      const baseMs = Math.max(parseIsoMs(timedRow.expiresAt) || nowMs, nowMs);
      const nextExpiresAt = new Date(baseMs + fortune.durationSeconds * 1000).toISOString();
      await tx.update(playerFortunes).set({
        expiresAt: nextExpiresAt,
        updatedAt: nowIso,
      }).where(eq(playerFortunes.id, timedRow.id)).run();
      results.push({
        fortuneId: fortune.id,
        action: "extended",
        playerFortuneId: timedRow.id,
        expiresAt: nextExpiresAt,
      });
      continue;
    }

    const expiresAt = fortune.durationSeconds > 0
      ? new Date(nowMs + fortune.durationSeconds * 1000).toISOString()
      : null;
    const created = await tx.insert(playerFortunes).values({
      playerId: params.playerId,
      fortuneId: fortune.id,
      sourceType: params.sourceType,
      sourceRef,
      status: "active",
      acquiredAt: nowIso,
      expiresAt,
      endedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    }).returning({
      id: playerFortunes.id,
    }).get();

    if (!created) {
      results.push({ fortuneId: fortune.id, action: "skipped", reason: "create_failed" });
      continue;
    }

    await applyPlayerDeltaWithLedger({
      tx,
      playerId: params.playerId,
      playerFortuneId: created.id,
      triggerType: "grant",
      requestedDelta: (fortune.attrEffects || {}) as AttributeDelta,
    });

    results.push({
      fortuneId: fortune.id,
      action: "granted",
      playerFortuneId: created.id,
      expiresAt,
    });
  }

  return results;
}

async function loadActiveFortuneRows(params: {
  playerId: string;
  tx?: DbExecutor;
  includeHidden?: boolean;
}) {
  const tx = params.tx || db;
  await syncExpiredFortunes({ playerId: params.playerId, tx });
  const whereConditions = [
    eq(playerFortunes.playerId, params.playerId),
    eq(playerFortunes.status, "active"),
  ];
  if (!params.includeHidden) {
    whereConditions.push(eq(fortunes.isHidden, false));
  }
  return await tx.select({
    playerFortuneId: playerFortunes.id,
    fortuneId: fortunes.id,
    name: fortunes.name,
    description: fortunes.description,
    enabled: fortunes.enabled,
    isHidden: fortunes.isHidden,
    grade: fortunes.grade,
    acquiredAt: playerFortunes.acquiredAt,
    expiresAt: playerFortunes.expiresAt,
    attrEffects: fortunes.attrEffects,
    eventEffects: fortunes.eventEffects,
    specialEffects: fortunes.specialEffects,
  }).from(playerFortunes)
    .innerJoin(fortunes, eq(playerFortunes.fortuneId, fortunes.id))
    .where(and(...whereConditions))
    .all();
}

export async function getActiveFortunes(params: {
  playerId: string;
  tx?: DbExecutor;
  includeHidden?: boolean;
}): Promise<ActiveFortuneView[]> {
  const rows = await loadActiveFortuneRows(params);
  const playerFortuneIds = rows.map((row) => row.playerFortuneId);
  const ledgerRows = playerFortuneIds.length > 0
    ? await (params.tx || db).select({
      playerFortuneId: playerFortuneAttrLedger.playerFortuneId,
      triggerType: playerFortuneAttrLedger.triggerType,
      deltaHp: playerFortuneAttrLedger.deltaHp,
      deltaMaxHp: playerFortuneAttrLedger.deltaMaxHp,
      deltaMp: playerFortuneAttrLedger.deltaMp,
      deltaMaxMp: playerFortuneAttrLedger.deltaMaxMp,
      deltaAttack: playerFortuneAttrLedger.deltaAttack,
      deltaDefense: playerFortuneAttrLedger.deltaDefense,
      deltaSpeed: playerFortuneAttrLedger.deltaSpeed,
      deltaLuck: playerFortuneAttrLedger.deltaLuck,
      deltaSpiritualSense: playerFortuneAttrLedger.deltaSpiritualSense,
      deltaArmorPenetration: playerFortuneAttrLedger.deltaArmorPenetration,
      deltaBlock: playerFortuneAttrLedger.deltaBlock,
      deltaSkillDamageBonus: playerFortuneAttrLedger.deltaSkillDamageBonus,
      deltaSkillDamageReduction: playerFortuneAttrLedger.deltaSkillDamageReduction,
      deltaArtifactDamageBonus: playerFortuneAttrLedger.deltaArtifactDamageBonus,
      deltaArtifactDamageReduction: playerFortuneAttrLedger.deltaArtifactDamageReduction,
    }).from(playerFortuneAttrLedger)
      .where(and(
        eq(playerFortuneAttrLedger.playerId, params.playerId),
        inArray(playerFortuneAttrLedger.playerFortuneId, playerFortuneIds),
      ))
      .all()
    : [];

  const accumulatedByFortuneId = new Map<number, Required<AttributeDelta>>();
  for (const ledger of ledgerRows) {
    if (ledger.triggerType === "grant") {
      continue;
    }
    const current = accumulatedByFortuneId.get(ledger.playerFortuneId) || { ...ZERO_DELTA };
    current.hp += toInt(ledger.deltaHp);
    current.maxHp += toInt(ledger.deltaMaxHp);
    current.mp += toInt(ledger.deltaMp);
    current.maxMp += toInt(ledger.deltaMaxMp);
    current.attack += toInt(ledger.deltaAttack);
    current.defense += toInt(ledger.deltaDefense);
    current.speed += toInt(ledger.deltaSpeed);
    current.luck += toInt(ledger.deltaLuck);
    current.spiritualSense += toInt(ledger.deltaSpiritualSense);
    current.armorPenetration += toInt(ledger.deltaArmorPenetration);
    current.block += toInt(ledger.deltaBlock);
    current.skillDamageBonus += toInt(ledger.deltaSkillDamageBonus);
    current.skillDamageReduction += toInt(ledger.deltaSkillDamageReduction);
    current.artifactDamageBonus += toInt(ledger.deltaArtifactDamageBonus);
    current.artifactDamageReduction += toInt(ledger.deltaArtifactDamageReduction);
    accumulatedByFortuneId.set(ledger.playerFortuneId, current);
  }

  return rows.map((row) => ({
    playerFortuneId: row.playerFortuneId,
    fortuneId: row.fortuneId,
    name: row.name,
    description: row.description,
    grade: row.grade,
    enabled: row.enabled,
    isHidden: row.isHidden,
    expiresAt: row.expiresAt,
    acquiredAt: row.acquiredAt,
    attrEffects: (row.attrEffects || {}) as AttributeDelta,
    eventEffects: (row.eventEffects || {}) as FortuneEventEffects,
    specialEffects: (row.specialEffects || {}) as FortuneSpecialEffects,
    accumulatedAttrEffects: accumulatedByFortuneId.get(row.playerFortuneId) || { ...ZERO_DELTA },
  }));
}

export async function getPlayerFortuneXpRateSum(params: {
  playerId: string;
  channel: FortuneXpChannel;
  tx?: DbExecutor;
}) {
  const rows = await loadActiveFortuneRows({ playerId: params.playerId, tx: params.tx });
  return rows.reduce((sum, row) => {
    if (!row.enabled) {
      return sum;
    }
    return sum + pickRateByChannel((row.specialEffects || {}) as FortuneSpecialEffects, params.channel);
  }, 0);
}

export async function getPlayerFortuneSpecialEffectSum(params: {
  playerId: string;
  key: string;
  aliases?: string[];
  tx?: DbExecutor;
}) {
  const rows = await loadActiveFortuneRows({ playerId: params.playerId, tx: params.tx });
  return rows.reduce((sum, row) => {
    if (!row.enabled) {
      return sum;
    }
    return sum + pickSpecialEffectValue(
      (row.specialEffects || {}) as FortuneSpecialEffects,
      params.key,
      params.aliases,
    );
  }, 0);
}

export async function applyXpRateForPlayer(params: {
  playerId: string;
  baseXp: number;
  channel: FortuneXpChannel;
  tx?: DbExecutor;
}) {
  const detail = await applyXpRateForPlayerDetailed(params);
  return detail.finalXp;
}

export async function applyXpRateForPlayerDetailed(params: {
  playerId: string;
  baseXp: number;
  channel: FortuneXpChannel;
  tx?: DbExecutor;
}): Promise<AppliedXpRateResult> {
  const baseXp = Math.max(0, Math.floor(Number(params.baseXp) || 0));
  const rateSum = await getPlayerFortuneXpRateSum({
    playerId: params.playerId,
    channel: params.channel,
    tx: params.tx,
  });
  const finalXp = applyXpRate(baseXp, rateSum);
  return {
    baseXp,
    rateSum,
    finalXp,
    bonusXp: Math.max(0, finalXp - baseXp),
  };
}

export async function applyFortuneEventEffects(params: {
  playerId: string;
  trigger: FortuneEventTrigger;
  tx?: DbExecutor;
}) {
  const tx = params.tx || db;
  const rows = await loadActiveFortuneRows({ playerId: params.playerId, tx });
  const totalDelta: Required<AttributeDelta> = { ...ZERO_DELTA };
  let appliedCount = 0;

  for (const row of rows) {
    if (!row.enabled) {
      continue;
    }
    const eventDelta = pickEventDelta((row.eventEffects || {}) as FortuneEventEffects, params.trigger);
    if (!eventDelta) {
      continue;
    }
    const actualDelta = await applyPlayerDeltaWithLedger({
      tx,
      playerId: params.playerId,
      playerFortuneId: row.playerFortuneId,
      triggerType: params.trigger,
      requestedDelta: eventDelta,
    });
    if (isZeroDelta(actualDelta)) {
      continue;
    }
    appliedCount += 1;
    totalDelta.hp += actualDelta.hp;
    totalDelta.maxHp += actualDelta.maxHp;
    totalDelta.mp += actualDelta.mp;
    totalDelta.maxMp += actualDelta.maxMp;
    totalDelta.attack += actualDelta.attack;
    totalDelta.defense += actualDelta.defense;
    totalDelta.speed += actualDelta.speed;
    totalDelta.luck += actualDelta.luck;
    totalDelta.spiritualSense += actualDelta.spiritualSense;
    totalDelta.armorPenetration += actualDelta.armorPenetration;
    totalDelta.block += actualDelta.block;
    totalDelta.skillDamageBonus += actualDelta.skillDamageBonus;
    totalDelta.skillDamageReduction += actualDelta.skillDamageReduction;
    totalDelta.artifactDamageBonus += actualDelta.artifactDamageBonus;
    totalDelta.artifactDamageReduction += actualDelta.artifactDamageReduction;
  }

  return {
    appliedCount,
    totalDelta,
  };
}

export async function getStarterFortuneOptions(
  limit = 5,
  gender?: string | null,
  options?: {
    excludeIds?: string[];
  },
) {
  const normalizedGender = normalizePlayableGender(gender);
  const excludedIds = new Set(
    (options?.excludeIds || [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  );
  const where = normalizedGender
    ? and(
      eq(fortunes.enabled, true),
      eq(fortunes.isHidden, false),
      eq(fortunes.isStarter, true),
      or(
        isNull(fortunes.gender),
        eq(fortunes.gender, normalizedGender),
      ),
    )
    : and(
      eq(fortunes.enabled, true),
      eq(fortunes.isHidden, false),
      eq(fortunes.isStarter, true),
    );
  const rows = await db.select({
    id: fortunes.id,
    name: fortunes.name,
    description: fortunes.description,
    grade: fortunes.grade,
    durationSeconds: fortunes.durationSeconds,
    attrEffects: fortunes.attrEffects,
    eventEffects: fortunes.eventEffects,
    specialEffects: fortunes.specialEffects,
    starterWeight: fortunes.starterWeight,
  }).from(fortunes).where(where).all();

  const pool = rows
    .map((row) => ({
      ...row,
      starterWeight: Number(row.starterWeight || 0),
    }))
    .filter((row) => row.starterWeight > 0 && !excludedIds.has(row.id));

  if (pool.length === 0) {
    return [];
  }

  return pickWeightedStarterFortunes(pool, limit).map(mapStarterFortuneOption);
}

/**
 * 逆天改命。
 *
 * 对标《鬼谷八荒》：每次大境界突破时从气运池三选一授予一道天机词条，
 * 词条跨类型随机，构筑感来自"随机池里的取舍"而非固定路线表。
 *
 * 复用已有的气运授予与到期回滚机制（`grantFortunesToPlayer`），因此：
 * - `attrEffects` 依旧按现有规则写基础属性并记账，**不走修饰层**（否则双倍）；
 * - 限时机缘到期由 `syncExpiredFortunes` 自动回滚，无需额外处理。
 *
 * 防重：`playerFortunes.sourceType = breakthrough` + `sourceRef = realm:<线性境界>`，
 * 同一境界只能领取一次。
 */

import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { fortunes, playerFortunes, playerReversalRerolls, playerTalents, talentPaths } from "@/db/schema";
import {
  appendFortuneAttrBonus,
  grantFortunesToPlayer,
} from "@/modules/character/services/fortune-service";
import type {
  AttributeDelta,
  FortuneEventEffects,
  FortuneSpecialEffects,
} from "@/types/game";

export const REVERSAL_SOURCE_TYPE = "breakthrough";
export const REVERSAL_OPTION_COUNT = 3;

/** 参与逆天改命池的最低品阶（白阶过弱，不进池）。 */
const REVERSAL_GRADES = ["blue", "purple", "gold", "red"];

/** 精进（重复承接同一天机）的属性追加系数，按品阶递增。 */
const UPGRADE_BONUS_RATE: Record<string, number> = {
  blue: 0.3,
  purple: 0.4,
  gold: 0.5,
  red: 0.6,
};

/** 运行时补齐老库缺的列/表（fortunes.category、player_reversal_rerolls）。 */
let ensureReversalSchemaPromise: Promise<void> | null = null;
export async function ensureReversalSchema(): Promise<void> {
  if (!ensureReversalSchemaPromise) {
    ensureReversalSchemaPromise = (async () => {
      await db.execute(sql.raw(`ALTER TABLE "fortunes" ADD COLUMN IF NOT EXISTS "category" text NOT NULL DEFAULT 'general'`));
      await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "fortunes_category_idx" ON "fortunes" ("category")`));
      await db.execute(sql.raw(`
        CREATE TABLE IF NOT EXISTS "player_reversal_rerolls" (
          "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          "player_id" text NOT NULL REFERENCES "players"("id"),
          "realm_linear" integer NOT NULL,
          "created_at" text NOT NULL DEFAULT NOW()::text
        )
      `));
      await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "player_reversal_rerolls_unique_idx" ON "player_reversal_rerolls" ("player_id", "realm_linear")`));
    })().catch((error) => {
      ensureReversalSchemaPromise = null;
      throw error;
    });
  }
  return ensureReversalSchemaPromise;
}

export interface ReversalOption {
  id: string;
  name: string;
  description: string | null;
  grade: string;
  durationSeconds: number;
  attrEffects: AttributeDelta;
  eventEffects: FortuneEventEffects;
  specialEffects: FortuneSpecialEffects;
  /** 玩家已拥有该天机的永久版：再选一次不重复获得，而是精进（属性按品阶追加）。 */
  owned: boolean;
}

export function buildReversalSourceRef(realmLinear: number): string {
  return `realm:${Math.floor(Number(realmLinear) || 0)}`;
}

/**
 * 玩家的天机池分类：构筑相关度从高到低递进——
 * 选了流派（剑/体/丹/符）用流派池；只选了道途（斗战/长生）用道途池；都没选走通用池。
 * 通用池永远在池中兜底，保证候选凑得满三道。
 */
async function getPlayerFortuneCategories(playerId: string): Promise<string[]> {
  const chosenRows = await db
    .select({ key: talentPaths.key, kind: talentPaths.kind })
    .from(playerTalents)
    .innerJoin(talentPaths, eq(talentPaths.key, playerTalents.pathKey))
    .where(and(
      eq(playerTalents.playerId, playerId),
      inArray(playerTalents.kind, ["direction", "path"]),
    ))
    .all();

  const categories = ["general"];
  const pathKey = chosenRows.find((row) => row.kind === "path")?.key;
  if (pathKey) {
    categories.push(pathKey);
    return categories;
  }
  const directionKey = chosenRows.find((row) => row.kind === "direction")?.key;
  if (directionKey) {
    categories.push(directionKey);
  }
  return categories;
}

/**
 * 掷出三道天机词条。
 *
 * 分池：未选道途只从通用池（category=general）抽；选定道途后从通用池 + 该方向池抽。
 * 已拥有的永久天机**不再被排除**——允许再次出现，承接时转为精进（属性按品阶追加），
 * 解决池子小、后期好词条全拿光之后无东西可选的问题。
 */
export async function rollReversalOptions(params: {
  playerId: string;
  gender?: string | null;
  limit?: number;
}): Promise<ReversalOption[]> {
  await ensureReversalSchema();
  const limit = Math.max(1, Math.min(params.limit ?? REVERSAL_OPTION_COUNT, 6));

  const ownedRows = await db
    .select({ fortuneId: playerFortunes.fortuneId })
    .from(playerFortunes)
    .where(and(
      eq(playerFortunes.playerId, params.playerId),
      eq(playerFortunes.status, "active"),
    ))
    .all();
  const ownedIds = new Set(ownedRows.map((row) => row.fortuneId));

  const gender = params.gender === "男" || params.gender === "女" ? params.gender : null;
  const categories = await getPlayerFortuneCategories(params.playerId);

  const filters = [
    eq(fortunes.enabled, true),
    eq(fortunes.isHidden, false),
    inArray(fortunes.grade, REVERSAL_GRADES),
    inArray(fortunes.category, categories),
    gender
      ? or(isNull(fortunes.gender), eq(fortunes.gender, gender))
      : undefined,
  ].filter(Boolean) as NonNullable<Parameters<typeof and>[0]>[];

  const rows = await db
    .select({
      id: fortunes.id,
      name: fortunes.name,
      description: fortunes.description,
      grade: fortunes.grade,
      durationSeconds: fortunes.durationSeconds,
      attrEffects: fortunes.attrEffects,
      eventEffects: fortunes.eventEffects,
      specialEffects: fortunes.specialEffects,
    })
    .from(fortunes)
    .where(and(...filters))
    .orderBy(sql`random()`)
    .limit(limit)
    .all();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    grade: row.grade,
    durationSeconds: Number(row.durationSeconds || 0),
    attrEffects: (row.attrEffects || {}) as AttributeDelta,
    eventEffects: (row.eventEffects || {}) as FortuneEventEffects,
    specialEffects: (row.specialEffects || {}) as FortuneSpecialEffects,
    owned: ownedIds.has(row.id) && Number(row.durationSeconds || 0) === 0,
  }));
}

/**
 * 刷新三选一：每个线性境界限一次，靠 player_reversal_rerolls 表兜底防重复。
 * 已经领取过本境界天机的不允许再刷（天机已定）。
 */
export async function rerollReversalOptions(params: {
  playerId: string;
  gender?: string | null;
  realmLinear: number;
}): Promise<{ allowed: boolean; options: ReversalOption[]; message: string }> {
  await ensureReversalSchema();
  const realmLinear = Math.floor(Number(params.realmLinear) || 0);
  if (realmLinear <= 0) {
    return { allowed: false, options: [], message: "缺少有效的境界值" };
  }

  const sourceRef = buildReversalSourceRef(realmLinear);
  const claimed = await db
    .select({ id: playerFortunes.id })
    .from(playerFortunes)
    .where(and(
      eq(playerFortunes.playerId, params.playerId),
      eq(playerFortunes.sourceType, REVERSAL_SOURCE_TYPE),
      eq(playerFortunes.sourceRef, sourceRef),
      ne(playerFortunes.status, "removed"),
    ))
    .limit(1)
    .get();
  if (claimed) {
    return { allowed: false, options: [], message: "此番天机已定，不能再改。" };
  }

  const inserted = await db.insert(playerReversalRerolls)
    .values({ playerId: params.playerId, realmLinear })
    .onConflictDoNothing()
    .returning({ id: playerReversalRerolls.id })
    .get();
  if (!inserted) {
    return { allowed: false, options: [], message: "此番天机已刷新过一次，好机缘不可强求。" };
  }

  const options = await rollReversalOptions({
    playerId: params.playerId,
    gender: params.gender,
  });
  return { allowed: true, options, message: "天机重演，三道新命数已现。" };
}

export interface ClaimReversalResult {
  fortuneId: string;
  fortuneName: string;
  alreadyClaimed: boolean;
  granted: boolean;
  message: string;
}

/**
 * 领取上一次突破的天机词条。
 * 同一线性境界只能领一次；重复调用返回已领结果而非报错，方便前端重试。
 */
export async function claimReversalFortune(params: {
  playerId: string;
  fortuneId: string;
  realmLinear: number;
}): Promise<ClaimReversalResult> {
  const sourceRef = buildReversalSourceRef(params.realmLinear);

  const existing = await db
    .select({ id: playerFortunes.id })
    .from(playerFortunes)
    .where(and(
      eq(playerFortunes.playerId, params.playerId),
      eq(playerFortunes.sourceType, REVERSAL_SOURCE_TYPE),
      eq(playerFortunes.sourceRef, sourceRef),
      ne(playerFortunes.status, "removed"),
    ))
    .limit(1)
    .get();

  if (existing) {
    return {
      fortuneId: params.fortuneId,
      fortuneName: "",
      alreadyClaimed: true,
      granted: false,
      message: "此番天机已定，无需再改。",
    };
  }

  const fortune = await db
    .select({
      id: fortunes.id,
      name: fortunes.name,
      enabled: fortunes.enabled,
      grade: fortunes.grade,
      attrEffects: fortunes.attrEffects,
    })
    .from(fortunes)
    .where(eq(fortunes.id, params.fortuneId))
    .get();

  if (!fortune || !fortune.enabled) {
    throw new Error("天机词条不存在或已停用");
  }

  // 精进：已拥有该天机的永久版，再选一次不重复授予，而是按品阶追加属性。
  const ownedPermanent = await db
    .select({ id: playerFortunes.id })
    .from(playerFortunes)
    .innerJoin(fortunes, eq(fortunes.id, playerFortunes.fortuneId))
    .where(and(
      eq(playerFortunes.playerId, params.playerId),
      eq(playerFortunes.fortuneId, params.fortuneId),
      eq(playerFortunes.status, "active"),
      isNull(playerFortunes.expiresAt),
    ))
    .limit(1)
    .get();

  if (ownedPermanent) {
    const rate = UPGRADE_BONUS_RATE[fortune.grade] ?? 0.3;
    const upgraded = await appendFortuneAttrBonus({
      playerId: params.playerId,
      playerFortuneId: ownedPermanent.id,
      baseDelta: (fortune.attrEffects || {}) as AttributeDelta,
      rate,
    });
    return {
      fortuneId: params.fortuneId,
      fortuneName: fortune.name,
      alreadyClaimed: false,
      granted: upgraded,
      message: upgraded
        ? `天机精进：「${fortune.name}」修为更深，效果提升 ${Math.round(rate * 100)}%。`
        : `「${fortune.name}」无可精进的属性，天机散作灵光。`,
    };
  }

  const results = await grantFortunesToPlayer({
    playerId: params.playerId,
    fortuneIds: [params.fortuneId],
    sourceType: REVERSAL_SOURCE_TYPE as never,
    sourceRef,
    allowGenderMismatch: false,
  });

  const result = results[0];
  const granted = !!result && result.action !== "skipped";

  return {
    fortuneId: params.fortuneId,
    fortuneName: fortune.name,
    alreadyClaimed: false,
    granted,
    message: granted
      ? `逆天改命：「${fortune.name}」已成。`
      : `未能承接此天机：${result?.reason || "条件不符"}`,
  };
}

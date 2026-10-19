import { and, desc, eq, inArray, lt, or, sql as drizzleSql } from "drizzle-orm";
import { db } from "@/db";
import {
  playerAdultProfiles,
  players,
  worldAdultEventLogs,
  worldMapInstances,
  worldNpcAdultProfiles,
  worldNpcLifeLogs,
  worldNpcProfiles,
  worldNpcRuntime,
} from "@/db/schema";
import { syncPregnancyStatusFromUterusState } from "@/modules/character/services/player-status";
import {
  generateOpenWorldAdultAccept,
  generateOpenWorldAdultBark,
  generateOpenWorldAdultDrain,
  generateOpenWorldAdultInvite,
  generateOpenWorldForcedConsequence,
  generateOpenWorldAdultPregnancy,
  generateOpenWorldPartnerJealousy,
  generateOpenWorldAdultProfile,
  generateOpenWorldAdultReject,
  generateOpenWorldAdultResult,
  generateOpenWorldAdultRumor,
} from "@/modules/world/services/world-ai-generation";
import {
  getCachedOpenWorldCustomNpcLibrary,
  getOpenWorldForcedRuleSnapshot,
  type OpenWorldForcedAction,
} from "@/modules/world/services/world-config";
import { resolveOpenWorldDistrictName } from "@/modules/world/services/world-district-service";
import { createWorldNpcNearbyChatMessage } from "@/modules/world/services/world-nearby-chat";
import { applyPlayerWorldIncident } from "@/modules/world/services/player-world-pressure-service";
import { ensureOpenWorldSchema } from "@/modules/world/services/world-schema";
import { isWorldNpcThreatActive } from "@/modules/world/services/world-npc-service";
import {
  settleWorldNpcDoubleCultivationLinkage,
  type WorldNpcDoubleCultivationLinkageResult,
} from "@/modules/world/services/double-cultivation-linkage";

const WORLD_ADULT_CONTACT_DISTANCE = 3;
const WORLD_ADULT_ACTION_COOLDOWN_MS = 2 * 60 * 1000;
const WORLD_ADULT_INVITE_COOLDOWN_MS = 18 * 60 * 1000;
const WORLD_ADULT_INVITE_TTL_MS = 12 * 60 * 1000;
const WORLD_ADULT_HISTORY_LIMIT = 20;
const WORLD_ADULT_RESOLVE_STALE_MS = 2 * 60 * 1000;

async function tryAcquireWorldAdultInviteLock(
  tx: { execute: typeof db.execute },
  lockKey: string,
) {
  const result = await tx.execute(
    drizzleSql`select pg_try_advisory_xact_lock(hashtext(${lockKey})) as locked`,
  ) as Array<{ locked?: boolean | null }> | { rows?: Array<{ locked?: boolean | null }> };
  if (Array.isArray(result)) {
    return result[0]?.locked === true;
  }
  return Array.isArray(result?.rows) && result.rows[0]?.locked === true;
}

export type WorldAdultActionType =
  | "seduce_invite"
  | "dual_cultivation"
  | "essence_drain"
  | "dangerous_preference";

export type WorldAdultNegotiationOutcome =
  | "accept"
  | "tease"
  | "reject"
  | "report"
  | "counter_drain";

export type WorldAdultResolveDecision =
  | "accept"
  | "reject"
  | "counter_drain"
  | "report"
  | "ignore";

const WORLD_ADULT_RESPONSE_LABELS = {
  accept: "接受",
  reject: "婉拒",
  counter_drain: "反向诱导",
  report: "示警",
  ignore: "无视",
} as const satisfies Record<WorldAdultResolveDecision, string>;

function canonicalizeAdultResponseOption(value: unknown): string | null {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  if (["accept", "同意", "接受", "应允", "赴约", "答应"].includes(text)) {
    return WORLD_ADULT_RESPONSE_LABELS.accept;
  }
  if (["reject", "拒绝", "婉拒", "回绝", "谢绝", "推辞"].includes(text)) {
    return WORLD_ADULT_RESPONSE_LABELS.reject;
  }
  if (["counter_drain", "反向诱导", "反制采补", "反向采补", "借势反制", "反诱导"].includes(text)) {
    return WORLD_ADULT_RESPONSE_LABELS.counter_drain;
  }
  if (["report", "示警", "告发", "上报", "报官"].includes(text)) {
    return WORLD_ADULT_RESPONSE_LABELS.report;
  }
  if (["ignore", "无视", "不理会", "不回应", "沉默离开", "沉默"].includes(text)) {
    return WORLD_ADULT_RESPONSE_LABELS.ignore;
  }
  return null;
}

function normalizeAdultResponseOptions(
  value: unknown,
  fallback: string[],
) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value
    .map((entry) => canonicalizeAdultResponseOption(entry))
    .filter(Boolean) as string[];
  return normalized.length > 0
    ? Array.from(new Set(normalized)).slice(0, 4)
    : fallback;
}

export type WorldAdultInviteView = {
  eventLogId: string;
  npcId: string;
  npcName: string;
  actionType: WorldAdultActionType;
  actionLabel: string;
  title: string;
  summary: string;
  atmosphere: string;
  dispositionLabel: string;
  responseOptions: string[];
  expiresAt: string | null;
  createdAt: string;
};

export type WorldNpcAdultIntentView = {
  npcId: string;
  adultDisposition: string;
  adultPreferenceHints: string[];
  corruptionStageLabel: string;
  actionCooldown: {
    isCoolingDown: boolean;
    cooldownRemainingMs: number;
    cooldownRemainingText: string | null;
    cooldownUntil: string | null;
    hint: string;
  };
  allowedAdultActions: Array<{
    actionType: WorldAdultActionType;
    label: string;
    description: string;
    riskLabel: string;
    disabledReason?: string | null;
  }>;
  playerAdultProfile: {
    corruptionValue: number;
    allureValue: number;
    shameValue: number;
    corruptionStageLabel: string;
  };
  npcAdultProfile: {
    desireValue: number;
    corruptionValue: number;
    cautionValue: number;
    roleTags: string[];
    preferenceTags: string[];
    summary: string;
  };
  pendingInvite: WorldAdultInviteView | null;
};

export type WorldAdultResolveResultView = {
  eventLogId: string;
  accepted: boolean;
  outcome: WorldAdultNegotiationOutcome;
  consentState: "mutual_accept" | "adult_report" | "coercive_failure" | "forced_consequence" | "rejected";
  title: string;
  summary: string;
  atmosphere: string;
  worldConsequence: string;
  pressureApplied: boolean;
  pressureEligible: boolean;
  relationshipConsequence: string | null;
  pressureSuppressedReason: string | null;
  changeHints: string[];
  numericChanges: {
    playerCorruptionDelta: number;
    playerAllureDelta: number;
    playerShameDelta: number;
    npcDesireDelta: number;
    npcCorruptionDelta: number;
    npcCautionDelta: number;
  };
  pregnancy: {
    triggered: boolean;
    summary: string;
    displayStageKey: string | null;
  } | null;
  forcedConsequenceTriggered: boolean;
  forcedConsequenceSummary: string | null;
  partnerJealousyTriggered: boolean;
  partnerJealousySummary: string | null;
};

export type WorldAdultHistoryDoubleCultivationView = {
  synced: boolean;
  forced: boolean;
  settledVia: string | null;
  logId: number | null;
  targetKind: string | null;
  targetId: string | null;
  targetName: string | null;
  sourceRef: string | null;
  sourceTargetId: string | null;
  playerGain: number | null;
  playerFluidMl: number | null;
  partnerFluidMl: number | null;
  intimacyScoreDelta: number | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  failureMessage: string | null;
};

type PlayerAdultProfileRow = typeof playerAdultProfiles.$inferSelect;
type WorldNpcAdultProfileRow = typeof worldNpcAdultProfiles.$inferSelect;
type WorldAdultEventLogRow = typeof worldAdultEventLogs.$inferSelect;

type AdultInteractionContext = {
  player: typeof players.$inferSelect;
  npcProfile: typeof worldNpcProfiles.$inferSelect;
  npcRuntime: typeof worldNpcRuntime.$inferSelect;
  map: Pick<typeof worldMapInstances.$inferSelect, "id" | "name" | "archetype"> | null;
  districtName: string | null;
};

const ADULT_ACTION_META: Record<WorldAdultActionType, {
  label: string;
  description: string;
  riskLabel: string;
}> = {
  seduce_invite: {
    label: "试探撩拨",
    description: "先以言语和气机试探对方的边界与心意。",
    riskLabel: "风险较低，更偏态度与气氛变化。",
  },
  dual_cultivation: {
    label: "双修相邀",
    description: "在双方都愿意的前提下尝试更深入的亲近与灵机交融。",
    riskLabel: "可能牵动关系、风声与孕育链。",
  },
  essence_drain: {
    label: "采补试探",
    description: "试着把互动导向更偏危险的灵机流转。",
    riskLabel: "灰色痕迹更重，也更容易引来风声。",
  },
  dangerous_preference: {
    label: "危险偏好",
    description: "只在高堕落时浮出的偏好试探，仍必须经过明确同意。",
    riskLabel: "一旦成立，世界压力与灰色余波都会更明显。",
  },
};

let ensureDoubleCultivationCompatTablesPromise: Promise<void> | null = null;

function clampStat(value: unknown, fallback: number, min = 0, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function parseTimestamp(value: string | null | undefined) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAdultCooldownRemaining(ms: number) {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0 && seconds > 0) {
    return `${minutes}分${seconds}秒`;
  }
  if (minutes > 0) {
    return `${minutes}分钟`;
  }
  return `${seconds}秒`;
}

function resolveAdultActionCooldown(lastAdultActionAt: string | null | undefined) {
  const parsed = parseTimestamp(lastAdultActionAt);
  if (parsed === null) {
    return {
      isCoolingDown: false,
      cooldownRemainingMs: 0,
      cooldownRemainingText: null,
      cooldownUntil: null,
      hint: "心神已定，可以再次试探。",
    };
  }
  const cooldownUntilMs = parsed + WORLD_ADULT_ACTION_COOLDOWN_MS;
  const cooldownRemainingMs = Math.max(0, cooldownUntilMs - Date.now());
  if (cooldownRemainingMs <= 0) {
    return {
      isCoolingDown: false,
      cooldownRemainingMs: 0,
      cooldownRemainingText: null,
      cooldownUntil: new Date(cooldownUntilMs).toISOString(),
      hint: "心神已定，可以再次试探。",
    };
  }
  const cooldownRemainingText = formatAdultCooldownRemaining(cooldownRemainingMs);
  return {
    isCoolingDown: true,
    cooldownRemainingMs,
    cooldownRemainingText,
    cooldownUntil: new Date(cooldownUntilMs).toISOString(),
    hint: `心神平复中，约 ${cooldownRemainingText} 后可再次试探。`,
  };
}

function hasCooldown(value: string | null | undefined, cooldownMs: number) {
  const parsed = parseTimestamp(value);
  return parsed !== null && (Date.now() - parsed) < cooldownMs;
}

function normalizeTags(value: unknown, max = 4) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((entry, index, list) => list.indexOf(entry) === index)
    .slice(0, max);
}

function chebyshevDistance(leftX: number, leftY: number, rightX: number, rightY: number) {
  return Math.max(Math.abs(leftX - rightX), Math.abs(leftY - rightY));
}

function resolveCorruptionStageLabel(value: number) {
  if (value >= 75) {
    return "欲念偏深";
  }
  if (value >= 45) {
    return "心防渐松";
  }
  return "仍守边界";
}

function resolveActionTypeLabel(actionType: WorldAdultActionType) {
  return ADULT_ACTION_META[actionType].label;
}

function shouldSyncAdultInteractionToDoubleCultivation(actionType: WorldAdultActionType) {
  return actionType === "dual_cultivation"
    || actionType === "dangerous_preference"
    || actionType === "essence_drain";
}

function buildWorldNpcDoubleCultivationHints(linkage: WorldNpcDoubleCultivationLinkageResult | null) {
  if (!linkage) {
    return [] as string[];
  }
  return [
    linkage.log?.id ? "已同步计入双修记录。" : null,
    typeof linkage.player?.gain === "number"
      ? `双修修为${linkage.player.gain >= 0 ? "+" : ""}${Math.floor(linkage.player.gain)}。`
      : null,
    typeof linkage.intimacy?.scoreDelta === "number" && linkage.intimacy.scoreDelta > 0
      ? `双修淫乱度 +${Math.floor(linkage.intimacy.scoreDelta)}。`
      : null,
    ...(Array.isArray(linkage.statusEffectsApplied) ? linkage.statusEffectsApplied : []),
  ].filter((entry): entry is string => Boolean(entry));
}

function buildWorldNpcDoubleCultivationPayload(linkage: WorldNpcDoubleCultivationLinkageResult | null, forced = false) {
  if (!linkage) {
    return {
      synced: false,
      forced,
      settledVia: null,
      fallbackUsed: false,
      fallbackReason: null,
      failureMessage: null,
    };
  }
  return {
    synced: true,
    forced,
    settledVia: linkage.settledVia ?? null,
    logId: linkage.log?.id ?? null,
    targetKind: linkage.log?.targetKind ?? null,
    targetId: linkage.log?.targetMonsterId ?? null,
    targetName: linkage.log?.targetNameSnapshot ?? null,
    sourceRef: linkage.log?.sourceRef ?? linkage.sourceRef ?? null,
    sourceTargetId: linkage.log?.sourceTargetId ?? linkage.sourceTargetId ?? null,
    playerGain: linkage.player?.gain ?? null,
    playerFluidMl: linkage.log?.initiatorFluidMl ?? null,
    partnerFluidMl: linkage.log?.targetFluidMl ?? null,
    intimacyScoreDelta: linkage.intimacy?.scoreDelta ?? null,
    fallbackUsed: false,
    fallbackReason: null,
    failureMessage: null,
  };
}

function buildWorldNpcDoubleCultivationFallbackPayload(params: {
  forced?: boolean;
  fallbackReason: string;
  failureMessage?: string | null;
  sourceRef?: string | null;
  sourceTargetId?: string | null;
  targetId?: string | null;
  targetName?: string | null;
}) {
  return {
    synced: false,
    forced: Boolean(params.forced),
    settledVia: null,
    logId: null,
    targetKind: "world_npc",
    targetId: String(params.targetId || "").trim() || null,
    targetName: String(params.targetName || "").trim() || null,
    sourceRef: String(params.sourceRef || "").trim() || null,
    sourceTargetId: String(params.sourceTargetId || "").trim() || null,
    playerGain: null,
    playerFluidMl: null,
    partnerFluidMl: null,
    intimacyScoreDelta: null,
    fallbackUsed: true,
    fallbackReason: params.fallbackReason,
    failureMessage: String(params.failureMessage || "").trim() || null,
  };
}

function toNullableNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractWorldAdultHistoryDoubleCultivation(
  payloadJson: Record<string, unknown> | null | undefined,
): WorldAdultHistoryDoubleCultivationView | null {
  if (!payloadJson || typeof payloadJson !== "object") {
    return null;
  }
  const raw = payloadJson.doubleCultivation;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  return {
    synced: row.synced === true,
    forced: row.forced === true,
    settledVia: String(row.settledVia || "").trim() || null,
    logId: toNullableNumber(row.logId),
    targetKind: String(row.targetKind || "").trim() || null,
    targetId: String(row.targetId || "").trim() || null,
    targetName: String(row.targetName || "").trim() || null,
    sourceRef: String(row.sourceRef || "").trim() || null,
    sourceTargetId: String(row.sourceTargetId || "").trim() || null,
    playerGain: toNullableNumber(row.playerGain),
    playerFluidMl: toNullableNumber(row.playerFluidMl),
    partnerFluidMl: toNullableNumber(row.partnerFluidMl),
    intimacyScoreDelta: toNullableNumber(row.intimacyScoreDelta),
    fallbackUsed: row.fallbackUsed === true,
    fallbackReason: String(row.fallbackReason || "").trim() || null,
    failureMessage: String(row.failureMessage || "").trim() || null,
  };
}

function normalizeAdultInteractionGender(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "male" || normalized === "man" || normalized === "男") {
    return "male" as const;
  }
  if (normalized === "female" || normalized === "woman" || normalized === "女") {
    return "female" as const;
  }
  return null;
}

function resolveAdultInteractionBlockedReason(input: {
  playerGender: string | null | undefined;
  npcGender: string | null | undefined;
}) {
  const playerGender = normalizeAdultInteractionGender(input.playerGender);
  const npcGender = normalizeAdultInteractionGender(input.npcGender);
  if (!playerGender || !npcGender) {
    return "此类试探暂只对已定性别的男女角色开放。";
  }
  if (playerGender === npcGender) {
    return "此类邀约当前只开放男女之间。";
  }
  return null;
}

function shouldAllowDangerousPreference(playerProfile: PlayerAdultProfileRow, npcProfile: WorldNpcAdultProfileRow) {
  return Math.max(playerProfile.corruptionValue, npcProfile.corruptionValue) >= 55;
}

async function ensureDoubleCultivationCompatTables() {
  if (!ensureDoubleCultivationCompatTablesPromise) {
    ensureDoubleCultivationCompatTablesPromise = (async () => {
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "player_double_cultivation_uterus" (
          "player_id" text PRIMARY KEY REFERENCES "players"("id"),
          "storage_ml" integer NOT NULL DEFAULT 0,
          "capacity_ml" integer NOT NULL DEFAULT 120,
          "updated_at" text NOT NULL DEFAULT NOW()::text,
          "last_digest_at" text
        )
      `));
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "player_double_cultivation_player_stats" (
          "player_id" text PRIMARY KEY REFERENCES "players"("id"),
          "intimacy_score" integer NOT NULL DEFAULT 0,
          "note" text NOT NULL DEFAULT '',
          "updated_at" text NOT NULL DEFAULT NOW()::text
        )
      `));
    })().catch((error) => {
      ensureDoubleCultivationCompatTablesPromise = null;
      throw error;
    });
  }
  await ensureDoubleCultivationCompatTablesPromise;
}

async function getCompatIntimacyScore(playerId: string) {
  await ensureDoubleCultivationCompatTables();
  const rows = await db.execute<{ intimacy_score?: number | null }>(drizzleSql`
    SELECT "intimacy_score"
    FROM "player_double_cultivation_player_stats"
    WHERE "player_id" = ${playerId}
    LIMIT 1
  `);
  const first = Array.isArray(rows) ? rows[0] : (rows as { rows?: Array<{ intimacy_score?: number | null }> }).rows?.[0];
  return clampStat(first?.intimacy_score, 0);
}

async function addCompatIntimacyScore(playerId: string, delta: number) {
  await ensureDoubleCultivationCompatTables();
  const nowIso = new Date().toISOString();
  await db.execute(drizzleSql`
    INSERT INTO "player_double_cultivation_player_stats" ("player_id", "intimacy_score", "note", "updated_at")
    VALUES (${playerId}, ${Math.max(0, Math.round(delta))}, '', ${nowIso})
    ON CONFLICT ("player_id")
    DO UPDATE SET
      "intimacy_score" = GREATEST(0, "player_double_cultivation_player_stats"."intimacy_score" + ${Math.round(delta)}),
      "updated_at" = ${nowIso}
  `);
}

async function addCompatUterusFluid(playerId: string, addMl: number) {
  await ensureDoubleCultivationCompatTables();
  const nowIso = new Date().toISOString();
  const rows = await db.execute<{
    storage_ml?: number | null;
    capacity_ml?: number | null;
  }>(drizzleSql`
    SELECT "storage_ml", "capacity_ml"
    FROM "player_double_cultivation_uterus"
    WHERE "player_id" = ${playerId}
    LIMIT 1
  `);
  const first = Array.isArray(rows) ? rows[0] : (rows as {
    rows?: Array<{ storage_ml?: number | null; capacity_ml?: number | null }>;
  }).rows?.[0];
  const capacityMl = Math.max(1, Math.floor(Number(first?.capacity_ml || 120)));
  const storageMl = Math.max(0, Math.floor(Number(first?.storage_ml || 0)));
  const nextStorageMl = Math.max(0, Math.min(capacityMl, storageMl + Math.max(0, Math.floor(addMl))));
  await db.execute(drizzleSql`
    INSERT INTO "player_double_cultivation_uterus" ("player_id", "storage_ml", "capacity_ml", "updated_at", "last_digest_at")
    VALUES (${playerId}, ${nextStorageMl}, ${capacityMl}, ${nowIso}, NULL)
    ON CONFLICT ("player_id")
    DO UPDATE SET
      "storage_ml" = ${nextStorageMl},
      "capacity_ml" = ${capacityMl},
      "updated_at" = ${nowIso},
      "last_digest_at" = NULL
  `);
  return {
    storageMl: nextStorageMl,
    capacityMl,
  };
}

async function syncAdultInteractionToDoubleCultivationLedger(params: {
  context: AdultInteractionContext;
  actionType: WorldAdultActionType;
  eventLogId: string;
}) {
  try {
    const result = await settleWorldNpcDoubleCultivationLinkage({
      playerId: params.context.player.id,
      targetNpcId: params.context.npcProfile.id,
      targetNpcName: params.context.npcProfile.name,
      targetNpcGender: String(params.context.npcProfile.gender || ""),
      targetNpcRealmName: params.context.npcProfile.realmName,
      actionType: params.actionType,
      sourceRef: `world-adult:${params.eventLogId}`,
      sourceTargetId: params.context.npcProfile.id,
    });
    if (!result?.settled) {
      throw new Error("世界 NPC 双修服务未完成落账");
    }
    console.info("[world-adult] double cultivation linkage settled", {
      playerId: params.context.player.id,
      npcId: params.context.npcProfile.id,
      actionType: params.actionType,
      sourceRef: `world-adult:${params.eventLogId}`,
      settledVia: result.settledVia ?? "unknown",
      logId: result.log?.id ?? null,
    });
    return result;
  } catch (error) {
    console.error("[world-adult] double cultivation linkage failed", {
      playerId: params.context.player.id,
      npcId: params.context.npcProfile.id,
      actionType: params.actionType,
      sourceRef: `world-adult:${params.eventLogId}`,
      mode: "direct-service",
      error,
    });
    return null;
  }
}

async function ensurePlayerAdultProfile(player: typeof players.$inferSelect) {
  const existing = await db.select().from(playerAdultProfiles)
    .where(eq(playerAdultProfiles.playerId, player.id))
    .get();
  if (existing) {
    return existing;
  }

  const intimacyScore = await getCompatIntimacyScore(player.id);
  const defaultRow = {
    playerId: player.id,
    corruptionValue: clampStat(Math.floor(intimacyScore / 4), 0),
    allureValue: clampStat(Math.floor(((player.luck || 0) + (player.speed || 0)) / 2), 12),
    shameValue: clampStat(82 - Math.floor(intimacyScore / 8), 82),
    adultPreferenceTags: [],
    metaJson: {},
    lastAdultActionAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } satisfies typeof playerAdultProfiles.$inferInsert;

  await db.insert(playerAdultProfiles).values(defaultRow)
    .onConflictDoNothing({ target: playerAdultProfiles.playerId })
    .run();
  return (await db.select().from(playerAdultProfiles).where(eq(playerAdultProfiles.playerId, player.id)).get()) || defaultRow;
}

async function ensureWorldNpcAdultProfile(params: {
  npcProfile: typeof worldNpcProfiles.$inferSelect;
  npcRuntime: typeof worldNpcRuntime.$inferSelect;
  map: Pick<typeof worldMapInstances.$inferSelect, "id" | "name" | "archetype"> | null;
}) {
  const existing = await db.select().from(worldNpcAdultProfiles)
    .where(eq(worldNpcAdultProfiles.npcId, params.npcProfile.id))
    .get();
  if (existing) {
    return existing;
  }

  const fallbackCorruption = clampStat(
    Math.floor((params.npcProfile.reincarnationCount || 0) * 8)
      + (String(params.npcProfile.faction || "").includes("魔") ? 24 : 0)
      + (String(params.npcProfile.profession || "").includes("黑") ? 10 : 0),
    18,
  );
  const generated = await generateOpenWorldAdultProfile({
    npcName: params.npcProfile.name,
    mapName: params.map?.name || "人间一隅",
    mapArchetype: params.map?.archetype || "开放世界",
    faction: params.npcProfile.faction,
    profession: params.npcProfile.profession,
    personalitySummary: params.npcProfile.personalitySummary,
    traitTags: normalizeTags(params.npcProfile.traitTags),
    corruptionValue: fallbackCorruption,
  });

  const insertRow = {
    npcId: params.npcProfile.id,
    desireValue: clampStat(28 + Math.floor((params.npcProfile.realmMinor || 1) * 3), 28),
    corruptionValue: fallbackCorruption,
    cautionValue: clampStat(String(params.npcProfile.faction || "").includes("正") ? 62 : 38, 38),
    adultRoleTags: generated.roleTags,
    adultPreferenceTags: generated.preferenceTags,
    metaJson: {
      summary: generated.summary,
      dispositionLabel: generated.dispositionLabel,
      preferenceHints: generated.preferenceHints,
      roleTags: generated.roleTags,
      preferenceTags: generated.preferenceTags,
      corruptionStageLabel: generated.corruptionStageLabel,
      aiSource: generated.source,
      generatedAt: new Date().toISOString(),
    },
    lastInviteAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } satisfies typeof worldNpcAdultProfiles.$inferInsert;

  await db.insert(worldNpcAdultProfiles).values(insertRow)
    .onConflictDoNothing({ target: worldNpcAdultProfiles.npcId })
    .run();
  return (await db.select().from(worldNpcAdultProfiles).where(eq(worldNpcAdultProfiles.npcId, params.npcProfile.id)).get()) || insertRow;
}

async function loadAdultInteractionContext(playerId: string, npcId: string): Promise<AdultInteractionContext | null> {
  const [player, npcRow] = await Promise.all([
    db.select().from(players).where(eq(players.id, playerId)).get(),
    db.select({
      profile: worldNpcProfiles,
      runtime: worldNpcRuntime,
      mapId: worldMapInstances.id,
      mapName: worldMapInstances.name,
      mapArchetype: worldMapInstances.archetype,
    })
      .from(worldNpcProfiles)
      .innerJoin(worldNpcRuntime, eq(worldNpcRuntime.npcId, worldNpcProfiles.id))
      .leftJoin(worldMapInstances, eq(worldMapInstances.id, worldNpcRuntime.currentMapId))
      .where(eq(worldNpcProfiles.id, npcId))
      .get(),
  ]);
  if (!player || !npcRow) {
    return null;
  }
  return {
    player,
    npcProfile: npcRow.profile,
    npcRuntime: npcRow.runtime,
    map: npcRow.mapId
      ? {
        id: npcRow.mapId,
        name: npcRow.mapName || "开放世界",
        archetype: npcRow.mapArchetype || "开放世界",
      }
      : null,
    districtName: resolveOpenWorldDistrictName({
      mapId: npcRow.runtime.currentMapId,
      positionX: npcRow.runtime.positionX,
      positionY: npcRow.runtime.positionY,
    }),
  };
}

function assertAdultInteractionAllowed(context: AdultInteractionContext) {
  const interactionBlockedReason = resolveAdultInteractionBlockedReason({
    playerGender: context.player.gender,
    npcGender: context.npcProfile.gender,
  });
  if (interactionBlockedReason) {
    throw new Error(interactionBlockedReason);
  }
  if (context.npcProfile.status === "dead") {
    throw new Error("该世界 NPC 已不在人世，无法继续互动。");
  }
  if (context.npcRuntime.occupiedByCombatId) {
    throw new Error("对方正处于交战中，无法分心回应。");
  }
  if (context.player.currentMapId !== context.npcRuntime.currentMapId) {
    throw new Error("你与对方不在同一张地图，无法进行接触。");
  }
  const distance = chebyshevDistance(
    context.player.positionX,
    context.player.positionY,
    context.npcRuntime.positionX,
    context.npcRuntime.positionY,
  );
  if (distance > WORLD_ADULT_CONTACT_DISTANCE) {
    throw new Error("距离过远，请先靠近对方。");
  }
  if (isWorldNpcThreatActive(context.npcRuntime) && String(context.npcRuntime.currentTargetId || "").trim() === context.player.id) {
    throw new Error("对方对你仍怀有敌意，此时不适合试探。");
  }
}

function buildPendingInviteView(
  row: WorldAdultEventLogRow,
  npcName: string,
  npcAdultProfile: WorldNpcAdultProfileRow,
) {
  const payload = (row.payloadJson || {}) as Record<string, unknown>;
  const defaultResponseOptions = row.negotiationOutcome === "counter_drain"
    ? [WORLD_ADULT_RESPONSE_LABELS.accept, WORLD_ADULT_RESPONSE_LABELS.reject, WORLD_ADULT_RESPONSE_LABELS.counter_drain, WORLD_ADULT_RESPONSE_LABELS.ignore]
    : [WORLD_ADULT_RESPONSE_LABELS.accept, WORLD_ADULT_RESPONSE_LABELS.reject, WORLD_ADULT_RESPONSE_LABELS.ignore];
  return {
    eventLogId: row.id,
    npcId: row.worldNpcId,
    npcName,
    actionType: row.actionType as WorldAdultActionType,
    actionLabel: resolveActionTypeLabel(row.actionType as WorldAdultActionType),
    title: String(payload.title || row.summary || "暧昧试探"),
    summary: String(payload.inviteSummary || row.summary || ""),
    atmosphere: String(payload.atmosphere || npcAdultProfile.metaJson?.summary || ""),
    dispositionLabel: String(npcAdultProfile.metaJson?.dispositionLabel || "试探"),
    responseOptions: normalizeAdultResponseOptions(payload.responseOptions, defaultResponseOptions),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  } satisfies WorldAdultInviteView;
}

function resolveAllowedAdultDecisions(row: Pick<WorldAdultEventLogRow, "negotiationOutcome" | "payloadJson">) {
  const payload = (row.payloadJson || {}) as Record<string, unknown>;
  const responseOptions = normalizeAdultResponseOptions(
    payload.responseOptions,
    row.negotiationOutcome === "counter_drain"
      ? [WORLD_ADULT_RESPONSE_LABELS.accept, WORLD_ADULT_RESPONSE_LABELS.reject, WORLD_ADULT_RESPONSE_LABELS.counter_drain, WORLD_ADULT_RESPONSE_LABELS.ignore]
      : [WORLD_ADULT_RESPONSE_LABELS.accept, WORLD_ADULT_RESPONSE_LABELS.reject, WORLD_ADULT_RESPONSE_LABELS.ignore],
  );
  const allowedDecisions = responseOptions.flatMap((label) => {
    switch (label) {
      case WORLD_ADULT_RESPONSE_LABELS.accept:
        return ["accept"] as const;
      case WORLD_ADULT_RESPONSE_LABELS.reject:
        return ["reject"] as const;
      case WORLD_ADULT_RESPONSE_LABELS.counter_drain:
        return ["counter_drain"] as const;
      case WORLD_ADULT_RESPONSE_LABELS.report:
        return ["report"] as const;
      case WORLD_ADULT_RESPONSE_LABELS.ignore:
        return ["ignore"] as const;
      default:
        return [];
    }
  });
  if (!allowedDecisions.includes("ignore")) {
    allowedDecisions.push("ignore");
  }
  return Array.from(new Set(allowedDecisions));
}

async function getPendingAdultInvite(playerId: string, npcId: string) {
  return getPendingAdultInviteFromExecutor(db, playerId, npcId);
}

async function claimWorldAdultResolveEvent(params: {
  eventLogId: string;
  playerId: string;
  npcId: string;
}) {
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - WORLD_ADULT_RESOLVE_STALE_MS).toISOString();
  return await db.update(worldAdultEventLogs).set({
    status: "resolving",
    updatedAt: nowIso,
  }).where(and(
    eq(worldAdultEventLogs.id, params.eventLogId),
    eq(worldAdultEventLogs.playerId, params.playerId),
    eq(worldAdultEventLogs.worldNpcId, params.npcId),
    or(
      eq(worldAdultEventLogs.status, "pending"),
      and(
        eq(worldAdultEventLogs.status, "resolving"),
        lt(worldAdultEventLogs.updatedAt, staleIso),
      ),
    ),
  )).returning().get();
}

async function getPendingAdultInviteFromExecutor(
  executor: Pick<typeof db, "select" | "update">,
  playerId: string,
  npcId: string,
) {
  const nowIso = new Date().toISOString();
  const rows = await executor.select().from(worldAdultEventLogs)
    .where(and(
      eq(worldAdultEventLogs.playerId, playerId),
      eq(worldAdultEventLogs.worldNpcId, npcId),
      eq(worldAdultEventLogs.status, "pending"),
    ))
    .orderBy(desc(worldAdultEventLogs.createdAt))
    .all();
  if (rows.length <= 0) {
    return null;
  }

  let activeRow: typeof rows[number] | null = null;
  const staleIds: string[] = [];

  for (const row of rows) {
    const isExpired = Boolean(row.expiresAt && row.expiresAt < nowIso);
    if (isExpired) {
      staleIds.push(row.id);
      continue;
    }
    if (!activeRow) {
      activeRow = row;
      continue;
    }
    staleIds.push(row.id);
  }

  if (staleIds.length > 0) {
    await executor.update(worldAdultEventLogs).set({
      status: "expired",
      respondedAt: nowIso,
      updatedAt: nowIso,
    }).where(inArray(worldAdultEventLogs.id, staleIds)).run();
  }

  return activeRow;
}

function resolveNegotiationOutcome(params: {
  playerProfile: PlayerAdultProfileRow;
  npcAdultProfile: WorldNpcAdultProfileRow;
  actionType: WorldAdultActionType;
  playerRealm: number;
  npcRealm: number;
}) {
  const realmGap = params.npcRealm - params.playerRealm;
  const tagBonus = params.actionType === "dual_cultivation"
    ? 8
    : params.actionType === "essence_drain"
      ? -4
      : params.actionType === "dangerous_preference"
        ? -8
        : 4;
  const baseScore = 42
    + Math.floor(params.playerProfile.allureValue * 0.45)
    + Math.floor(params.playerProfile.corruptionValue * 0.2)
    + Math.floor(params.npcAdultProfile.desireValue * 0.38)
    + Math.floor(params.npcAdultProfile.corruptionValue * 0.3)
    - Math.floor(params.npcAdultProfile.cautionValue * 0.42)
    - Math.max(0, realmGap) * 8
    + tagBonus;

  if (
    params.actionType === "essence_drain"
    && params.npcAdultProfile.corruptionValue >= 55
    && params.npcAdultProfile.desireValue >= 48
    && baseScore >= 44
  ) {
    return "counter_drain" as const;
  }
  if (params.actionType === "dangerous_preference" && params.npcAdultProfile.cautionValue >= 68 && baseScore < 38) {
    return "report" as const;
  }
  if (baseScore >= 70) {
    return "accept" as const;
  }
  if (baseScore >= 48) {
    return "tease" as const;
  }
  if (params.npcAdultProfile.cautionValue >= 70 && params.actionType !== "seduce_invite") {
    return "report" as const;
  }
  return "reject" as const;
}

function buildAllowedAdultActions(params: {
  playerProfile: PlayerAdultProfileRow;
  npcProfile: WorldNpcAdultProfileRow;
}) {
  return (Object.entries(ADULT_ACTION_META) as Array<[WorldAdultActionType, typeof ADULT_ACTION_META[WorldAdultActionType]]>).map(([actionType, meta]) => {
    const disabledReason = actionType === "dangerous_preference" && !shouldAllowDangerousPreference(params.playerProfile, params.npcProfile)
      ? "双方堕落尚未高到足以让危险偏好浮上台面。"
      : null;
    return {
      actionType,
      label: meta.label,
      description: meta.description,
      riskLabel: meta.riskLabel,
      disabledReason,
    };
  });
}

function buildVisibleAdultActions(params: {
  playerProfile: PlayerAdultProfileRow;
  npcProfile: WorldNpcAdultProfileRow;
  interactionBlockedReason?: string | null;
}) {
  return buildAllowedAdultActions({
    playerProfile: params.playerProfile,
    npcProfile: params.npcProfile,
  }).map((action) => ({
    ...action,
    disabledReason: params.interactionBlockedReason || action.disabledReason || null,
  }));
}

async function writeAdultLifeLog(params: {
  npcId: string;
  title: string;
  content: string;
  payloadJson?: Record<string, unknown>;
}) {
  await db.insert(worldNpcLifeLogs).values({
    npcId: params.npcId,
    logType: "adult_interaction",
    title: params.title,
    content: params.content,
    payloadJson: params.payloadJson || {},
    createdAt: new Date().toISOString(),
  }).run();
}

function resolveAdultPlayerDisplayName(playerName: string | null | undefined) {
  const normalized = String(playerName || "").trim();
  return normalized || "某位修士";
}

function resolveAdultHistorySummary(entry: WorldAdultEventLogRow) {
  const payload = (entry.payloadJson && typeof entry.payloadJson === "object")
    ? entry.payloadJson as Record<string, unknown>
    : {};
  const summaryCandidates = [
    entry.resultSummary,
    entry.summary,
    String(payload.finalSummary || ""),
    String(payload.worldConsequence || ""),
    String(payload.inviteSummary || ""),
    String(payload.atmosphere || ""),
  ];
  const uniqueSegments = summaryCandidates
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
  if (uniqueSegments.length === 0) {
    return "这段互动留下了一点暧昧余波。";
  }
  return uniqueSegments.join("\n");
}

function resolveAdultHistoryTitle(entry: WorldAdultEventLogRow) {
  const payload = (entry.payloadJson && typeof entry.payloadJson === "object")
    ? entry.payloadJson as Record<string, unknown>
    : {};
  return String(
    payload.finalTitle
    || payload.acceptTitle
    || payload.rejectTitle
    || payload.title
    || resolveActionTypeLabel(entry.actionType as WorldAdultActionType),
  ).trim() || resolveActionTypeLabel(entry.actionType as WorldAdultActionType);
}

async function maybeCreateAdultRumor(params: {
  context: AdultInteractionContext;
  actionType: WorldAdultActionType;
  npcName: string;
  moodHint?: string;
}) {
  const rumor = await generateOpenWorldAdultRumor({
    mapName: params.context.map?.name || "人间一隅",
    districtName: params.context.districtName,
    actionType: params.actionType,
    moodHint: params.moodHint,
  });
  await createWorldNpcNearbyChatMessage({
    mapId: params.context.npcRuntime.currentMapId,
    npcId: params.context.npcProfile.id,
    senderName: params.npcName,
    content: rumor.summary,
    districtName: params.context.districtName,
  });
}

export async function getWorldNpcAdultIntent(params: {
  playerId: string;
  npcId: string;
}) {
  if (!(await ensureOpenWorldSchema())) {
    throw new Error("开放世界表结构尚未就绪");
  }
  const context = await loadAdultInteractionContext(params.playerId, params.npcId);
  if (!context) {
    throw new Error("世界 NPC 不存在");
  }
  const [playerProfile, npcAdultProfile, pendingInvite] = await Promise.all([
    ensurePlayerAdultProfile(context.player),
    ensureWorldNpcAdultProfile({
      npcProfile: context.npcProfile,
      npcRuntime: context.npcRuntime,
      map: context.map,
    }),
    getPendingAdultInvite(params.playerId, params.npcId),
  ]);
  const interactionBlockedReason = resolveAdultInteractionBlockedReason({
    playerGender: context.player.gender,
    npcGender: context.npcProfile.gender,
  });
  const actionCooldown = resolveAdultActionCooldown(playerProfile.lastAdultActionAt);

  return {
    npcId: context.npcProfile.id,
    adultDisposition: String(npcAdultProfile.metaJson?.dispositionLabel || "谨慎观望"),
    adultPreferenceHints: normalizeTags(npcAdultProfile.metaJson?.preferenceHints, 4),
    corruptionStageLabel: String(npcAdultProfile.metaJson?.corruptionStageLabel || resolveCorruptionStageLabel(npcAdultProfile.corruptionValue)),
    actionCooldown,
    allowedAdultActions: buildVisibleAdultActions({
      playerProfile,
      npcProfile: npcAdultProfile,
      interactionBlockedReason,
    }),
    playerAdultProfile: {
      corruptionValue: playerProfile.corruptionValue,
      allureValue: playerProfile.allureValue,
      shameValue: playerProfile.shameValue,
      corruptionStageLabel: resolveCorruptionStageLabel(playerProfile.corruptionValue),
    },
    npcAdultProfile: {
      desireValue: npcAdultProfile.desireValue,
      corruptionValue: npcAdultProfile.corruptionValue,
      cautionValue: npcAdultProfile.cautionValue,
      roleTags: normalizeTags(npcAdultProfile.adultRoleTags),
      preferenceTags: normalizeTags(npcAdultProfile.adultPreferenceTags),
      summary: String(npcAdultProfile.metaJson?.summary || ""),
    },
    pendingInvite: pendingInvite
      ? buildPendingInviteView(pendingInvite, context.npcProfile.name, npcAdultProfile)
      : null,
  } satisfies WorldNpcAdultIntentView;
}

export async function negotiateWorldNpcAdultInteraction(params: {
  playerId: string;
  npcId: string;
  actionType: WorldAdultActionType;
}) {
  if (!(await ensureOpenWorldSchema())) {
    throw new Error("开放世界表结构尚未就绪");
  }
  const context = await loadAdultInteractionContext(params.playerId, params.npcId);
  if (!context) {
    throw new Error("世界 NPC 不存在");
  }
  assertAdultInteractionAllowed(context);

  const [playerProfile, npcAdultProfile, existingPending] = await Promise.all([
    ensurePlayerAdultProfile(context.player),
    ensureWorldNpcAdultProfile({
      npcProfile: context.npcProfile,
      npcRuntime: context.npcRuntime,
      map: context.map,
    }),
    getPendingAdultInvite(params.playerId, params.npcId),
  ]);
  const actionCooldown = resolveAdultActionCooldown(playerProfile.lastAdultActionAt);
  if (actionCooldown.isCoolingDown) {
    throw new Error(`你的心神还未平复，约 ${actionCooldown.cooldownRemainingText || "片刻"} 后可再次试探。`);
  }
  if (existingPending) {
    return {
      outcome: existingPending.negotiationOutcome as WorldAdultNegotiationOutcome,
      canResolve: true,
      invite: buildPendingInviteView(existingPending, context.npcProfile.name, npcAdultProfile),
      eventLogId: existingPending.id,
    };
  }

  const matchedAction = buildVisibleAdultActions({
    playerProfile,
    npcProfile: npcAdultProfile,
    interactionBlockedReason: resolveAdultInteractionBlockedReason({
      playerGender: context.player.gender,
      npcGender: context.npcProfile.gender,
    }),
  }).find((entry) => entry.actionType === params.actionType);
  if (matchedAction?.disabledReason) {
    throw new Error(matchedAction.disabledReason);
  }

  const outcome = resolveNegotiationOutcome({
    playerProfile,
    npcAdultProfile,
    actionType: params.actionType,
    playerRealm: Math.max(1, Number(context.player.realmMinor || context.player.realm || 1)),
    npcRealm: Math.max(1, Number(context.npcProfile.realmMinor || context.npcProfile.realmMajor || 1)),
  });
  const mapName = context.map?.name || "人间一隅";
  const playerDisplayName = resolveAdultPlayerDisplayName(context.player.name);
  const responseOptions = outcome === "counter_drain"
    ? ["接受", "婉拒", "反向诱导", "无视"]
    : ["接受", "婉拒", "无视"];

  const inviteText = outcome === "reject" || outcome === "report"
    ? await generateOpenWorldAdultReject({
      npcName: context.npcProfile.name,
      mapName,
      districtName: context.districtName,
      actionType: params.actionType,
    })
    : await generateOpenWorldAdultInvite({
      npcName: context.npcProfile.name,
      mapName,
      districtName: context.districtName,
      actionType: params.actionType,
      dispositionLabel: String(npcAdultProfile.metaJson?.dispositionLabel || ""),
      moodHint: resolveActionTypeLabel(params.actionType),
    });

  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + WORLD_ADULT_INVITE_TTL_MS).toISOString();
  const eventLogId = crypto.randomUUID();
  await db.insert(worldAdultEventLogs).values({
    id: eventLogId,
    playerId: params.playerId,
    worldNpcId: params.npcId,
    mapId: context.npcRuntime.currentMapId,
    districtName: context.districtName,
    eventType: "adult_negotiation",
    actionType: params.actionType,
    initiatedBy: "player",
    negotiationOutcome: outcome,
    status: outcome === "accept" || outcome === "tease" || outcome === "counter_drain" ? "pending" : "resolved",
    accepted: false,
    summary: inviteText.summary,
    atmosphereSummary: inviteText.atmosphere,
    resultSummary: null,
    statChangesJson: {},
    payloadJson: {
      playerName: playerDisplayName,
      npcName: context.npcProfile.name,
      title: inviteText.title,
      inviteSummary: inviteText.summary,
      atmosphere: inviteText.atmosphere,
      responseOptions: normalizeAdultResponseOptions(
        "responseOptions" in inviteText ? inviteText.responseOptions : responseOptions,
        responseOptions,
      ),
    },
    expiresAt: outcome === "accept" || outcome === "tease" || outcome === "counter_drain" ? expiresAt : null,
    respondedAt: outcome === "accept" || outcome === "tease" || outcome === "counter_drain" ? null : nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  }).run();

  if (outcome === "report") {
    await applyPlayerWorldIncident({
      playerId: params.playerId,
      incidentType: "adult_report",
      sourceType: "world_npc",
      sourceId: params.npcId,
      mapId: context.npcRuntime.currentMapId,
      districtName: context.districtName,
      severity: 2,
      summary: `${context.npcProfile.name}对你的试探生出警惕，这点风声可能会在附近传开。`,
      payloadJson: {
        actionType: params.actionType,
        outcome,
      },
    });
  }

  await db.update(playerAdultProfiles).set({
    lastAdultActionAt: nowIso,
    updatedAt: nowIso,
  }).where(eq(playerAdultProfiles.playerId, params.playerId)).run();
  await db.update(worldNpcAdultProfiles).set({
    lastInviteAt: nowIso,
    updatedAt: nowIso,
  }).where(eq(worldNpcAdultProfiles.npcId, params.npcId)).run();

  return {
    outcome,
    canResolve: outcome === "accept" || outcome === "tease" || outcome === "counter_drain",
    eventLogId,
    invite: buildPendingInviteView({
      id: eventLogId,
      playerId: params.playerId,
      worldNpcId: params.npcId,
      mapId: context.npcRuntime.currentMapId,
      districtName: context.districtName,
      eventType: "adult_negotiation",
      actionType: params.actionType,
      initiatedBy: "player",
      negotiationOutcome: outcome,
      resolutionDecision: null,
      status: outcome === "accept" || outcome === "tease" || outcome === "counter_drain" ? "pending" : "resolved",
      accepted: false,
      summary: inviteText.summary,
      atmosphereSummary: inviteText.atmosphere,
      resultSummary: null,
      statChangesJson: {},
      payloadJson: {
        playerName: playerDisplayName,
        npcName: context.npcProfile.name,
        title: inviteText.title,
        inviteSummary: inviteText.summary,
        atmosphere: inviteText.atmosphere,
        responseOptions: normalizeAdultResponseOptions(
          "responseOptions" in inviteText ? inviteText.responseOptions : responseOptions,
          responseOptions,
        ),
      },
      expiresAt,
      respondedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    }, context.npcProfile.name, npcAdultProfile),
  };
}

function buildAdultNumericChanges(input: {
  actionType: WorldAdultActionType;
  outcome: WorldAdultNegotiationOutcome;
}) {
  const isDangerous = input.actionType === "dangerous_preference" || input.actionType === "essence_drain";
  return {
    playerCorruptionDelta: isDangerous ? 6 : 3,
    playerAllureDelta: input.actionType === "seduce_invite" ? 3 : 1,
    playerShameDelta: isDangerous ? -5 : -2,
    npcDesireDelta: input.outcome === "counter_drain" ? 8 : 5,
    npcCorruptionDelta: isDangerous ? 5 : 2,
    npcCautionDelta: input.outcome === "accept" ? -3 : -1,
  };
}

function resolveAdultPressureIncidentType(params: {
  actionType: WorldAdultActionType;
  outcome: WorldAdultNegotiationOutcome;
  decision: WorldAdultResolveDecision;
}) {
  if (params.decision === "report") {
    return "adult_report" as const;
  }
  if (params.outcome === "counter_drain") {
    return "essence_drain" as const;
  }
  if (params.actionType === "dangerous_preference") {
    return "dangerous_preference" as const;
  }
  if (params.actionType === "essence_drain") {
    return "essence_drain" as const;
  }
  return null;
}

function resolveAdultPressureIncidentSeverity(params: {
  actionType: WorldAdultActionType;
  outcome: WorldAdultNegotiationOutcome;
  decision: WorldAdultResolveDecision;
}) {
  if (params.decision === "report") {
    return 1;
  }
  if (params.outcome === "counter_drain") {
    return 2;
  }
  if (params.actionType === "dangerous_preference") {
    return 3;
  }
  if (params.actionType === "essence_drain") {
    return 2;
  }
  return 0;
}

function resolveNpcLingYuReserve(params: {
  statsSummary?: Record<string, unknown> | null;
  realmMinor: number;
}) {
  const explicit = Number(params.statsSummary?.lingYuReserve || 0);
  if (explicit > 0) {
    return Math.max(0, Math.floor(explicit));
  }
  return Math.max(18, Math.floor(params.realmMinor * 24));
}

function buildNextNpcStatsSummary(params: {
  currentStatsSummary?: Record<string, unknown> | null;
  lingYuReserve: number;
}) {
  return {
    ...(params.currentStatsSummary || {}),
    lingYuReserve: Math.max(0, Math.floor(params.lingYuReserve)),
  };
}

function resolveAdultForcedActionsFromPayload(payloadJson: Record<string, unknown> | null | undefined) {
  const value = payloadJson?.forcedActions;
  if (!Array.isArray(value)) {
    return [] as OpenWorldForcedAction[];
  }
  return Array.from(new Set(
    value
      .map((entry) => String(entry || "").trim())
      .filter((entry): entry is OpenWorldForcedAction => (
        entry === "rob_lingyu"
        || entry === "forced_teleport"
        || entry === "forced_dual_cultivation"
      )),
  ));
}

function resolveAdultCoerciveFlavorLevel(params: {
  actionType: WorldAdultActionType;
  payloadJson?: Record<string, unknown> | null;
  npcCorruptionValue: number;
}) {
  const payloadLevel = String(params.payloadJson?.coerciveFlavorLevel || "").trim();
  if (payloadLevel === "high" || payloadLevel === "medium" || payloadLevel === "low") {
    return payloadLevel;
  }
  if (params.actionType === "dangerous_preference" || params.actionType === "essence_drain") {
    return params.npcCorruptionValue >= 75 ? "high" : "medium";
  }
  if (params.actionType === "dual_cultivation") {
    if (params.npcCorruptionValue >= 78) {
      return "high";
    }
    if (params.npcCorruptionValue >= 60) {
      return "medium";
    }
  }
  return "low";
}

function buildAdultForcedActions(params: {
  actionType: WorldAdultActionType;
  payloadJson?: Record<string, unknown> | null;
  coerciveFlavorLevel?: "low" | "medium" | "high";
}) {
  const payloadActions = resolveAdultForcedActionsFromPayload(params.payloadJson);
  if (payloadActions.length > 0) {
    return payloadActions;
  }
  const forcedRules = getOpenWorldForcedRuleSnapshot();
  if (params.actionType === "dangerous_preference" || params.actionType === "essence_drain") {
    return [...forcedRules.playerForcedActions];
  }
  if (params.actionType === "dual_cultivation" && params.coerciveFlavorLevel === "high") {
    return [...forcedRules.playerForcedActions];
  }
  return [];
}

function pickAdultForcedAction(forcedActions: readonly OpenWorldForcedAction[]) {
  if (forcedActions.includes("forced_dual_cultivation")) {
    return "forced_dual_cultivation" as const;
  }
  if (forcedActions.includes("forced_teleport")) {
    return "forced_teleport" as const;
  }
  return forcedActions[0] || null;
}

function resolveAdultPartnerJealousyTarget(npcId: string, npcGender: string | null | undefined) {
  const customNpc = getCachedOpenWorldCustomNpcLibrary().npcs.find((entry) => `${entry.id}` === String(npcId).match(/:custom:([^:]+)$/)?.[1]);
  if (!customNpc) {
    return null;
  }
  const partnerId = String(customNpc.primaryPartnerId || customNpc.partnerIds[0] || "").trim();
  if (!partnerId) {
    return null;
  }
  const partner = getCachedOpenWorldCustomNpcLibrary().npcs.find((entry) => entry.id === partnerId);
  if (!partner) {
    return null;
  }
  const normalizedNpcGender = normalizeAdultInteractionGender(npcGender);
  const normalizedPartnerGender = normalizeAdultInteractionGender(partner.gender);
  if (
    normalizedNpcGender
    && normalizedPartnerGender
    && normalizedNpcGender === normalizedPartnerGender
  ) {
    return null;
  }
  return partner;
}

export async function resolveWorldNpcAdultInteraction(params: {
  playerId: string;
  npcId: string;
  eventLogId: string;
  decision: WorldAdultResolveDecision;
}) {
  if (!(await ensureOpenWorldSchema())) {
    throw new Error("开放世界表结构尚未就绪");
  }
  const row = await db.select().from(worldAdultEventLogs)
    .where(and(
      eq(worldAdultEventLogs.id, params.eventLogId),
      eq(worldAdultEventLogs.playerId, params.playerId),
      eq(worldAdultEventLogs.worldNpcId, params.npcId),
    ))
    .get();
  if (!row) {
    throw new Error("互动记录不存在或已失效。");
  }
  const nowIso = new Date().toISOString();
  if (row.expiresAt && row.expiresAt < nowIso) {
    await db.update(worldAdultEventLogs).set({
      status: "expired",
      respondedAt: nowIso,
      updatedAt: nowIso,
    }).where(eq(worldAdultEventLogs.id, row.id)).run();
    throw new Error("这条邀约已经过期，无法继续回应。");
  }
  if (row.status !== "pending") {
    throw new Error("这条互动已经结算，无需重复处理。");
  }
  if (!(await claimWorldAdultResolveEvent(params))) {
    const latestRow = await db.select().from(worldAdultEventLogs)
      .where(eq(worldAdultEventLogs.id, params.eventLogId))
      .get();
    if (latestRow?.status === "resolved" || latestRow?.status === "expired") {
      throw new Error("这条互动已经结算，无需重复处理。");
    }
    throw new Error("这条互动正在处理中，请稍后再试。");
  }
  const allowedDecisions = resolveAllowedAdultDecisions(row);
  if (!allowedDecisions.includes(params.decision)) {
    throw new Error("这次邀约并不接受这种回应。");
  }

  const context = await loadAdultInteractionContext(params.playerId, params.npcId);
  if (!context) {
    throw new Error("世界 NPC 不存在");
  }
  const [playerProfile, npcAdultProfile] = await Promise.all([
    ensurePlayerAdultProfile(context.player),
    ensureWorldNpcAdultProfile({
      npcProfile: context.npcProfile,
      npcRuntime: context.npcRuntime,
      map: context.map,
    }),
  ]);
  const outcome = (row.negotiationOutcome || "reject") as WorldAdultNegotiationOutcome;
  const effectiveOutcome = params.decision === "counter_drain"
    ? "counter_drain"
    : outcome;
  const mapName = context.map?.name || "人间一隅";
  const playerDisplayName = resolveAdultPlayerDisplayName(context.player.name);
  const normalizedPlayerGender = normalizeAdultInteractionGender(context.player.gender);
  const normalizedNpcGender = normalizeAdultInteractionGender(context.npcProfile.gender);
  const pressureIncidentType = resolveAdultPressureIncidentType({
    actionType: row.actionType as WorldAdultActionType,
    outcome: effectiveOutcome,
    decision: params.decision,
  });
  const pressureIncidentSeverity = resolveAdultPressureIncidentSeverity({
    actionType: row.actionType as WorldAdultActionType,
    outcome: effectiveOutcome,
    decision: params.decision,
  });
  const forcedRuleSnapshot = getOpenWorldForcedRuleSnapshot();

  if (params.decision !== "accept" && params.decision !== "counter_drain") {
    const rejectText = await generateOpenWorldAdultReject({
      npcName: context.npcProfile.name,
      mapName,
      districtName: context.districtName,
      actionType: row.actionType as WorldAdultActionType,
      atmosphereHint: row.atmosphereSummary || undefined,
    });
    let forcedConsequenceTriggered = false;
    let forcedConsequenceSummary: string | null = null;
    let pressureApplied = false;
    let forcedActionUsed: OpenWorldForcedAction | null = null;
    let forcedDoubleCultivationLinkage: WorldNpcDoubleCultivationLinkageResult | null = null;
    let forcedDoubleCultivationPregnancy: WorldAdultResolveResultView["pregnancy"] = null;
    let consentState: WorldAdultResolveResultView["consentState"] = params.decision === "report"
      ? "adult_report"
      : "rejected";
    let relationshipConsequence = params.decision === "report"
      ? "你把这次试探当作风声记了出去，对方短时间内不会再把你视作可轻慢的对象。"
      : null;
    const coerciveFlavorLevel = resolveAdultCoerciveFlavorLevel({
      actionType: row.actionType as WorldAdultActionType,
      payloadJson: row.payloadJson as Record<string, unknown> | null,
      npcCorruptionValue: npcAdultProfile.corruptionValue,
    });
    const forcedActions = buildAdultForcedActions({
      actionType: row.actionType as WorldAdultActionType,
      payloadJson: row.payloadJson as Record<string, unknown> | null,
      coerciveFlavorLevel,
    });
    const canNpcForcePlayer = coerciveFlavorLevel === "high"
      && forcedActions.length > 0
      && playerProfile.corruptionValue >= forcedRuleSnapshot.highCorruptionThreshold;

    if (params.decision === "report" && pressureIncidentType) {
      await applyPlayerWorldIncident({
        playerId: params.playerId,
        incidentType: pressureIncidentType,
        sourceType: "world_npc",
        sourceId: params.npcId,
        mapId: context.npcRuntime.currentMapId,
        districtName: context.districtName,
        severity: pressureIncidentSeverity,
        summary: `${context.npcProfile.name}的暧昧试探被你当作风声记了出去，附近已经有人开始议论这场不太体面的碰撞。`,
        payloadJson: {
          actionType: row.actionType,
          outcome: effectiveOutcome,
          accepted: false,
          decision: params.decision,
        },
      });
      pressureApplied = true;
    }

    if (canNpcForcePlayer) {
      forcedActionUsed = pickAdultForcedAction(forcedActions);
      if (forcedActionUsed === "rob_lingyu") {
        const robbedLingYu = Math.min(
          context.player.lingYu,
          Math.max(12, Math.floor(context.player.lingYu * 0.18)),
        );
        if (robbedLingYu > 0) {
          await db.update(players).set({
            lingYu: Math.max(0, context.player.lingYu - robbedLingYu),
          }).where(eq(players.id, params.playerId)).run();
        }
      } else if (forcedActionUsed === "forced_teleport") {
        const targetMap = await db.select({
          id: worldMapInstances.id,
        }).from(worldMapInstances)
          .where(eq(worldMapInstances.id, context.npcRuntime.currentMapId))
          .get();
        const fallbackMap = await db.select({
          id: worldMapInstances.id,
        }).from(worldMapInstances)
          .orderBy(desc(worldMapInstances.dangerLevel), desc(worldMapInstances.heatScore))
          .limit(1)
          .get();
        const destinationMapId = fallbackMap?.id || targetMap?.id || context.npcRuntime.currentMapId;
        await db.update(players).set({
          currentMapId: destinationMapId,
          positionX: 15,
          positionY: 15,
        }).where(eq(players.id, params.playerId)).run();
      } else if (forcedActionUsed === "forced_dual_cultivation") {
        forcedDoubleCultivationLinkage = await syncAdultInteractionToDoubleCultivationLedger({
          context,
          actionType: "dual_cultivation",
          eventLogId: row.id,
        });
        if (
          forcedDoubleCultivationLinkage
          && normalizedPlayerGender === "female"
          && normalizedNpcGender === "male"
        ) {
          const pregnancyText = await generateOpenWorldAdultPregnancy({
            npcName: context.npcProfile.name,
            mapName,
            districtName: context.districtName,
            actionType: "dual_cultivation",
            pregnancyTriggered: Boolean(forcedDoubleCultivationLinkage.pregnancyStatus?.stageKey),
            atmosphereHint: rejectText.atmosphere,
          });
          forcedDoubleCultivationPregnancy = {
            triggered: Boolean(forcedDoubleCultivationLinkage.pregnancyStatus?.stageKey),
            summary: pregnancyText.summary,
            displayStageKey: forcedDoubleCultivationLinkage.pregnancyStatus?.stageKey
              || forcedDoubleCultivationLinkage.fertilizationDisplayStatus?.stageKey
              || forcedDoubleCultivationLinkage.fertilizationDisplayStatus?.statusKey
              || null,
          };
        }
      }

      const forcedNarrative = await generateOpenWorldForcedConsequence({
        npcName: context.npcProfile.name,
        mapName,
        districtName: context.districtName,
        actionType: row.actionType,
        atmosphereHint: rejectText.atmosphere,
        forcedAction: forcedActionUsed || "rob_lingyu",
      });
      forcedConsequenceTriggered = true;
      forcedConsequenceSummary = [
        forcedNarrative.summary,
        forcedActionUsed === "forced_dual_cultivation"
          ? buildWorldNpcDoubleCultivationHints(forcedDoubleCultivationLinkage).join(" ")
          : null,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();
      consentState = "coercive_failure";
      relationshipConsequence = forcedConsequenceSummary || relationshipConsequence;
      await applyPlayerWorldIncident({
        playerId: params.playerId,
        incidentType: "coercive_failure",
        sourceType: "world_npc",
        sourceId: params.npcId,
        mapId: context.npcRuntime.currentMapId,
        districtName: context.districtName,
        severity: 2,
        summary: forcedNarrative.summary,
        payloadJson: {
          actionType: row.actionType,
          decision: params.decision,
          forcedAction: forcedActionUsed,
        },
      });
      await applyPlayerWorldIncident({
        playerId: params.playerId,
        incidentType: "forced_consequence",
        sourceType: "world_npc",
        sourceId: params.npcId,
        mapId: context.npcRuntime.currentMapId,
        districtName: context.districtName,
        severity: 2,
        summary: forcedNarrative.summary,
        payloadJson: {
          actionType: row.actionType,
          decision: params.decision,
          forcedAction: forcedActionUsed,
        },
      });
      pressureApplied = true;
    }

    const finalWorldConsequence = [rejectText.worldConsequence, forcedConsequenceSummary]
      .filter(Boolean)
      .join(" ")
      .trim() || rejectText.worldConsequence;

    await db.update(worldAdultEventLogs).set({
      status: "resolved",
      resolutionDecision: params.decision,
      respondedAt: nowIso,
      accepted: false,
      resultSummary: rejectText.summary,
      atmosphereSummary: rejectText.atmosphere,
      payloadJson: {
        ...(row.payloadJson || {}),
        playerName: playerDisplayName,
        npcName: context.npcProfile.name,
        rejectTitle: rejectText.title,
        worldConsequence: finalWorldConsequence,
        consentState,
        pressureApplied,
        pressureEligible: Boolean(pressureIncidentType || forcedConsequenceTriggered),
        relationshipConsequence,
        forcedConsequenceTriggered,
        forcedConsequenceSummary,
        forcedAction: forcedActionUsed,
        doubleCultivation: forcedActionUsed === "forced_dual_cultivation"
          ? buildWorldNpcDoubleCultivationPayload(forcedDoubleCultivationLinkage, true)
          : undefined,
        pregnancy: forcedDoubleCultivationPregnancy,
      },
      updatedAt: nowIso,
    }).where(eq(worldAdultEventLogs.id, row.id)).run();

    return {
      eventLogId: row.id,
      accepted: false,
      outcome: effectiveOutcome,
      consentState,
      title: rejectText.title,
      summary: rejectText.summary,
      atmosphere: rejectText.atmosphere,
      worldConsequence: finalWorldConsequence,
      pressureApplied,
      pressureEligible: Boolean(pressureIncidentType || forcedConsequenceTriggered),
      relationshipConsequence,
      pressureSuppressedReason: pressureApplied ? null : "你没有同意，这次互动没有进入世界压力结算。",
      changeHints: Array.from(new Set([
        ...rejectText.changeHints,
        ...buildWorldNpcDoubleCultivationHints(forcedDoubleCultivationLinkage),
        ...(forcedConsequenceSummary ? [forcedConsequenceSummary] : []),
      ])),
      numericChanges: {
        playerCorruptionDelta: 0,
        playerAllureDelta: 0,
        playerShameDelta: 0,
        npcDesireDelta: 0,
        npcCorruptionDelta: 0,
        npcCautionDelta: 0,
      },
      pregnancy: forcedDoubleCultivationPregnancy,
      forcedConsequenceTriggered,
      forcedConsequenceSummary,
      partnerJealousyTriggered: false,
      partnerJealousySummary: null,
    } satisfies WorldAdultResolveResultView;
  }

  assertAdultInteractionAllowed(context);
  const numericChanges = buildAdultNumericChanges({
    actionType: row.actionType as WorldAdultActionType,
    outcome: effectiveOutcome,
  });
  const nextPlayerCorruption = clampStat(playerProfile.corruptionValue + numericChanges.playerCorruptionDelta, playerProfile.corruptionValue);
  const nextPlayerAllure = clampStat(playerProfile.allureValue + numericChanges.playerAllureDelta, playerProfile.allureValue);
  const nextPlayerShame = clampStat(playerProfile.shameValue + numericChanges.playerShameDelta, playerProfile.shameValue);
  const nextNpcDesire = clampStat(npcAdultProfile.desireValue + numericChanges.npcDesireDelta, npcAdultProfile.desireValue);
  const nextNpcCorruption = clampStat(npcAdultProfile.corruptionValue + numericChanges.npcCorruptionDelta, npcAdultProfile.corruptionValue);
  const nextNpcCaution = clampStat(npcAdultProfile.cautionValue + numericChanges.npcCautionDelta, npcAdultProfile.cautionValue);

  await db.transaction(async (tx) => {
    await tx.update(playerAdultProfiles).set({
      corruptionValue: nextPlayerCorruption,
      allureValue: nextPlayerAllure,
      shameValue: nextPlayerShame,
      lastAdultActionAt: nowIso,
      updatedAt: nowIso,
    }).where(eq(playerAdultProfiles.playerId, params.playerId)).run();
    await tx.update(worldNpcAdultProfiles).set({
      desireValue: nextNpcDesire,
      corruptionValue: nextNpcCorruption,
      cautionValue: nextNpcCaution,
      lastInviteAt: nowIso,
      updatedAt: nowIso,
      metaJson: {
        ...(npcAdultProfile.metaJson || {}),
        corruptionStageLabel: resolveCorruptionStageLabel(nextNpcCorruption),
      },
    }).where(eq(worldNpcAdultProfiles.npcId, params.npcId)).run();
  });

  const acceptText = await generateOpenWorldAdultAccept({
    npcName: context.npcProfile.name,
    mapName,
    districtName: context.districtName,
    actionType: row.actionType as WorldAdultActionType,
    atmosphereHint: row.atmosphereSummary || undefined,
  });
  const finalText = effectiveOutcome === "counter_drain"
    ? await generateOpenWorldAdultDrain({
      npcName: context.npcProfile.name,
      mapName,
      districtName: context.districtName,
      actionType: row.actionType as WorldAdultActionType,
      atmosphereHint: acceptText.atmosphere,
    })
    : await generateOpenWorldAdultResult({
      npcName: context.npcProfile.name,
      mapName,
      districtName: context.districtName,
      actionType: row.actionType as WorldAdultActionType,
      atmosphereHint: acceptText.atmosphere,
    });

  const actionType = row.actionType as WorldAdultActionType;
  const doubleCultivationLinkage = shouldSyncAdultInteractionToDoubleCultivation(actionType)
    ? await syncAdultInteractionToDoubleCultivationLedger({
      context,
      actionType,
      eventLogId: row.id,
    })
    : null;
  const shouldUseCompatFallback = !doubleCultivationLinkage;
  if (shouldUseCompatFallback) {
    await addCompatIntimacyScore(params.playerId, numericChanges.playerCorruptionDelta);
  }

  let pregnancyView: WorldAdultResolveResultView["pregnancy"] = null;
  if (
    doubleCultivationLinkage
    && normalizedPlayerGender === "female"
    && normalizedNpcGender === "male"
  ) {
    const pregnancyText = await generateOpenWorldAdultPregnancy({
      npcName: context.npcProfile.name,
      mapName,
      districtName: context.districtName,
      actionType,
      pregnancyTriggered: Boolean(doubleCultivationLinkage.pregnancyStatus?.stageKey),
      atmosphereHint: finalText.atmosphere,
    });
    pregnancyView = {
      triggered: Boolean(doubleCultivationLinkage.pregnancyStatus?.stageKey),
      summary: pregnancyText.summary,
      displayStageKey: doubleCultivationLinkage.pregnancyStatus?.stageKey
        || doubleCultivationLinkage.fertilizationDisplayStatus?.stageKey
        || doubleCultivationLinkage.fertilizationDisplayStatus?.statusKey
        || null,
    };
  } else if (
    params.decision === "accept"
    && normalizedPlayerGender === "female"
    && normalizedNpcGender === "male"
    && row.actionType !== "essence_drain"
  ) {
    const fluidGainMl = row.actionType === "dangerous_preference" ? 16 : 9;
    const uterusState = await addCompatUterusFluid(params.playerId, fluidGainMl);
    const pregnancySettle = await syncPregnancyStatusFromUterusState({
      femalePlayerId: params.playerId,
      uterusStorageMl: uterusState.storageMl,
      uterusCapacityMl: uterusState.capacityMl,
      absorbedMl: fluidGainMl,
      sourceRef: `world-adult:${row.id}`,
      sourceType: "open_world_adult",
      sourcePluginId: "double-cultivation",
      sourceTargetKind: "world_npc",
      sourceTargetId: params.npcId,
    });
    const pregnancyText = await generateOpenWorldAdultPregnancy({
      npcName: context.npcProfile.name,
      mapName,
      districtName: context.districtName,
      actionType: row.actionType as WorldAdultActionType,
      pregnancyTriggered: Boolean(pregnancySettle.pregnancyStatus),
      atmosphereHint: finalText.atmosphere,
    });
    pregnancyView = {
      triggered: Boolean(pregnancySettle.pregnancyStatus),
      summary: pregnancyText.summary,
      displayStageKey: pregnancySettle.pregnancyStatus?.stageKey || null,
    };
  }

  const linkageChangeHints = buildWorldNpcDoubleCultivationHints(doubleCultivationLinkage);

  const bark = await generateOpenWorldAdultBark({
    seed: `${row.id}:adult-bark`,
    mapName,
    districtName: context.districtName,
    npcName: context.npcProfile.name,
    actionType: row.actionType as WorldAdultActionType,
    moodHint: acceptText.atmosphere,
  });
  await createWorldNpcNearbyChatMessage({
    mapId: context.npcRuntime.currentMapId,
    npcId: context.npcProfile.id,
    senderName: context.npcProfile.name,
    content: bark.content,
    districtName: context.districtName,
  });
  if (row.actionType === "dangerous_preference" || row.actionType === "essence_drain") {
    await maybeCreateAdultRumor({
      context,
      actionType: row.actionType as WorldAdultActionType,
      npcName: context.npcProfile.name,
      moodHint: finalText.atmosphere,
    });
  }

  const consentState: WorldAdultResolveResultView["consentState"] = "mutual_accept";
  let pressureApplied = false;
  let pressureSuppressedReason: string | null = null;
  let relationshipConsequence: string | null = null;
  let forcedConsequenceTriggered = false;
  let forcedConsequenceSummary: string | null = null;
  let partnerJealousyTriggered = false;
  let partnerJealousySummary: string | null = null;

  if (pressureIncidentType) {
    await applyPlayerWorldIncident({
      playerId: params.playerId,
      incidentType: pressureIncidentType,
      sourceType: "world_npc",
      sourceId: params.npcId,
      mapId: context.npcRuntime.currentMapId,
      districtName: context.districtName,
      severity: pressureIncidentSeverity,
      summary: effectiveOutcome === "counter_drain"
        ? `${context.npcProfile.name}与你的试探突然反转成一场更危险的灵机拉扯，附近风声因此更显暧昧。`
        : row.actionType === "dangerous_preference"
        ? `${context.districtName || context.map?.name || "此地"}里已经有人察觉到一丝危险而暧昧的余波。`
        : `${context.npcProfile.name}在与你的接触中留下了一道足以牵动风声的危险痕迹。`,
      payloadJson: {
        actionType: row.actionType,
        outcome: effectiveOutcome,
        accepted: true,
        consentState,
        doubleCultivationLogId: doubleCultivationLinkage?.log?.id ?? null,
      },
    });
    pressureApplied = true;
  } else {
    pressureSuppressedReason = "双方明确同意的双修只记关系余波，不进入世界通缉与压力链。";
  }

  const canPlayerForceNpc = effectiveOutcome === "counter_drain"
    && npcAdultProfile.corruptionValue >= forcedRuleSnapshot.highCorruptionThreshold
    && forcedRuleSnapshot.npcForcedActions.includes("rob_lingyu");
  if (canPlayerForceNpc) {
    const npcReserve = resolveNpcLingYuReserve({
      statsSummary: context.npcProfile.statsSummary as Record<string, unknown> | null,
      realmMinor: context.npcProfile.realmMinor,
    });
    const robbedLingYu = Math.min(
      npcReserve,
      Math.max(12, Math.floor(npcReserve * 0.35)),
    );
    if (robbedLingYu > 0) {
      await db.transaction(async (tx) => {
        await tx.update(players).set({
          lingYu: context.player.lingYu + robbedLingYu,
        }).where(eq(players.id, params.playerId)).run();
        await tx.update(worldNpcProfiles).set({
          statsSummary: buildNextNpcStatsSummary({
            currentStatsSummary: context.npcProfile.statsSummary as Record<string, unknown> | null,
            lingYuReserve: npcReserve - robbedLingYu,
          }),
          updatedAt: nowIso,
        }).where(eq(worldNpcProfiles.id, params.npcId)).run();
      });
      const forcedNarrative = await generateOpenWorldForcedConsequence({
        npcName: context.npcProfile.name,
        mapName,
        districtName: context.districtName,
        actionType: row.actionType,
        atmosphereHint: finalText.atmosphere,
        forcedAction: "rob_lingyu",
      });
      forcedConsequenceTriggered = true;
      forcedConsequenceSummary = forcedNarrative.summary;
      relationshipConsequence = forcedNarrative.summary;
    }
  }

  const partnerJealousyTarget = resolveAdultPartnerJealousyTarget(params.npcId, context.npcProfile.gender);
  if (partnerJealousyTarget && !pressureApplied) {
    const jealousyNarrative = await generateOpenWorldPartnerJealousy({
      npcName: context.npcProfile.name,
      partnerName: partnerJealousyTarget.name,
      mapName,
      districtName: context.districtName,
      actionType: row.actionType,
      atmosphereHint: finalText.atmosphere,
    });
    partnerJealousyTriggered = true;
    partnerJealousySummary = jealousyNarrative.summary;
    relationshipConsequence = [relationshipConsequence, jealousyNarrative.summary]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  await db.update(worldAdultEventLogs).set({
    status: "resolved",
    resolutionDecision: params.decision,
    respondedAt: nowIso,
    accepted: true,
    summary: acceptText.summary,
    atmosphereSummary: finalText.atmosphere,
    resultSummary: finalText.summary,
    statChangesJson: {
      player: {
        corruptionValue: numericChanges.playerCorruptionDelta,
        allureValue: numericChanges.playerAllureDelta,
        shameValue: numericChanges.playerShameDelta,
      },
      npc: {
        desireValue: numericChanges.npcDesireDelta,
        corruptionValue: numericChanges.npcCorruptionDelta,
        cautionValue: numericChanges.npcCautionDelta,
      },
      world: {
        risk: row.actionType === "dangerous_preference" ? 3 : row.actionType === "essence_drain" ? 2 : 1,
      },
    },
    payloadJson: {
      ...(row.payloadJson || {}),
      playerName: playerDisplayName,
      npcName: context.npcProfile.name,
      acceptTitle: acceptText.title,
      finalTitle: finalText.title,
      finalSummary: finalText.summary,
      worldConsequence: finalText.worldConsequence,
      effectiveOutcome,
      consentState,
      pressureApplied,
      pressureEligible: Boolean(pressureIncidentType),
      relationshipConsequence,
      pressureSuppressedReason,
      forcedConsequenceTriggered,
      forcedConsequenceSummary,
      partnerJealousyTriggered,
      partnerJealousySummary,
      pregnancy: pregnancyView,
      doubleCultivation: doubleCultivationLinkage
        ? buildWorldNpcDoubleCultivationPayload(doubleCultivationLinkage)
        : buildWorldNpcDoubleCultivationFallbackPayload({
          fallbackReason: shouldSyncAdultInteractionToDoubleCultivation(actionType)
            ? "linkage_unavailable"
            : "sync_not_required",
          failureMessage: shouldSyncAdultInteractionToDoubleCultivation(actionType)
            ? "开放世界双修正式账本未完成同步，当前仅写入兼容态数据。"
            : null,
          sourceRef: `world-adult:${row.id}`,
          sourceTargetId: params.npcId,
          targetId: params.npcId,
          targetName: context.npcProfile.name,
        }),
      },
    updatedAt: nowIso,
  }).where(eq(worldAdultEventLogs.id, row.id)).run();

  await writeAdultLifeLog({
    npcId: params.npcId,
    title: resolveActionTypeLabel(row.actionType as WorldAdultActionType),
    content: relationshipConsequence
      ? `${context.npcProfile.name}与${playerDisplayName}之间留下了一段会继续发酵的余波。${relationshipConsequence}`
      : `${context.npcProfile.name}与${playerDisplayName}留下一段暧昧余波，关系与风声都因此偏移了些许。`,
    payloadJson: {
      playerId: params.playerId,
      playerName: playerDisplayName,
      npcName: context.npcProfile.name,
      eventLogId: row.id,
      actionType: row.actionType,
      outcome: effectiveOutcome,
      finalSummary: finalText.summary,
      relationshipConsequence,
      pressureApplied,
    },
  });

  return {
    eventLogId: row.id,
    accepted: true,
    outcome: effectiveOutcome,
    consentState,
    title: finalText.title,
    summary: finalText.summary,
    atmosphere: finalText.atmosphere,
    worldConsequence: `${acceptText.worldConsequence} ${finalText.worldConsequence}`.trim(),
    pressureApplied,
    pressureEligible: Boolean(pressureIncidentType),
    relationshipConsequence,
    pressureSuppressedReason,
    changeHints: Array.from(new Set([
      ...acceptText.changeHints,
      ...finalText.changeHints,
      ...linkageChangeHints,
      ...(forcedConsequenceSummary ? [forcedConsequenceSummary] : []),
      ...(partnerJealousySummary ? [partnerJealousySummary] : []),
    ])),
    numericChanges,
    pregnancy: pregnancyView,
    forcedConsequenceTriggered,
    forcedConsequenceSummary,
    partnerJealousyTriggered,
    partnerJealousySummary,
  } satisfies WorldAdultResolveResultView;
}

export async function listWorldAdultHistory(params: {
  playerId: string;
  npcId?: string | null;
}) {
  if (!(await ensureOpenWorldSchema())) {
    return [];
  }
  const filters = [eq(worldAdultEventLogs.playerId, params.playerId)];
  if (params.npcId) {
    filters.push(eq(worldAdultEventLogs.worldNpcId, params.npcId));
  }
  const rows = await db.select().from(worldAdultEventLogs)
    .where(and(...filters))
    .orderBy(desc(worldAdultEventLogs.createdAt))
    .limit(WORLD_ADULT_HISTORY_LIMIT)
    .all();
  const npcIds = Array.from(new Set(rows.map((entry) => entry.worldNpcId)));
  const npcRows = npcIds.length > 0
    ? await db.select({
      id: worldNpcProfiles.id,
      name: worldNpcProfiles.name,
    }).from(worldNpcProfiles).where(inArray(worldNpcProfiles.id, npcIds)).all()
    : [];
  const npcNameMap = new Map(npcRows.map((entry) => [entry.id, entry.name]));
  return rows.map((entry) => ({
    id: entry.id,
    npcId: entry.worldNpcId,
    npcName: npcNameMap.get(entry.worldNpcId) || "无名之人",
    title: resolveAdultHistoryTitle(entry),
    actionType: entry.actionType,
    actionLabel: resolveActionTypeLabel(entry.actionType as WorldAdultActionType),
    negotiationOutcome: entry.negotiationOutcome,
    resolutionDecision: entry.resolutionDecision,
    accepted: entry.accepted,
    status: entry.status,
    summary: resolveAdultHistorySummary(entry),
    atmosphereSummary: entry.atmosphereSummary,
    resultSummary: entry.resultSummary,
    doubleCultivation: extractWorldAdultHistoryDoubleCultivation(
      entry.payloadJson && typeof entry.payloadJson === "object"
        ? entry.payloadJson as Record<string, unknown>
        : null,
    ),
    createdAt: entry.createdAt,
  }));
}

async function createNpcAdultInvite(params: {
  playerId: string;
  context: AdultInteractionContext;
  npcAdultProfile: WorldNpcAdultProfileRow;
  actionType: WorldAdultActionType;
}) {
  const fastExistingPending = await getPendingAdultInvite(params.playerId, params.context.npcProfile.id);
  if (fastExistingPending) {
    return fastExistingPending;
  }

  const invite = await generateOpenWorldAdultInvite({
    npcName: params.context.npcProfile.name,
    mapName: params.context.map?.name || "人间一隅",
    districtName: params.context.districtName,
    actionType: params.actionType,
    dispositionLabel: String(params.npcAdultProfile.metaJson?.dispositionLabel || ""),
    moodHint: resolveActionTypeLabel(params.actionType),
  });
  const coerciveFlavorLevel = resolveAdultCoerciveFlavorLevel({
    actionType: params.actionType,
    npcCorruptionValue: params.npcAdultProfile.corruptionValue,
  });
  const forcedActions = buildAdultForcedActions({
    actionType: params.actionType,
    payloadJson: null,
    coerciveFlavorLevel,
  });

  const result = await db.transaction(async (tx) => {
    const lockKey = `world-adult-invite:${params.playerId}:${params.context.npcProfile.id}`;
    if (!(await tryAcquireWorldAdultInviteLock(tx, lockKey))) {
      return {
        row: fastExistingPending,
        created: false,
      };
    }

    const existingPending = await getPendingAdultInviteFromExecutor(
      tx,
      params.playerId,
      params.context.npcProfile.id,
    );
    if (existingPending) {
      return {
        row: existingPending,
        created: false,
      };
    }
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + WORLD_ADULT_INVITE_TTL_MS).toISOString();
    const eventLogId = crypto.randomUUID();
    const playerDisplayName = resolveAdultPlayerDisplayName(params.context.player.name);
    await tx.insert(worldAdultEventLogs).values({
      id: eventLogId,
      playerId: params.playerId,
      worldNpcId: params.context.npcProfile.id,
      mapId: params.context.npcRuntime.currentMapId,
      districtName: params.context.districtName,
      eventType: "adult_invite",
      actionType: params.actionType,
      initiatedBy: "npc",
      negotiationOutcome: "accept",
      status: "pending",
      accepted: false,
      summary: invite.summary,
      atmosphereSummary: invite.atmosphere,
      resultSummary: null,
      statChangesJson: {},
      payloadJson: {
        playerName: playerDisplayName,
        npcName: params.context.npcProfile.name,
        title: invite.title,
        inviteSummary: invite.summary,
        atmosphere: invite.atmosphere,
        responseOptions: normalizeAdultResponseOptions(
          invite.responseOptions,
          [WORLD_ADULT_RESPONSE_LABELS.accept, WORLD_ADULT_RESPONSE_LABELS.reject, WORLD_ADULT_RESPONSE_LABELS.ignore],
        ),
        coerciveFlavorLevel,
        forcedActions,
        consentRequired: true,
      },
      expiresAt,
      respondedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    }).run();
    await tx.update(worldNpcAdultProfiles).set({
      lastInviteAt: nowIso,
      updatedAt: nowIso,
    }).where(eq(worldNpcAdultProfiles.npcId, params.context.npcProfile.id)).run();

    return {
      row: {
        id: eventLogId,
        playerId: params.playerId,
        worldNpcId: params.context.npcProfile.id,
        mapId: params.context.npcRuntime.currentMapId,
        districtName: params.context.districtName,
        eventType: "adult_invite",
        actionType: params.actionType,
        initiatedBy: "npc",
        negotiationOutcome: "accept",
        resolutionDecision: null,
        status: "pending",
        accepted: false,
        summary: invite.summary,
        atmosphereSummary: invite.atmosphere,
        resultSummary: null,
        statChangesJson: {},
        payloadJson: {
          playerName: playerDisplayName,
          npcName: params.context.npcProfile.name,
          title: invite.title,
          inviteSummary: invite.summary,
          atmosphere: invite.atmosphere,
          responseOptions: invite.responseOptions,
          coerciveFlavorLevel,
          forcedActions,
          consentRequired: true,
        },
        expiresAt,
        respondedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      created: true,
    };
  });

  if (!result.created) {
    return result.row;
  }

  if (!result.row) {
    return null;
  }

  const bark = await generateOpenWorldAdultBark({
    seed: `${result.row.id}:npc-invite`,
    mapName: params.context.map?.name || "人间一隅",
    districtName: params.context.districtName,
    npcName: params.context.npcProfile.name,
    actionType: params.actionType,
    moodHint: invite.atmosphere,
  });
  await createWorldNpcNearbyChatMessage({
    mapId: params.context.npcRuntime.currentMapId,
    npcId: params.context.npcProfile.id,
    senderName: params.context.npcProfile.name,
    content: bark.content,
    districtName: params.context.districtName,
  });

  return result.row;
}

export async function listWorldAdultInvitesForMap(params: {
  playerId: string;
  mapId: string;
}) {
  if (!(await ensureOpenWorldSchema())) {
    return {
      invites: [] as WorldAdultInviteView[],
      adultDangerHints: [] as string[],
    };
  }

  const nowIso = new Date().toISOString();
  const pendingRows = await db.select().from(worldAdultEventLogs)
    .where(and(
      eq(worldAdultEventLogs.playerId, params.playerId),
      eq(worldAdultEventLogs.mapId, params.mapId),
      eq(worldAdultEventLogs.status, "pending"),
    ))
    .orderBy(desc(worldAdultEventLogs.createdAt))
    .all();

  const alivePendingRows = pendingRows.filter((entry) => !entry.expiresAt || entry.expiresAt >= nowIso);
  const finalRows = alivePendingRows;
  const npcIds = Array.from(new Set(finalRows.map((entry) => entry.worldNpcId)));
  const [npcRows, npcAdultRows] = await Promise.all([
    npcIds.length > 0
      ? db.select({
        id: worldNpcProfiles.id,
        name: worldNpcProfiles.name,
      }).from(worldNpcProfiles).where(inArray(worldNpcProfiles.id, npcIds)).all()
      : Promise.resolve([]),
    npcIds.length > 0
      ? db.select().from(worldNpcAdultProfiles).where(inArray(worldNpcAdultProfiles.npcId, npcIds)).all()
      : Promise.resolve([])
  ]);
  const npcNameMap = new Map(npcRows.map((entry) => [entry.id, entry.name]));
  const npcAdultMap = new Map(npcAdultRows.map((entry) => [entry.npcId, entry]));
  const dedupedFinalRows = Array.from(new Map(
    finalRows
      .filter((entry) => !entry.expiresAt || entry.expiresAt >= nowIso)
      .map((entry) => [entry.worldNpcId, entry]),
  ).values());
  const invites = dedupedFinalRows
    .slice(0, 2)
    .map((entry) => buildPendingInviteView(
      entry,
      npcNameMap.get(entry.worldNpcId) || "无名之人",
      npcAdultMap.get(entry.worldNpcId) || {
        npcId: entry.worldNpcId,
        desireValue: 0,
        corruptionValue: 0,
        cautionValue: 0,
        adultRoleTags: [],
        adultPreferenceTags: [],
        metaJson: {},
        lastInviteAt: null,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      },
    ));

  const adultDangerHints = invites.length > 0
    ? [
      "附近气氛有些暧昧，像有人正借风声试探你的心意。",
      invites.some((entry) => entry.actionType === "dangerous_preference" || entry.actionType === "essence_drain")
        ? "这股邀约里混着几分危险意味，接受之前最好先想清楚代价。"
        : "这类试探不会强行结算，只有你明确接受才会继续。",
    ]
    : [];

  return {
    invites,
    adultDangerHints,
  };
}

export async function listOrPrimeWorldAdultInvitesForMap(params: {
  playerId: string;
  mapId: string;
}) {
  if (!(await ensureOpenWorldSchema())) {
    return {
      invites: [] as WorldAdultInviteView[],
      adultDangerHints: [] as string[],
    };
  }

  const nowIso = new Date().toISOString();
  const pendingRows = await db.select().from(worldAdultEventLogs)
    .where(and(
      eq(worldAdultEventLogs.playerId, params.playerId),
      eq(worldAdultEventLogs.mapId, params.mapId),
      eq(worldAdultEventLogs.status, "pending"),
    ))
    .orderBy(desc(worldAdultEventLogs.createdAt))
    .all();

  const alivePendingRows = pendingRows.filter((entry) => !entry.expiresAt || entry.expiresAt >= nowIso);
  if (alivePendingRows.length < 1) {
    const player = await db.select().from(players).where(eq(players.id, params.playerId)).get();
    if (player && player.currentMapId === params.mapId) {
      const playerAdultProfile = await ensurePlayerAdultProfile(player);
      const playerAttractsDualCultivation = playerAdultProfile.corruptionValue >= 65 || playerAdultProfile.allureValue >= 60;
      const candidateRows = await db.select({
        profile: worldNpcProfiles,
        runtime: worldNpcRuntime,
        mapId: worldMapInstances.id,
        mapName: worldMapInstances.name,
        mapArchetype: worldMapInstances.archetype,
      }).from(worldNpcProfiles)
        .innerJoin(worldNpcRuntime, eq(worldNpcRuntime.npcId, worldNpcProfiles.id))
        .leftJoin(worldMapInstances, eq(worldMapInstances.id, worldNpcRuntime.currentMapId))
        .where(and(
          eq(worldNpcRuntime.currentMapId, params.mapId),
          eq(worldNpcRuntime.isActivated, true),
          eq(worldNpcProfiles.status, "active"),
        ))
        .all();

      for (const candidate of candidateRows) {
        if (candidate.runtime.occupiedByCombatId) {
          continue;
        }
        if (isWorldNpcThreatActive(candidate.runtime) && String(candidate.runtime.currentTargetId || "").trim() === params.playerId) {
          continue;
        }
        if (chebyshevDistance(player.positionX, player.positionY, candidate.runtime.positionX, candidate.runtime.positionY) > 8) {
          continue;
        }
        const npcAdultProfile = await ensureWorldNpcAdultProfile({
          npcProfile: candidate.profile,
          npcRuntime: candidate.runtime,
          map: candidate.mapId
            ? { id: candidate.mapId, name: candidate.mapName || "开放世界", archetype: candidate.mapArchetype || "开放世界" }
            : null,
        });
        if (resolveAdultInteractionBlockedReason({
          playerGender: player.gender,
          npcGender: candidate.profile.gender,
        })) {
          continue;
        }
        if (hasCooldown(npcAdultProfile.lastInviteAt, WORLD_ADULT_INVITE_COOLDOWN_MS)) {
          continue;
        }
        if (
          !playerAttractsDualCultivation
          && npcAdultProfile.desireValue < 36
          && npcAdultProfile.corruptionValue < 42
        ) {
          continue;
        }
        const shouldPrimeDualCultivation = playerAttractsDualCultivation
          && npcAdultProfile.desireValue >= 32
          && !isWorldNpcThreatActive(candidate.runtime);
        await createNpcAdultInvite({
          playerId: params.playerId,
          context: {
            player,
            npcProfile: candidate.profile,
            npcRuntime: candidate.runtime,
            map: candidate.mapId
              ? { id: candidate.mapId, name: candidate.mapName || "开放世界", archetype: candidate.mapArchetype || "开放世界" }
              : null,
            districtName: resolveOpenWorldDistrictName({
              mapId: candidate.runtime.currentMapId,
              positionX: candidate.runtime.positionX,
              positionY: candidate.runtime.positionY,
            }),
          },
          npcAdultProfile,
          actionType: shouldPrimeDualCultivation
            ? "dual_cultivation"
            : npcAdultProfile.corruptionValue >= 58
              ? "dangerous_preference"
              : "seduce_invite",
        });
        break;
      }
    }
  }
  return await listWorldAdultInvitesForMap(params);
}

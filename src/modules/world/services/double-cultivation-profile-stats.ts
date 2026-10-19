import { eq, sql as drizzleSql } from "drizzle-orm";
import { db } from "@/db";
import { playerAdultProfiles, players } from "@/db/schema";
import {
  buildFemalePregnancyDisplayStatus,
  getPlayerStatuses,
  resolvePregnancySystemConfig,
  syncPregnancyStatusFromUterusState,
} from "@/modules/character/services/player-status";
import { ensureDoubleCultivationHostLedger } from "@/modules/world/services/double-cultivation-ledger";
import type { PlayerStatusView } from "@/types/game";

const DEFAULT_SPERM_INITIAL_ML = 50;
const DEFAULT_SPERM_MAX_ML = 100;
const DEFAULT_SPERM_REGEN_TICK_MS = 10 * 60 * 1000;
const DEFAULT_SPERM_REGEN_MIN = 1;
const DEFAULT_SPERM_REGEN_MAX = 2;
const DEFAULT_UTERUS_CAPACITY_ML = 120;
const DEFAULT_UTERUS_DIGEST_SECONDS_PER_ML = 60 * 60;
const MIN_UTERUS_DIGEST_SECONDS_PER_ML = 60;

export type BuiltinDoubleCultivationGongfaBonuses = {
  xpBonusPct: number;
  intimacyBonus: number;
  maleEjaculationPct: number;
  femaleSqueezePct: number;
  maleSpermCapacityPct: number;
  maleSpermRegenPct: number;
  uterusDigestEfficiencyPct: number;
  uterusDigestSecondsReduce: number;
  maleDualAbsorbPct: number;
  sexMaxUnlocked: boolean;
};

export type BuiltinDoubleCultivationSupplementalStats = {
  gender: "男" | "女" | null;
  spermStorageMl: number | null;
  spermRecoveryRemainingSeconds: number | null;
  uterusStorageMl: number | null;
  uterusCapacityMl: number | null;
  uterusDigestUnlocked: boolean;
  uterusDigestSecondsPerMl: number | null;
  uterusDigestRemainingSeconds: number | null;
  uterusNextDigestAt: string | null;
  pregnancyStatus: PlayerStatusView | null;
  pregnancyDisplayStatus: PlayerStatusView | null;
  gongfaBonuses: BuiltinDoubleCultivationGongfaBonuses;
};

type GongfaBonusRow = {
  attr_key: string;
  total_value: number | string;
};

type SpermStorageRow = {
  storage_ml?: number | string | null;
  updated_at?: string | null;
};

type UterusStorageRow = {
  storage_ml?: number | string | null;
  capacity_ml?: number | string | null;
  updated_at?: string | null;
  last_digest_at?: string | null;
};

function pickFirstRow<T>(result: unknown) {
  if (Array.isArray(result)) {
    return (result[0] as T | undefined) || null;
  }
  if (result && typeof result === "object") {
    const maybeRows = (result as { rows?: unknown }).rows;
    if (Array.isArray(maybeRows)) {
      return (maybeRows[0] as T | undefined) || null;
    }
  }
  return null;
}

function normalizeUiGender(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "male" || normalized === "man" || normalized === "男") {
    return "男" as const;
  }
  if (normalized === "female" || normalized === "woman" || normalized === "女") {
    return "女" as const;
  }
  return null;
}

function normalizeBonusKey(value: unknown) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function sumBonusByKeys(rows: GongfaBonusRow[], candidateKeys: string[]) {
  if (!Array.isArray(rows) || rows.length < 1) {
    return 0;
  }
  const normalizedCandidates = candidateKeys.map((key) => normalizeBonusKey(key)).filter(Boolean);
  let total = 0;
  for (const row of rows) {
    const key = normalizeBonusKey(row.attr_key);
    if (!key) {
      continue;
    }
    const matched = normalizedCandidates.some((candidate) => key === candidate || key.includes(candidate));
    if (!matched) {
      continue;
    }
    const value = Number(row.total_value);
    if (!Number.isFinite(value)) {
      continue;
    }
    total += value;
  }
  return total;
}

function isMissingPluginTableError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? String((error as { code?: unknown }).code || "") : "";
  const message = "message" in error ? String((error as { message?: unknown }).message || "") : "";
  return code === "42P01" || message.toLowerCase().includes("plugin_gongfa");
}

async function getBuiltinDoubleCultivationGongfaBonuses(playerId: string): Promise<BuiltinDoubleCultivationGongfaBonuses> {
  let rows: GongfaBonusRow[] = [];
  let maxUnlockedRows: Array<{ unlocked: boolean }> = [];
  try {
    [rows, maxUnlockedRows] = await Promise.all([
      db.execute<GongfaBonusRow>(drizzleSql`
        SELECT
          i.attr_key,
          SUM(i.attr_value) AS total_value
        FROM plugin_gongfa_player_progress p
        JOIN plugin_gongfa_books b
          ON b.id = p.gongfa_id
        JOIN plugin_gongfa_book_levels l
          ON l.gongfa_id = p.gongfa_id
          AND l.enabled = true
          AND l.level_index <= p.level
        JOIN plugin_gongfa_level_bonus_items i
          ON i.gongfa_id = l.gongfa_id
          AND i.level_index = l.level_index
          AND i.enabled = true
        WHERE p.player_id = ${playerId}
          AND b.enabled = true
          AND b.gongfa_type = 'sex'
        GROUP BY i.attr_key
      `),
      db.execute<{ unlocked: boolean }>(drizzleSql`
        SELECT EXISTS (
          SELECT 1
          FROM plugin_gongfa_player_progress p
          JOIN plugin_gongfa_books b
            ON b.id = p.gongfa_id
          WHERE p.player_id = ${playerId}
            AND b.enabled = true
            AND b.gongfa_type = 'sex'
            AND p.level >= b.max_level
        ) AS unlocked
      `),
    ]);
  } catch (error) {
    if (!isMissingPluginTableError(error)) {
      throw error;
    }
  }

  const xpBonusPct = sumBonusByKeys(rows, [
    "dc_dual_xp_pct",
    "double_cultivation_xp_rate_pct",
    "double_cultivation_xp_rate",
    "doublecultivationxprate",
    "双修修为提升倍率",
    "双修修为增幅",
  ]);
  const intimacyBonus = sumBonusByKeys(rows, [
    "dc_intimacy_bonus",
    "intimacy_bonus",
    "intimacy",
    "淫乱度增幅",
    "亲密度增幅",
  ]);
  const maleEjaculationPct = sumBonusByKeys(rows, [
    "dc_male_ejaculation_pct",
    "male_ejaculation_pct",
    "maleejaculationpct",
    "男性射精量增幅",
  ]);
  const femaleSqueezePct = sumBonusByKeys(rows, [
    "dc_female_squeeze_pct",
    "female_squeeze_pct",
    "femalesqueezepct",
    "女修榨精增幅",
  ]);
  const maleSpermCapacityPct = sumBonusByKeys(rows, [
    "dc_male_sperm_capacity_pct",
    "male_sperm_capacity_pct",
    "malespermcapacitypct",
    "男性精液容量增幅",
  ]);
  const maleSpermRegenPct = sumBonusByKeys(rows, [
    "dc_male_sperm_regen_pct",
    "male_sperm_regen_pct",
    "malespermregenpct",
    "男性精液恢复增幅",
  ]);
  const uterusDigestEfficiencyPct = sumBonusByKeys(rows, [
    "dc_uterus_digest_efficiency_pct",
    "uterus_digest_efficiency_pct",
    "uterusdigestefficiencypct",
    "子宫精液转化效率增幅",
    "子宫转化效率增幅",
    "子宫转化效率",
  ]);
  const uterusDigestSecondsReduce = sumBonusByKeys(rows, [
    "dc_uterus_digest_sec_reduce",
    "uterus_digest_sec_reduce",
    "uterusdigestsecreduce",
    "子宫消化减秒",
  ]);
  const maleDualAbsorbPct = sumBonusByKeys(rows, [
    "dc_male_dual_absorb_pct",
    "male_dual_absorb_pct",
    "maledualabsorbpct",
    "男性互补吸收增幅",
  ]);

  return {
    xpBonusPct: Number(xpBonusPct.toFixed(4)),
    intimacyBonus: Number(intimacyBonus.toFixed(4)),
    maleEjaculationPct: Number(maleEjaculationPct.toFixed(4)),
    femaleSqueezePct: Number(femaleSqueezePct.toFixed(4)),
    maleSpermCapacityPct: Number(maleSpermCapacityPct.toFixed(4)),
    maleSpermRegenPct: Number(maleSpermRegenPct.toFixed(4)),
    uterusDigestEfficiencyPct: Number(uterusDigestEfficiencyPct.toFixed(4)),
    uterusDigestSecondsReduce: Number(uterusDigestSecondsReduce.toFixed(4)),
    maleDualAbsorbPct: Number(maleDualAbsorbPct.toFixed(4)),
    sexMaxUnlocked: Boolean(maxUnlockedRows?.[0]?.unlocked),
  };
}

function resolveUterusDigestSecondsPerMl(
  bonus: Pick<BuiltinDoubleCultivationGongfaBonuses, "uterusDigestSecondsReduce" | "sexMaxUnlocked">,
) {
  if (!bonus.sexMaxUnlocked) {
    return null;
  }
  const reducedSeconds = Math.max(0, Math.floor(Number(bonus.uterusDigestSecondsReduce || 0)));
  return Math.max(MIN_UTERUS_DIGEST_SECONDS_PER_ML, DEFAULT_UTERUS_DIGEST_SECONDS_PER_ML - reducedSeconds);
}

function clampInt(value: unknown, fallback: number, min?: number, max?: number) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) {
    return fallback;
  }
  let out = n;
  if (min !== undefined) {
    out = Math.max(min, out);
  }
  if (max !== undefined) {
    out = Math.min(max, out);
  }
  return out;
}

function calcRegenAmount(params: {
  lastUpdated: string;
  nowIso: string;
  currentStorage: number;
  maxStorage: number;
  tickMs: number;
  regenMin: number;
  regenMax: number;
}) {
  const lastMs = Date.parse(params.lastUpdated || params.nowIso) || Date.now();
  const nowMs = Date.parse(params.nowIso) || Date.now();
  const diffMs = Math.max(0, nowMs - lastMs);
  const safeTickMs = Math.max(60_000, Math.floor(Number(params.tickMs) || 60_000));
  const ticksRaw = Math.floor(diffMs / safeTickMs);
  const currentStorage = Math.max(0, Math.floor(Number(params.currentStorage) || 0));
  const maxStorage = Math.max(0, Math.floor(Number(params.maxStorage) || 0));
  if (ticksRaw <= 0 || currentStorage >= maxStorage) {
    return { storageMl: Math.min(currentStorage, maxStorage), updatedAt: params.lastUpdated || params.nowIso };
  }

  const regenMin = Math.max(0, Math.floor(Number(params.regenMin) || 0));
  const regenMax = Math.max(regenMin, Math.floor(Number(params.regenMax) || 0));
  if (regenMax <= 0) {
    return { storageMl: Math.min(currentStorage, maxStorage), updatedAt: params.lastUpdated || params.nowIso };
  }

  const remaining = Math.max(0, Math.floor(maxStorage - currentStorage));
  const ticksCap = regenMax > 0 ? Math.ceil(remaining / regenMax) : ticksRaw;
  const ticks = Math.max(0, Math.min(ticksRaw, ticksCap));

  let regen = 0;
  for (let i = 0; i < ticks; i += 1) {
    if (regenMax <= regenMin) {
      regen += regenMin;
      continue;
    }
    regen += regenMin + Math.floor(Math.random() * (regenMax - regenMin + 1));
  }

  const newStorage = Math.min(maxStorage, currentStorage + regen);
  return { storageMl: newStorage, updatedAt: params.nowIso };
}

async function getBuiltinSpermStorageState(params: {
  playerId: string;
  nowIso: string;
  gongfaBonuses: BuiltinDoubleCultivationGongfaBonuses;
}) {
  const capacityMultiplier = 1 + Math.max(0, Number(params.gongfaBonuses.maleSpermCapacityPct || 0)) / 100;
  const regenMultiplier = 1 + Math.max(0, Number(params.gongfaBonuses.maleSpermRegenPct || 0)) / 100;
  const maxMl = Math.max(1, Math.floor(DEFAULT_SPERM_MAX_ML * capacityMultiplier));
  const regenPerTickMin = Math.max(0, Math.floor(DEFAULT_SPERM_REGEN_MIN * regenMultiplier));
  const regenPerTickMax = Math.max(
    regenPerTickMin,
    Math.floor(DEFAULT_SPERM_REGEN_MAX * regenMultiplier),
  );
  const nowMs = Date.parse(params.nowIso) || Date.now();

  const row = pickFirstRow<SpermStorageRow>(await db.execute(drizzleSql`
    SELECT "storage_ml", "updated_at"
    FROM "player_double_cultivation_sperm"
    WHERE "player_id" = ${params.playerId}
    LIMIT 1
  `));

  if (!row) {
    await db.execute(drizzleSql`
      INSERT INTO "player_double_cultivation_sperm" ("player_id", "storage_ml", "updated_at")
      VALUES (${params.playerId}, ${DEFAULT_SPERM_INITIAL_ML}, ${params.nowIso})
      ON CONFLICT ("player_id") DO NOTHING
    `);
    return {
      storageMl: DEFAULT_SPERM_INITIAL_ML,
      recoveryRemainingSeconds: Math.floor(DEFAULT_SPERM_REGEN_TICK_MS / 1000),
    };
  }

  const previousStorage = Math.max(0, Math.floor(Number(row.storage_ml) || 0));
  const { storageMl, updatedAt } = calcRegenAmount({
    lastUpdated: String(row.updated_at || params.nowIso),
    nowIso: params.nowIso,
    currentStorage: previousStorage,
    maxStorage: maxMl,
    tickMs: DEFAULT_SPERM_REGEN_TICK_MS,
    regenMin: regenPerTickMin,
    regenMax: regenPerTickMax,
  });

  let effectiveUpdatedAt = String(row.updated_at || params.nowIso);
  if (storageMl !== previousStorage || updatedAt !== row.updated_at) {
    await db.execute(drizzleSql`
      UPDATE "player_double_cultivation_sperm"
      SET
        "storage_ml" = ${storageMl},
        "updated_at" = ${updatedAt}
      WHERE "player_id" = ${params.playerId}
    `);
    effectiveUpdatedAt = updatedAt;
  }

  const nextRecoveryAt = Date.parse(effectiveUpdatedAt) + DEFAULT_SPERM_REGEN_TICK_MS;
  return {
    storageMl,
    recoveryRemainingSeconds: Math.max(0, Math.floor((nextRecoveryAt - nowMs) / 1000)),
  };
}

function previewUterusDigest(params: {
  row: UterusStorageRow | null;
  nowIso: string;
  digestUnlocked: boolean;
  digestSecondsPerMl: number | null;
}) {
  const state = {
    storageMl: clampInt(params.row?.storage_ml, 0, 0),
    capacityMl: clampInt(params.row?.capacity_ml, DEFAULT_UTERUS_CAPACITY_ML, 1),
    updatedAt: String(params.row?.updated_at || params.nowIso),
    lastDigestAt: params.row?.last_digest_at ? String(params.row.last_digest_at) : null,
  };

  if (!params.digestUnlocked || !params.digestSecondsPerMl) {
    return {
      storageMl: state.storageMl,
      capacityMl: state.capacityMl,
      digestRemainingSeconds: null,
      nextDigestAt: null,
    };
  }

  if (!state.lastDigestAt) {
    const nextDigestAt = state.storageMl > 0
      ? new Date((Date.parse(state.updatedAt) || Date.now()) + params.digestSecondsPerMl * 1000).toISOString()
      : null;
    return {
      storageMl: state.storageMl,
      capacityMl: state.capacityMl,
      digestRemainingSeconds: nextDigestAt
        ? Math.max(0, Math.floor((Date.parse(nextDigestAt) - (Date.parse(params.nowIso) || Date.now())) / 1000))
        : null,
      nextDigestAt,
    };
  }

  const lastDigestMs = Date.parse(state.lastDigestAt) || Date.parse(params.nowIso) || Date.now();
  const nowMs = Date.parse(params.nowIso) || Date.now();
  const intervalMs = params.digestSecondsPerMl * 1000;
  const digestedMl = state.storageMl > 0
    ? Math.max(0, Math.min(state.storageMl, Math.floor((nowMs - lastDigestMs) / intervalMs)))
    : 0;
  const effectiveStorageMl = digestedMl > 0
    ? Math.max(0, state.storageMl - digestedMl)
    : state.storageMl;
  const effectiveLastDigestAt = digestedMl > 0
    ? (effectiveStorageMl > 0 ? new Date(lastDigestMs + digestedMl * intervalMs).toISOString() : params.nowIso)
    : state.lastDigestAt;
  const nextDigestAt = effectiveStorageMl > 0 && effectiveLastDigestAt
    ? new Date((Date.parse(effectiveLastDigestAt) || nowMs) + intervalMs).toISOString()
    : null;

  return {
    storageMl: effectiveStorageMl,
    capacityMl: state.capacityMl,
    digestRemainingSeconds: nextDigestAt
      ? Math.max(0, Math.floor((Date.parse(nextDigestAt) - nowMs) / 1000))
      : null,
    nextDigestAt,
  };
}

export async function getBuiltinDoubleCultivationSupplementalStats(params: {
  playerId: string;
  gender?: unknown;
}): Promise<BuiltinDoubleCultivationSupplementalStats> {
  await ensureDoubleCultivationHostLedger();

  const normalizedGender = normalizeUiGender(params.gender);
  const nowIso = new Date().toISOString();
  const gongfaBonuses = await getBuiltinDoubleCultivationGongfaBonuses(params.playerId);

  if (normalizedGender === "男") {
    const spermState = await getBuiltinSpermStorageState({
      playerId: params.playerId,
      nowIso,
      gongfaBonuses,
    });
    return {
      gender: normalizedGender,
      spermStorageMl: spermState.storageMl,
      spermRecoveryRemainingSeconds: spermState.recoveryRemainingSeconds,
      uterusStorageMl: null,
      uterusCapacityMl: null,
      uterusDigestUnlocked: false,
      uterusDigestSecondsPerMl: null,
      uterusDigestRemainingSeconds: null,
      uterusNextDigestAt: null,
      pregnancyStatus: null,
      pregnancyDisplayStatus: null,
      gongfaBonuses,
    };
  }

  if (normalizedGender !== "女") {
    return {
      gender: normalizedGender,
      spermStorageMl: null,
      spermRecoveryRemainingSeconds: null,
      uterusStorageMl: null,
      uterusCapacityMl: null,
      uterusDigestUnlocked: false,
      uterusDigestSecondsPerMl: null,
      uterusDigestRemainingSeconds: null,
      uterusNextDigestAt: null,
      pregnancyStatus: null,
      pregnancyDisplayStatus: null,
      gongfaBonuses,
    };
  }

  const uterusRow = pickFirstRow<UterusStorageRow>(await db.execute(drizzleSql`
    SELECT "storage_ml", "capacity_ml", "updated_at", "last_digest_at"
    FROM "player_double_cultivation_uterus"
    WHERE "player_id" = ${params.playerId}
    LIMIT 1
  `));
  const uterusDigestUnlocked = Boolean(gongfaBonuses.sexMaxUnlocked);
  const uterusDigestSecondsPerMl = resolveUterusDigestSecondsPerMl(gongfaBonuses);
  const uterusState = previewUterusDigest({
    row: uterusRow,
    nowIso,
    digestUnlocked: uterusDigestUnlocked,
    digestSecondsPerMl: uterusDigestSecondsPerMl,
  });

  const pregnancyConfig = await resolvePregnancySystemConfig();
  const syncedPregnancy = await syncPregnancyStatusFromUterusState({
    femalePlayerId: params.playerId,
    uterusStorageMl: uterusState.storageMl,
    uterusCapacityMl: uterusState.capacityMl,
    absorbedMl: 0,
    sourceType: "double_cultivation_status_sync",
    sourcePluginId: "double-cultivation",
  });
  const mergedStatuses = syncedPregnancy?.pregnancyStatus
    ? [
      ...(await getPlayerStatuses(params.playerId, { skipSync: true })).filter(
        (item) => item.statusKey !== pregnancyConfig.statusKey,
      ),
      syncedPregnancy.pregnancyStatus,
    ]
    : await getPlayerStatuses(params.playerId);
  const pregnancyStatus = mergedStatuses.find((item) => item.statusKey === pregnancyConfig.statusKey) || null;
  const pregnancyDisplayStatus = pregnancyStatus || buildFemalePregnancyDisplayStatus(pregnancyConfig);

  return {
    gender: normalizedGender,
    spermStorageMl: null,
    spermRecoveryRemainingSeconds: null,
    uterusStorageMl: uterusState.storageMl,
    uterusCapacityMl: uterusState.capacityMl,
    uterusDigestUnlocked,
    uterusDigestSecondsPerMl,
    uterusDigestRemainingSeconds: uterusState.digestRemainingSeconds,
    uterusNextDigestAt: uterusState.nextDigestAt,
    pregnancyStatus,
    pregnancyDisplayStatus,
    gongfaBonuses,
  };
}

export async function getBuiltinDoubleCultivationAdultProfile(params: {
  playerId: string;
  intimacyScore: number;
}) {
  const [profileRow, playerRow] = await Promise.all([
    db.select({
      corruptionValue: playerAdultProfiles.corruptionValue,
      allureValue: playerAdultProfiles.allureValue,
      shameValue: playerAdultProfiles.shameValue,
    }).from(playerAdultProfiles).where(eq(playerAdultProfiles.playerId, params.playerId)).get(),
    db.select({
      speed: players.speed,
      luck: players.luck,
    }).from(players).where(eq(players.id, params.playerId)).get(),
  ]);

  const corruptionValue = Math.max(
    0,
    Math.floor(Number(profileRow?.corruptionValue ?? Math.floor(params.intimacyScore / 4))),
  );
  return {
    corruptionValue,
    allureValue: Math.max(
      0,
      Math.floor(
        Number(profileRow?.allureValue ?? Math.floor(((playerRow?.luck || 0) + (playerRow?.speed || 0)) / 2)),
      ),
    ),
    shameValue: Math.max(
      0,
      Math.floor(Number(profileRow?.shameValue ?? (82 - Math.floor(params.intimacyScore / 8)))),
    ),
    stageLabel: corruptionValue >= 75 ? "欲念偏深" : corruptionValue >= 45 ? "心防渐松" : "仍守边界",
  };
}

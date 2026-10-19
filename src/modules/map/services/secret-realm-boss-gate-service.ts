import type {
  SecretRealmBossGateStatus,
  SecretRealmRunSummary,
  TileData,
} from "@/types/game";

function buildTileKey(tile: Pick<TileData, "x" | "y">) {
  return `${tile.x},${tile.y}`;
}

export function resolveSecretRealmBossGateRule(params: {
  width: number;
  height: number;
  specialType?: string | null;
}) {
  if (params.specialType === "wild_wolf_valley" || (params.width >= 80 && params.height >= 80)) {
    return {
      guardRequired: 4,
    };
  }
  if (params.width > 32 || params.height > 32) {
    return {
      guardRequired: 3,
    };
  }
  return {
    guardRequired: 2,
  };
}

export function createInitialSecretRealmBossGateStatus(params: {
  width: number;
  height: number;
  totalNonBossMonsterCount: number;
  guardMonsterIds: string[];
  sealedDoorTiles: TileData[];
  specialType?: string | null;
}) {
  const rule = resolveSecretRealmBossGateRule(params);
  const guardRequired = Math.max(0, Math.min(rule.guardRequired, params.guardMonsterIds.length));
  const totalNonBossMonsterCount = Math.max(0, Math.floor(Number(params.totalNonBossMonsterCount) || 0));
  const clearRequired = totalNonBossMonsterCount > 0
    ? Math.floor(totalNonBossMonsterCount / 2) + 1
    : 0;

  return {
    isUnlocked: false,
    guardRequired,
    guardDefeated: 0,
    totalNonBossMonsterCount,
    clearRequired,
    clearDefeated: 0,
    remainingGuardCount: guardRequired,
    remainingClearCount: clearRequired,
    guardMonsterIds: [...params.guardMonsterIds],
    defeatedGuardMonsterIds: [],
    sealedDoorTiles: params.sealedDoorTiles.map((tile) => ({ ...tile })),
    unlockedAt: null,
  } satisfies SecretRealmBossGateStatus;
}

export function normalizeSecretRealmBossGateStatus(value: SecretRealmRunSummary["bossGate"]): SecretRealmBossGateStatus | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const guardMonsterIds = Array.isArray(value.guardMonsterIds)
    ? value.guardMonsterIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const defeatedGuardMonsterIds = Array.isArray(value.defeatedGuardMonsterIds)
    ? value.defeatedGuardMonsterIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const totalNonBossMonsterCount = Math.max(0, Number(value.totalNonBossMonsterCount || 0));
  const clearRequired = Math.max(0, Number(value.clearRequired || 0));
  const clearDefeated = Math.max(0, Number(value.clearDefeated || 0));
  const guardRequired = Math.max(guardMonsterIds.length, Math.max(0, Number(value.guardRequired || 0)));
  const guardDefeated = Math.min(guardRequired, Math.max(defeatedGuardMonsterIds.length, Math.max(0, Number(value.guardDefeated || 0))));
  const isUnlocked = Boolean(value.isUnlocked) || guardDefeated >= guardRequired || clearDefeated >= clearRequired;

  return {
    isUnlocked,
    guardRequired,
    guardDefeated,
    totalNonBossMonsterCount,
    clearRequired,
    clearDefeated,
    remainingGuardCount: Math.max(0, guardRequired - guardDefeated),
    remainingClearCount: Math.max(0, clearRequired - clearDefeated),
    guardMonsterIds,
    defeatedGuardMonsterIds,
    sealedDoorTiles: Array.isArray(value.sealedDoorTiles)
      ? value.sealedDoorTiles
        .filter((tile): tile is TileData => Boolean(tile && typeof tile === "object" && !Array.isArray(tile)))
        .map((tile) => ({ ...tile }))
      : [],
    unlockedAt: typeof value.unlockedAt === "string" ? value.unlockedAt : null,
  };
}

export function isSecretRealmBossGateGuard(summary: SecretRealmRunSummary | null | undefined, monsterId: string) {
  const gate = normalizeSecretRealmBossGateStatus(summary?.bossGate || null);
  if (!gate) {
    return false;
  }
  return gate.guardMonsterIds?.includes(monsterId) || false;
}

export function recordSecretRealmBossGateMonsterDefeat(params: {
  summary: SecretRealmRunSummary;
  monsterId: string;
  defeatedMonsterIds: string[];
  nowIso: string;
}) {
  const gate = normalizeSecretRealmBossGateStatus(params.summary.bossGate || null);
  if (!gate || gate.isUnlocked) {
    return {
      nextSummary: params.summary,
      bossGate: gate,
      unlockedNow: false,
    };
  }

  const defeatedGuardMonsterIds = gate.guardMonsterIds?.includes(params.monsterId)
    ? Array.from(new Set([...(gate.defeatedGuardMonsterIds || []), params.monsterId]))
    : [...(gate.defeatedGuardMonsterIds || [])];

  const nextGate: SecretRealmBossGateStatus = {
    ...gate,
    guardDefeated: Math.min(gate.guardRequired, defeatedGuardMonsterIds.length),
    defeatedGuardMonsterIds,
    clearDefeated: Math.min(gate.clearRequired, params.defeatedMonsterIds.length),
  };
  nextGate.isUnlocked = nextGate.guardDefeated >= nextGate.guardRequired || nextGate.clearDefeated >= nextGate.clearRequired;
  nextGate.remainingGuardCount = Math.max(0, nextGate.guardRequired - nextGate.guardDefeated);
  nextGate.remainingClearCount = Math.max(0, nextGate.clearRequired - nextGate.clearDefeated);
  if (nextGate.isUnlocked && !nextGate.unlockedAt) {
    nextGate.unlockedAt = params.nowIso;
  }

  return {
    nextSummary: {
      ...params.summary,
      bossGate: nextGate,
    } satisfies SecretRealmRunSummary,
    bossGate: nextGate,
    unlockedNow: nextGate.isUnlocked && !gate.isUnlocked,
  };
}

export function unlockSecretRealmBossGateDoors(params: {
  tilesData: TileData[];
  gate: SecretRealmBossGateStatus | null;
}) {
  const gate = normalizeSecretRealmBossGateStatus(params.gate);
  if (!gate || !gate.isUnlocked || !Array.isArray(gate.sealedDoorTiles) || gate.sealedDoorTiles.length === 0) {
    return params.tilesData;
  }

  const sealedMap = new Map(gate.sealedDoorTiles.map((tile) => [buildTileKey(tile), tile]));
  return params.tilesData.map((tile) => {
    const restored = sealedMap.get(buildTileKey(tile));
    return restored ? { ...restored } : tile;
  });
}

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  hongmengTreasureConfigs,
  items,
  playerHongmengTreasures,
  playerInventory,
  type HongmengTreasureStarConfig,
  type HongmengTreasureUpgradeCost,
} from "@/db/schema";

function normalizePositiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const n = Math.floor(parsed);
  if (n <= 0) {
    return fallback;
  }
  return n;
}

function parseUpdatedAtMs(updatedAt: string | null | undefined, nowMs: number) {
  const parsed = Date.parse(updatedAt || "");
  if (Number.isNaN(parsed)) {
    return nowMs;
  }
  return parsed;
}

function resolveStarConfig(
  configs: HongmengTreasureStarConfig[] | null | undefined,
  star: number,
): { energyCap: number; regenSecondsPerEnergy: number } {
  const list = Array.isArray(configs) ? configs : [];
  const matched = list.find((item) => Number(item?.star) === star) || null;
  const energyCap = normalizePositiveInt(matched?.energyCap, 200);
  const regenSecondsPerEnergy = normalizePositiveInt(matched?.regenSecondsPerEnergy, 8 * 60);
  return { energyCap, regenSecondsPerEnergy };
}

export function recoverHongmengTreasureEnergySnapshot(params: {
  energy: number;
  energyUpdatedAt: string | null | undefined;
  energyCap: number;
  regenSecondsPerEnergy: number;
  nowMs?: number;
}) {
  const nowMs = params.nowMs ?? Date.now();
  const energyCap = Math.max(0, Math.floor(params.energyCap));
  const regenSecondsPerEnergy = normalizePositiveInt(params.regenSecondsPerEnergy, 8 * 60);
  const regenMs = regenSecondsPerEnergy * 1000;

  const current = Math.max(0, Math.min(energyCap, Math.floor(Number(params.energy) || 0)));
  const previousUpdatedAt = typeof params.energyUpdatedAt === "string" && params.energyUpdatedAt
    ? params.energyUpdatedAt
    : new Date(nowMs).toISOString();
  const lastMs = parseUpdatedAtMs(params.energyUpdatedAt, nowMs);

  if (current >= energyCap) {
    if (nowMs - lastMs < regenMs) {
      return {
        energy: energyCap,
        energyUpdatedAt: previousUpdatedAt,
        changed: current !== params.energy,
        nextRegenInSeconds: null as number | null,
      };
    }
    return {
      energy: energyCap,
      energyUpdatedAt: new Date(nowMs).toISOString(),
      changed: true,
      nextRegenInSeconds: null as number | null,
    };
  }

  const elapsedMs = Math.max(0, nowMs - lastMs);
  const recoverSteps = Math.floor(elapsedMs / regenMs);
  const recoveredEnergy = recoverSteps > 0
    ? Math.min(energyCap, current + recoverSteps)
    : current;
  const nextUpdatedAt = recoverSteps <= 0
    ? previousUpdatedAt
    : (recoveredEnergy >= energyCap
      ? new Date(nowMs).toISOString()
      : new Date(lastMs + recoverSteps * regenMs).toISOString());

  const nextRegenInSeconds = recoveredEnergy >= energyCap
    ? null
    : Math.max(1, Math.ceil((regenMs - (Math.max(0, nowMs - parseUpdatedAtMs(nextUpdatedAt, nowMs)) % regenMs)) / 1000));

  return {
    energy: recoveredEnergy,
    energyUpdatedAt: nextUpdatedAt,
    changed: recoveredEnergy !== current || nextUpdatedAt !== previousUpdatedAt,
    nextRegenInSeconds,
  };
}

export type PlayerHongmengTreasureState = {
  itemId: string;
  itemName: string;
  star: number;
  energy: number;
  energyCap: number;
  regenSecondsPerEnergy: number;
  nextRegenInSeconds: number | null;
  spiritualFieldEnergyCost: number;
  spiritualFieldReduceSeconds: number;
  maxStar: number;
};

type HongmengTreasureConfigRow = {
  itemId: string;
  enabled: boolean;
  maxStar: number;
  starConfigs: HongmengTreasureStarConfig[] | null;
  spiritualFieldEnergyCost: number;
  spiritualFieldReduceSeconds: number;
  itemName: string;
};

async function selectHongmengTreasureConfigs(itemIds?: string[]): Promise<HongmengTreasureConfigRow[]> {
  const normalizedItemIds = Array.from(new Set(
    (Array.isArray(itemIds) ? itemIds : [])
      .map((itemId) => String(itemId || "").trim())
      .filter(Boolean),
  ));

  const filters = [eq(hongmengTreasureConfigs.enabled, true)];
  if (normalizedItemIds.length > 0) {
    filters.push(inArray(hongmengTreasureConfigs.itemId, normalizedItemIds));
  }

  return db.select({
    itemId: hongmengTreasureConfigs.itemId,
    enabled: hongmengTreasureConfigs.enabled,
    maxStar: hongmengTreasureConfigs.maxStar,
    starConfigs: hongmengTreasureConfigs.starConfigs,
    spiritualFieldEnergyCost: hongmengTreasureConfigs.spiritualFieldEnergyCost,
    spiritualFieldReduceSeconds: hongmengTreasureConfigs.spiritualFieldReduceSeconds,
    itemName: items.name,
  })
    .from(hongmengTreasureConfigs)
    .innerJoin(items, eq(hongmengTreasureConfigs.itemId, items.id))
    .where(and(...filters))
    .all();
}

async function ensurePlayerTreasureRow(params: {
  playerId: string;
  itemId: string;
  starConfigs: HongmengTreasureStarConfig[] | null | undefined;
}): Promise<{
  itemId: string;
  star: number;
  energy: number;
  energyUpdatedAt: string;
}> {
  const nowIso = new Date().toISOString();
  const existing = await db.select({
    itemId: playerHongmengTreasures.itemId,
    star: playerHongmengTreasures.star,
    energy: playerHongmengTreasures.energy,
    energyUpdatedAt: playerHongmengTreasures.energyUpdatedAt,
  })
    .from(playerHongmengTreasures)
    .where(and(
      eq(playerHongmengTreasures.playerId, params.playerId),
      eq(playerHongmengTreasures.itemId, params.itemId),
    ))
    .get();

  if (existing) {
    return {
      itemId: existing.itemId,
      star: existing.star,
      energy: existing.energy,
      energyUpdatedAt: existing.energyUpdatedAt || nowIso,
    };
  }

  const { energyCap } = resolveStarConfig(params.starConfigs, 0);
  await db.insert(playerHongmengTreasures).values({
    playerId: params.playerId,
    itemId: params.itemId,
    star: 0,
    energy: energyCap,
    energyUpdatedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  }).run();

  return {
    itemId: params.itemId,
    star: 0,
    energy: energyCap,
    energyUpdatedAt: nowIso,
  };
}

export async function getPlayerHongmengTreasureStateByItemId(params: {
  playerId: string;
  itemId: string;
}): Promise<PlayerHongmengTreasureState | null> {
  const states = await getPlayerHongmengTreasureStateMap({
    playerId: params.playerId,
    itemIds: [params.itemId],
  });
  return states[params.itemId] ?? null;
}

export async function getPlayerHongmengTreasureStateMap(params: {
  playerId: string;
  itemIds?: string[];
}): Promise<Record<string, PlayerHongmengTreasureState>> {
  const configs = await selectHongmengTreasureConfigs(params.itemIds);
  if (configs.length === 0) {
    return {};
  }

  const configItemIds = configs.map((config) => config.itemId);
  const inventoryRows = await db.select({
    itemId: playerInventory.itemId,
    quantity: playerInventory.quantity,
  })
    .from(playerInventory)
    .where(and(
      eq(playerInventory.playerId, params.playerId),
      inArray(playerInventory.itemId, configItemIds),
    ))
    .all();

  const ownedItemIds = inventoryRows
    .filter((row) => Number(row.quantity || 0) > 0)
    .map((row) => row.itemId);
  if (ownedItemIds.length === 0) {
    return {};
  }

  const ownedSet = new Set(ownedItemIds);
  const activeConfigs = configs.filter((config) => ownedSet.has(config.itemId));
  const treasureRows = await db.select({
    itemId: playerHongmengTreasures.itemId,
    star: playerHongmengTreasures.star,
    energy: playerHongmengTreasures.energy,
    energyUpdatedAt: playerHongmengTreasures.energyUpdatedAt,
  })
    .from(playerHongmengTreasures)
    .where(and(
      eq(playerHongmengTreasures.playerId, params.playerId),
      inArray(playerHongmengTreasures.itemId, ownedItemIds),
    ))
    .all();

  const rowMap = new Map(treasureRows.map((row) => [row.itemId, row]));
  const result: Record<string, PlayerHongmengTreasureState> = {};

  for (const config of activeConfigs) {
    let row = rowMap.get(config.itemId);
    if (!row) {
      row = await ensurePlayerTreasureRow({
        playerId: params.playerId,
        itemId: config.itemId,
        starConfigs: config.starConfigs,
      });
      rowMap.set(config.itemId, {
        itemId: config.itemId,
        star: row.star,
        energy: row.energy,
        energyUpdatedAt: row.energyUpdatedAt,
      });
    }

    const star = Math.max(0, Math.floor(Number(row.star) || 0));
    const { energyCap, regenSecondsPerEnergy } = resolveStarConfig(config.starConfigs, star);
    const nowIso = new Date().toISOString();
    const recovered = recoverHongmengTreasureEnergySnapshot({
      energy: Number(row.energy || 0),
      energyUpdatedAt: row.energyUpdatedAt,
      energyCap,
      regenSecondsPerEnergy,
    });

    if (recovered.changed) {
      await db.update(playerHongmengTreasures).set({
        energy: recovered.energy,
        energyUpdatedAt: recovered.energyUpdatedAt,
        updatedAt: nowIso,
      }).where(and(
        eq(playerHongmengTreasures.playerId, params.playerId),
        eq(playerHongmengTreasures.itemId, config.itemId),
      )).run();
    }

    result[config.itemId] = {
      itemId: config.itemId,
      itemName: config.itemName,
      star,
      energy: recovered.energy,
      energyCap,
      regenSecondsPerEnergy,
      nextRegenInSeconds: recovered.nextRegenInSeconds,
      spiritualFieldEnergyCost: Number(config.spiritualFieldEnergyCost ?? 60),
      spiritualFieldReduceSeconds: Number(config.spiritualFieldReduceSeconds ?? 3600),
      maxStar: Number(config.maxStar ?? 5),
    };
  }

  return result;
}

export async function getPlayerFirstEnabledHongmengTreasureState(playerId: string): Promise<PlayerHongmengTreasureState | null> {
  const configs = await db.select({
    itemId: hongmengTreasureConfigs.itemId,
    enabled: hongmengTreasureConfigs.enabled,
    maxStar: hongmengTreasureConfigs.maxStar,
    starConfigs: hongmengTreasureConfigs.starConfigs,
    spiritualFieldEnergyCost: hongmengTreasureConfigs.spiritualFieldEnergyCost,
    spiritualFieldReduceSeconds: hongmengTreasureConfigs.spiritualFieldReduceSeconds,
    itemName: items.name,
  })
    .from(hongmengTreasureConfigs)
    .innerJoin(items, eq(hongmengTreasureConfigs.itemId, items.id))
    .where(eq(hongmengTreasureConfigs.enabled, true))
    .all();

  if (configs.length === 0) {
    return null;
  }

  const itemIds = configs.map((row) => row.itemId);
  const inventory = await db.select({
    itemId: playerInventory.itemId,
    quantity: playerInventory.quantity,
  })
    .from(playerInventory)
    .where(and(
      eq(playerInventory.playerId, playerId),
      inArray(playerInventory.itemId, itemIds),
    ))
    .all();

  const ownedSet = new Set(inventory.filter((row) => Number(row.quantity || 0) > 0).map((row) => row.itemId));
  const config = configs.find((row) => ownedSet.has(row.itemId)) || null;
  if (!config) {
    return null;
  }

  const row = await ensurePlayerTreasureRow({
    playerId,
    itemId: config.itemId,
    starConfigs: config.starConfigs,
  });

  const nowIso = new Date().toISOString();
  const star = Math.max(0, Math.floor(Number(row.star) || 0));
  const { energyCap, regenSecondsPerEnergy } = resolveStarConfig(config.starConfigs, star);
  const recovered = recoverHongmengTreasureEnergySnapshot({
    energy: Number(row.energy || 0),
    energyUpdatedAt: row.energyUpdatedAt,
    energyCap,
    regenSecondsPerEnergy,
  });

  if (recovered.changed) {
    await db.update(playerHongmengTreasures).set({
      energy: recovered.energy,
      energyUpdatedAt: recovered.energyUpdatedAt,
      updatedAt: nowIso,
    }).where(and(
      eq(playerHongmengTreasures.playerId, playerId),
      eq(playerHongmengTreasures.itemId, config.itemId),
    )).run();
  }

  return {
    itemId: config.itemId,
    itemName: config.itemName,
    star,
    energy: recovered.energy,
    energyCap,
    regenSecondsPerEnergy,
    nextRegenInSeconds: recovered.nextRegenInSeconds,
    spiritualFieldEnergyCost: Number(config.spiritualFieldEnergyCost ?? 60),
    spiritualFieldReduceSeconds: Number(config.spiritualFieldReduceSeconds ?? 3600),
    maxStar: Number(config.maxStar ?? 5),
  };
}

export async function upgradeHongmengTreasureStar(params: {
  playerId: string;
  itemId: string;
}): Promise<PlayerHongmengTreasureState> {
  const config = await db.select({
    itemId: hongmengTreasureConfigs.itemId,
    enabled: hongmengTreasureConfigs.enabled,
    maxStar: hongmengTreasureConfigs.maxStar,
    starConfigs: hongmengTreasureConfigs.starConfigs,
    upgradeCosts: hongmengTreasureConfigs.upgradeCosts,
    spiritualFieldEnergyCost: hongmengTreasureConfigs.spiritualFieldEnergyCost,
    spiritualFieldReduceSeconds: hongmengTreasureConfigs.spiritualFieldReduceSeconds,
    itemName: items.name,
  })
    .from(hongmengTreasureConfigs)
    .innerJoin(items, eq(hongmengTreasureConfigs.itemId, items.id))
    .where(eq(hongmengTreasureConfigs.itemId, params.itemId))
    .get();

  if (!config || !config.enabled) {
    throw new Error("至宝未启用或不存在。");
  }

  const inv = await db.select({
    quantity: playerInventory.quantity,
  })
    .from(playerInventory)
    .where(and(
      eq(playerInventory.playerId, params.playerId),
      eq(playerInventory.itemId, params.itemId),
    ))
    .get();

  if (!inv || Number(inv.quantity || 0) <= 0) {
    throw new Error("你尚未持有该至宝。");
  }

  await ensurePlayerTreasureRow({
    playerId: params.playerId,
    itemId: params.itemId,
    starConfigs: config.starConfigs,
  });

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  await db.transaction(async (tx) => {
    const treasureRows = await tx.select({
      star: playerHongmengTreasures.star,
      energy: playerHongmengTreasures.energy,
      energyUpdatedAt: playerHongmengTreasures.energyUpdatedAt,
    })
      .from(playerHongmengTreasures)
      .where(and(
        eq(playerHongmengTreasures.playerId, params.playerId),
        eq(playerHongmengTreasures.itemId, params.itemId),
      ))
      .for("update");

    const treasure = treasureRows[0];
    if (!treasure) {
      throw new Error("至宝状态异常，请稍后重试。");
    }

    const currentStar = Math.max(0, Math.floor(Number(treasure.star) || 0));
    const maxStar = Math.max(0, Math.floor(Number(config.maxStar) || 0));
    if (currentStar >= maxStar) {
      throw new Error("已达最高星级。");
    }

    const costs = (Array.isArray(config.upgradeCosts) ? config.upgradeCosts : []) as HongmengTreasureUpgradeCost[];
    const required = costs.filter((row) => Number(row?.fromStar) === currentStar);
    if (required.length === 0) {
      throw new Error("未配置该星级的升星消耗。");
    }

    // 锁定并扣除升星消耗
    for (const cost of required) {
      const costItemId = typeof cost.costItemId === "string" ? cost.costItemId.trim() : "";
      const costQty = Math.max(1, Math.floor(Number(cost.costQuantity) || 0));
      if (!costItemId) {
        throw new Error("升星消耗配置异常：缺少物品ID。");
      }
      const invRow = await tx.select({
        quantity: playerInventory.quantity,
      })
        .from(playerInventory)
        .where(and(
          eq(playerInventory.playerId, params.playerId),
          eq(playerInventory.itemId, costItemId),
        ))
        .for("update")
        .then((rows) => rows[0] || null);

      const owned = Number(invRow?.quantity || 0);
      if (owned < costQty) {
        throw new Error("升星材料不足。");
      }
      const nextQty = owned - costQty;
      if (nextQty <= 0) {
        await tx.delete(playerInventory).where(and(
          eq(playerInventory.playerId, params.playerId),
          eq(playerInventory.itemId, costItemId),
        )).run();
      } else {
        await tx.update(playerInventory).set({ quantity: nextQty }).where(and(
          eq(playerInventory.playerId, params.playerId),
          eq(playerInventory.itemId, costItemId),
        )).run();
      }
    }

    const nextStar = currentStar + 1;
    const { energyCap: nextCap } = resolveStarConfig(config.starConfigs, nextStar);
    const recovered = recoverHongmengTreasureEnergySnapshot({
      energy: Number(treasure.energy || 0),
      energyUpdatedAt: treasure.energyUpdatedAt,
      energyCap: resolveStarConfig(config.starConfigs, currentStar).energyCap,
      regenSecondsPerEnergy: resolveStarConfig(config.starConfigs, currentStar).regenSecondsPerEnergy,
      nowMs,
    });
    const nextEnergy = Math.min(nextCap, recovered.energy);

    await tx.update(playerHongmengTreasures).set({
      star: nextStar,
      energy: nextEnergy,
      energyUpdatedAt: recovered.energyUpdatedAt,
      updatedAt: nowIso,
    }).where(and(
      eq(playerHongmengTreasures.playerId, params.playerId),
      eq(playerHongmengTreasures.itemId, params.itemId),
    )).run();
  });

  const state = await getPlayerHongmengTreasureStateByItemId({
    playerId: params.playerId,
    itemId: params.itemId,
  });
  if (!state) {
    throw new Error("升星完成，但状态读取失败。");
  }
  return state;
}

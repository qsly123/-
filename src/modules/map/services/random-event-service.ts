import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { fortunes, items, maps, monsters, playerFortunes, playerInventory, players } from "@/db/schema";
import { applyXpRateForPlayer, grantFortunesToPlayer, removePlayerFortune } from "@/modules/character/services/fortune-service";
import { getPlayerByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { getPlayerCosmeticProfileById } from "@/modules/character/services/player-cosmetic-profile";
import { warmMapSceneSharedStateForMapId } from "@/modules/map/services/map-scene-hub";
import { advanceMapSceneTick, ensureMapSceneTick, resetMapClientSequence } from "@/modules/map/services/map-scene-sync";
import { publishMapPresencePlayerPosition } from "@/modules/map/services/map-presence";
import { pickPortalSpawn } from "@/modules/map/services/map-portal";
import { isBuiltinRandomEventActionType } from "@/modules/map/services/random-event-action-builtins";
import { resetRepeatKillGuard } from "@/modules/combat/services/repeat-kill-guard";
import {
  executeDoubleCultivationRandomEventAction,
  isDoubleCultivationRandomEventAction,
} from "@/modules/world/services/double-cultivation-random-event";
import type { RandomEventRewardAction } from "@/types/game";

const TARGET_VAR_TEMPLATE_REGEX = /^\{\{([a-zA-Z0-9_]+)\}\}$/;
const RANDOM_EVENT_MAP_TYPE_SET = new Set([
  "city",
  "field",
  "dungeon",
  "secret",
  "secret_realm_instance",
]);

export type RandomEventMapType = "city" | "field" | "dungeon" | "secret" | "secret_realm_instance";

export interface RandomEventRewardInput {
  xp?: number;
  gold?: number;
  items?: { itemId: string; quantity: number }[];
  fortuneIds?: string[];
  removeFortuneIds?: string[];
  actions?: RandomEventRewardAction[];
}

export interface RandomEventRewardActionView {
  type: string;
  label?: string;
  targetVar?: string;
  targetName?: string;
  targetKind?: "player" | "monster";
  logId?: number;
  monsterId?: string;
  mapId?: string;
  navigatePath?: string;
  [key: string]: unknown;
}

export interface RandomEventRewardView {
  xp?: number;
  gold?: number;
  items?: { itemId: string; itemName: string; itemIconUrl?: string | null; quantity: number }[];
  fortunes?: { fortuneId: string; fortuneName: string }[];
  removedFortunes?: { fortuneId: string; fortuneName: string }[];
  actions?: RandomEventRewardActionView[];
}

interface RandomEventActionPlayerState {
  id: string;
  name: string | null;
  gender: string | null;
  realm: number;
  realmMajor: number | null;
  realmMinor: number | null;
  realmName: string;
  currentMapId: string | null;
  positionX: number;
  positionY: number;
  avatarId: string | null;
  avatarFrameId: string | null;
}

function parseTargetVariableKey(targetVar: string) {
  const normalized = String(targetVar || "").trim();
  const match = TARGET_VAR_TEMPLATE_REGEX.exec(normalized);
  if (!match) {
    return null;
  }
  return match[1];
}

function normalizeRandomEventActions(input: unknown): RandomEventRewardAction[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => {
      const action = row as Record<string, unknown>;
      const type = typeof action.type === "string" ? action.type.trim() : "";
      if (!type) {
        throw new Error("动作类型不能为空");
      }
      return {
        ...action,
        type,
        targetVar: typeof action.targetVar === "string" ? action.targetVar.trim() : "",
        monsterId: typeof action.monsterId === "string" ? action.monsterId.trim() : "",
        mapId: typeof action.mapId === "string" ? action.mapId.trim() : "",
      };
    });
}

export function isRandomEventMapType(value: string): value is RandomEventMapType {
  return RANDOM_EVENT_MAP_TYPE_SET.has(value);
}

export function normalizeRandomEventMapIds(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return [...new Set(
    input
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  )];
}

export function normalizeRandomEventMapTypes(input: unknown): RandomEventMapType[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return [...new Set(
    input
      .map((item) => String(item || "").trim())
      .filter((value): value is RandomEventMapType => isRandomEventMapType(value)),
  )];
}

export function resolveRandomEventMapTypes(params: {
  mapTypes: unknown;
  mapType?: unknown;
}) {
  const mapTypes = normalizeRandomEventMapTypes(params.mapTypes);
  if (mapTypes.length > 0) {
    return mapTypes;
  }

  const legacyMapType = typeof params.mapType === "string" ? params.mapType.trim() : "";
  if (!legacyMapType || !isRandomEventMapType(legacyMapType)) {
    return [] as RandomEventMapType[];
  }

  return [legacyMapType];
}

export function matchRandomEventTargetMap(params: {
  currentMapId: string;
  currentMapType: string;
  mapIds: unknown;
  mapTypes: unknown;
  legacyMapType?: unknown;
}) {
  const mapIds = normalizeRandomEventMapIds(params.mapIds);
  if (mapIds.length > 0) {
    return mapIds.includes(params.currentMapId);
  }

  const mapTypes = resolveRandomEventMapTypes({
    mapTypes: params.mapTypes,
    mapType: params.legacyMapType,
  });
  if (mapTypes.length === 0) {
    return true;
  }

  return mapTypes.includes(params.currentMapType as RandomEventMapType);
}

export function normalizeRandomEventImageUrls(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

export function pickRandomEventImageUrl(input: unknown): string | null {
  const imageUrls = normalizeRandomEventImageUrls(input);
  if (imageUrls.length === 0) {
    return null;
  }
  const index = Math.floor(Math.random() * imageUrls.length);
  return imageUrls[index] || null;
}

export function collectRandomEventActionVariableKeys(rewards: RandomEventRewardInput | null | undefined) {
  const keys = new Set<string>();
  const actions = normalizeRandomEventActions(rewards?.actions);
  for (const action of actions) {
    const targetVar = typeof action.targetVar === "string" ? action.targetVar.trim() : "";
    if (!targetVar) {
      continue;
    }
    const key = parseTargetVariableKey(targetVar);
    if (!key) {
      continue;
    }
    keys.add(key);
  }
  return [...keys];
}

async function executeRandomEventActions(params: {
  playerId: string;
  playerState: RandomEventActionPlayerState;
  actions: RandomEventRewardAction[];
  aiVariables?: Record<string, string> | null;
  sourceRef?: string | null;
}) {
  if (params.actions.length === 0) {
    return [];
  }

  const results: RandomEventRewardActionView[] = [];
  for (const action of params.actions) {
    if (isBuiltinRandomEventActionType(action.type)) {
      const actionType = String(action.type || "").trim();
      if (actionType === "battle") {
        const monsterId = String(action.monsterId || "").trim();
        if (!monsterId) {
          throw new Error("战斗动作缺少 monsterId");
        }

        const monster = await db.select({
          id: monsters.id,
          name: monsters.name,
          monsterType: monsters.monsterType,
        }).from(monsters).where(eq(monsters.id, monsterId)).get();
        if (!monster) {
          throw new Error(`战斗怪物不存在: ${monsterId}`);
        }

        results.push({
          type: "battle",
          label: `战斗·${monster.name}`,
          monsterId: monster.id,
          targetName: monster.name,
          navigatePath: monster.monsterType === "boss"
            ? `/game/boss/${monster.id}`
            : `/game/combat/${monster.id}`,
        });
        continue;
      }

      if (actionType === "teleport") {
        const mapId = String(action.mapId || "").trim();
        if (!mapId) {
          throw new Error("传送动作缺少 mapId");
        }

        const targetMap = await db.select({
          id: maps.id,
          name: maps.name,
          width: maps.width,
          height: maps.height,
          tilesData: maps.tilesData,
        }).from(maps).where(eq(maps.id, mapId)).get();
        if (!targetMap) {
          throw new Error(`目标地图不存在: ${mapId}`);
        }

        const portalSpawn = pickPortalSpawn(targetMap.tilesData);
        const positionX = portalSpawn?.x ?? Math.floor(targetMap.width / 2);
        const positionY = portalSpawn?.y ?? Math.floor(targetMap.height / 2);
        const prevMapId = params.playerState.currentMapId || "map_starter_village";
        const nowIso = new Date().toISOString();

        await db.update(players)
          .set({
            currentMapId: targetMap.id,
            currentMapInstanceId: null,
            positionX,
            positionY,
            updatedAt: nowIso,
          })
          .where(eq(players.id, params.playerId))
          .run();
        ensureMapSceneTick(prevMapId);
        ensureMapSceneTick(targetMap.id);
        advanceMapSceneTick(prevMapId);
        advanceMapSceneTick(targetMap.id);
        resetMapClientSequence(params.playerId, targetMap.id);
        resetRepeatKillGuard(params.playerId);
        await warmMapSceneSharedStateForMapId({
          mapId: targetMap.id,
          reason: "player_transition",
        }).catch((error) => {
          console.error("Random event teleport prewarm error:", {
            playerId: params.playerId,
            mapId: targetMap.id,
            error,
          });
        });

        const playerCosmetic = params.playerState.avatarId || params.playerState.avatarFrameId
          ? await getPlayerCosmeticProfileById(params.playerId)
          : { avatarImageUrl: null, avatarFrameImageUrl: null };

        publishMapPresencePlayerPosition({
          id: params.playerState.id,
          name: params.playerState.name || "",
          gender: params.playerState.gender,
          avatarImageUrl: playerCosmetic.avatarImageUrl,
          avatarFrameImageUrl: playerCosmetic.avatarFrameImageUrl,
          realm: params.playerState.realm,
          realmMajor: params.playerState.realmMajor,
          realmMinor: params.playerState.realmMinor,
          realmName: params.playerState.realmName || "凡人",
          mapId: targetMap.id,
          prevMapId,
          positionX,
          positionY,
        });

        params.playerState.currentMapId = targetMap.id;
        params.playerState.positionX = positionX;
        params.playerState.positionY = positionY;

        results.push({
          type: "teleport",
          label: `传送·${targetMap.name}`,
          mapId: targetMap.id,
          targetName: targetMap.name,
          positionX,
          positionY,
        });
        continue;
      }

      if (actionType === "pregnancyAdvance") {
        // 兼容旧随机事件配置：新版孕育系统已不再由奇遇动作推进阶段。
        continue;
      }

      if (isDoubleCultivationRandomEventAction(action)) {
        const actionResult = await executeDoubleCultivationRandomEventAction({
          playerId: params.playerId,
          action,
          aiVariables: params.aiVariables,
          sourceRef: params.sourceRef,
        });
        if (actionResult) {
          results.push(actionResult);
        }
        continue;
      }
    }

    throw new Error(`不支持的事件动作类型: ${action.type}`);
  }

  return results;
}

export async function applyRandomEventRewards(params: {
  playerId: string;
  rewards: RandomEventRewardInput | null;
  sourceRef?: string | null;
  aiVariables?: Record<string, string> | null;
}) {
  const rewards = params.rewards;
  if (!rewards) return null;

  const player = await getPlayerByIdCompat(params.playerId);
  if (!player) {
    throw new Error("玩家不存在");
  }

  const playerState: RandomEventActionPlayerState = {
    id: player.id,
    name: player.name,
    gender: player.gender,
    realm: player.realm,
    realmMajor: player.realmMajor,
    realmMinor: player.realmMinor,
    realmName: player.realmName || "凡人",
    currentMapId: player.currentMapId,
    positionX: player.positionX,
    positionY: player.positionY,
    avatarId: player.avatarId,
    avatarFrameId: player.avatarFrameId,
  };

  const actions = normalizeRandomEventActions(rewards.actions);
  const actionResults = await executeRandomEventActions({
    playerId: params.playerId,
    playerState,
    actions,
    aiVariables: params.aiVariables,
    sourceRef: params.sourceRef,
  });

  const rawXp = Number(rewards.xp ?? 0);
  const xpDelta = Number.isFinite(rawXp)
    ? Math.floor(rawXp)
    : 0;
  const finalXpDelta = xpDelta > 0
    ? await applyXpRateForPlayer({
      playerId: params.playerId,
      baseXp: xpDelta,
      channel: "adventure",
    })
    : xpDelta;
  const rawGold = Number(rewards.gold ?? 0);
  const goldDelta = Number.isFinite(rawGold)
    ? Math.floor(rawGold)
    : 0;

  const nextCultivationXp = Math.max(0, player.cultivationXp + finalXpDelta);
  const nextGold = Math.max(0, player.gold + goldDelta);
  const appliedXpDelta = nextCultivationXp - player.cultivationXp;
  const appliedGoldDelta = nextGold - player.gold;

  if (appliedXpDelta !== 0 || appliedGoldDelta !== 0) {
    await db.update(players)
      .set({
        cultivationXp: nextCultivationXp,
        gold: nextGold,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(players.id, params.playerId))
      .run();
  }

  if (rewards.items) {
    for (const item of rewards.items) {
      const existing = await db.select().from(playerInventory)
        .where(and(
          eq(playerInventory.playerId, params.playerId),
          eq(playerInventory.itemId, item.itemId),
        )).get();

      if (existing) {
        await db.update(playerInventory)
          .set({ quantity: existing.quantity + item.quantity })
          .where(and(
            eq(playerInventory.playerId, params.playerId),
            eq(playerInventory.itemId, item.itemId),
          ))
          .run();
      } else {
        await db.insert(playerInventory)
          .values({ playerId: params.playerId, itemId: item.itemId, quantity: item.quantity })
          .run();
      }
    }
  }

  const fortuneIds = Array.isArray(rewards.fortuneIds)
    ? [...new Set(rewards.fortuneIds.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
  const fortuneGrantResults = fortuneIds.length > 0
    ? await grantFortunesToPlayer({
      playerId: params.playerId,
      fortuneIds,
      sourceType: "random_event",
      sourceRef: params.sourceRef || null,
    })
    : [];
  const grantedFortuneIds = fortuneGrantResults
    .filter((row) => row.action !== "skipped")
    .map((row) => row.fortuneId);

  const removeFortuneIds = Array.isArray(rewards.removeFortuneIds)
    ? [...new Set(rewards.removeFortuneIds.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
  const removedFortuneIds: string[] = [];
  if (removeFortuneIds.length > 0) {
    const removableRows = await db.select({
      playerFortuneId: playerFortunes.id,
      fortuneId: playerFortunes.fortuneId,
    }).from(playerFortunes).where(and(
      eq(playerFortunes.playerId, params.playerId),
      eq(playerFortunes.status, "active"),
      inArray(playerFortunes.fortuneId, removeFortuneIds),
    )).all();

    for (const row of removableRows) {
      const removed = await removePlayerFortune({
        playerId: params.playerId,
        playerFortuneId: row.playerFortuneId,
      });
      if (removed) {
        removedFortuneIds.push(row.fortuneId);
      }
    }
  }

  const removedFortuneIdSet = new Set(removedFortuneIds);
  const finalGrantedFortuneIds = [...new Set(grantedFortuneIds.filter((id) => !removedFortuneIdSet.has(id)))];
  const finalRemovedFortuneIds = [...new Set(removedFortuneIds)];
  const displayFortuneIds = [...new Set([...finalGrantedFortuneIds, ...finalRemovedFortuneIds])];

  const fortuneRows = displayFortuneIds.length > 0
    ? await db.select({
      id: fortunes.id,
      name: fortunes.name,
      isHidden: fortunes.isHidden,
    }).from(fortunes).where(inArray(fortunes.id, displayFortuneIds)).all()
    : [];
  const visibleFortuneRows = fortuneRows.filter((row) => !row.isHidden);
  const visibleFortuneIdSet = new Set(visibleFortuneRows.map((row) => row.id));
  const fortuneNameMap = new Map(visibleFortuneRows.map((row) => [row.id, row.name]));

  const rewardsWithName: RandomEventRewardView = {
    xp: appliedXpDelta,
    gold: appliedGoldDelta,
    items: rewards.items
      ? await Promise.all(rewards.items.map(async (item) => {
        const itemInfo = await db.select({
          name: items.name,
          iconUrl: items.iconUrl,
        })
          .from(items)
          .where(eq(items.id, item.itemId))
          .get();

        return {
          itemId: item.itemId,
          itemName: itemInfo?.name || "未知物品",
          itemIconUrl: itemInfo?.iconUrl || null,
          quantity: item.quantity,
        };
      }))
      : undefined,
    fortunes: finalGrantedFortuneIds
      .filter((fortuneId) => visibleFortuneIdSet.has(fortuneId))
      .map((fortuneId) => ({
      fortuneId,
      fortuneName: fortuneNameMap.get(fortuneId) || fortuneId,
      })),
    removedFortunes: finalRemovedFortuneIds
      .filter((fortuneId) => visibleFortuneIdSet.has(fortuneId))
      .map((fortuneId) => ({
      fortuneId,
      fortuneName: fortuneNameMap.get(fortuneId) || fortuneId,
      })),
    actions: actionResults.length > 0 ? actionResults : undefined,
  };

  return rewardsWithName;
}

import { getSystemConfigMap } from "@/modules/system/services/system-config";
import { GAME_START_CONFIG_KEYS } from "@/modules/system/services/system-config-keys";

export interface GameStartInventoryItem {
  itemId: string;
  quantity: number;
  equipped?: boolean;
}

export interface GameStartConfig {
  mapId: string;
  positionX: number;
  positionY: number;
  baseSkillId: string;
  initialInventory: GameStartInventoryItem[];
}

const DEFAULT_GAME_START_CONFIG: GameStartConfig = {
  mapId: "map_four_realms_penglai_island",
  positionX: 3,
  positionY: 22,
  baseSkillId: "skill_four_realms_qianchao_jianqi",
  initialInventory: [],
};

function parseIntWithFallback(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseInventoryJson(raw: string | undefined): GameStartInventoryItem[] {
  if (!raw || !raw.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const merged = new Map<string, GameStartInventoryItem>();
    for (const row of parsed) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        continue;
      }

      const one = row as Record<string, unknown>;
      const itemId = String(one.itemId ?? "").trim();
      const quantity = Math.floor(Number(one.quantity ?? 0));
      if (!itemId || !Number.isFinite(quantity) || quantity <= 0) {
        continue;
      }

      const equipped = Boolean(one.equipped);
      const existing = merged.get(itemId);
      if (existing) {
        existing.quantity += quantity;
        existing.equipped = existing.equipped || equipped;
      } else {
        merged.set(itemId, { itemId, quantity, equipped });
      }
    }

    return [...merged.values()];
  } catch {
    return [];
  }
}

export async function getGameStartConfig(): Promise<GameStartConfig> {
  const map = await getSystemConfigMap(GAME_START_CONFIG_KEYS);

  return {
    mapId: (map.GAME_START_MAP_ID || DEFAULT_GAME_START_CONFIG.mapId).trim() || DEFAULT_GAME_START_CONFIG.mapId,
    positionX: parseIntWithFallback(map.GAME_START_POSITION_X, DEFAULT_GAME_START_CONFIG.positionX),
    positionY: parseIntWithFallback(map.GAME_START_POSITION_Y, DEFAULT_GAME_START_CONFIG.positionY),
    baseSkillId: (map.GAME_START_BASE_SKILL_ID || DEFAULT_GAME_START_CONFIG.baseSkillId).trim()
      || DEFAULT_GAME_START_CONFIG.baseSkillId,
    initialInventory: parseInventoryJson(map.GAME_START_INVENTORY_JSON),
  };
}

import {
  sanitizePlayerFacingItemDescription,
  sanitizePlayerFacingItemName,
} from "@/modules/shared/services/player-facing-copy";

type PlayerFacingItemInput = {
  id?: string | null;
  name?: string | null;
  iconUrl?: string | null;
  description?: string | null;
  itemType?: string | null;
  rarity?: string | null;
  price?: number | null;
  stackable?: boolean | null;
  isBound?: boolean | null;
  minRealm?: number | null;
  maxRealm?: number | null;
  pillToxicity?: number | null;
};

export type PlayerFacingItemBase = {
  itemId: string;
  name: string;
  iconUrl: string | null;
  description: string;
  itemType: string;
  rarity: string;
  price: number;
  stackable: boolean;
  isBound: boolean;
  minRealm: number | null;
  maxRealm: number | null;
  pillToxicity: number;
};

export function buildPlayerFacingItemBase(item: PlayerFacingItemInput): PlayerFacingItemBase {
  const itemType = typeof item.itemType === "string" && item.itemType.trim()
    ? item.itemType.trim()
    : "material";
  const rarity = typeof item.rarity === "string" && item.rarity.trim()
    ? item.rarity.trim()
    : "common";

  return {
    itemId: typeof item.id === "string" ? item.id : "",
    name: sanitizePlayerFacingItemName(item.name, { itemType, rarity }),
    iconUrl: typeof item.iconUrl === "string" && item.iconUrl.trim() ? item.iconUrl.trim() : null,
    description: sanitizePlayerFacingItemDescription(item.description, { itemType, rarity }),
    itemType,
    rarity,
    price: Number(item.price || 0),
    stackable: item.stackable === true,
    isBound: item.isBound === true,
    minRealm: item.minRealm ?? null,
    maxRealm: item.maxRealm ?? null,
    pillToxicity: Number(item.pillToxicity || 0),
  };
}

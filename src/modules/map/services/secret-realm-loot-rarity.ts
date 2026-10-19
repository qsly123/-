import type {
  ItemRarity,
  SecretRealmLootBlueprint,
  SecretRealmLootBlueprintEntry,
  SecretRealmMonsterRole,
} from "@/types/game";

const SECRET_REALM_RARITY_ORDER: ItemRarity[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "hongmeng",
];

export function normalizeSecretRealmItemRarity(value: unknown): ItemRarity {
  if (
    value === "hongmeng"
    || value === "legendary"
    || value === "epic"
    || value === "rare"
    || value === "uncommon"
    || value === "common"
  ) {
    return value;
  }
  return "common";
}

function getSecretRealmRarityRank(rarity: ItemRarity) {
  return SECRET_REALM_RARITY_ORDER.indexOf(rarity);
}

export function getNaturalSecretRealmRarityCap(role: SecretRealmMonsterRole): ItemRarity {
  return role === "boss" ? "legendary" : "epic";
}

export function clampSecretRealmEntryRarityByRole(
  role: SecretRealmMonsterRole,
  rarity: unknown,
): ItemRarity {
  const normalizedRarity = normalizeSecretRealmItemRarity(rarity);
  const naturalCap = getNaturalSecretRealmRarityCap(role);
  return getSecretRealmRarityRank(normalizedRarity) > getSecretRealmRarityRank(naturalCap)
    ? naturalCap
    : normalizedRarity;
}

export function sanitizeSecretRealmLootEntryByRole(
  role: SecretRealmMonsterRole,
  entry: SecretRealmLootBlueprintEntry,
): SecretRealmLootBlueprintEntry {
  const rarity = clampSecretRealmEntryRarityByRole(role, entry.rarity);
  if (rarity === entry.rarity) {
    return entry;
  }
  return {
    ...entry,
    rarity,
  };
}

export function sanitizeSecretRealmLootBlueprintByRole(
  blueprint?: SecretRealmLootBlueprint | null,
): SecretRealmLootBlueprint | null {
  if (!blueprint) {
    return null;
  }

  let changed = false;
  const entries = (blueprint.entries || []).map((entry) => {
    const sanitizedEntry = sanitizeSecretRealmLootEntryByRole(blueprint.role, entry);
    if (sanitizedEntry !== entry) {
      changed = true;
    }
    return sanitizedEntry;
  });

  if (!changed) {
    return blueprint;
  }

  return {
    ...blueprint,
    entries,
  };
}

const PLAYER_AVATAR_PREFIX = "/uploads/cosmetics/avatar/";
const NPC_AVATAR_PREFIX = "/uploads/cosmetics/npc-avatar/";
const NPC_PORTRAIT_PREFIX = "/uploads/cosmetics/npc-portrait/";
const MONSTER_PREFIX = "/uploads/cosmetics/monster/";
const LEGACY_WORLD_NPC_PORTRAIT_PREFIX = "/uploads/portraits/";
const LEGACY_WORLD_NPC_AVATAR_FALLBACKS: Record<"male" | "female", string> = {
  male: "/static/male.png",
  female: "/static/female.png",
};
const LEGACY_COSMETIC_URL_ALIASES: Record<string, string> = {
  "/uploads/cosmetics/item/four-realms/weapon-focus.png": "/uploads/cosmetics/item/ai-smithing/focus/31263.png",
  "/uploads/cosmetics/item/four-realms/artifact-sword-box.png": "/uploads/cosmetics/item/ai-smithing/sword-box/1011_0.png",
  "/uploads/cosmetics/item/four-realms/artifact-blood-banner.png": "/uploads/cosmetics/item/ai-smithing/blood-banner/31284.png",
  "/uploads/cosmetics/item/four-realms/artifact-swift-ring.png": "/uploads/cosmetics/item/ai-smithing/swift-ring/1003_2.png",
};

function normalizeUrlValue(value?: string | null) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

export function rewriteLegacyCosmeticUrl(value?: string | null) {
  const normalized = normalizeUrlValue(value);
  if (!normalized) {
    return null;
  }
  return LEGACY_COSMETIC_URL_ALIASES[normalized] || normalized;
}

function rewriteLegacyAvatarPrefix(value: string | null, targetPrefix: string) {
  if (!value) {
    return null;
  }
  if (!value.startsWith(PLAYER_AVATAR_PREFIX)) {
    return value;
  }
  return `${targetPrefix}${value.slice(PLAYER_AVATAR_PREFIX.length)}`;
}

function rewriteLegacyWorldNpcPortrait(value: string | null) {
  if (!value || !value.startsWith(LEGACY_WORLD_NPC_PORTRAIT_PREFIX)) {
    return value;
  }
  if (value.includes("/female-")) {
    return LEGACY_WORLD_NPC_AVATAR_FALLBACKS.female;
  }
  if (value.includes("/male-")) {
    return LEGACY_WORLD_NPC_AVATAR_FALLBACKS.male;
  }
  return null;
}

export function normalizeNpcAvatarImageUrl(value?: string | null) {
  return rewriteLegacyWorldNpcPortrait(
    rewriteLegacyAvatarPrefix(rewriteLegacyCosmeticUrl(value), NPC_AVATAR_PREFIX),
  );
}

export function normalizeNpcPortraitImageUrl(value?: string | null) {
  const normalized = rewriteLegacyWorldNpcPortrait(rewriteLegacyCosmeticUrl(value));
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith(NPC_PORTRAIT_PREFIX) || normalized.startsWith(NPC_AVATAR_PREFIX)) {
    return normalized;
  }
  return rewriteLegacyAvatarPrefix(normalized, NPC_AVATAR_PREFIX);
}

export function normalizeMonsterImageUrl(value?: string | null) {
  return rewriteLegacyAvatarPrefix(rewriteLegacyCosmeticUrl(value), MONSTER_PREFIX);
}

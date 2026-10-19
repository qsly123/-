import type {
  SecretRealmElement,
  SecretRealmLootCategory,
  SecretRealmSeedThemeTag,
} from "@/types/game";

function dedupe<T>(values: T[]) {
  return Array.from(new Set(values));
}

export type SecretRealmThemeProfile = {
  themeTags: string[];
  preferredElements: SecretRealmElement[];
  preferredCategories: SecretRealmLootCategory[];
  seedFocusTags: SecretRealmSeedThemeTag[];
  isSeedRich: boolean;
  hasHighTierSeedChance: boolean;
};

export function buildSecretRealmThemeProfile(theme: string, labels?: string[]): SecretRealmThemeProfile {
  const text = `${theme} ${(labels || []).join(" ")}`;
  const themeTags: string[] = [];
  const preferredElements: SecretRealmElement[] = [];
  const preferredCategories: SecretRealmLootCategory[] = [];
  const seedFocusTags: SecretRealmSeedThemeTag[] = [];

  if (/荒林|幽谷|妖植|草|木/u.test(text)) {
    themeTags.push("荒林");
    preferredElements.push("wood", "water");
    preferredCategories.push("existing_material", "alchemy_material", "herb_seed");
    seedFocusTags.push("forest", "growth");
  }
  if (/丹房|药谷|药|泉|水府/u.test(text)) {
    themeTags.push("药气");
    preferredElements.push("water", "wood");
    preferredCategories.push("existing_material", "alchemy_material", "herb_seed");
    seedFocusTags.push("pill", "water", "growth");
  }
  if (/石窟|矿|器坊|金石|火煞|守卫/u.test(text)) {
    themeTags.push("矿脉");
    preferredElements.push("metal", "fire", "earth");
    preferredCategories.push("existing_material", "smithing_material", "equipment");
    seedFocusTags.push("ore", "ruins");
  }
  if (/残碑|尸傀|毒瘴|遗魂/u.test(text)) {
    themeTags.push("残煞");
    preferredElements.push("earth", "fire");
    preferredCategories.push("existing_material", "smithing_material", "alchemy_material");
    seedFocusTags.push("ruins");
  }

  const resolvedThemeTags = themeTags.length > 0 ? dedupe(themeTags) : ["秘境"];
  const resolvedSeedFocusTags = dedupe(seedFocusTags);
  const isSeedRich = resolvedThemeTags.includes("荒林") || resolvedThemeTags.includes("药气");

  return {
    themeTags: resolvedThemeTags,
    preferredElements: preferredElements.length > 0 ? dedupe(preferredElements) : ["metal", "wood", "water", "fire", "earth"],
    preferredCategories: preferredCategories.length > 0 ? dedupe(preferredCategories) : ["existing_material", "alchemy_material", "smithing_material"],
    seedFocusTags: resolvedSeedFocusTags,
    isSeedRich,
    hasHighTierSeedChance: isSeedRich,
  };
}

export function mapSeedThemeTagToLabel(tag: SecretRealmSeedThemeTag) {
  switch (tag) {
    case "forest":
      return "草木灵种";
    case "water":
      return "水脉灵种";
    case "pill":
      return "丹材灵种";
    case "growth":
      return "养成灵种";
    case "ore":
      return "矿脉伴生种";
    case "ruins":
      return "遗府异种";
    default:
      return "秘境灵种";
  }
}

export function buildSecretRealmSeedFocusView(params: {
  theme: string;
  labels?: string[];
  recommendedRealm: number;
  specialType?: string | null;
}) {
  const profile = buildSecretRealmThemeProfile(params.theme, params.labels);
  const hasHighTierSeedChance = params.specialType === "wild_wolf_valley"
    || (params.recommendedRealm >= 17 && profile.hasHighTierSeedChance);
  return {
    seedFocusTags: profile.seedFocusTags.map(mapSeedThemeTagToLabel),
    hasHighTierSeedChance,
  };
}

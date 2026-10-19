type ItemCopyMeta = {
  itemType?: string | null;
  rarity?: string | null;
};

type TextSanitizeOptions = {
  fallback?: string;
  maxLength?: number;
};

const TECHNICAL_ID_PATTERN = /\b(?:item|skill|map|portal|route|effect|player|monster|source|target)_[a-z0-9:_-]+\b/gi;
const TECHNICAL_WORD_PATTERN = /\b(?:sourceType|sourceMeta|generatedSeed|materialIds?|routeFit(?:Score|Tier)?|routeScoreMap|guidancePenaltyRate|targetRouteLabel|targetRoute|rarityPattern|supportHigherRarityWeight|supportLowerRarityWeight|resultRarityLabel|resultRarity|zeroToxicityChance|rolledZeroToxicity|qualityScore|dominantMaterialRarity(?:Count|Label)?|hongmengChance|bind_skill|learn_skill|boost_[a-z_]+|itemId|skillId|avatarId|frameId|secret_realm|ai_smithing|ai_alchemy)\b/gi;
const JSON_NOISE_PATTERN = /[\[{].{0,120}[:：].{0,120}[\]}]/g;
const MULTI_ASCII_SEGMENT_PATTERN = /(?:[A-Za-z][A-Za-z0-9_-]{2,}\s*){2,}/g;
const COPY_BOILERPLATE_PATTERNS = [
  /(?:丹名|器名|来历|药性|描述)由天道推演[^。！？]*[。！？]?/g,
  /材料词条仅用于筛选与显示契合度[。！？]?/g,
  /药力与丹毒仍由服务器裁定[。！？]?/g,
  /强度仍由服务器模板限制[。！？]?/g,
  /由服务器(?:模板)?(?:裁定|限制|控制)[^。！？]*[。！？]?/g,
  /仅用于筛选与显示契合度[。！？]?/g,
] as const;

function resolveGenericItemLabel(meta: ItemCopyMeta) {
  const rarityLabel = resolveRarityLabel(meta.rarity);
  const typeLabel = resolveItemTypeLabel(meta.itemType);
  return `${rarityLabel}${typeLabel}`;
}

function resolveItemTypeLabel(itemType?: string | null) {
  if (itemType === "weapon") return "武器";
  if (itemType === "armor") return "法衣";
  if (itemType === "helmet") return "灵冠";
  if (itemType === "shoes") return "步履";
  if (itemType === "artifact") return "法宝";
  if (itemType === "consumable") return "丹药";
  if (itemType === "material") return "灵材";
  if (itemType === "skill_book") return "神通书";
  if (itemType === "quest") return "信物";
  return "物品";
}

function resolveRarityLabel(rarity?: string | null) {
  if (rarity === "hongmeng") return "鸿蒙";
  if (rarity === "legendary") return "仙品";
  if (rarity === "epic") return "极品";
  if (rarity === "rare") return "上品";
  if (rarity === "uncommon") return "良品";
  return "凡品";
}

function resolveItemDescriptionFallback(meta: ItemCopyMeta) {
  if (meta.itemType === "weapon") return "此器灵光内敛，可在斗法中稳住攻势。";
  if (meta.itemType === "armor") return "此衣气机绵密，适合护体承伤。";
  if (meta.itemType === "helmet") return "此冠可稳神护念，适合久战佩戴。";
  if (meta.itemType === "shoes") return "此履轻灵顺气，利于挪移追击。";
  if (meta.itemType === "artifact") return "此宝已生灵性，可在斗法中辅攻护身。";
  if (meta.itemType === "consumable") return "药力已成，择机服下可助修行。";
  if (meta.itemType === "material") return "此物灵性未散，可用于炼丹、炼器或其他修炼。";
  if (meta.itemType === "skill_book") return "书中留有法诀残意，静心参悟或可有得。";
  if (meta.itemType === "quest") return "此物牵连因果，留待后续机缘再用。";
  return "此物尚存灵性，或可在日后修行中派上用场。";
}

function normalizeText(raw: string) {
  return raw
    .replace(/\r/g, "")
    .replace(/\n+/g, "。")
    .replace(/[“”"'`]/g, "")
    .replace(/[()（）]/g, "")
    .replace(/\s+/g, "")
    .replace(/[\\/|]+/g, "、")
    .replace(/,+/g, "，")
    .replace(/\.+/g, "。")
    .replace(/。{2,}/g, "。")
    .replace(/，{2,}/g, "，")
    .replace(/、{2,}/g, "、")
    .trim();
}

function stripTechnicalNoise(raw: string) {
  let next = raw;
  for (const pattern of COPY_BOILERPLATE_PATTERNS) {
    next = next.replace(pattern, "");
  }
  next = next
    .replace(JSON_NOISE_PATTERN, "")
    .replace(TECHNICAL_ID_PATTERN, "")
    .replace(TECHNICAL_WORD_PATTERN, "")
    .replace(MULTI_ASCII_SEGMENT_PATTERN, "");
  return next;
}

function dedupeClauses(raw: string) {
  const parts = raw
    .split(/[。！？；]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    const normalized = part.replace(/[，、\s]/g, "");
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(part);
  }
  return result.join("。");
}

function looksTechnicalOrMeaningless(raw: string) {
  const text = raw.trim();
  if (!text) {
    return true;
  }
  const chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const asciiCount = (text.match(/[A-Za-z]/g) || []).length;
  if (chineseCount === 0 && asciiCount > 0) {
    return true;
  }
  if (asciiCount >= Math.max(8, chineseCount * 2) && /[_:]/.test(text)) {
    return true;
  }
  return false;
}

function finalizeText(raw: string, options: TextSanitizeOptions) {
  const maxLength = Math.max(0, Number(options.maxLength || 0));
  if (!maxLength || raw.length <= maxLength) {
    return raw;
  }
  return raw.slice(0, maxLength).replace(/[，。、；！？”、]+$/g, "").trim();
}

export function sanitizePlayerFacingText(value: unknown, options: TextSanitizeOptions = {}) {
  const fallback = String(options.fallback || "").trim();
  const text = normalizeText(String(value || ""));
  const stripped = dedupeClauses(normalizeText(stripTechnicalNoise(text)))
    .replace(/^[-，。、；！]+/g, "")
    .replace(/[-，。、；！]+$/g, "")
    .trim();
  const candidate = looksTechnicalOrMeaningless(stripped) ? fallback : stripped || fallback;
  return finalizeText(candidate, options);
}

export function sanitizePlayerFacingLabel(value: unknown, fallback = "未命名") {
  return sanitizePlayerFacingText(value, { fallback, maxLength: 24 });
}

export function sanitizePlayerFacingItemName(value: unknown, meta: ItemCopyMeta = {}) {
  const fallback = resolveGenericItemLabel(meta);
  return sanitizePlayerFacingText(value, { fallback, maxLength: 20 });
}

export function sanitizePlayerFacingItemDescription(value: unknown, meta: ItemCopyMeta = {}) {
  const fallback = resolveItemDescriptionFallback(meta);
  return sanitizePlayerFacingText(value, { fallback, maxLength: 120 });
}

export function sanitizePlayerFacingFlavorDescription(value: unknown, fallback: string, maxLength = 60) {
  return sanitizePlayerFacingText(value, { fallback, maxLength });
}

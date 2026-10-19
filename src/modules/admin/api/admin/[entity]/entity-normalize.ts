import { createHash } from "crypto";
import type { AdminEntity } from "@/modules/admin/services/admin-entities";
import { PREGNANCY_STAGE7_FORTUNE_CONFIG_KEY } from "@/modules/character/constants/pregnancy-system";
import { resolveRandomEventMapTypes } from "@/modules/map/services/random-event-service";
import { LLM_OPTIONAL_OVERRIDE_CONFIG_KEYS } from "@/modules/system/services/system-config-keys";
import { buildSkillEffectsPayload } from "@/modules/shared/services/skill-visual-effect";
import {
  normalizeMonsterImageUrl,
  normalizeNpcAvatarImageUrl,
  normalizeNpcPortraitImageUrl,
} from "@/modules/shared/services/cosmetic-url";

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

function parseJsonField<T>(value: unknown, fieldName: string): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      throw new Error(`${fieldName} JSON 格式错误`);
    }
  }
  return value as T;
}

function parseNullableInteger(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.floor(parsed);
}

const SYSTEM_CONFIG_EMPTY_VALUE_ALLOWED_KEYS = new Set<string>([
  ...LLM_OPTIONAL_OVERRIDE_CONFIG_KEYS,
  PREGNANCY_STAGE7_FORTUNE_CONFIG_KEY,
]);

export function normalizeEntityPayload(entity: AdminEntity, payload: Record<string, unknown>, forCreate: boolean) {
  const normalized = { ...payload };

  if (forCreate) {
    const rawId = normalized.id;
    if (rawId === undefined || rawId === null || (typeof rawId === "string" && !rawId.trim())) {
      delete normalized.id;
    } else if (typeof rawId === "string") {
      normalized.id = rawId.trim();
    }
  }

  if (entity === "accounts") {
    delete normalized.passwordHash;
    const rawPassword = typeof normalized.password === "string" ? normalized.password.trim() : "";
    if (rawPassword) {
      normalized.passwordHash = md5(rawPassword);
    }
    delete normalized.password;
    normalized.updatedAt = new Date().toISOString();
  }

  if (entity === "maps" || entity === "temporaryMaps") {
    if ("tilesData" in normalized) {
      normalized.tilesData = parseJsonField(normalized.tilesData, "tilesData");
    }
    if ("backgroundImageUrl" in normalized) {
      const value = typeof normalized.backgroundImageUrl === "string" ? normalized.backgroundImageUrl.trim() : "";
      normalized.backgroundImageUrl = value || null;
    }
    if ("expiresAt" in normalized) {
      const value = typeof normalized.expiresAt === "string" ? normalized.expiresAt.trim() : "";
      normalized.expiresAt = value || null;
    }
    if (entity === "temporaryMaps") {
      normalized.updatedAt = new Date().toISOString();
    }
  }

  if (entity === "players") {
    if ("pillToxicity" in normalized) {
      const pillToxicity = Number(normalized.pillToxicity);
      normalized.pillToxicity = Number.isFinite(pillToxicity)
        ? Math.max(0, Math.floor(pillToxicity))
        : 0;
      normalized.pillToxicityUpdatedAt = new Date().toISOString();
    }
  }

  if (entity === "npcs") {
    if ("personality" in normalized) {
      normalized.personality = typeof normalized.personality === "string"
        ? normalized.personality.trim()
        : "";
    } else if (forCreate) {
      normalized.personality = "";
    }
    if ("shopItems" in normalized) {
      normalized.shopItems = parseJsonField(normalized.shopItems, "shopItems");
    }
    if ("avatarImageUrl" in normalized) {
      normalized.avatarImageUrl = normalizeNpcAvatarImageUrl(
        typeof normalized.avatarImageUrl === "string" ? normalized.avatarImageUrl : null,
      );
    }
    if ("portraitImageUrl" in normalized) {
      normalized.portraitImageUrl = normalizeNpcPortraitImageUrl(
        typeof normalized.portraitImageUrl === "string" ? normalized.portraitImageUrl : null,
      );
    }
    if ("bountyEnabled" in normalized) {
      normalized.bountyEnabled = Boolean(normalized.bountyEnabled);
    }
    if ("bountyDailyLimit" in normalized) {
      const value = normalized.bountyDailyLimit;
      normalized.bountyDailyLimit = value === null || value === undefined || value === ""
        ? 0
        : Math.floor(Number(value));
    }
  }

  if (entity === "items" || entity === "aiItems") {
    if ("effects" in normalized) {
      normalized.effects = parseJsonField(normalized.effects, "effects");
    }
    if ("iconUrl" in normalized) {
      const value = typeof normalized.iconUrl === "string" ? normalized.iconUrl.trim() : "";
      normalized.iconUrl = value || null;
    }
    if ("isBound" in normalized) {
      normalized.isBound = Boolean(normalized.isBound);
    }
    if ("pillToxicity" in normalized) {
      const pillToxicity = Number(normalized.pillToxicity);
      normalized.pillToxicity = Number.isFinite(pillToxicity)
        ? Math.max(0, Math.floor(pillToxicity))
        : 0;
    }
  }

  if (entity === "pillToxicityConfigs") {
    delete normalized.key;
    delete normalized.id;
    if ("maxToxicity" in normalized) {
      const maxToxicity = Number(normalized.maxToxicity);
      normalized.maxToxicity = Number.isFinite(maxToxicity)
        ? Math.max(1, Math.floor(maxToxicity))
        : 1;
    }
    if ("recoverIntervalMinutes" in normalized) {
      const recoverIntervalMinutes = Number(normalized.recoverIntervalMinutes);
      normalized.recoverIntervalMinutes = Number.isFinite(recoverIntervalMinutes)
        ? Math.max(1, Math.floor(recoverIntervalMinutes))
        : 1;
    }
    normalized.updatedAt = new Date().toISOString();
  }

  if (entity === "hongmengTreasures") {
    if (!forCreate) {
      delete normalized.itemId;
    }
    if ("enabled" in normalized) {
      normalized.enabled = Boolean(normalized.enabled);
    }
    if ("maxStar" in normalized) {
      normalized.maxStar = Math.max(0, Math.floor(Number(normalized.maxStar)));
    }
    if ("starConfigs" in normalized) {
      normalized.starConfigs = parseJsonField(normalized.starConfigs, "starConfigs");
    }
    if ("upgradeCosts" in normalized) {
      normalized.upgradeCosts = parseJsonField(normalized.upgradeCosts, "upgradeCosts");
    }
    if ("spiritualFieldEnergyCost" in normalized) {
      normalized.spiritualFieldEnergyCost = Math.max(0, Math.floor(Number(normalized.spiritualFieldEnergyCost)));
    }
    if ("spiritualFieldReduceSeconds" in normalized) {
      normalized.spiritualFieldReduceSeconds = Math.max(0, Math.floor(Number(normalized.spiritualFieldReduceSeconds)));
    }
    normalized.updatedAt = new Date().toISOString();
  }

  if (entity === "skills") {
    const parsedEffects = "effects" in normalized
      ? parseJsonField(normalized.effects, "effects")
      : undefined;
    normalized.effects = buildSkillEffectsPayload(parsedEffects, normalized, normalized);
    delete normalized.visualEffectSpriteUrl;
    delete normalized.visualEffectFrameWidth;
    delete normalized.visualEffectFrameHeight;
    delete normalized.visualEffectFrameCount;
    delete normalized.visualEffectFrameDurationMs;
    delete normalized.visualEffectScale;
    delete normalized.visualEffectOffsetX;
    delete normalized.visualEffectOffsetY;
  }

  if (entity === "monsters" || entity === "temporaryMonsters") {
    if ("iconUrl" in normalized) {
      normalized.iconUrl = normalizeMonsterImageUrl(
        typeof normalized.iconUrl === "string" ? normalized.iconUrl : null,
      );
    }
    if ("skills" in normalized) {
      normalized.skills = parseJsonField(normalized.skills, "skills");
    }
    if ("drops" in normalized) {
      normalized.drops = parseJsonField(normalized.drops, "drops");
    }
    if ("aiMoveIntervalMinSeconds" in normalized) {
      normalized.aiMoveIntervalMinSeconds = parseNullableInteger(normalized.aiMoveIntervalMinSeconds);
    }
    if ("aiMoveIntervalMaxSeconds" in normalized) {
      normalized.aiMoveIntervalMaxSeconds = parseNullableInteger(normalized.aiMoveIntervalMaxSeconds);
    }
    if ("aiMoveRange" in normalized) {
      normalized.aiMoveRange = parseNullableInteger(normalized.aiMoveRange);
    }
    if ("expiresAt" in normalized) {
      const value = typeof normalized.expiresAt === "string" ? normalized.expiresAt.trim() : "";
      normalized.expiresAt = value || null;
    }
    if (entity === "temporaryMonsters") {
      normalized.updatedAt = new Date().toISOString();
    }
  }

  if (entity === "quests") {
    if ("requirements" in normalized) {
      normalized.requirements = parseJsonField(normalized.requirements, "requirements");
    }
    if ("rewards" in normalized) {
      normalized.rewards = parseJsonField(normalized.rewards, "rewards");
    }
    if ("prerequisites" in normalized) {
      normalized.prerequisites = parseJsonField(normalized.prerequisites, "prerequisites");
    }
  }

  if (entity === "randomEvents") {
    if ("spawnIntervalSeconds" in normalized) {
      normalized.spawnIntervalSeconds = parseNullableInteger(normalized.spawnIntervalSeconds);
    }
    if ("durationSeconds" in normalized) {
      normalized.durationSeconds = parseNullableInteger(normalized.durationSeconds);
    }
    if ("encounterMode" in normalized) {
      const value = typeof normalized.encounterMode === "string" ? normalized.encounterMode.trim() : "";
      normalized.encounterMode = value === "chain" ? "chain" : "single";
    } else if (forCreate) {
      normalized.encounterMode = "single";
    }
    if ("encounterStageCount" in normalized) {
      normalized.encounterStageCount = parseNullableInteger(normalized.encounterStageCount) ?? 3;
    }
    if ("encounterChoiceCount" in normalized) {
      normalized.encounterChoiceCount = parseNullableInteger(normalized.encounterChoiceCount) ?? 2;
    }
    if ("iconImageUrl" in normalized) {
      const value = typeof normalized.iconImageUrl === "string" ? normalized.iconImageUrl.trim() : "";
      normalized.iconImageUrl = value || null;
    }
    if ("imageUrls" in normalized) {
      const parsed = parseJsonField<unknown>(normalized.imageUrls, "imageUrls");
      const imageUrls = Array.isArray(parsed)
        ? parsed
          .map((item) => String(item || "").trim())
          .filter(Boolean)
        : [];
      normalized.imageUrls = imageUrls.length > 0 ? imageUrls : null;
    }
    if ("mapTypes" in normalized || "mapType" in normalized) {
      const mapTypes = resolveRandomEventMapTypes({
        mapTypes: normalized.mapTypes,
        mapType: normalized.mapType,
      });
      normalized.mapTypes = mapTypes.length > 0 ? mapTypes : null;
      normalized.mapType = mapTypes[0] || null;
    }
    if ("mapIds" in normalized) {
      normalized.mapIds = parseJsonField(normalized.mapIds, "mapIds");
    }
    if ("judgeConditions" in normalized) {
      normalized.judgeConditions = parseJsonField(normalized.judgeConditions, "judgeConditions");
    }
    if ("rewards" in normalized) {
      normalized.rewards = parseJsonField(normalized.rewards, "rewards");
    }
  }

  if (entity === "cdkCodes") {
    if ("reward" in normalized) {
      normalized.reward = parseJsonField(normalized.reward, "reward");
    }
    if ("expiresAt" in normalized) {
      const expiresAt = normalized.expiresAt;
      normalized.expiresAt = typeof expiresAt === "string" && !expiresAt.trim() ? null : expiresAt;
    }
    normalized.updatedAt = new Date().toISOString();
  }

  if (entity === "checkinRewardRules") {
    if ("reward" in normalized) {
      normalized.reward = parseJsonField(normalized.reward, "reward");
    }
    normalized.updatedAt = new Date().toISOString();
    delete normalized.id;
    delete normalized.dayIndex;
  }

  if (entity === "fortunes") {
    if ("gender" in normalized) {
      const value = typeof normalized.gender === "string" ? normalized.gender.trim() : "";
      normalized.gender = value === "男" || value === "女" ? value : null;
    }
    if ("enabled" in normalized) {
      normalized.enabled = Boolean(normalized.enabled);
    }
    if ("isHidden" in normalized) {
      normalized.isHidden = Boolean(normalized.isHidden);
    }
    if ("isStarter" in normalized) {
      normalized.isStarter = Boolean(normalized.isStarter);
    }
    if ("starterWeight" in normalized) {
      const value = Number(normalized.starterWeight);
      normalized.starterWeight = Number.isFinite(value) ? value : 0;
    }
    if ("durationSeconds" in normalized) {
      const value = Number(normalized.durationSeconds);
      normalized.durationSeconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    }
    if ("attrEffects" in normalized) {
      normalized.attrEffects = parseJsonField(normalized.attrEffects, "attrEffects");
    }
    if ("eventEffects" in normalized) {
      normalized.eventEffects = parseJsonField(normalized.eventEffects, "eventEffects");
    }
    if ("specialEffects" in normalized) {
      normalized.specialEffects = parseJsonField(normalized.specialEffects, "specialEffects");
    }
    normalized.updatedAt = new Date().toISOString();
  }

  if (entity === "systemConfigs") {
    const key = typeof normalized.key === "string" ? normalized.key.trim() : "";
    const rowKey = forCreate ? key : (typeof normalized.id === "string" ? normalized.id.trim() : "");
    const group = typeof normalized.group === "string" ? normalized.group.trim() : "";
    const value = normalized.value;
    const now = new Date().toISOString();

    if (forCreate && !key) {
      throw new Error("key 不能为空");
    }
    if (!group) {
      throw new Error("group 不能为空");
    }
    const allowEmptyValue = rowKey ? SYSTEM_CONFIG_EMPTY_VALUE_ALLOWED_KEYS.has(rowKey) : false;
    if (!allowEmptyValue && (value === undefined || value === null || String(value).trim() === "")) {
      throw new Error("value 不能为空");
    }

    if (forCreate) {
      normalized.key = key;
    } else {
      delete normalized.key;
    }
    normalized.group = group;
    normalized.value = String(value);
    normalized.isSecret = Boolean(normalized.isSecret);
    normalized.description = typeof normalized.description === "string" && normalized.description.trim()
      ? normalized.description.trim()
      : null;
    normalized.updatedAt = now;
    if (forCreate) {
      normalized.createdAt = now;
    }
  }

  return normalized;
}

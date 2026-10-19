import type { CombatSkillVisualEffect, SkillSourceType } from "@/types/game";

export type SkillVisualEffectResolverInput = {
  skillId?: string | null;
  name?: string | null;
  description?: string | null;
  skillType?: string | null;
  element?: string | null;
  target?: string | null;
  sourceType?: SkillSourceType | string | null;
};

const FRAME_SIZE = 192;

function createSpriteSheetEffect(
  spriteUrl: string,
  columns: number,
  rows: number,
  options?: {
    frameDurationMs?: number;
    scale?: number;
    offsetX?: number;
    offsetY?: number;
  },
): CombatSkillVisualEffect {
  return {
    spriteUrl,
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
    frameCount: Math.max(1, columns * rows),
    frameDurationMs: options?.frameDurationMs ?? 50,
    scale: options?.scale ?? 0.9,
    offsetX: options?.offsetX ?? 0,
    offsetY: options?.offsetY ?? 0,
  };
}

const SKILL_VISUAL_EFFECT_PRESETS = {
  basicSlash: createSpriteSheetEffect(
    "/uploads/cosmetics/skill-sprite/ai-candidates/all/30FPS_AC2Q001_Slash.png",
    5,
    2,
    { frameDurationMs: 52, scale: 0.76, offsetY: -8 },
  ),
  physicalHit: createSpriteSheetEffect(
    "/uploads/cosmetics/skill-sprite/ai-candidates/all/30FPS_AC2Q006_Hit.png",
    5,
    2,
    { frameDurationMs: 48, scale: 0.74, offsetY: -6 },
  ),
  barrier: createSpriteSheetEffect(
    "/uploads/cosmetics/skill-sprite/four-realms/30FPS_AC2Q017_Barrier.png",
    6,
    8,
    { frameDurationMs: 48, scale: 0.92, offsetY: -10 },
  ),
  heal: createSpriteSheetEffect(
    "/uploads/cosmetics/skill-sprite/ai-candidates/all/30FPS_AC2Q022_Star_Heal.png",
    5,
    9,
    { frameDurationMs: 48, scale: 0.9, offsetY: -8 },
  ),
  radiance: createSpriteSheetEffect(
    "/uploads/cosmetics/skill-sprite/ai-candidates/all/Light3.png",
    5,
    6,
    { frameDurationMs: 48, scale: 0.86, offsetY: -8 },
  ),
  lightning: createSpriteSheetEffect(
    "/uploads/cosmetics/skill-sprite/four-realms/30FPS_ACQ023_LightningA.png",
    5,
    10,
    { frameDurationMs: 48, scale: 0.84, offsetY: -6 },
  ),
  fire: createSpriteSheetEffect(
    "/uploads/cosmetics/skill-sprite/four-realms/30FPS_ACQ021_Fire.png",
    5,
    10,
    { frameDurationMs: 48, scale: 0.88, offsetY: -10 },
  ),
  water: createSpriteSheetEffect(
    "/uploads/cosmetics/skill-sprite/four-realms/30FPS_ACQ020_Water.png",
    5,
    10,
    { frameDurationMs: 48, scale: 0.92, offsetY: -10 },
  ),
  ice: createSpriteSheetEffect(
    "/uploads/cosmetics/skill-sprite/ai-candidates/all/30FPS_ACQ024_Ice.png",
    5,
    10,
    { frameDurationMs: 48, scale: 0.9, offsetY: -10 },
  ),
  poison: createSpriteSheetEffect(
    "/uploads/cosmetics/skill-sprite/four-realms/30FPS_ACQ012_Poison.png",
    5,
    9,
    { frameDurationMs: 48, scale: 0.84, offsetY: -8 },
  ),
  sleep: createSpriteSheetEffect(
    "/uploads/cosmetics/skill-sprite/four-realms/30FPS_ACQ013_Sleep.png",
    5,
    6,
    { frameDurationMs: 54, scale: 0.8, offsetY: -4 },
  ),
  tempest: createSpriteSheetEffect(
    "/uploads/cosmetics/skill-sprite/four-realms/30FPS_AC3T018_Tempest.png",
    5,
    18,
    { frameDurationMs: 46, scale: 0.68, offsetY: -14 },
  ),
} as const;

const BASIC_ATTACK_IDS = new Set([
  "skill_basic_attack",
]);

const SHIELD_KEYWORDS = [
  "护盾",
  "护体",
  "护身",
  "灵盾",
  "气盾",
  "盾墙",
  "盾阵",
  "壁垒",
  "屏障",
  "守护",
  "结界",
  "护魄",
];
const HEAL_KEYWORDS = ["疗", "愈", "治", "回", "生", "春", "养", "续", "复"];
const BUFF_KEYWORDS = ["增", "强", "振", "明", "耀", "祝", "灵光"];
const DEBUFF_KEYWORDS = ["缚", "封", "禁", "压", "咒", "咒印", "镇", "迟", "缓", "慑"];
const FIRE_KEYWORDS = ["火", "焰", "炎", "灼", "爆", "离火", "赤"];
const WATER_KEYWORDS = ["水", "潮", "海", "泉", "浪", "河", "雨"];
const ICE_KEYWORDS = ["冰", "霜", "寒", "雪", "冻"];
const LIGHTNING_KEYWORDS = ["雷", "电", "霆", "符", "箓", "印", "闪"];
const POISON_KEYWORDS = ["毒", "蚀", "蛊", "瘴", "腐"];
const SLEEP_KEYWORDS = ["眠", "梦", "魇", "魂", "魄", "摄", "眩", "惑", "幻", "魅"];
const TEMPEST_KEYWORDS = ["风", "岚", "暴", "卷", "涛", "河", "雨", "阵"];

function includesAnyKeyword(text: string, keywords: readonly string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

export function resolvePersistentActiveEffectVisualEffect(effectType?: string | null): CombatSkillVisualEffect | null {
  const normalizedEffectType = String(effectType || "").trim().toLowerCase();
  if (!normalizedEffectType) {
    return null;
  }

  if (normalizedEffectType === "shield") {
    return SKILL_VISUAL_EFFECT_PRESETS.barrier;
  }

  return null;
}

function pickElementalPreset(text: string, skillType: string, target: string) {
  if (includesAnyKeyword(text, ICE_KEYWORDS)) {
    return SKILL_VISUAL_EFFECT_PRESETS.ice;
  }

  if (includesAnyKeyword(text, FIRE_KEYWORDS)) {
    return target === "all_enemies"
      ? SKILL_VISUAL_EFFECT_PRESETS.tempest
      : SKILL_VISUAL_EFFECT_PRESETS.fire;
  }

  if (includesAnyKeyword(text, WATER_KEYWORDS)) {
    return target === "all_enemies"
      ? SKILL_VISUAL_EFFECT_PRESETS.tempest
      : SKILL_VISUAL_EFFECT_PRESETS.water;
  }

  if (includesAnyKeyword(text, LIGHTNING_KEYWORDS)) {
    return SKILL_VISUAL_EFFECT_PRESETS.lightning;
  }

  if (includesAnyKeyword(text, POISON_KEYWORDS)) {
    return SKILL_VISUAL_EFFECT_PRESETS.poison;
  }

  if (includesAnyKeyword(text, SLEEP_KEYWORDS) || skillType === "debuff") {
    return SKILL_VISUAL_EFFECT_PRESETS.sleep;
  }

  return null;
}

export function inferSkillVisualEffect(input: SkillVisualEffectResolverInput): CombatSkillVisualEffect | null {
  const skillId = String(input.skillId || "").trim();
  const skillType = String(input.skillType || "").trim().toLowerCase();
  const target = String(input.target || "").trim().toLowerCase();
  const normalizedText = [
    skillId,
    String(input.name || "").trim(),
    String(input.description || "").trim(),
    String(input.element || "").trim(),
  ]
    .filter(Boolean)
    .join(" ");

  if (!normalizedText && !skillType) {
    return null;
  }

  if (BASIC_ATTACK_IDS.has(skillId)) {
    return SKILL_VISUAL_EFFECT_PRESETS.basicSlash;
  }

  if (skillType === "shield" || includesAnyKeyword(normalizedText, SHIELD_KEYWORDS)) {
    return SKILL_VISUAL_EFFECT_PRESETS.barrier;
  }

  if (skillType === "heal" || includesAnyKeyword(normalizedText, HEAL_KEYWORDS)) {
    return SKILL_VISUAL_EFFECT_PRESETS.heal;
  }

  if (skillType === "buff" || (target === "self" && includesAnyKeyword(normalizedText, BUFF_KEYWORDS))) {
    return SKILL_VISUAL_EFFECT_PRESETS.radiance;
  }

  const elementalPreset = pickElementalPreset(normalizedText, skillType, target);
  if (elementalPreset) {
    return elementalPreset;
  }

  if (skillType === "dot") {
    return SKILL_VISUAL_EFFECT_PRESETS.poison;
  }

  if (target === "all_enemies" || skillType === "aoe" || includesAnyKeyword(normalizedText, TEMPEST_KEYWORDS)) {
    return SKILL_VISUAL_EFFECT_PRESETS.tempest;
  }

  if (skillType === "debuff" || includesAnyKeyword(normalizedText, DEBUFF_KEYWORDS)) {
    return SKILL_VISUAL_EFFECT_PRESETS.lightning;
  }

  if (skillType === "attack") {
    return SKILL_VISUAL_EFFECT_PRESETS.basicSlash;
  }

  return SKILL_VISUAL_EFFECT_PRESETS.physicalHit;
}

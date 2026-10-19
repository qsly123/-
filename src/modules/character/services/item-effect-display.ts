import { sanitizePlayerFacingLabel } from "@/modules/shared/services/player-facing-copy";

export type ItemEffectDisplayEntry = {
  type?: string;
  value?: number;
  skillId?: string;
  skillName?: string | null;
  avatarId?: string;
  avatarName?: string | null;
  avatarFrameId?: string;
  avatarFrameName?: string | null;
  duration?: number;
};

export const ITEM_EFFECT_TYPE_NAMES: Record<string, string> = {
  heal_hp: "恢复气血",
  heal_mp: "恢复灵力",
  heal_stamina: "恢复体力",
  boost_breakthrough: "突破加成",
  boost_atk: "攻击加成",
  boost_def: "防御加成",
  boost_xp: "修为加成",
  boost_hp: "气血加成",
  boost_mp: "灵力加成",
  boost_speed: "遁速加成",
  boost_luck: "幸运加成",
  boost_spiritual_sense: "神识加成",
  boost_armor_penetration: "破防加成",
  boost_block: "格挡加成",
  boost_skill_damage_bonus: "神通增伤",
  boost_skill_damage_reduction: "神通减伤",
  boost_artifact_damage_bonus: "法宝增伤",
  boost_artifact_damage_reduction: "法宝减伤",
  learn_skill: "参悟神通",
  bind_skill: "绑定神通",
  unlock_avatar: "激活头像",
  unlock_avatar_frame: "激活头像框",
};

export function formatItemEffectRateValue(value: number) {
  if (Math.abs(value) <= 1) {
    const percentValue = value * 100;
    return Number.isInteger(percentValue) ? `${percentValue}%` : `${percentValue.toFixed(1)}%`;
  }
  return `${value}`;
}

export function formatItemEffectText(effect: ItemEffectDisplayEntry) {
  const type = typeof effect.type === "string" ? effect.type : "unknown";
  const value = Number(effect.value || 0);

  if (type === "heal_hp") return `恢复气血 +${value}`;
  if (type === "heal_mp") return `恢复灵力 +${value}`;
  if (type === "heal_stamina") return `恢复体力 +${value}`;
  if (type === "boost_breakthrough") return `突破成功率 +${formatItemEffectRateValue(value)}`;
  if (type === "boost_atk") return `攻击 +${value}`;
  if (type === "boost_def") return `防御 +${value}`;
  if (type === "boost_xp") return `修为 +${value}`;
  if (type === "boost_hp") return `最大气血 +${value}`;
  if (type === "boost_mp") return `最大灵力 +${value}`;
  if (type === "boost_speed") return `遁速 +${value}`;
  if (type === "boost_luck") return `幸运 +${value}`;
  if (type === "boost_spiritual_sense") return `神识 +${value}`;
  if (type === "boost_armor_penetration") return `破防 +${value}`;
  if (type === "boost_block") return `格挡 +${value}`;
  if (type === "boost_skill_damage_bonus") return `神通增伤 +${value}%`;
  if (type === "boost_skill_damage_reduction") return `神通减伤 +${value}%`;
  if (type === "boost_artifact_damage_bonus") return `法宝增伤 +${value}%`;
  if (type === "boost_artifact_damage_reduction") return `法宝减伤 +${value}%`;
  if (type === "learn_skill") return `参悟神通 ${sanitizePlayerFacingLabel(effect.skillName, "未知神通")}`;
  if (type === "bind_skill") return `绑定神通 ${sanitizePlayerFacingLabel(effect.skillName, "未命名神通")}`;
  if (type === "unlock_avatar") return `激活头像 ${sanitizePlayerFacingLabel(effect.avatarName, "未知头像")}`;
  if (type === "unlock_avatar_frame") return `激活头像框 ${sanitizePlayerFacingLabel(effect.avatarFrameName, "未知头像框")}`;

  const label = ITEM_EFFECT_TYPE_NAMES[type] || "特殊效果";
  const valueText = Number.isFinite(value) && value !== 0 ? ` ${value > 0 ? "+" : ""}${value}` : "";
  return `${label}${valueText}`;
}

export function buildItemEffectExtraText(effect: ItemEffectDisplayEntry) {
  const extras: string[] = [];
  if (effect.duration) {
    extras.push(`持续 ${effect.duration}`);
  }
  if (effect.skillName) {
    extras.push(`关联神通 ${sanitizePlayerFacingLabel(effect.skillName, "未命名神通")}`);
  }
  if (effect.avatarName) {
    extras.push(`关联头像 ${sanitizePlayerFacingLabel(effect.avatarName, "未知头像")}`);
  }
  if (effect.avatarFrameName) {
    extras.push(`关联头像框 ${sanitizePlayerFacingLabel(effect.avatarFrameName, "未知头像框")}`);
  }
  return extras.join("，");
}

export function enrichItemEffectsForDisplay<T extends ItemEffectDisplayEntry>(effects: T[]) {
  return effects.map((effect) => {
    const { skillId, avatarId, avatarFrameId, ...safeEffect } = effect;
    void skillId;
    void avatarId;
    void avatarFrameId;
    return {
      ...safeEffect,
      label: ITEM_EFFECT_TYPE_NAMES[String(effect.type || "")] || "特殊效果",
      text: formatItemEffectText(effect),
      extraText: buildItemEffectExtraText(effect),
    };
  });
}

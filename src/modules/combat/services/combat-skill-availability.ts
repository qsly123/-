import type { CombatUnit, SkillEffect } from "@/types/game";

type SkillAvailabilitySnapshot = {
  id?: string;
  skillType?: string | null;
  mpCost?: number | null;
  effects?: SkillEffect[] | null;
};

export function hasActiveShieldEffect(unit?: Pick<CombatUnit, "activeEffects"> | null) {
  return Boolean(unit?.activeEffects?.some((effect) => (
    effect.type === "shield" && Number(effect.remainingTurns || 0) > 0
  )));
}

export function isShieldSkill(skill?: SkillAvailabilitySnapshot | null) {
  if (!skill) {
    return false;
  }

  if (skill.skillType === "shield") {
    return true;
  }

  return Array.isArray(skill.effects) && skill.effects.some((effect) => effect.type === "shield");
}

export function canCombatUnitUseSkill(params: {
  unit: CombatUnit;
  skillId: string;
  skill?: SkillAvailabilitySnapshot | null;
}) {
  const { unit, skillId, skill } = params;
  if (!skill) {
    return false;
  }

  const cooldownLeft = Number(unit.skillCooldowns?.[skillId] || 0);
  if (cooldownLeft > 0) {
    return false;
  }

  if (unit.mp < Math.max(0, Number(skill.mpCost || 0))) {
    return false;
  }

  if (hasActiveShieldEffect(unit) && isShieldSkill(skill)) {
    return false;
  }

  return true;
}

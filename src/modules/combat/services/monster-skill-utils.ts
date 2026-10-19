import type { SkillEffectsPayload } from "@/types/game";
import { inferSkillVisualEffect } from "@/modules/shared/services/skill-visual-effect-presets";

export const BASIC_MONSTER_SKILL_ID = "skill_basic_attack";
export const BASIC_ATTACK_RUNTIME_COOLDOWN = 0;

export type BuiltinMonsterBasicAttackSkill = {
  id: typeof BASIC_MONSTER_SKILL_ID;
  name: string;
  description: string;
  createdAt: string;
  minRealm: number | null;
  skillType: string;
  element: string | null;
  damageBase: number;
  damageMultiplier: number;
  mpCost: number;
  cooldown: number;
  effects: SkillEffectsPayload;
  maxRealm: number | null;
  target: string;
  sourceType: "monster";
};

export function normalizeMonsterCombatSkillIds(rawSkills: unknown) {
  const deduped = new Set<string>();

  if (Array.isArray(rawSkills)) {
    for (const rawSkillId of rawSkills) {
      if (typeof rawSkillId !== "string") {
        continue;
      }
      const skillId = rawSkillId.trim();
      if (!skillId) {
        continue;
      }
      deduped.add(skillId);
    }
  }

  deduped.add(BASIC_MONSTER_SKILL_ID);
  return Array.from(deduped);
}

export function isBasicAttackSkillId(skillId?: string | null) {
  return skillId === BASIC_MONSTER_SKILL_ID;
}

export function normalizeCombatSkillCooldown(skillId: string, cooldown: number) {
  if (isBasicAttackSkillId(skillId)) {
    return BASIC_ATTACK_RUNTIME_COOLDOWN;
  }
  return Math.max(0, Math.floor(Number(cooldown) || 0));
}

export function ensureCombatSkillIdsWithBasicAttack(skillIds: string[]) {
  const deduped = new Set<string>();
  for (const rawSkillId of skillIds) {
    if (typeof rawSkillId !== "string") {
      continue;
    }
    const skillId = rawSkillId.trim();
    if (!skillId) {
      continue;
    }
    deduped.add(skillId);
  }
  deduped.add(BASIC_MONSTER_SKILL_ID);
  return Array.from(deduped);
}

export function createBuiltinMonsterBasicAttackSkill(): BuiltinMonsterBasicAttackSkill {
  return {
    id: BASIC_MONSTER_SKILL_ID,
    name: "基础攻击",
    description: "怪物的基础攻击，不消耗灵气。",
    createdAt: new Date(0).toISOString(),
    minRealm: null,
    skillType: "attack",
    element: null,
    damageBase: 0,
    damageMultiplier: 1,
    mpCost: 0,
    cooldown: BASIC_ATTACK_RUNTIME_COOLDOWN,
    effects: {
      effects: [],
      visualEffect: inferSkillVisualEffect({
        skillId: BASIC_MONSTER_SKILL_ID,
        name: "基础攻击",
        description: "怪物的基础攻击，不消耗灵气。",
        skillType: "attack",
        target: "enemy",
        sourceType: "monster",
      }),
    },
    maxRealm: null,
    target: "enemy",
    sourceType: "monster",
  };
}

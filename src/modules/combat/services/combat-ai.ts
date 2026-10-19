import type { CombatUnit } from "@/types/game";
import { canCombatUnitUseSkill } from "@/modules/combat/services/combat-skill-availability";
import {
  resolveCombatSkillContact,
  type CombatScenePositions,
} from "@/modules/combat/services/combat-spatial";

export type CombatAiSkillSnapshot = {
  id?: string;
  name: string;
  skillType?: string;
  mpCost: number;
  target?: string | null;
};

export type CombatAutoActionDecision = {
  skillId: string;
  contactOutcome: "hit" | "graze" | "miss";
  orderedIndex: number;
};

function canUseSkill(unit: CombatUnit, skill?: CombatAiSkillSnapshot | null) {
  return canCombatUnitUseSkill({
    unit,
    skillId: skill?.id || "",
    skill,
  });
}

function isEnemyFacingSkill(target?: string | null) {
  return target === "enemy" || target === "all_enemies";
}

function isDamageSkill(skill?: CombatAiSkillSnapshot | null) {
  return skill?.skillType === "attack" || skill?.skillType === "aoe" || skill?.skillType === "dot";
}

function isOffensiveSkill(skill?: CombatAiSkillSnapshot | null) {
  return isEnemyFacingSkill(skill?.target) && (
    isDamageSkill(skill)
    || skill?.skillType === "debuff"
  );
}

function isAutoBattleOffensiveSkill(skillId: string, skill?: CombatAiSkillSnapshot | null) {
  return skillId === "skill_basic_attack" || isOffensiveSkill(skill);
}

function buildOrderedSkillIds(params: {
  unit: CombatUnit;
  preferredRotation?: string[];
  rotationCursor?: number;
}) {
  const unique = new Set<string>();
  const ordered: string[] = [];
  const preferredRotation = Array.isArray(params.preferredRotation)
    ? params.preferredRotation
    : [];
  const normalizedCursor = preferredRotation.length > 0
    ? Math.max(0, params.rotationCursor ?? 0) % preferredRotation.length
    : 0;

  for (let offset = 0; offset < preferredRotation.length; offset += 1) {
    const skillId = preferredRotation[(normalizedCursor + offset) % preferredRotation.length];
    if (!params.unit.skills.includes(skillId) || unique.has(skillId)) {
      continue;
    }
    unique.add(skillId);
    ordered.push(skillId);
  }

  for (const skillId of params.unit.skills) {
    if (unique.has(skillId)) {
      continue;
    }
    unique.add(skillId);
    ordered.push(skillId);
  }

  if (!ordered.length) {
    ordered.push("skill_basic_attack");
  }

  return ordered;
}

export function pickSharedEnemySkillId(params: {
  unit: CombatUnit;
  skills: Record<string, CombatAiSkillSnapshot | undefined>;
  aliveEnemyCount: number;
}) {
  const skillIds = params.unit.skills.length > 0 ? params.unit.skills : ["skill_basic_attack"];
  const usableSkills = skillIds
    .map((skillId) => ({ skillId, skill: params.skills[skillId] || null }))
    .filter(({ skill }) => canUseSkill(params.unit, skill));

  if (!usableSkills.length) {
    return "skill_basic_attack";
  }

  const damageSkills = usableSkills.filter(({ skill, skillId }) => (
    skillId === "skill_basic_attack" || isDamageSkill(skill)
  ));
  const offensiveSkills = usableSkills.filter(({ skill, skillId }) => (
    skillId === "skill_basic_attack" || isOffensiveSkill(skill)
  ));
  const zeroCostSkills = usableSkills.filter(({ skill }) => Number(skill?.mpCost || 0) <= 0);
  const zeroCostDamageSkills = damageSkills.filter(({ skill }) => Number(skill?.mpCost || 0) <= 0);
  const basicSkill = usableSkills.find(({ skillId }) => skillId === "skill_basic_attack");

  if (params.unit.mp <= 0 && zeroCostSkills.length > 0) {
    const aoeSkill = zeroCostDamageSkills.find(({ skill }) => skill?.target === "all_enemies");
    return aoeSkill?.skillId
      || basicSkill?.skillId
      || zeroCostDamageSkills[0]?.skillId
      || zeroCostSkills[0]?.skillId
      || "skill_basic_attack";
  }

  if (params.aliveEnemyCount >= 2 && damageSkills.length > 0) {
    const aoeSkill = damageSkills.find(({ skill }) => skill?.target === "all_enemies");
    if (aoeSkill?.skillId) {
      return aoeSkill.skillId;
    }
  }

  if (basicSkill?.skillId && damageSkills.length > 0) {
    return basicSkill.skillId;
  }

  if (damageSkills[0]?.skillId) {
    return damageSkills[0].skillId;
  }

  if (offensiveSkills[0]?.skillId) {
    return offensiveSkills[0].skillId;
  }

  return basicSkill?.skillId || usableSkills[0]?.skillId || "skill_basic_attack";
}

export function pickTimedAutoActionSkillId(params: {
  unit: CombatUnit;
  skills: Record<string, CombatAiSkillSnapshot | undefined>;
}) {
  const skillIds = params.unit.skills.length > 0 ? params.unit.skills : ["skill_basic_attack"];
  const basicAttack = skillIds.find((skillId) => skillId === "skill_basic_attack");
  if (basicAttack && canUseSkill(params.unit, params.skills[basicAttack] || null)) {
    return basicAttack;
  }

  const zeroCostDamageSkill = skillIds.find((skillId) => {
    const skill = params.skills[skillId];
    return isDamageSkill(skill) && canUseSkill(params.unit, skill || null) && Number(skill?.mpCost || 0) <= 0;
  });
  if (zeroCostDamageSkill) {
    return zeroCostDamageSkill;
  }

  const firstUsableDamageSkill = skillIds.find((skillId) => {
    const skill = params.skills[skillId];
    return isDamageSkill(skill) && canUseSkill(params.unit, skill || null);
  });
  if (firstUsableDamageSkill) {
    return firstUsableDamageSkill;
  }

  const firstUsableOffensiveSkill = skillIds.find((skillId) => {
    const skill = params.skills[skillId];
    return isOffensiveSkill(skill) && canUseSkill(params.unit, skill || null);
  });
  if (firstUsableOffensiveSkill) {
    return firstUsableOffensiveSkill;
  }

  return basicAttack || skillIds[0] || "skill_basic_attack";
}

export function pickCombatAutoMovementAnchorSkillId(params: {
  unit: CombatUnit;
  skills: Record<string, CombatAiSkillSnapshot | undefined>;
  preferredRotation?: string[];
  rotationCursor?: number;
}) {
  const orderedSkillIds = buildOrderedSkillIds({
    unit: params.unit,
    preferredRotation: params.preferredRotation,
    rotationCursor: params.rotationCursor,
  });

  let firstOffensiveSkillId: string | null = null;
  let firstKnownSkillId: string | null = null;

  for (const skillId of orderedSkillIds) {
    const skill = params.skills[skillId] || null;
    if (!firstKnownSkillId && (skill || skillId === "skill_basic_attack")) {
      firstKnownSkillId = skillId;
    }

    if (!isAutoBattleOffensiveSkill(skillId, skill)) {
      continue;
    }

    if (!firstOffensiveSkillId) {
      firstOffensiveSkillId = skillId;
    }

    if (canUseSkill(params.unit, skill)) {
      return skillId;
    }
  }

  return firstOffensiveSkillId || firstKnownSkillId || orderedSkillIds[0] || null;
}

export function pickCombatAutoActionDecision(params: {
  unit: CombatUnit;
  skills: Record<string, CombatAiSkillSnapshot | undefined>;
  preferredRotation?: string[];
  rotationCursor?: number;
  actorIsPlayer: boolean;
  positions?: CombatScenePositions | null;
}) {
  const orderedSkillIds = buildOrderedSkillIds({
    unit: params.unit,
    preferredRotation: params.preferredRotation,
    rotationCursor: params.rotationCursor,
  });

  let firstUsableOffensiveMiss: CombatAutoActionDecision | null = null;
  let firstUsableSupportDecision: CombatAutoActionDecision | null = null;

  for (let index = 0; index < orderedSkillIds.length; index += 1) {
    const skillId = orderedSkillIds[index];
    const skill = params.skills[skillId] || null;
    if (!canUseSkill(params.unit, skill)) {
      continue;
    }

    const contact = resolveCombatSkillContact({
      actorIsPlayer: params.actorIsPlayer,
      skillType: skill?.skillType,
      skillId,
      positions: params.positions,
    });

    const nextDecision = {
      skillId,
      contactOutcome: contact.outcome,
      orderedIndex: index,
    } satisfies CombatAutoActionDecision;

    if (isAutoBattleOffensiveSkill(skillId, skill)) {
      if (contact.outcome !== "miss") {
        return nextDecision;
      }

      if (!firstUsableOffensiveMiss) {
        firstUsableOffensiveMiss = nextDecision;
      }
      continue;
    }

    if (!firstUsableSupportDecision) {
      firstUsableSupportDecision = nextDecision;
    }

    if (contact.outcome !== "miss" && !firstUsableOffensiveMiss) {
      return nextDecision;
    }
  }

  return firstUsableOffensiveMiss || firstUsableSupportDecision;
}

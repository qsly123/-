import type {
  ActiveEffect,
  CombatLogEntry,
  CombatState,
  CombatUnit,
  SkillEffect,
  SkillSourceType,
} from "@/types/game";
import type { DamageCalculator } from "@/modules/combat/services/damage-formula";
import {
  applyShieldMitigation,
  calculateCombatDamageOutcome,
  calculateHealAmount,
  normalizeShieldRatioForDisplay,
} from "@/modules/combat/services/combat-mechanics";
import {
  resolveCombatSkillContact,
  type CombatScenePositions,
} from "@/modules/combat/services/combat-spatial";
import { normalizeCombatSkillCooldown } from "@/modules/combat/services/monster-skill-utils";
import { STATUS_NAMES } from "@/modules/shared/constants";

type SkillActionData = {
  name: string;
  skillType: string;
  sourceType?: SkillSourceType;
  damageBase: number;
  damageMultiplier: number;
  mpCost: number;
  cooldown: number;
  effects: SkillEffect[];
  target: string;
  visualEffect?: CombatLogEntry["visualEffect"];
};

type ItemActionData = {
  name: string;
  effects: Array<{ type: string; value: number }>;
};

function pushLog(log: CombatLogEntry[], entry: CombatLogEntry) {
  log.push(entry);
}

function getStatusName(type: string) {
  return STATUS_NAMES[type] || type;
}

function getEffectActionName(type: string) {
  if (type === "poison") {
    return "\中\毒";
  }
  if (type === "burn") {
    return "\灼\烧";
  }
  return getStatusName(type);
}

export function createCombatState(
  combatId: string,
  player: CombatUnit,
  enemy: CombatUnit,
): CombatState {
  return {
    id: combatId,
    turn: 0,
    player,
    enemy,
    log: [],
    status: "ongoing",
  };
}

function processEffects(unit: CombatUnit, log: CombatLogEntry[], turn: number): void {
  for (const effect of unit.activeEffects) {
    switch (effect.type) {
      case "poison":
      case "burn": {
        const result = applyShieldMitigation(unit, effect.value);
        const action = getEffectActionName(effect.type);
        const extra = result.mpDamage > 0
          ? `\，\其\中 ${result.mpDamage} \点\由\护\盾\分\担\至\灵\力\。`
          : "\。";
        pushLog(log, {
          turn,
          actorName: unit.name,
          action,
          entryType: "status",
          actorId: unit.id,
          targetId: unit.id,
          damage: result.totalDamage,
          actorCurrentHp: unit.hp,
          actorCurrentMp: unit.mp,
          targetCurrentHp: unit.hp,
          targetCurrentMp: unit.mp,
          message: `${unit.name} \受\到${action}\伤\害 ${result.totalDamage}${extra}`,
        });
        break;
      }
      case "regen": {
        const heal = Math.max(0, Math.floor(Number(effect.value) || 0));
        if (heal > 0) {
          unit.hp = Math.min(unit.maxHp, unit.hp + heal);
          pushLog(log, {
            turn,
            actorName: unit.name,
            action: "\回\春",
            entryType: "status",
            actorId: unit.id,
            targetId: unit.id,
            heal,
            actorCurrentHp: unit.hp,
            targetCurrentHp: unit.hp,
            message: `${unit.name} \恢\复\气\血 ${heal}\。`,
          });
        }
        break;
      }
      case "freeze":
      case "stun":
        unit.isStunned = true;
        pushLog(log, {
          turn,
          actorName: unit.name,
          action: getStatusName(effect.type),
          entryType: "status",
          actorId: unit.id,
          targetId: unit.id,
          effects: [getStatusName(effect.type)],
          message: `${unit.name} \受\到${getStatusName(effect.type)}\影\响\，\本\回\合\无\法\行\动\。`,
        });
        break;
      default:
        break;
    }

    effect.remainingTurns -= 1;
  }

  unit.activeEffects = unit.activeEffects.filter((item) => item.remainingTurns > 0);
  unit.isStunned = unit.activeEffects.some((item) => item.type === "freeze" || item.type === "stun");
}

function getEffectiveStats(unit: CombatUnit) {
  let atk = unit.attack;
  let def = unit.defense;
  let spd = unit.speed;

  for (const effect of unit.activeEffects) {
    switch (effect.type) {
      case "atkUp":
        atk = Math.floor(atk * (1 + effect.value / 100));
        break;
      case "atkDown":
        atk = Math.floor(atk * (1 - effect.value / 100));
        break;
      case "defUp":
        def = Math.floor(def * (1 + effect.value / 100));
        break;
      case "defDown":
        def = Math.floor(def * (1 - effect.value / 100));
        break;
      case "speedDown":
        spd = Math.floor(spd * (1 - effect.value / 100));
        break;
      default:
        break;
    }
  }

  return {
    atk: Math.max(1, atk),
    def: Math.max(0, def),
    spd: Math.max(1, spd),
  };
}

function applySkillEffects(
  effects: SkillEffect[],
  target: CombatUnit,
  caster: CombatUnit,
  skillId: string,
  log: CombatLogEntry[],
  turn: number,
): void {
  for (const effect of effects) {
    if (Math.random() > effect.chance) {
      continue;
    }

    const activeEffect: ActiveEffect = {
      type: effect.type,
      value: effect.value,
      remainingTurns: effect.duration,
      sourceSkillId: skillId,
    };

    const existingIndex = target.activeEffects.findIndex((item) => item.type === effect.type);
    if (existingIndex >= 0) {
      target.activeEffects[existingIndex] = activeEffect;
    } else {
      target.activeEffects.push(activeEffect);
    }

    const effectName = getStatusName(effect.type);
    pushLog(log, {
      turn,
      actorName: caster.name,
      action: `\施\加${effectName}`,
      entryType: "status",
      actorId: caster.id,
      targetId: target.id,
      skillId,
      effects: [effectName],
      targetCurrentHp: target.hp,
      targetCurrentMp: target.mp,
      message: `${caster.name} \对 ${target.name} \施\加\了${effectName}\，\持\续 ${effect.duration} \回\合\。`,
    });
  }
}

function tickUnitSkillCooldowns(unit: CombatUnit): void {
  const currentCooldowns = unit.skillCooldowns || {};
  const nextCooldowns: Record<string, number> = {};
  for (const [skillId, turns] of Object.entries(currentCooldowns)) {
    const value = Number(turns || 0);
    if (value > 1) {
      nextCooldowns[skillId] = value - 1;
    }
  }
  unit.skillCooldowns = nextCooldowns;
}

function canUnitUseSkill(unit: CombatUnit, skillId: string, skillData?: SkillActionData) {
  if (!skillData) {
    return false;
  }

  const cooldownLeft = Number(unit.skillCooldowns?.[skillId] || 0);
  if (cooldownLeft > 0) {
    return false;
  }

  return unit.mp >= skillData.mpCost;
}

function isDamageEnemySkill(skillData?: SkillActionData) {
  return skillData?.skillType === "attack" || skillData?.skillType === "aoe" || skillData?.skillType === "dot";
}

function isOffensiveEnemySkill(skillData?: SkillActionData) {
  return (skillData?.target === "enemy" || skillData?.target === "all_enemies")
    && (
      isDamageEnemySkill(skillData)
      || skillData?.skillType === "debuff"
    );
}

function getSeededRatio(seedValue: number) {
  const raw = Math.sin(seedValue * 12.9898) * 43758.5453;
  return raw - Math.floor(raw);
}

export function pickCombatEnemySkillId(
  enemy: CombatUnit,
  allSkillsData?: Record<string, SkillActionData>,
  seedValue = 1,
) {
  const candidateSkills = enemy.skills.length > 0 ? enemy.skills : ["skill_basic_attack"];
  const readySkills = candidateSkills.filter((sid) => canUnitUseSkill(enemy, sid, allSkillsData?.[sid]));
  if (readySkills.length === 0) {
    return null;
  }

  const basicSkillId = readySkills.find((sid) => sid === "skill_basic_attack");
  const damageSkills = readySkills.filter((sid) => sid === "skill_basic_attack" || isDamageEnemySkill(allSkillsData?.[sid]));
  if (damageSkills.length === 0) {
    const offensiveSkills = readySkills.filter((sid) => sid === "skill_basic_attack" || isOffensiveEnemySkill(allSkillsData?.[sid]));
    if (offensiveSkills.length > 0) {
      return basicSkillId || offensiveSkills[0] || readySkills[0];
    }
    return basicSkillId || readySkills[0];
  }

  const specialDamageSkills = damageSkills.filter((sid) => sid !== basicSkillId);
  if (specialDamageSkills.length === 0) {
    return basicSkillId || readySkills[0];
  }

  if (basicSkillId && getSeededRatio(seedValue) < 0.65) {
    return basicSkillId;
  }

  const specialIndex = Math.floor(getSeededRatio(seedValue + readySkills.length + enemy.speed) * specialDamageSkills.length);
  return specialDamageSkills[specialIndex] || basicSkillId || damageSkills[0] || readySkills[0];
}

export function executeAction(
  state: CombatState,
  actorIsPlayer: boolean,
  actionType: "skill" | "item" | "flee",
  skillId?: string,
  skillData?: SkillActionData,
  itemData?: ItemActionData,
  damageCalculator?: DamageCalculator,
  scenePositions?: CombatScenePositions | null,
): CombatState {
  const actor = actorIsPlayer ? state.player : state.enemy;
  const target = actorIsPlayer ? state.enemy : state.player;

  if (actionType === "flee") {
    const fleeChance = 0.3 + (actor.speed - target.speed) * 0.05;
    const success = Math.random() < Math.max(0.1, Math.min(0.8, fleeChance));

    pushLog(state.log, {
      turn: state.turn,
      actorName: actor.name,
      action: success ? "\逃\跑\成\功" : "\逃\跑\失\败",
      entryType: "flee",
      actorId: actor.id,
      message: success
        ? `${actor.name} \成\功\脱\离\战\斗\。`
        : `${actor.name} \试\图\逃\跑\，\但\被\拦\下\了\。`,
    });

    if (success) {
      state.status = "fled";
    }
    return state;
  }

  if (actionType === "item") {
    if (!itemData) {
      pushLog(state.log, {
        turn: state.turn,
        actorName: actor.name,
        action: "\使\用\物\品\失\败",
        entryType: "item",
        actorId: actor.id,
        targetId: actor.id,
        message: `${actor.name} \想\要\使\用\物\品\，\但\没\有\产\生\效\果\。`,
      });
      return state;
    }

    const hpBefore = actor.hp;
    const mpBefore = actor.mp;
    for (const effect of itemData.effects || []) {
      if (!Number.isFinite(effect.value) || effect.value <= 0) {
        continue;
      }
      if (effect.type === "heal_hp") {
        actor.hp = Math.min(actor.maxHp, actor.hp + effect.value);
      }
      if (effect.type === "heal_mp") {
        actor.mp = Math.min(actor.maxMp, actor.mp + effect.value);
      }
    }

    const hpRecovered = actor.hp - hpBefore;
    const mpRecovered = actor.mp - mpBefore;
    const recoverText = [
      hpRecovered > 0 ? `\气\血 ${hpBefore} -> ${actor.hp}` : "",
      mpRecovered > 0 ? `\灵\力 ${mpBefore} -> ${actor.mp}` : "",
    ].filter(Boolean).join("\；");

    pushLog(state.log, {
      turn: state.turn,
      actorName: actor.name,
      action: itemData.name,
      entryType: "item",
      actorId: actor.id,
      targetId: actor.id,
      heal: Math.max(0, hpRecovered + mpRecovered),
      actorCurrentHp: actor.hp,
      actorCurrentMp: actor.mp,
      targetCurrentHp: actor.hp,
      targetCurrentMp: actor.mp,
      message: recoverText
        ? `${actor.name} \使\用\了${itemData.name}\，\恢\复\了${recoverText}\。`
        : `${actor.name} \使\用\了${itemData.name}\，\但\没\有\得\到\恢\复\。`,
    });
  }

  if (actionType === "skill" && skillData) {
    if (skillId) {
      const cooldownLeft = Number(actor.skillCooldowns?.[skillId] || 0);
      if (cooldownLeft > 0) {
        pushLog(state.log, {
          turn: state.turn,
          actorName: actor.name,
          action: "\技\能\冷\却",
          entryType: "system",
          actorId: actor.id,
          skillId,
          skillName: skillData.name,
          message: `${skillData.name} \冷\却\中\，\还\需 ${cooldownLeft} \回\合\。`,
        });
        return state;
      }
    }

    if (actor.mp < skillData.mpCost) {
      pushLog(state.log, {
        turn: state.turn,
        actorName: actor.name,
        action: "\灵\力\不\足",
        entryType: "system",
        actorId: actor.id,
        skillId,
        skillName: skillData.name,
        message: `${actor.name} \灵\力\不\足\，\无\法\施\展 ${skillData.name}\。`,
      });
      return state;
    }

    actor.mp -= skillData.mpCost;
    const effectTarget = skillData.target === "self" ? actor : target;
    let hasPrimaryActionLog = false;

    if (
      skillData.skillType === "attack"
      || skillData.skillType === "dot"
      || skillData.skillType === "aoe"
      || skillData.skillType === "debuff"
    ) {
      if (skillData.damageBase > 0 || skillData.damageMultiplier > 0) {
        const contact = resolveCombatSkillContact({
          actorIsPlayer,
          skillType: skillData.skillType,
          skillId,
          positions: scenePositions,
        });

        if (contact.outcome === "miss") {
          pushLog(state.log, {
            turn: state.turn,
            actorName: actor.name,
            action: skillData.name,
            entryType: "skill",
            actorId: actor.id,
            targetId: target.id,
            skillId,
            skillName: skillData.name,
            resultType: "miss",
            resultLabel: contact.resultLabel,
            visualEffect: skillData.visualEffect || null,
            actorCurrentHp: actor.hp,
            actorCurrentMp: actor.mp,
            targetCurrentHp: target.hp,
            targetCurrentMp: target.mp,
            message: `${actor.name} 施展 ${skillData.name}，${contact.messageSuffix || "未能命中。"}`
          });
          hasPrimaryActionLog = true;
        } else {
        const result = calculateCombatDamageOutcome({
          attacker: actor,
          defender: target,
          damageBase: skillData.damageBase,
          damageMultiplier: skillData.damageMultiplier,
          damageCalculator,
          sourceType: skillData.sourceType,
          damageScale: contact.damageScale,
        });
        const tags = [
          result.isCritical ? "\暴\击" : "",
          result.isBlocked ? "\格\挡" : "",
          contact.outcome === "graze" ? "\擦\中" : "",
          result.mpDamage > 0 ? `\护\盾\分\担\灵\力 ${result.mpDamage}` : "",
        ].filter(Boolean).join("\，");
        pushLog(state.log, {
          turn: state.turn,
          actorName: actor.name,
          action: skillData.name,
          entryType: "skill",
          actorId: actor.id,
          targetId: target.id,
          skillId,
          skillName: skillData.name,
          damage: result.totalDamage,
          visualEffect: skillData.visualEffect || null,
          actorCurrentHp: actor.hp,
          actorCurrentMp: actor.mp,
          targetCurrentHp: target.hp,
          targetCurrentMp: target.mp,
          resultType: contact.outcome === "graze" ? "graze" : undefined,
          message: `${actor.name} \施\展 ${skillData.name}\，\对 ${target.name} \造\成 ${result.totalDamage} \点\伤\害${tags ? `\（${tags}\）` : ""}${contact.messageSuffix ? contact.messageSuffix : "\。"}`,
        });
        hasPrimaryActionLog = true;
        }
      }
    }

    if (skillData.skillType === "heal") {
      const healAmount = calculateHealAmount(actor, skillData.sourceType);
      actor.hp = Math.min(actor.maxHp, actor.hp + healAmount);
      pushLog(state.log, {
        turn: state.turn,
        actorName: actor.name,
        action: skillData.name,
        entryType: "skill",
        actorId: actor.id,
        targetId: actor.id,
        skillId,
        skillName: skillData.name,
        heal: healAmount,
        visualEffect: skillData.visualEffect || null,
        actorCurrentHp: actor.hp,
        actorCurrentMp: actor.mp,
        targetCurrentHp: actor.hp,
        targetCurrentMp: actor.mp,
        message: `${actor.name} \施\展 ${skillData.name}\，\恢\复 ${healAmount} \点\气\血\。`,
      });
      hasPrimaryActionLog = true;
    }

    if (skillData.skillType === "shield") {
      const shieldEffect = skillData.effects.find((effect) => effect.type === "shield");
      const ratio = normalizeShieldRatioForDisplay(Number(shieldEffect?.value || 0));
      pushLog(state.log, {
        turn: state.turn,
        actorName: actor.name,
        action: skillData.name,
        entryType: "skill",
        actorId: actor.id,
        targetId: effectTarget.id,
        skillId,
        skillName: skillData.name,
        visualEffect: skillData.visualEffect || null,
        actorCurrentHp: actor.hp,
        actorCurrentMp: actor.mp,
        targetCurrentHp: effectTarget.hp,
        targetCurrentMp: effectTarget.mp,
        message: ratio > 0
          ? `${actor.name} \施\展 ${skillData.name}\，\开\启 ${ratio}% \伤\害\转\移\灵\力\护\盾\。`
          : `${actor.name} \施\展 ${skillData.name}\。`,
      });
      hasPrimaryActionLog = true;
    }

    if (!hasPrimaryActionLog) {
      pushLog(state.log, {
        turn: state.turn,
        actorName: actor.name,
        action: skillData.name,
        entryType: "skill",
        actorId: actor.id,
        targetId: effectTarget.id,
        skillId,
        skillName: skillData.name,
        visualEffect: skillData.visualEffect || null,
        actorCurrentHp: actor.hp,
        actorCurrentMp: actor.mp,
        targetCurrentHp: effectTarget.hp,
        targetCurrentMp: effectTarget.mp,
        message: `${actor.name} \施\展\了 ${skillData.name}\。`,
      });
    }

    if (skillData.effects && skillData.effects.length > 0) {
      applySkillEffects(skillData.effects, effectTarget, actor, skillId || "", state.log, state.turn);
    }

    if (skillId) {
      const normalizedCooldown = normalizeCombatSkillCooldown(skillId, skillData.cooldown);
      if (normalizedCooldown > 0) {
        actor.skillCooldowns[skillId] = normalizedCooldown + 1;
      }
    }
  }

  if (target.hp <= 0) {
    state.status = actorIsPlayer ? "player_win" : "enemy_win";
  }
  if (actor.hp <= 0) {
    state.status = actorIsPlayer ? "enemy_win" : "player_win";
  }

  return state;
}

export function executeTurn(
  state: CombatState,
  playerAction: "skill" | "item" | "flee",
  playerSkillId?: string,
  playerSkillData?: NonNullable<Parameters<typeof executeAction>[4]>,
  allSkillsData?: Record<string, NonNullable<Parameters<typeof executeAction>[4]>>,
  playerItemData?: NonNullable<Parameters<typeof executeAction>[5]>,
  damageCalculator?: DamageCalculator,
  scenePositions?: CombatScenePositions | null,
  enemySkillIdOverride?: string | null,
  options?: {
    forcePlayerFirst?: boolean;
  },
): CombatState {
  state.turn += 1;

  processEffects(state.player, state.log, state.turn);
  if (state.player.hp <= 0) {
    state.status = "enemy_win";
    return state;
  }

  processEffects(state.enemy, state.log, state.turn);
  if (state.enemy.hp <= 0) {
    state.status = "player_win";
    return state;
  }

  const playerSpeed = getEffectiveStats(state.player).spd;
  const enemySpeed = getEffectiveStats(state.enemy).spd;
  const playerFirst = options?.forcePlayerFirst ? true : playerSpeed >= enemySpeed;

  const doPlayerAction = () => {
    if (state.player.isStunned) {
      state.player.isStunned = false;
      return;
    }

    executeAction(
      state,
      true,
      playerAction,
      playerSkillId,
      playerSkillData,
      playerItemData,
      damageCalculator,
      scenePositions,
    );
  };

  const doEnemyAction = () => {
    if (state.status !== "ongoing") {
      return;
    }
    if (state.enemy.isStunned) {
      state.enemy.isStunned = false;
      return;
    }

    const chosenSkillId = enemySkillIdOverride || pickCombatEnemySkillId(
      state.enemy,
      allSkillsData,
      state.turn + state.enemy.speed + state.player.speed,
    );
    if (!chosenSkillId) {
      return;
    }

    const skillData = allSkillsData?.[chosenSkillId];
    if (skillData) {
      executeAction(state, false, "skill", chosenSkillId, skillData, undefined, damageCalculator, scenePositions);
    }
  };

  if (playerFirst) {
    doPlayerAction();
    if (state.status === "ongoing") {
      doEnemyAction();
    }
  } else {
    doEnemyAction();
    if (state.status === "ongoing") {
      doPlayerAction();
    }
  }

  tickUnitSkillCooldowns(state.player);
  tickUnitSkillCooldowns(state.enemy);
  return state;
}

export function executeEnemyAutoTurn(
  state: CombatState,
  allSkillsData?: Record<string, NonNullable<Parameters<typeof executeAction>[4]>>,
  damageCalculator?: DamageCalculator,
  scenePositions?: CombatScenePositions | null,
  enemySkillIdOverride?: string | null,
) {
  if (state.status !== "ongoing") {
    return state;
  }

  state.turn += 1;

  processEffects(state.player, state.log, state.turn);
  if (state.player.hp <= 0) {
    state.status = "enemy_win";
    return state;
  }

  processEffects(state.enemy, state.log, state.turn);
  if (state.enemy.hp <= 0) {
    state.status = "player_win";
    return state;
  }

  if (!state.enemy.isStunned) {
    const chosenSkillId = enemySkillIdOverride || pickCombatEnemySkillId(
      state.enemy,
      allSkillsData,
      state.turn + state.enemy.speed + state.player.speed,
    );

    if (chosenSkillId) {
      const skillData = allSkillsData?.[chosenSkillId];
      if (skillData) {
        executeAction(state, false, "skill", chosenSkillId, skillData, undefined, damageCalculator, scenePositions);
      }
    }
  } else {
    state.enemy.isStunned = false;
  }

  tickUnitSkillCooldowns(state.player);
  tickUnitSkillCooldowns(state.enemy);
  return state;
}

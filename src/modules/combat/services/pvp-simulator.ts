import type {
  ActiveEffect,
  CombatLogEntry,
  CombatSkillVisualEffect,
  CombatState,
  CombatUnit,
  SkillEffect,
  SkillSourceType,
} from "@/types/game";
import type { DamageCalculator } from "@/modules/combat/services/damage-formula";
import { canCombatUnitUseSkill } from "@/modules/combat/services/combat-skill-availability";
import {
  applyShieldMitigation,
  calculateCombatDamageOutcome,
  calculateHealAmount,
  normalizeShieldRatioForDisplay,
} from "@/modules/combat/services/combat-mechanics";
import { normalizeCombatSkillCooldown } from "@/modules/combat/services/monster-skill-utils";
import { STATUS_NAMES } from "@/modules/shared/constants";

export interface PvpSkillSnapshot {
  name: string;
  skillType: string;
  sourceType?: SkillSourceType;
  damageBase: number;
  damageMultiplier: number;
  mpCost: number;
  cooldown: number;
  effects: SkillEffect[];
  target: string;
  visualEffect?: CombatSkillVisualEffect | null;
}

interface SkillChoice {
  skillId: string;
  skill: PvpSkillSnapshot;
  nextCursor: number;
}

function getStatusName(type: string) {
  return STATUS_NAMES[type] || type;
}

function appendLog(log: CombatLogEntry[], entry: CombatLogEntry) {
  log.push(entry);
}

function cloneActiveEffectsSnapshot(activeEffects?: ActiveEffect[]) {
  return (activeEffects || []).map((effect) => ({ ...effect }));
}

function withCombatLogUnitSnapshot(
  entry: CombatLogEntry,
  actor?: CombatUnit | null,
  target?: CombatUnit | null,
): CombatLogEntry {
  return {
    ...entry,
    ...(actor ? { actorActiveEffects: cloneActiveEffectsSnapshot(actor.activeEffects) } : {}),
    ...(target ? { targetActiveEffects: cloneActiveEffectsSnapshot(target.activeEffects) } : {}),
  };
}

function cloneUnit(unit: CombatUnit): CombatUnit {
  return {
    ...unit,
    skills: [...unit.skills],
    skillCooldowns: { ...(unit.skillCooldowns || {}) },
    activeEffects: (unit.activeEffects || []).map((effect) => ({ ...effect })),
  };
}

function getEffectiveStats(unit: CombatUnit) {
  let attack = unit.attack;
  let defense = unit.defense;
  let speed = unit.speed;

  for (const effect of unit.activeEffects) {
    if (effect.type === "atkUp") {
      attack = Math.floor(attack * (1 + effect.value / 100));
      continue;
    }
    if (effect.type === "atkDown") {
      attack = Math.floor(attack * (1 - effect.value / 100));
      continue;
    }
    if (effect.type === "defUp") {
      defense = Math.floor(defense * (1 + effect.value / 100));
      continue;
    }
    if (effect.type === "defDown") {
      defense = Math.floor(defense * (1 - effect.value / 100));
      continue;
    }
    if (effect.type === "speedDown") {
      speed = Math.floor(speed * (1 - effect.value / 100));
    }
  }

  return {
    attack: Math.max(1, attack),
    defense: Math.max(0, defense),
    speed: Math.max(1, speed),
  };
}

function processEffects(unit: CombatUnit, log: CombatLogEntry[], turn: number) {
  const nextEffects: ActiveEffect[] = [];

  for (const effect of unit.activeEffects) {
    switch (effect.type) {
      case "poison":
      case "burn": {
        const result = applyShieldMitigation(unit, effect.value);
        const action = effect.type === "poison" ? "\中\毒" : "\灼\烧";
        const extra = result.mpDamage > 0
          ? `\，\其\中 ${result.mpDamage} \点\由\护\盾\分\担\至\灵\力\。`
          : "\。";
        appendLog(log, withCombatLogUnitSnapshot({
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
        }, unit, unit));
        break;
      }
      case "regen": {
        const heal = Math.max(0, Math.floor(Number(effect.value) || 0));
        if (heal > 0) {
          unit.hp = Math.min(unit.maxHp, unit.hp + heal);
          appendLog(log, withCombatLogUnitSnapshot({
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
          }, unit, unit));
        }
        break;
      }
      case "freeze":
      case "stun":
        appendLog(log, withCombatLogUnitSnapshot({
          turn,
          actorName: unit.name,
          action: getStatusName(effect.type),
          entryType: "status",
          actorId: unit.id,
          targetId: unit.id,
          effects: [getStatusName(effect.type)],
          message: `${unit.name} \处\于${getStatusName(effect.type)}\状\态\，\无\法\行\动\。`,
        }, unit, unit));
        break;
      default:
        break;
    }

    const nextEffect: ActiveEffect = {
      ...effect,
      remainingTurns: effect.remainingTurns - 1,
    };
    if (nextEffect.remainingTurns > 0) {
      nextEffects.push(nextEffect);
    }
  }

  unit.activeEffects = nextEffects;
  unit.isStunned = nextEffects.some((effect) => effect.type === "freeze" || effect.type === "stun");
}

function tickCooldowns(unit: CombatUnit) {
  const next: Record<string, number> = {};
  for (const [skillId, turns] of Object.entries(unit.skillCooldowns || {})) {
    const value = Number(turns || 0);
    if (value > 1) {
      next[skillId] = value - 1;
    }
  }
  unit.skillCooldowns = next;
}

function applySkillEffects(params: {
  effects: SkillEffect[];
  target: CombatUnit;
  caster: CombatUnit;
  skillId: string;
  turn: number;
  log: CombatLogEntry[];
}) {
  const { effects, target, caster, skillId, turn, log } = params;
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
    appendLog(log, withCombatLogUnitSnapshot({
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
    }, caster, target));
  }
}

function chooseSkill(params: {
  unit: CombatUnit;
  rotation: string[];
  cursor: number;
  skillsData: Record<string, PvpSkillSnapshot>;
}): SkillChoice | null {
  const { unit, rotation, cursor, skillsData } = params;

  const normalize = (sid: string): SkillChoice | null => {
    const skill = skillsData[sid];
    if (!canCombatUnitUseSkill({
      unit,
      skillId: sid,
      skill,
    })) {
      return null;
    }
    return { skillId: sid, skill, nextCursor: cursor };
  };

  if (rotation.length > 0) {
    for (let i = 0; i < rotation.length; i += 1) {
      const index = (cursor + i) % rotation.length;
      const skillId = rotation[index];
      const skill = skillsData[skillId];
      if (!canCombatUnitUseSkill({
        unit,
        skillId,
        skill,
      })) {
        continue;
      }
      return {
        skillId,
        skill,
        nextCursor: (index + 1) % rotation.length,
      };
    }
  }

  for (const sid of unit.skills) {
    const picked = normalize(sid);
    if (picked) {
      return picked;
    }
  }

  return null;
}

function resolveWinnerByState(state: CombatState) {
  if (state.enemy.hp <= 0) {
    state.status = "player_win";
    return;
  }
  if (state.player.hp <= 0) {
    state.status = "enemy_win";
  }
}

function executeSkillAction(params: {
  state: CombatState;
  actorIsPlayer: boolean;
  skillId: string;
  skill: PvpSkillSnapshot;
  damageCalculator?: DamageCalculator;
}) {
  const { state, actorIsPlayer, skillId, skill } = params;
  const actor = actorIsPlayer ? state.player : state.enemy;
  const target = actorIsPlayer ? state.enemy : state.player;
  const turn = state.turn;

  const cooldownLeft = Number(actor.skillCooldowns?.[skillId] || 0);
  if (cooldownLeft > 0) {
    appendLog(state.log, withCombatLogUnitSnapshot({
      turn,
      actorName: actor.name,
      action: "\技\能\冷\却",
      entryType: "system",
      actorId: actor.id,
      skillId,
      skillName: skill.name,
      message: `${actor.name} \的 ${skill.name} \冷\却\中\（\剩\余 ${cooldownLeft} \回\合\）\。`,
    }, actor, actor));
    return;
  }
  if (actor.mp < skill.mpCost) {
    appendLog(state.log, withCombatLogUnitSnapshot({
      turn,
      actorName: actor.name,
      action: "\灵\力\不\足",
      entryType: "system",
      actorId: actor.id,
      skillId,
      skillName: skill.name,
      message: `${actor.name} \灵\力\不\足\，\无\法\使\用 ${skill.name}\。`,
    }, actor, actor));
    return;
  }

  actor.mp -= skill.mpCost;
  const effectTarget = skill.target === "self" ? actor : target;
  let hasPrimaryActionLog = false;

  if (
    skill.skillType === "attack"
    || skill.skillType === "dot"
    || skill.skillType === "aoe"
    || skill.skillType === "debuff"
  ) {
    if (skill.damageBase > 0 || skill.damageMultiplier > 0) {
      const result = calculateCombatDamageOutcome({
        attacker: actor,
        defender: target,
        damageBase: skill.damageBase,
        damageMultiplier: skill.damageMultiplier,
        damageCalculator: params.damageCalculator,
        sourceType: skill.sourceType,
      });
      const tags = [
        result.isCritical ? "\暴\击" : "",
        result.isBlocked ? "\格\挡" : "",
        result.mpDamage > 0 ? `\护\盾\分\担\灵\力 ${result.mpDamage}` : "",
      ].filter(Boolean).join("\，");
      appendLog(state.log, withCombatLogUnitSnapshot({
        turn,
        actorName: actor.name,
        action: skill.name,
        entryType: "skill",
        actorId: actor.id,
        targetId: target.id,
        skillId,
        skillName: skill.name,
        visualEffect: skill.visualEffect,
        damage: result.totalDamage,
        actorCurrentHp: actor.hp,
        actorCurrentMp: actor.mp,
        targetCurrentHp: target.hp,
        targetCurrentMp: target.mp,
        message: `${actor.name} \使\用 ${skill.name}\，\对 ${target.name} \造\成 ${result.totalDamage} \点\伤\害${tags ? `\（${tags}\）` : ""}\。`,
      }, actor, target));
      hasPrimaryActionLog = true;
    }
  }

  if (skill.skillType === "heal") {
    const healAmount = calculateHealAmount(actor, skill.sourceType);
    actor.hp = Math.min(actor.maxHp, actor.hp + healAmount);
    appendLog(state.log, withCombatLogUnitSnapshot({
      turn,
      actorName: actor.name,
      action: skill.name,
      entryType: "skill",
      actorId: actor.id,
      targetId: actor.id,
      skillId,
      skillName: skill.name,
      visualEffect: skill.visualEffect,
      heal: healAmount,
      actorCurrentHp: actor.hp,
      actorCurrentMp: actor.mp,
      targetCurrentHp: actor.hp,
      targetCurrentMp: actor.mp,
      message: `${actor.name} \使\用 ${skill.name}\，\恢\复 ${healAmount} \点\气\血\。`,
    }, actor, actor));
    hasPrimaryActionLog = true;
  }

  if (skill.skillType === "shield") {
    const shieldEffect = skill.effects.find((effect) => effect.type === "shield");
    const ratio = normalizeShieldRatioForDisplay(Number(shieldEffect?.value || 0));
    appendLog(state.log, withCombatLogUnitSnapshot({
      turn,
      actorName: actor.name,
      action: skill.name,
      entryType: "skill",
      actorId: actor.id,
      targetId: effectTarget.id,
      skillId,
      skillName: skill.name,
      visualEffect: skill.visualEffect,
      actorCurrentHp: actor.hp,
      actorCurrentMp: actor.mp,
      targetCurrentHp: effectTarget.hp,
      targetCurrentMp: effectTarget.mp,
      message: ratio > 0
        ? `${actor.name} \使\用 ${skill.name}\，\开\启 ${ratio}% \伤\害\转\移\灵\力\护\盾\。`
        : `${actor.name} \使\用 ${skill.name}\。`,
    }, actor, effectTarget));
    hasPrimaryActionLog = true;
  }

  if (!hasPrimaryActionLog) {
    appendLog(state.log, withCombatLogUnitSnapshot({
      turn,
      actorName: actor.name,
      action: skill.name,
      entryType: "skill",
      actorId: actor.id,
      targetId: effectTarget.id,
      skillId,
      skillName: skill.name,
      visualEffect: skill.visualEffect,
      actorCurrentHp: actor.hp,
      actorCurrentMp: actor.mp,
      targetCurrentHp: effectTarget.hp,
      targetCurrentMp: effectTarget.mp,
      message: `${actor.name} \使\用\了 ${skill.name}\。`,
    }, actor, effectTarget));
  }

  if (skill.effects && skill.effects.length > 0) {
    applySkillEffects({
      effects: skill.effects,
      target: effectTarget,
      caster: actor,
      skillId,
      turn,
      log: state.log,
    });
  }

  const normalizedCooldown = normalizeCombatSkillCooldown(skillId, skill.cooldown);
  if (normalizedCooldown > 0) {
    actor.skillCooldowns[skillId] = normalizedCooldown + 1;
  }

  resolveWinnerByState(state);
}

function settleByRemainingHp(state: CombatState) {
  if (state.player.hp > state.enemy.hp) {
    state.status = "player_win";
  } else if (state.enemy.hp > state.player.hp) {
    state.status = "enemy_win";
  } else if (state.player.mp >= state.enemy.mp) {
    state.status = "player_win";
  } else {
    state.status = "enemy_win";
  }

  appendLog(state.log, withCombatLogUnitSnapshot({
    turn: state.turn,
    actorName: "\系\统",
    action: "\回\合\上\限",
    entryType: "system",
    message: "\达\到\回\合\上\限\，\按\剩\余\状\态\判\定\胜\负\。",
  }, state.player, state.enemy));
}

export function simulatePvpBattle(params: {
  combatId: string;
  player: CombatUnit;
  enemy: CombatUnit;
  playerRotation: string[];
  enemyRotation: string[];
  skillsData: Record<string, PvpSkillSnapshot>;
  maxTurns?: number;
  damageCalculator?: DamageCalculator;
}): CombatState {
  const maxTurns = Math.max(1, Math.floor(Number(params.maxTurns || 200)));
  const state: CombatState = {
    id: params.combatId,
    turn: 0,
    player: cloneUnit(params.player),
    enemy: cloneUnit(params.enemy),
    log: [
      {
        turn: 0,
        actorName: "\系\统",
        action: "\切\磋\开\始",
        entryType: "system",
        message: `${params.player.name} \与 ${params.enemy.name} \开\始\切\磋\。`,
      },
    ],
    status: "ongoing",
  };

  let playerCursor = 0;
  let enemyCursor = 0;

  while (state.status === "ongoing" && state.turn < maxTurns) {
    state.turn += 1;

    processEffects(state.player, state.log, state.turn);
    if (state.player.hp <= 0) {
      state.status = "enemy_win";
      break;
    }

    processEffects(state.enemy, state.log, state.turn);
    if (state.enemy.hp <= 0) {
      state.status = "player_win";
      break;
    }

    const playerSpeed = getEffectiveStats(state.player).speed;
    const enemySpeed = getEffectiveStats(state.enemy).speed;
    const order: Array<"player" | "enemy"> = playerSpeed >= enemySpeed
      ? ["player", "enemy"]
      : ["enemy", "player"];

    for (const side of order) {
      if (state.status !== "ongoing") {
        break;
      }

      const actor = side === "player" ? state.player : state.enemy;
      if (actor.isStunned) {
        actor.isStunned = false;
        continue;
      }

      const choice = side === "player"
        ? chooseSkill({
          unit: state.player,
          rotation: params.playerRotation,
          cursor: playerCursor,
          skillsData: params.skillsData,
        })
        : chooseSkill({
          unit: state.enemy,
          rotation: params.enemyRotation,
          cursor: enemyCursor,
          skillsData: params.skillsData,
        });

      if (!choice) {
        appendLog(state.log, withCombatLogUnitSnapshot({
          turn: state.turn,
          actorName: actor.name,
          action: "\无\可\用\技\能",
          entryType: "system",
          actorId: actor.id,
          message: `${actor.name} \当\前\无\可\用\技\能\。`,
        }, actor, actor));
        continue;
      }

      if (side === "player") {
        playerCursor = choice.nextCursor;
      } else {
        enemyCursor = choice.nextCursor;
      }

      executeSkillAction({
        state,
        actorIsPlayer: side === "player",
        skillId: choice.skillId,
        skill: choice.skill,
        damageCalculator: params.damageCalculator,
      });
    }

    tickCooldowns(state.player);
    tickCooldowns(state.enemy);
  }

  if (state.status === "ongoing") {
    settleByRemainingHp(state);
  }

  return state;
}

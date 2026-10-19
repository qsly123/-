import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { skills } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getPlayerSkillLoadout } from "@/modules/character/services/player-active-skills";
import { getPlayerCombatRateBonuses } from "@/modules/character/services/equipment-instance-service";
import { getPlayerCosmeticProfileById } from "@/modules/character/services/player-cosmetic-profile";
import {
  buildPlayerStatsSnapshot,
  buildPlayerStatsSnapshotWithEquipment,
} from "@/modules/character/services/player-stats";
import { mapSpiritualRootPercent } from "@/modules/character/services/framework";
import {
  buildPartyCombatViewState,
  createNormalPartyCombat,
  getPartyCombatEncounterRuntime,
} from "@/modules/combat/services/party-combat-service";
import {
  BASIC_ATTACK_RUNTIME_COOLDOWN,
  BASIC_MONSTER_SKILL_ID,
  createBuiltinMonsterBasicAttackSkill,
  ensureCombatSkillIdsWithBasicAttack,
  normalizeCombatSkillCooldown,
  normalizeMonsterCombatSkillIds,
} from "@/modules/combat/services/monster-skill-utils";
import { resolveCombatRealmByMapId } from "@/modules/combat/services/combat-realm-utils";
import { buildCombatBattleViewState } from "@/modules/combat/services/battle-view";
import { buildBattleRuntimeFromBattleView } from "@/modules/combat/services/battle-runtime";
import {
  getMonsterChebyshevDistance,
  isPlayerNearMonster,
  resolveMonsterCurrentPosition,
} from "@/modules/map/services/monster-position";
import { canStartCombatWithSecretRealmMonster } from "@/modules/map/services/secret-realm-instance-service";
import { setPendingCombatSession } from "@/modules/combat/services/pending-combat-session";
import {
  closePartyEncounter,
  getActivePartyEncounterByPlayerId,
  getEligiblePartyMembersNearMonster,
  getPartyGroupByPlayerId,
} from "@/modules/social/infrastructure/party-service";
import { resolveSkillEffectsPayload } from "@/modules/shared/services/skill-visual-effect";
import { getRuntimeMonsterById } from "@/modules/map/services/runtime-monster-store";
import {
  assertCanEngageWorldNpc,
  getWorldNpcCombatTarget,
  isWorldNpcMonsterId,
  occupyWorldNpcForCombat,
  releaseWorldNpcCombatOccupation,
  resolveWorldNpcIdFromMonsterId,
} from "@/modules/world/services/world-npc-service";
import {
  canOpenWorldAssassinationStartCombat,
  consumeOpenWorldAssassinationCombat,
} from "@/modules/world/services/world-player-conflict-runtime";
import type { CombatState, CombatUnit } from "@/types/game";

type CombatStartSkill = typeof skills.$inferSelect & {
  sourceType?: "learned" | "artifact" | "monster";
};

function createBuiltinPlayerBasicAttackSkill(): CombatStartSkill {
  return {
    id: BASIC_MONSTER_SKILL_ID,
    name: "基础攻击",
    description: "角色的基础攻击，不消耗灵气。",
    createdAt: new Date(0).toISOString(),
    minRealm: null,
    maxRealm: null,
    skillType: "attack",
    element: null,
    damageBase: 0,
    damageMultiplier: 1,
    mpCost: 0,
    cooldown: BASIC_ATTACK_RUNTIME_COOLDOWN,
    effects: {
      effects: [],
      visualEffect: null,
    },
    target: "enemy",
    sourceType: "learned",
  };
}

function toCombatSkillSnapshot(skill: CombatStartSkill) {
  const normalized = resolveSkillEffectsPayload(skill.effects, skill);
  return {
    name: skill.name,
    skillType: skill.skillType,
    sourceType: "sourceType" in skill ? skill.sourceType : undefined,
    damageBase: skill.damageBase,
    damageMultiplier: skill.damageMultiplier,
    mpCost: skill.mpCost,
    cooldown: normalizeCombatSkillCooldown(skill.id, skill.cooldown),
    effects: normalized.effects,
    target: skill.target,
    visualEffect: normalized.visualEffect,
  };
}

const FALLBACK_PLAYER_SKILL_IDS = ["skill_basic_attack"];

function normalizeObservedCoordinate(value: unknown) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.floor(Number(value));
}

function normalizeCombatMonsterId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized.includes("%")) {
    return normalized;
  }
  try {
    return decodeURIComponent(normalized).trim();
  } catch {
    return normalized;
  }
}

function canUseObservedMonsterPosition(params: {
  playerMapId: string | null;
  playerPositionX: number;
  playerPositionY: number;
  monster: {
    mapId: string;
    positionX: number;
    positionY: number;
    currentPositionX: number | null;
    currentPositionY: number | null;
  };
  observedMonsterPositionX: number | null;
  observedMonsterPositionY: number | null;
}) {
  if (
    params.observedMonsterPositionX === null
    || params.observedMonsterPositionY === null
    || !params.playerMapId
    || params.playerMapId !== params.monster.mapId
  ) {
    return false;
  }

  const distanceToObserved = getMonsterChebyshevDistance({
    playerPositionX: params.playerPositionX,
    playerPositionY: params.playerPositionY,
    monsterPositionX: params.observedMonsterPositionX,
    monsterPositionY: params.observedMonsterPositionY,
  });
  if (distanceToObserved > 1) {
    return false;
  }

  const actualPosition = resolveMonsterCurrentPosition(params.monster);
  const driftDistance = getMonsterChebyshevDistance({
    playerPositionX: params.observedMonsterPositionX,
    playerPositionY: params.observedMonsterPositionY,
    monsterPositionX: actualPosition.positionX,
    monsterPositionY: actualPosition.positionY,
  });

  return driftDistance <= 2;
}

async function loadPlayerStatsSnapshot(player: NonNullable<Awaited<ReturnType<typeof getCurrentPlayer>>>) {
  try {
    return await buildPlayerStatsSnapshot(player);
  } catch (error) {
    console.error("Combat start stats fallback:", { playerId: player.id }, error);
    return buildPlayerStatsSnapshotWithEquipment(
      player,
      null,
      null,
      null,
      mapSpiritualRootPercent(player.spiritualRoot),
    );
  }
}

async function loadPlayerCosmetics(playerId: string) {
  try {
    return await getPlayerCosmeticProfileById(playerId);
  } catch (error) {
    console.error("Combat start cosmetics fallback:", { playerId }, error);
    return {
      avatarId: null,
      avatarImageUrl: null,
      avatarFrameId: null,
      avatarFrameImageUrl: null,
    };
  }
}

async function loadPlayerSkillLoadout(playerId: string, realm: number) {
  try {
    return await getPlayerSkillLoadout({
      playerId,
      realm,
    });
  } catch (error) {
    console.error("Combat start skill loadout fallback:", { playerId, realm }, error);
    return null;
  }
}

async function buildPlayerSkillPayload(playerId: string, realm: number, fallbackSkillIds?: string[]) {
  const loadout = await loadPlayerSkillLoadout(playerId, realm);
  const playerSkillRows = loadout?.activeSkills || [];
  const basePlayerSkillIds = playerSkillRows.length > 0
    ? playerSkillRows.map((row) => row.id)
    : (fallbackSkillIds && fallbackSkillIds.length > 0 ? fallbackSkillIds : FALLBACK_PLAYER_SKILL_IDS);
  const playerSkillIds = ensureCombatSkillIdsWithBasicAttack(basePlayerSkillIds);

  const skillMap: Record<string, CombatStartSkill> = {};
  for (const row of playerSkillRows) {
    skillMap[row.id] = row;
  }

  const missingIds = playerSkillIds.filter((skillId) => !skillMap[skillId]);
  if (missingIds.length > 0) {
    const missingRows = await db.select().from(skills).where(inArray(skills.id, missingIds)).all();
    for (const row of missingRows) {
      skillMap[row.id] = row;
    }
  }

  return {
    playerSkillIds,
    skillRotation: ensureCombatSkillIdsWithBasicAttack(loadout?.skillRotation?.length ? loadout.skillRotation : playerSkillIds),
    skillsData: Object.fromEntries(
      Object.entries(skillMap).map(([skillId, skill]) => [skillId, toCombatSkillSnapshot(skill)]),
    ),
  };
}

async function buildPartyCombatStartResponse(params: {
  playerId: string;
  monsterId: string;
  partyCombatId: string;
  playerRealm: number;
}) {
  const runtime = await getPartyCombatEncounterRuntime({
    encounterId: params.partyCombatId,
    allowStatuses: ["ongoing", "resolved"],
  });
  if (!runtime) {
    await closePartyEncounter({
      encounterId: params.partyCombatId,
      status: "abandoned",
    }).catch(() => null);
    return NextResponse.json({ success: false, error: "组队战斗不存在或已结束" }, { status: 404 });
  }

  if (runtime.encounter.encounterType !== "normal" || runtime.encounter.monsterId !== params.monsterId) {
    await closePartyEncounter({
      encounterId: params.partyCombatId,
      status: "abandoned",
      state: runtime.state,
      turnState: runtime.turnState,
      sceneSnapshot: runtime.sceneSnapshot as Record<string, unknown> | null,
      eligibleMemberIds: runtime.turnState.eligibleMemberIds || runtime.state.eligibleMemberIds || [],
    }).catch(() => null);
    return NextResponse.json({ success: false, error: "组队战斗已失效，请返回地图后重新发起" }, { status: 404 });
  }

  if (!runtime.turnState.eligibleMemberIds?.includes(params.playerId)) {
    return NextResponse.json({ success: false, error: "你不在本次组队战名单中" }, { status: 403 });
  }

  const visibleState = buildPartyCombatViewState(runtime.state, params.playerId);
  const viewerUnit = visibleState.participants?.find((unit) => unit.id === params.playerId) || visibleState.player;
  const skillPayload = await buildPlayerSkillPayload(params.playerId, params.playerRealm, viewerUnit.skills);
  const battleView = buildCombatBattleViewState({
    runtimeId: runtime.encounter.id,
    mode: "party",
    state: visibleState,
    sceneSnapshot: runtime.sceneSnapshot,
    turnState: runtime.turnState,
    viewerPlayerId: params.playerId,
  });
  const battleRuntime = buildBattleRuntimeFromBattleView({
    battleView,
    sceneSnapshot: runtime.sceneSnapshot,
    turnState: runtime.turnState,
  });

  return NextResponse.json({
    success: true,
    data: {
      combatId: runtime.encounter.id,
      partyCombatId: runtime.encounter.id,
      state: visibleState,
      battleView,
      battleRuntime,
      player: visibleState.player,
      enemy: visibleState.enemy,
      skillsData: skillPayload.skillsData,
      skillRotation: skillPayload.skillRotation,
      sceneSnapshot: runtime.sceneSnapshot,
    },
  });
}

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json().catch(() => null) as {
      monsterId?: unknown;
      partyCombatId?: unknown;
      observedMonsterPositionX?: unknown;
      observedMonsterPositionY?: unknown;
      worldAssassinationId?: unknown;
    } | null;
    const monsterId = normalizeCombatMonsterId(body?.monsterId);
    const partyCombatId = typeof body?.partyCombatId === "string" ? body.partyCombatId.trim() : "";
    const observedMonsterPositionX = normalizeObservedCoordinate(body?.observedMonsterPositionX);
    const observedMonsterPositionY = normalizeObservedCoordinate(body?.observedMonsterPositionY);
    const worldAssassinationId = typeof body?.worldAssassinationId === "string"
      ? body.worldAssassinationId.trim()
      : "";
    if (!monsterId) {
      return NextResponse.json({ success: false, error: "缺少怪物 ID" }, { status: 400 });
    }

    if (isWorldNpcMonsterId(monsterId)) {
      const npcId = resolveWorldNpcIdFromMonsterId(monsterId);
      const allowRemoteEngage = Boolean(
        worldAssassinationId
        && canOpenWorldAssassinationStartCombat({
          playerId: player.id,
          eventId: worldAssassinationId,
          npcId,
        }),
      );

      let engagement: Awaited<ReturnType<typeof assertCanEngageWorldNpc>>;
      let combatTarget: Awaited<ReturnType<typeof getWorldNpcCombatTarget>>;
      try {
        [engagement, combatTarget] = await Promise.all([
          assertCanEngageWorldNpc({
            playerId: player.id,
            npcId,
            allowRemoteEngage,
          }),
          getWorldNpcCombatTarget(npcId),
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "世界 NPC 交战校验失败";
        return NextResponse.json({ success: false, error: message }, { status: 400 });
      }
      if (!combatTarget) {
        return NextResponse.json({ success: false, error: "世界 NPC 不存在或已死亡" }, { status: 404 });
      }

      const skillPayload = await buildPlayerSkillPayload(player.id, player.realm, FALLBACK_PLAYER_SKILL_IDS);
      const [stats, playerCosmetics] = await Promise.all([
        loadPlayerStatsSnapshot(player),
        loadPlayerCosmetics(player.id),
      ]);
      const worldNpcRealm = await resolveCombatRealmByMapId(
        combatTarget.currentMapId
        || engagement.npc.runtime.currentMapId
        || player.currentMapId,
      );
      const playerSkillIds = skillPayload.playerSkillIds;

      const playerUnit: CombatUnit = {
        id: player.id,
        name: player.name || "无名修士",
        isPlayer: true,
        realm: player.realm,
        avatarImageUrl: playerCosmetics.avatarImageUrl,
        avatarFrameImageUrl: playerCosmetics.avatarFrameImageUrl,
        hp: stats.total.hp,
        maxHp: stats.total.maxHp,
        mp: stats.total.mp,
        maxMp: stats.total.maxMp,
        attack: stats.total.attack,
        defense: stats.total.defense,
        speed: stats.total.speed,
        luck: stats.total.luck,
        spiritualSense: stats.total.spiritualSense,
        armorPenetration: stats.total.armorPenetration,
        block: stats.total.block,
        skillDamageBonus: stats.total.skillDamageBonus,
        skillDamageReduction: stats.total.skillDamageReduction,
        artifactDamageBonus: stats.total.artifactDamageBonus,
        artifactDamageReduction: stats.total.artifactDamageReduction,
        skills: playerSkillIds,
        skillCooldowns: {},
        activeEffects: [],
        isStunned: false,
        critBonus: (await getPlayerCombatRateBonuses(player.id)).critBonus,
        blockBonus: (await getPlayerCombatRateBonuses(player.id)).blockBonus,
      };

      const enemyUnit: CombatUnit = {
        id: monsterId,
        name: combatTarget.name,
        isPlayer: false,
        realm: worldNpcRealm,
        avatarImageUrl: combatTarget.avatarImageUrl || null,
        avatarFrameImageUrl: null,
        hp: combatTarget.stats.hp,
        maxHp: combatTarget.stats.hp,
        mp: 60,
        maxMp: 60,
        attack: combatTarget.stats.attack,
        defense: combatTarget.stats.defense,
        speed: combatTarget.stats.speed,
        luck: combatTarget.stats.luck,
        spiritualSense: combatTarget.stats.spiritualSense,
        armorPenetration: combatTarget.stats.armorPenetration,
        block: combatTarget.stats.block,
        skillDamageBonus: combatTarget.stats.skillDamageBonus,
        skillDamageReduction: combatTarget.stats.skillDamageReduction,
        artifactDamageBonus: combatTarget.stats.artifactDamageBonus,
        artifactDamageReduction: combatTarget.stats.artifactDamageReduction,
        skills: [BASIC_MONSTER_SKILL_ID],
        skillCooldowns: {},
        activeEffects: [],
        isStunned: false,
      };

      const combatId = nanoid(12);
      const occupied = await occupyWorldNpcForCombat({
        npcId: combatTarget.npcId,
        combatId,
        playerId: player.id,
      });
      if (!occupied) {
        return NextResponse.json({ success: false, error: "该世界 NPC 正在与他人交战" }, { status: 409 });
      }
      try {
        if (worldAssassinationId) {
          const consumed = consumeOpenWorldAssassinationCombat({
            playerId: player.id,
            eventId: worldAssassinationId,
            npcId,
          });
          if (!consumed) {
            await releaseWorldNpcCombatOccupation({
              npcId,
              combatId,
            });
            return NextResponse.json({ success: false, error: "刺杀气机已散，请返回地图后重新确认局势" }, { status: 409 });
          }
        }

        const skillsData: Record<string, CombatStartSkill> = {};
        for (const [skillId, skill] of Object.entries(skillPayload.skillsData)) {
          skillsData[skillId] = {
            id: skillId,
            name: skill.name,
            description: null,
            skillType: skill.skillType,
            element: null,
            damageBase: skill.damageBase,
            damageMultiplier: skill.damageMultiplier,
            mpCost: skill.mpCost,
            cooldown: skill.cooldown,
            effects: skill.effects,
            minRealm: null,
            maxRealm: null,
            target: skill.target,
            createdAt: new Date(0).toISOString(),
            sourceType: skill.sourceType,
          };
        }
        if (!skillsData[BASIC_MONSTER_SKILL_ID]) {
          skillsData[BASIC_MONSTER_SKILL_ID] = createBuiltinMonsterBasicAttackSkill();
        }

        const initialState: CombatState = {
          id: combatId,
          turn: 0,
          player: playerUnit,
          enemy: enemyUnit,
          log: [{
            turn: 0,
            actorName: "系统",
            action: "战斗开始",
            entryType: "system",
            targetId: enemyUnit.id,
            message: `${enemyUnit.name}在你身前停步，杀机已起。`,
          }],
          status: "ongoing",
        };
        const sessionSkillsData = Object.fromEntries(
          Object.entries(skillsData).map(([skillId, skill]) => [skillId, toCombatSkillSnapshot(skill)]),
        );
        const pendingSession = setPendingCombatSession(player.id, {
          combatId,
          monsterId,
          state: initialState,
          skillsData: sessionSkillsData,
        });
        const battleView = buildCombatBattleViewState({
          runtimeId: combatId,
          mode: "solo",
          state: initialState,
          sceneSnapshot: pendingSession.sceneSnapshot,
          viewerPlayerId: player.id,
        });
        const battleRuntime = buildBattleRuntimeFromBattleView({
          battleView,
          sceneSnapshot: pendingSession.sceneSnapshot,
        });

        return NextResponse.json({
          success: true,
          data: {
            combatId,
            state: initialState,
            battleView,
            battleRuntime,
            player: playerUnit,
            enemy: enemyUnit,
            skillsData: sessionSkillsData,
            skillRotation: skillPayload.skillRotation,
            sceneSnapshot: pendingSession.sceneSnapshot,
            engagementMapId: engagement.npc.runtime.currentMapId,
          },
        });
      } catch (error) {
        await releaseWorldNpcCombatOccupation({
          npcId,
          combatId,
        });
        throw error;
      }
    }

    const activePartyEncounter = partyCombatId
      ? null
      : await getActivePartyEncounterByPlayerId(player.id);
    const staleEncounterId = partyCombatId || activePartyEncounter?.id || "";

    const secretRealmCombatAccess = await canStartCombatWithSecretRealmMonster(monsterId);
    if (!secretRealmCombatAccess.allowed) {
      if (staleEncounterId) {
        await closePartyEncounter({
          encounterId: staleEncounterId,
          status: "abandoned",
        }).catch(() => null);
      }
      return NextResponse.json({
        success: false,
        error: secretRealmCombatAccess.reason || "该秘境怪物已无法挑战",
      }, { status: 400 });
    }

    const monster = await getRuntimeMonsterById(monsterId);
    if (!monster) {
      if (staleEncounterId) {
        await closePartyEncounter({
          encounterId: staleEncounterId,
          status: "abandoned",
        }).catch(() => null);
      }
      return NextResponse.json({ success: false, error: "怪物不存在" }, { status: 404 });
    }

    if (monster.monsterType === "boss") {
      return NextResponse.json({ success: false, error: "首领请前往首领战页面挑战" }, { status: 400 });
    }

    const interaction = isPlayerNearMonster({
      playerMapId: player.currentMapId,
      playerPositionX: player.positionX,
      playerPositionY: player.positionY,
      monster,
    });
    const allowObservedPositionFallback = !interaction.allowed
      && interaction.reason === "distance"
      && canUseObservedMonsterPosition({
        playerMapId: player.currentMapId,
        playerPositionX: player.positionX,
        playerPositionY: player.positionY,
        monster,
        observedMonsterPositionX,
        observedMonsterPositionY,
      });
    if (!interaction.allowed && !allowObservedPositionFallback) {
      return NextResponse.json({
        success: false,
        error: interaction.reason === "map"
          ? "不在同一地图，无法发起这场战斗"
          : "距离怪物过远，请靠近后再开战",
      }, { status: 400 });
    }

    if (partyCombatId) {
      return buildPartyCombatStartResponse({
        playerId: player.id,
        monsterId,
        partyCombatId,
        playerRealm: player.realm,
      });
    }

    if (activePartyEncounter?.id) {
      return buildPartyCombatStartResponse({
        playerId: player.id,
        monsterId,
        partyCombatId: activePartyEncounter.id,
        playerRealm: player.realm,
      });
    }

    const playerParty = await getPartyGroupByPlayerId(player.id);
    if (playerParty && playerParty.leaderPlayerId === player.id) {
      const eligibleMemberIds = await getEligiblePartyMembersNearMonster({
        leaderPlayerId: player.id,
        monsterId,
      });

      if (eligibleMemberIds.length > 1) {
        const encounter = await createNormalPartyCombat({
          partyId: playerParty.id,
          monsterId,
          eligibleMemberIds,
        });

        if (encounter?.id) {
          return buildPartyCombatStartResponse({
            playerId: player.id,
            monsterId,
            partyCombatId: encounter.id,
            playerRealm: player.realm,
          });
        }
      }
    }

    const skillPayload = await buildPlayerSkillPayload(player.id, player.realm, FALLBACK_PLAYER_SKILL_IDS);

    const [stats, playerCosmetics] = await Promise.all([
      loadPlayerStatsSnapshot(player),
      loadPlayerCosmetics(player.id),
    ]);
    const enemyRealm = await resolveCombatRealmByMapId(monster.mapId);
    const playerSkillIds = skillPayload.playerSkillIds;

    const playerUnit: CombatUnit = {
      id: player.id,
      name: player.name || "无名修士",
      isPlayer: true,
      realm: player.realm,
      avatarImageUrl: playerCosmetics.avatarImageUrl,
      avatarFrameImageUrl: playerCosmetics.avatarFrameImageUrl,
      hp: stats.total.hp,
      maxHp: stats.total.maxHp,
      mp: stats.total.mp,
      maxMp: stats.total.maxMp,
      attack: stats.total.attack,
      defense: stats.total.defense,
      speed: stats.total.speed,
      luck: stats.total.luck,
      spiritualSense: stats.total.spiritualSense,
      armorPenetration: stats.total.armorPenetration,
      block: stats.total.block,
      skillDamageBonus: stats.total.skillDamageBonus,
      skillDamageReduction: stats.total.skillDamageReduction,
      artifactDamageBonus: stats.total.artifactDamageBonus,
      artifactDamageReduction: stats.total.artifactDamageReduction,
      skills: playerSkillIds,
      skillCooldowns: {},
      activeEffects: [],
      isStunned: false,
    };

    const enemyUnit: CombatUnit = {
      id: monster.id,
      name: monster.name,
      isPlayer: false,
      realm: enemyRealm,
      avatarImageUrl: monster.iconUrl || null,
      avatarFrameImageUrl: null,
      hp: monster.hp,
      maxHp: monster.hp,
      mp: 100,
      maxMp: 100,
      attack: monster.attack,
      defense: monster.defense,
      speed: monster.speed,
      luck: monster.luck,
      spiritualSense: monster.spiritualSense,
      armorPenetration: monster.armorPenetration,
      block: monster.block,
      skillDamageBonus: monster.skillDamageBonus,
      skillDamageReduction: monster.skillDamageReduction,
      artifactDamageBonus: monster.artifactDamageBonus,
      artifactDamageReduction: monster.artifactDamageReduction,
      skills: normalizeMonsterCombatSkillIds(monster.skills),
      skillCooldowns: {},
      activeEffects: [],
      isStunned: false,
    };

    const allSkillIds = [...new Set([...playerUnit.skills, ...enemyUnit.skills])];
    const skillsData: Record<string, CombatStartSkill> = {};

    for (const [skillId, skill] of Object.entries(skillPayload.skillsData)) {
      skillsData[skillId] = {
        id: skillId,
        name: skill.name,
        description: null,
        skillType: skill.skillType,
        element: null,
        damageBase: skill.damageBase,
        damageMultiplier: skill.damageMultiplier,
        mpCost: skill.mpCost,
        cooldown: normalizeCombatSkillCooldown(skillId, skill.cooldown),
        effects: skill.effects,
        minRealm: null,
        maxRealm: null,
        target: skill.target,
        createdAt: new Date(0).toISOString(),
        sourceType: skill.sourceType,
      };
    }

    for (const sid of allSkillIds) {
      if (skillsData[sid]) {
        continue;
      }

      const skill = await db.select().from(skills).where(eq(skills.id, sid)).get();
      if (skill) {
        skillsData[sid] = {
          ...skill,
          cooldown: normalizeCombatSkillCooldown(sid, skill.cooldown),
          sourceType: enemyUnit.skills.includes(sid) ? "monster" : undefined,
        };
      }
    }

    if (!skillsData[BASIC_MONSTER_SKILL_ID]) {
      skillsData[BASIC_MONSTER_SKILL_ID] = playerUnit.skills.includes(BASIC_MONSTER_SKILL_ID)
        ? createBuiltinPlayerBasicAttackSkill()
        : createBuiltinMonsterBasicAttackSkill();
    }

    const combatId = nanoid(12);
    const sessionSkillsData = Object.fromEntries(
      Object.entries(skillsData).map(([skillId, skill]) => [skillId, toCombatSkillSnapshot(skill)]),
    );

    const initialState: CombatState = {
      id: combatId,
      turn: 0,
      player: playerUnit,
      enemy: enemyUnit,
      log: [{
        turn: 0,
        actorName: "系统",
        action: "战斗开始",
        entryType: "system",
        targetId: enemyUnit.id,
        message: `${enemyUnit.name} 出现在前方，战斗开始。`,
      }],
      status: "ongoing",
    };

    const pendingSession = setPendingCombatSession(player.id, {
      combatId,
      monsterId: monster.id,
      state: initialState,
      skillsData: sessionSkillsData,
    });
    const battleView = buildCombatBattleViewState({
      runtimeId: combatId,
      mode: "solo",
      state: initialState,
      sceneSnapshot: pendingSession.sceneSnapshot,
      viewerPlayerId: player.id,
    });
    const battleRuntime = buildBattleRuntimeFromBattleView({
      battleView,
      sceneSnapshot: pendingSession.sceneSnapshot,
    });

    return NextResponse.json({
      success: true,
      data: {
        combatId,
        state: initialState,
        battleView,
        battleRuntime,
        player: playerUnit,
        enemy: enemyUnit,
        skillsData: sessionSkillsData,
        skillRotation: skillPayload.skillRotation,
        sceneSnapshot: pendingSession.sceneSnapshot,
      },
    });
  } catch (error) {
    console.error("Combat start error:", error);
    return NextResponse.json({ success: false, error: "开始战斗失败" }, { status: 500 });
  }
}

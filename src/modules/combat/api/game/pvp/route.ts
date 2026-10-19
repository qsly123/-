import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import {
  maps,
  players,
  skills,
} from "@/db/schema";
import type { CombatUnit } from "@/types/game";
import { getPlayerSkillLoadout } from "@/modules/character/services/player-active-skills";
import { getPlayerCombatRateBonuses } from "@/modules/character/services/equipment-instance-service";
import {
  getPlayerCosmeticMapByIds,
  type PlayerCosmeticProfile,
} from "@/modules/character/services/player-cosmetic-profile";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";
import {
  BASIC_ATTACK_RUNTIME_COOLDOWN,
  ensureCombatSkillIdsWithBasicAttack,
  normalizeCombatSkillCooldown,
} from "@/modules/combat/services/monster-skill-utils";
import type { PvpSkillSnapshot } from "@/modules/combat/services/pvp-simulator";
import {
  buildPvpViewerSceneData,
  createPvpCombatRuntime,
} from "@/modules/combat/services/pvp-runtime-service";
import { resolveSkillEffectsPayload } from "@/modules/shared/services/skill-visual-effect";
import { getPvpMapAvailability } from "@/modules/combat/services/pvp-map-config";

const DEFAULT_MAP_ID = "map_starter_village";
const BASIC_SKILL_ID = "skill_basic_attack";

type PvpRouteSkill = typeof skills.$inferSelect & {
  sourceType?: PvpSkillSnapshot["sourceType"];
};

type PlayerCombatSource = {
  id: string;
  name: string;
  gender: string | null;
  realm: number;
  realmMajor: number | null;
  realmMinor: number | null;
  realmName: string | null;
  currentMapId: string | null;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  spiritualSense: number;
  armorPenetration: number;
  block: number;
  skillDamageBonus: number;
  skillDamageReduction: number;
  artifactDamageBonus: number;
  artifactDamageReduction: number;
};

function toSkillSnapshot(skill: PvpRouteSkill): PvpSkillSnapshot {
  const normalized = resolveSkillEffectsPayload(skill.effects, skill);
  return {
    name: skill.name,
    skillType: skill.skillType,
    sourceType: skill.sourceType,
    damageBase: skill.damageBase,
    damageMultiplier: skill.damageMultiplier,
    mpCost: skill.mpCost,
    cooldown: normalizeCombatSkillCooldown(skill.id, skill.cooldown),
    effects: normalized.effects,
    target: skill.target,
    visualEffect: normalized.visualEffect,
  };
}

async function loadCombatProfile(player: PlayerCombatSource, cosmetics?: PlayerCosmeticProfile | null) {
  const [stats, loadout] = await Promise.all([
    buildPlayerStatsSnapshot(player),
    getPlayerSkillLoadout({
      playerId: player.id,
      realm: player.realm,
    }),
  ]);

  const playerSkillRows = loadout.activeSkills;
  const skillIds = ensureCombatSkillIdsWithBasicAttack(
    playerSkillRows.length > 0 ? playerSkillRows.map((row) => row.id) : [BASIC_SKILL_ID],
  );
  const combatRates = await getPlayerCombatRateBonuses(player.id);
  const unit: CombatUnit = {
    id: player.id,
    name: (player.name || "无名修士").trim() || "无名修士",
    isPlayer: true,
    realm: player.realm,
    avatarImageUrl: cosmetics?.avatarImageUrl || null,
    avatarFrameImageUrl: cosmetics?.avatarFrameImageUrl || null,
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
    skills: skillIds,
    skillCooldowns: {},
    activeEffects: [],
    critBonus: combatRates.critBonus,
    blockBonus: combatRates.blockBonus,
    isStunned: false,
  };

  const skillsData: Record<string, PvpSkillSnapshot> = {};
  for (const row of playerSkillRows) {
    skillsData[row.id] = toSkillSnapshot(row);
  }
  if (!skillsData[BASIC_SKILL_ID]) {
    skillsData[BASIC_SKILL_ID] = {
      name: "基础攻击",
      skillType: "attack",
      sourceType: "learned",
      damageBase: 0,
      damageMultiplier: 1,
      mpCost: 0,
      cooldown: BASIC_ATTACK_RUNTIME_COOLDOWN,
      effects: [],
      target: "enemy",
      visualEffect: null,
    };
  }

  return {
    unit,
    skillRotation: ensureCombatSkillIdsWithBasicAttack(loadout.skillRotation.length > 0 ? loadout.skillRotation : skillIds),
    skillsData,
  };
}

export async function POST(request: Request) {
  try {
    const currentPlayer = await getCurrentPlayer();
    if (!currentPlayer) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json() as { targetPlayerId?: unknown };
    const targetPlayerId = typeof body.targetPlayerId === "string" ? body.targetPlayerId.trim() : "";
    if (!targetPlayerId) {
      return NextResponse.json({ success: false, error: "缺少目标玩家ID" }, { status: 400 });
    }
    if (targetPlayerId === currentPlayer.id) {
      return NextResponse.json({ success: false, error: "不能与自己切磋" }, { status: 400 });
    }

    const playerRows = await db.select({
      id: players.id,
      name: players.name,
      gender: players.gender,
      realm: players.realm,
      realmMajor: players.realmMajor,
      realmMinor: players.realmMinor,
      realmName: players.realmName,
      currentMapId: players.currentMapId,
      hp: players.hp,
      maxHp: players.maxHp,
      mp: players.mp,
      maxMp: players.maxMp,
      attack: players.attack,
      defense: players.defense,
      speed: players.speed,
      luck: players.luck,
      spiritualSense: players.spiritualSense,
      armorPenetration: players.armorPenetration,
      block: players.block,
      skillDamageBonus: players.skillDamageBonus,
      skillDamageReduction: players.skillDamageReduction,
      artifactDamageBonus: players.artifactDamageBonus,
      artifactDamageReduction: players.artifactDamageReduction,
    }).from(players)
      .where(inArray(players.id, [currentPlayer.id, targetPlayerId]))
      .all();

    const challenger = playerRows.find((row) => row.id === currentPlayer.id);
    const targetPlayer = playerRows.find((row) => row.id === targetPlayerId);

    if (!challenger || !targetPlayer) {
      return NextResponse.json({ success: false, error: "目标玩家不存在" }, { status: 404 });
    }

    const challengerMapId = challenger.currentMapId || DEFAULT_MAP_ID;
    const targetMapId = targetPlayer.currentMapId || DEFAULT_MAP_ID;
    if (challengerMapId !== targetMapId) {
      return NextResponse.json({ success: false, error: "仅可与同地图玩家切磋" }, { status: 400 });
    }

    const currentMap = await db.select({
      mapType: maps.mapType,
    }).from(maps).where(eq(maps.id, challengerMapId)).get();
    const mapAvailability = await getPvpMapAvailability({
      mapId: challengerMapId,
      mapType: currentMap?.mapType || null,
    });
    if (!mapAvailability.enabledMapIds.length && !Object.values(mapAvailability.enabledMapTypes).some(Boolean)) {
      return NextResponse.json({ success: false, error: "当前未配置可切磋地图" }, { status: 400 });
    }
    if (!mapAvailability.enabled) {
      return NextResponse.json({ success: false, error: "当前地图未开放切磋" }, { status: 400 });
    }

    const cosmeticMap = await getPlayerCosmeticMapByIds([challenger.id, targetPlayer.id]);
    const [challengerProfile, targetProfile] = await Promise.all([
      loadCombatProfile(challenger, cosmeticMap.get(challenger.id)),
      loadCombatProfile(targetPlayer, cosmeticMap.get(targetPlayer.id)),
    ]);

    const skillsData: Record<string, PvpSkillSnapshot> = {
      ...challengerProfile.skillsData,
      ...targetProfile.skillsData,
    };

    const allSkillIds = Array.from(new Set([
      ...challengerProfile.unit.skills,
      ...targetProfile.unit.skills,
      BASIC_SKILL_ID,
    ]));
    const missingSkillIds = allSkillIds.filter((sid) => !skillsData[sid]);
    if (missingSkillIds.length > 0) {
      const missingRows = await db.select().from(skills).where(inArray(skills.id, missingSkillIds)).all();
      for (const row of missingRows) {
        skillsData[row.id] = toSkillSnapshot({
          ...row,
          sourceType: "system",
        });
      }
    }

    if (skillsData[BASIC_SKILL_ID]) {
      if (!challengerProfile.unit.skills.includes(BASIC_SKILL_ID)) {
        challengerProfile.unit.skills.push(BASIC_SKILL_ID);
      }
      if (!targetProfile.unit.skills.includes(BASIC_SKILL_ID)) {
        targetProfile.unit.skills.push(BASIC_SKILL_ID);
      }
    }

    const challengerRotation = challengerProfile.skillRotation.length > 0
      ? challengerProfile.skillRotation
      : [...challengerProfile.unit.skills];
    const targetRotation = targetProfile.skillRotation.length > 0
      ? targetProfile.skillRotation
      : [...targetProfile.unit.skills];

    if (!challengerProfile.unit.skills.length || !targetProfile.unit.skills.length) {
      return NextResponse.json({ success: false, error: "存在玩家未配置可用神通" }, { status: 400 });
    }

    const combatId = nanoid(12);
    await createPvpCombatRuntime({
      combatId,
      mapId: challengerMapId,
      challengerPlayerId: challenger.id,
      targetPlayerId: targetPlayer.id,
      challenger: challengerProfile.unit,
      target: targetProfile.unit,
      skillsData,
      challengerRotation,
      targetRotation,
    });
    const viewerData = buildPvpViewerSceneData(combatId, challenger.id);
    if (!viewerData) {
      return NextResponse.json({ success: false, error: "论道创建成功但场景初始化失败" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        combatId,
        mapId: challengerMapId,
        state: viewerData.state,
        battleView: viewerData.battleView,
        battleRuntime: viewerData.battleRuntime,
        sceneSnapshot: viewerData.sceneSnapshot,
        turnState: viewerData.turnState,
        settlement: viewerData.settlement,
      },
    });
  } catch (error) {
    console.error("Pvp error:", error);
    return NextResponse.json({ success: false, error: "切磋失败" }, { status: 500 });
  }
}

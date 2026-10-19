import { getPlayerByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";
import { resolveMapVisionProfile, type MapVisionProfile } from "@/modules/map/services/map-vision";

export type PlayerVisionState = {
  spiritualSense: number;
  visionProfile: MapVisionProfile;
};

type PlayerVisionSource = {
  id: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  spiritualSense?: number | null;
  armorPenetration?: number | null;
  block?: number | null;
  skillDamageBonus?: number | null;
  skillDamageReduction?: number | null;
  artifactDamageBonus?: number | null;
  artifactDamageReduction?: number | null;
};

export async function buildPlayerVisionState(
  player: PlayerVisionSource,
): Promise<PlayerVisionState> {
  const playerStats = await buildPlayerStatsSnapshot({
    ...player,
    spiritualSense: player.spiritualSense ?? undefined,
    armorPenetration: player.armorPenetration ?? undefined,
    block: player.block ?? undefined,
    skillDamageBonus: player.skillDamageBonus ?? undefined,
    skillDamageReduction: player.skillDamageReduction ?? undefined,
    artifactDamageBonus: player.artifactDamageBonus ?? undefined,
    artifactDamageReduction: player.artifactDamageReduction ?? undefined,
  });
  const spiritualSense = playerStats.total.spiritualSense;
  return {
    spiritualSense,
    visionProfile: resolveMapVisionProfile(spiritualSense),
  };
}

export async function loadPlayerVisionState(playerId: string): Promise<PlayerVisionState | null> {
  const player = await getPlayerByIdCompat(playerId);
  if (!player) {
    return null;
  }

  return await buildPlayerVisionState(player);
}

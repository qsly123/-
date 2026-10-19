import { eq } from "drizzle-orm";
import { db } from "@/db";
import { maps, players, sectMembers, sects } from "@/db/schema";
import { getGameStartConfig } from "@/modules/character/services/game-start-config";
import { warmMapSceneSharedStateForMapId } from "@/modules/map/services/map-scene-hub";
import { pickPortalSpawn } from "@/modules/map/services/map-portal";
import { publishMapPresencePlayerPosition } from "@/modules/map/services/map-presence";
import { buildSectHomePortalId, ensureSectHomeMapFixedPortals } from "@/modules/sect/services/sect-map-service";

export type PlayerDefeatRespawnMode = "sect" | "spawn";

export type PlayerDefeatRespawnTarget = {
  mode: PlayerDefeatRespawnMode;
  mapId: string;
  mapName: string;
  positionX: number;
  positionY: number;
  sectName?: string;
};

type RespawnPresencePlayer = {
  id: string;
  name: string | null;
  gender: string | null;
  realm: number;
  realmMajor: number | null;
  realmMinor: number | null;
  realmName: string | null;
};

export async function resolvePlayerDefeatRespawnTarget(playerId: string): Promise<PlayerDefeatRespawnTarget> {
  const membership = await db.select({
    sectId: sectMembers.sectId,
  }).from(sectMembers).where(eq(sectMembers.playerId, playerId)).get();

  if (membership?.sectId) {
    const sect = await db.select({
      id: sects.id,
      name: sects.name,
      homeMapId: sects.homeMapId,
      externalMapId: sects.externalMapId,
    }).from(sects).where(eq(sects.id, membership.sectId)).get();

    if (sect) {
      await ensureSectHomeMapFixedPortals({
        sectId: sect.id,
        sectName: sect.name,
        homeMapId: sect.homeMapId,
        externalMapId: sect.externalMapId,
        externalMapName: null,
      }).catch((error) => {
        console.error("Repair sect home portals before respawn failed:", {
          playerId,
          sectId: sect.id,
          error,
        });
      });

      const homeMap = await db.select({
        id: maps.id,
        name: maps.name,
        tilesData: maps.tilesData,
      }).from(maps).where(eq(maps.id, sect.homeMapId)).get();

      if (homeMap) {
        const portal = pickPortalSpawn(homeMap.tilesData, buildSectHomePortalId(sect.id));
        if (portal) {
          return {
            mode: "sect",
            mapId: homeMap.id,
            mapName: homeMap.name,
            positionX: portal.x,
            positionY: portal.y,
            sectName: sect.name,
          };
        }
      }
    }
  }

  const gameStartConfig = await getGameStartConfig();
  const startMap = await db.select({
    id: maps.id,
    name: maps.name,
  }).from(maps).where(eq(maps.id, gameStartConfig.mapId)).get();

  return {
    mode: "spawn",
    mapId: gameStartConfig.mapId,
    mapName: startMap?.name || "出生点",
    positionX: gameStartConfig.positionX,
    positionY: gameStartConfig.positionY,
  };
}

export async function applyPlayerDefeatRespawn(params: {
  playerId: string;
  hp: number;
  mp: number;
  nowIso?: string;
  prevMapId?: string | null;
  presencePlayer?: RespawnPresencePlayer | null;
}) {
  const target = await resolvePlayerDefeatRespawnTarget(params.playerId);
  const nowIso = params.nowIso || new Date().toISOString();

  await db.update(players).set({
    hp: params.hp,
    mp: params.mp,
    currentMapId: target.mapId,
    currentMapInstanceId: null,
    positionX: target.positionX,
    positionY: target.positionY,
    updatedAt: nowIso,
  }).where(eq(players.id, params.playerId)).run();

  await warmMapSceneSharedStateForMapId({
    mapId: target.mapId,
    reason: "player_transition",
  }).catch((error) => {
    console.error("Player defeat respawn map prewarm error:", {
      playerId: params.playerId,
      mapId: target.mapId,
      error,
    });
  });

  if (params.presencePlayer) {
    publishMapPresencePlayerPosition({
      id: params.presencePlayer.id,
      name: params.presencePlayer.name || "",
      gender: params.presencePlayer.gender,
      realm: params.presencePlayer.realm,
      realmMajor: params.presencePlayer.realmMajor,
      realmMinor: params.presencePlayer.realmMinor,
      realmName: params.presencePlayer.realmName || "凡人",
      mapId: target.mapId,
      prevMapId: params.prevMapId || target.mapId,
      positionX: target.positionX,
      positionY: target.positionY,
    });
  }

  return target;
}

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { npcs, players } from "@/db/schema";

const DEFAULT_MAP_ID = "map_starter_village";
const MAX_NPC_INTERACTION_DISTANCE = 1;

export class NpcInteractionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function requireNpcInteraction(params: {
  playerId: string;
  npcId: string;
}) {
  const [playerState, npc] = await Promise.all([
    db.select({
      id: players.id,
      currentMapId: players.currentMapId,
      positionX: players.positionX,
      positionY: players.positionY,
    }).from(players).where(eq(players.id, params.playerId)).get(),
    db.select().from(npcs).where(eq(npcs.id, params.npcId)).get(),
  ]);

  if (!playerState) {
    throw new NpcInteractionError("玩家不存在", 404);
  }
  if (!npc) {
    throw new NpcInteractionError("NPC不存在", 404);
  }
  if (!npc.mapId) {
    throw new NpcInteractionError("NPC未配置地图，暂时无法交互", 400);
  }

  const playerMapId = playerState.currentMapId || DEFAULT_MAP_ID;
  const npcMapId = npc.mapId;
  if (playerMapId !== npcMapId) {
    throw new NpcInteractionError("不在同一地图，无法与该NPC交互", 400);
  }

  const distance = Math.max(
    Math.abs(playerState.positionX - npc.positionX),
    Math.abs(playerState.positionY - npc.positionY),
  );
  if (distance > MAX_NPC_INTERACTION_DISTANCE) {
    throw new NpcInteractionError("不在NPC附近，请靠近后再交互", 400);
  }

  return npc;
}

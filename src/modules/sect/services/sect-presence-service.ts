import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { players, sectMembers } from "@/db/schema";
import {
  isSectPresenceState,
  resolveSectPresenceState,
  type SectPresenceMemberView,
  type SectPresenceState,
} from "@immortality/shared-protocol/sect-presence";

/**
 * 宗门成员 presence 持久化。
 *
 * 实时房间是 presence 的权威来源，数据库只做两件事：
 * 1. 断线 / 重连后给界面一个兜底值，避免成员列表在重连窗口里全灰。
 * 2. 让"谁在驻地"这类跨会话信息可被低频 API 读取。
 *
 * presence 写入必须 best-effort：写库失败不能影响实时链路，也不能让页面报错。
 */

function normalizePresenceState(value: unknown): SectPresenceState {
  return isSectPresenceState(value) ? value : "offline";
}

export async function persistSectMemberPresence(params: {
  playerId: string;
  sectId: string;
  atHome: boolean;
  connected?: boolean;
  mapId?: string | null;
}) {
  const playerId = String(params.playerId || "").trim();
  const sectId = String(params.sectId || "").trim();
  if (!playerId || !sectId) {
    return false;
  }
  const nowIso = new Date().toISOString();
  try {
    await db.update(sectMembers).set({
      presenceState: resolveSectPresenceState({
        connected: params.connected ?? true,
        atHome: params.atHome,
      }),
      presenceAtHome: params.atHome,
      presenceMapId: params.mapId ?? null,
      presenceUpdatedAt: nowIso,
      updatedAt: nowIso,
    }).where(and(
      eq(sectMembers.playerId, playerId),
      eq(sectMembers.sectId, sectId),
    )).run();
    return true;
  } catch (error) {
    console.error("[sect] presence persist failed", {
      logCategory: "sect.presence.persist_failed",
      playerId,
      sectId,
      error,
    });
    return false;
  }
}

export async function markSectMemberOffline(playerId: string) {
  const normalizedPlayerId = String(playerId || "").trim();
  if (!normalizedPlayerId) {
    return false;
  }
  const nowIso = new Date().toISOString();
  try {
    await db.update(sectMembers).set({
      presenceState: "offline",
      presenceAtHome: false,
      presenceUpdatedAt: nowIso,
      updatedAt: nowIso,
    }).where(eq(sectMembers.playerId, normalizedPlayerId)).run();
    return true;
  } catch (error) {
    console.error("[sect] presence offline persist failed", {
      logCategory: "sect.presence.offline_persist_failed",
      playerId: normalizedPlayerId,
      error,
    });
    return false;
  }
}

/** 低频读取：宗门成员 presence 兜底快照。 */
export async function loadSectPresenceSnapshot(sectId: string): Promise<SectPresenceMemberView[]> {
  const normalizedSectId = String(sectId || "").trim();
  if (!normalizedSectId) {
    return [];
  }
  try {
    const rows = await db.select({
      playerId: sectMembers.playerId,
      playerName: players.name,
      presenceState: sectMembers.presenceState,
      presenceAtHome: sectMembers.presenceAtHome,
      presenceMapId: sectMembers.presenceMapId,
      presenceUpdatedAt: sectMembers.presenceUpdatedAt,
    }).from(sectMembers)
      .innerJoin(players, eq(players.id, sectMembers.playerId))
      .where(eq(sectMembers.sectId, normalizedSectId))
      .all();

    return rows.map((row) => {
      const presenceState = normalizePresenceState(row.presenceState);
      const atHome = Boolean(row.presenceAtHome) && presenceState !== "offline";
      return {
        playerId: String(row.playerId || "").trim(),
        name: String(row.playerName || "").trim(),
        sectId: normalizedSectId,
        presenceState,
        atHome,
        mapId: String(row.presenceMapId || "").trim(),
        shardId: "",
        updatedAt: Date.parse(String(row.presenceUpdatedAt || "")) || 0,
      } satisfies SectPresenceMemberView;
    });
  } catch (error) {
    console.error("[sect] presence snapshot read failed", {
      logCategory: "sect.presence.snapshot_failed",
      sectId: normalizedSectId,
      error,
    });
    return [];
  }
}

/** 宗门成员 playerId 列表，用于把刷新帧推给所有在线成员。 */
export async function listSectMemberPlayerIds(sectId: string) {
  const normalizedSectId = String(sectId || "").trim();
  if (!normalizedSectId) {
    return [] as string[];
  }
  try {
    const rows = await db.select({
      playerId: sectMembers.playerId,
    }).from(sectMembers).where(eq(sectMembers.sectId, normalizedSectId)).all();
    return rows.map((row) => String(row.playerId || "").trim()).filter(Boolean);
  } catch {
    return [] as string[];
  }
}

/** 宗门驻地在线人数，供总览卡片展示。 */
export async function countSectHomeOnlineMembers(sectId: string) {
  const normalizedSectId = String(sectId || "").trim();
  if (!normalizedSectId) {
    return 0;
  }
  try {
    const rows = await db.select({
      playerId: sectMembers.playerId,
    }).from(sectMembers)
      .where(and(
        eq(sectMembers.sectId, normalizedSectId),
        eq(sectMembers.presenceAtHome, true),
      ))
      .all();
    return rows.length;
  } catch {
    return 0;
  }
}

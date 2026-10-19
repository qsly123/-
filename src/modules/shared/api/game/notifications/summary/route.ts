import { NextResponse } from "next/server";
import {
  and,
  count,
  eq,
  gt,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  checkinRewardRules,
  dmConversationReads,
  dmConversations,
  dmMessages,
  mapInstances,
  marketTradeRecords,
  playerCheckinLogs,
  playerFriendships,
  playerIntimacyRelations,
  playerMails,
  secretRealmSpawns,
  secretRealmTemplates,
  sectApplications,
} from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { hasRewardValue, normalizeCdkReward } from "@/modules/character/services/reward-service";
import { resolveSecretRealmSpecialType } from "@/modules/map/services/secret-realm-specials";
import { collectNotificationBadgesByPlugins } from "@/modules/shared/services/legacy-plugin-compat";
import { getPlayerSectSummary } from "@/modules/sect/services/sect-service";
import { readThroughReadModelCache } from "@/modules/shared/services/read-model-cache";
import {
  buildNotificationSummaryCacheKey,
  getNotificationSummaryCacheTtlMs,
} from "@/modules/shared/services/read-model-cache-keys";
import { buildDmRetentionCutoff } from "@/modules/social/domain/social-types";
import { getIncomingDoubleCultivationNotificationCount } from "@/modules/world/services/double-cultivation-core-api";
import { getPlayerWorldNotificationSummary } from "@/modules/world/services/player-world-pressure-service";

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

function getShanghaiDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";

  return `${year}-${month}-${day}`;
}

function getDayIndexFromDateKey(dateKey: string) {
  const [yearText, monthText, dayText] = dateKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function toSafeCount(value: unknown) {
  return Math.max(0, Number(value) || 0);
}

function canClaimCheckinToday(params: {
  ruleEnabled: boolean;
  ruleReward: unknown;
  alreadyCheckedIn: boolean;
}) {
  if (params.alreadyCheckedIn || !params.ruleEnabled) {
    return false;
  }

  try {
    return hasRewardValue(normalizeCdkReward(params.ruleReward || {}));
  } catch {
    return false;
  }
}

async function hasWildWolfValleyAttention(params: {
  playerId: string;
  currentMapId?: string | null;
  currentMapInstanceId?: string | null;
}) {
  const nowIso = new Date().toISOString();
  const [currentInstanceRow, visibleSpawnRows] = await Promise.all([
    params.currentMapInstanceId
      ? db.select({
        name: secretRealmTemplates.name,
        tags: secretRealmTemplates.tags,
      }).from(mapInstances)
        .innerJoin(secretRealmTemplates, eq(secretRealmTemplates.id, mapInstances.templateId))
        .where(eq(mapInstances.id, params.currentMapInstanceId))
        .get()
      : Promise.resolve(null),
    params.currentMapId
      ? db.select({
        name: secretRealmTemplates.name,
        tags: secretRealmTemplates.tags,
      }).from(secretRealmSpawns)
        .innerJoin(secretRealmTemplates, eq(secretRealmTemplates.id, secretRealmSpawns.templateId))
        .where(and(
          eq(secretRealmSpawns.mapId, params.currentMapId),
          eq(secretRealmSpawns.status, "active"),
          gt(secretRealmSpawns.expiresAt, nowIso),
          or(
            eq(secretRealmSpawns.spawnType, "global"),
            eq(secretRealmSpawns.ownerPlayerId, params.playerId),
            sql`${secretRealmSpawns.visiblePlayerIds} ? ${params.playerId}`,
          ),
        ))
        .all()
      : Promise.resolve([]),
  ]);

  if (currentInstanceRow && resolveSecretRealmSpecialType(currentInstanceRow) === "wild_wolf_valley") {
    return true;
  }

  return visibleSpawnRows.some((row) => resolveSecretRealmSpecialType(row) === "wild_wolf_valley");
}

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const data = await readThroughReadModelCache({
      key: buildNotificationSummaryCacheKey(player.id),
      ttlMs: getNotificationSummaryCacheTtlMs(),
      statGroup: "notification_summary",
      loader: async () => {
        const todayDateKey = getShanghaiDateKey();
        const todayDayIndex = getDayIndexFromDateKey(todayDateKey);
        const dmRetentionCutoff = buildDmRetentionCutoff();

        const [
          dmUnreadRow,
          friendIncomingRow,
          intimacyIncomingRow,
          mailUnreadRow,
          marketUnreadRow,
          todayRule,
          todayLog,
          pluginBadgeMap,
          doubleCultivationIncomingCount,
          wildWolfValleyAttention,
          worldNotificationSummary,
          sectSummary,
        ] = await Promise.all([
          db.select({ total: count() })
            .from(dmMessages)
            .innerJoin(dmConversations, eq(dmConversations.id, dmMessages.conversationId))
            .leftJoin(dmConversationReads, and(
              eq(dmConversationReads.conversationId, dmMessages.conversationId),
              eq(dmConversationReads.playerId, player.id),
            ))
            .where(and(
              or(
                eq(dmConversations.playerAId, player.id),
                eq(dmConversations.playerBId, player.id),
              ),
              ne(dmMessages.senderPlayerId, player.id),
              sql`${dmMessages.id} > coalesce(${dmConversationReads.lastReadMessageId}, 0)`,
              sql`${dmMessages.createdAt} >= ${dmRetentionCutoff}`,
            ))
            .get(),
          db.select({ total: count() })
            .from(playerFriendships)
            .where(and(
              or(
                eq(playerFriendships.playerAId, player.id),
                eq(playerFriendships.playerBId, player.id),
              ),
              eq(playerFriendships.status, "pending"),
              ne(playerFriendships.requestedBy, player.id),
            ))
            .get(),
          db.select({ total: count() })
            .from(playerIntimacyRelations)
            .where(and(
              or(
                eq(playerIntimacyRelations.playerAId, player.id),
                eq(playerIntimacyRelations.playerBId, player.id),
              ),
              eq(playerIntimacyRelations.status, "pending"),
              ne(playerIntimacyRelations.requestedBy, player.id),
            ))
            .get(),
          db.select({ total: count() })
            .from(playerMails)
            .where(and(
              eq(playerMails.playerId, player.id),
              isNull(playerMails.claimedAt),
            ))
            .get(),
          db.select({ total: count() })
            .from(marketTradeRecords)
            .where(and(
              eq(marketTradeRecords.sellerPlayerId, player.id),
              isNull(marketTradeRecords.sellerReadAt),
            ))
            .get(),
          db.select({
            enabled: checkinRewardRules.enabled,
            reward: checkinRewardRules.reward,
          })
            .from(checkinRewardRules)
            .where(eq(checkinRewardRules.dayIndex, todayDayIndex))
            .get(),
          db.select({ id: playerCheckinLogs.id })
            .from(playerCheckinLogs)
            .where(and(
              eq(playerCheckinLogs.playerId, player.id),
              eq(playerCheckinLogs.checkinDate, todayDateKey),
            ))
            .get(),
          collectNotificationBadgesByPlugins({
            playerId: player.id,
          }),
          getIncomingDoubleCultivationNotificationCount(player.id),
          hasWildWolfValleyAttention({
            playerId: player.id,
            currentMapId: player.currentMapId,
            currentMapInstanceId: player.currentMapInstanceId,
          }),
          getPlayerWorldNotificationSummary(player.id),
          getPlayerSectSummary(player.id),
        ]);

        let sectIncomingCount = 0;
        let sectVisitorIncomingCount = 0;
        if (sectSummary?.sectId && (sectSummary.canReviewJoinApplications || sectSummary.canReviewVisitApplications)) {
          const pendingRows = await db.select({
            type: sectApplications.type,
            total: count(),
          }).from(sectApplications)
            .where(and(
              eq(sectApplications.sectId, sectSummary.sectId),
              eq(sectApplications.status, "pending"),
              gt(sectApplications.expiresAt, new Date().toISOString()),
            ))
            .groupBy(sectApplications.type)
            .all();
          for (const row of pendingRows) {
            const value = toSafeCount(row.total);
            if (row.type === "join") {
              sectIncomingCount = value;
            } else if (row.type === "visit") {
              sectVisitorIncomingCount = value;
            }
          }
          if (!sectSummary.canReviewJoinApplications) {
            sectIncomingCount = 0;
          }
          if (!sectSummary.canReviewVisitApplications) {
            sectVisitorIncomingCount = 0;
          }
        }

        return {
          dmUnreadCount: toSafeCount(dmUnreadRow?.total),
          friendIncomingCount: toSafeCount(friendIncomingRow?.total),
          intimacyIncomingCount: toSafeCount(intimacyIncomingRow?.total),
          mailUnreadCount: toSafeCount(mailUnreadRow?.total),
          marketUnreadCount: toSafeCount(marketUnreadRow?.total),
          checkinCanClaim: canClaimCheckinToday({
            ruleEnabled: Boolean(todayRule?.enabled),
            ruleReward: todayRule?.reward,
            alreadyCheckedIn: Boolean(todayLog?.id),
          }),
          pluginBadgeMap: {
            ...pluginBadgeMap,
            "double-cultivation": doubleCultivationIncomingCount,
          },
          wildWolfValleyAttention,
          worldDangerCount: worldNotificationSummary.worldDangerCount,
          worldBountyActive: worldNotificationSummary.worldBountyActive,
          worldRumorUnread: worldNotificationSummary.worldRumorUnread,
          sectIncomingCount,
          sectVisitorIncomingCount,
          sectHasNotification: sectIncomingCount > 0 || sectVisitorIncomingCount > 0,
        };
      },
    });

    return NextResponse.json({
      success: true,
      data,
    }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Notification summary error:", error);
    return NextResponse.json({ success: false, error: "获取通知摘要失败" }, { status: 500 });
  }
}

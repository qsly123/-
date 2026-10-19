import { NextResponse } from "next/server";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { checkinRewardRules, items, playerCheckinLogs } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { grantRewardToPlayer, hasRewardValue, normalizeCdkReward } from "@/modules/character/services/reward-service";
import type { CdkReward } from "@/types/game";

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

class CheckinError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function getShanghaiDateParts(date = new Date()) {
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

  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    monthKey: `${year}-${month}`,
    dateKey: `${year}-${month}-${day}`,
  };
}

function parseMonthKey(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!MONTH_PATTERN.test(normalized)) {
    return null;
  }

  const [yearText, monthText] = normalized.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    return null;
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return {
    year,
    month,
    monthKey: `${yearText}-${monthText}`,
  };
}

function getDaysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getDayIndexFromDateKey(dateKey: string) {
  const [yearText, monthText, dayText] = dateKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0-6, 周日为0
  return weekday === 0 ? 7 : weekday; // 周一=1, 周日=7
}

function safeNormalizeReward(input: unknown) {
  try {
    return normalizeCdkReward(input || {});
  } catch {
    return {};
  }
}

function attachItemNames(
  reward: CdkReward,
  itemNameMap: Record<string, string>,
  itemIconMap: Record<string, string | null>,
): CdkReward {
  if (!reward.items?.length) {
    return reward;
  }

  return {
    ...reward,
    items: reward.items.map((item) => ({
      itemId: item.itemId,
      quantity: item.quantity,
      itemName: itemNameMap[item.itemId] || "未知物品",
      itemIconUrl: itemIconMap[item.itemId] || null,
    })),
  };
}

function isAlreadyCheckedInError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("player_checkin_logs_player_id_checkin_date_unique")
    || error.message.toLowerCase().includes("duplicate key");
}

export async function GET(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const url = new URL(request.url);
    const rawMonth = url.searchParams.get("month");
    const monthInput = parseMonthKey(rawMonth);
    if (rawMonth && !monthInput) {
      return NextResponse.json({ success: false, error: "month 参数非法，应为 YYYY-MM" }, { status: 400 });
    }
    const today = getShanghaiDateParts();

    const targetMonth = monthInput || {
      year: today.year,
      month: today.month,
      monthKey: today.monthKey,
    };

    const monthDays = getDaysInMonth(targetMonth.year, targetMonth.month);
    const monthStart = `${targetMonth.monthKey}-01`;
    const monthEnd = `${targetMonth.monthKey}-${pad2(monthDays)}`;

    const [ruleRows, logRows] = await Promise.all([
      db.select({
        dayIndex: checkinRewardRules.dayIndex,
        reward: checkinRewardRules.reward,
        enabled: checkinRewardRules.enabled,
      })
        .from(checkinRewardRules)
        .all(),
      db.select({
        checkinDate: playerCheckinLogs.checkinDate,
      })
        .from(playerCheckinLogs)
        .where(and(
          eq(playerCheckinLogs.playerId, player.id),
          gte(playerCheckinLogs.checkinDate, monthStart),
          lte(playerCheckinLogs.checkinDate, monthEnd),
        ))
        .all(),
    ]);

    const ruleMap = new Map(
      ruleRows.map((row) => [
        row.dayIndex,
        {
          reward: safeNormalizeReward(row.reward),
          enabled: row.enabled,
        },
      ])
    );

    const rewardList = [...ruleMap.values()].map((rule) => rule.reward);
    const itemIds = Array.from(new Set(
      rewardList.flatMap((reward) => reward.items?.map((item) => item.itemId) || []),
    ));
    const itemNameMap: Record<string, string> = {};
    const itemIconMap: Record<string, string | null> = {};
    if (itemIds.length > 0) {
      const itemRows = await db.select({
        id: items.id,
        name: items.name,
        iconUrl: items.iconUrl,
      })
        .from(items)
        .where(inArray(items.id, itemIds))
        .all();
      for (const itemRow of itemRows) {
        itemNameMap[itemRow.id] = itemRow.name;
        itemIconMap[itemRow.id] = itemRow.iconUrl || null;
      }
    }

    const claimedDateSet = new Set(logRows.map((row) => row.checkinDate));

    const days = Array.from({ length: monthDays }, (_, index) => {
      const day = index + 1;
      const dateKey = `${targetMonth.monthKey}-${pad2(day)}`;
      const dayIndex = getDayIndexFromDateKey(dateKey);
      const rule = ruleMap.get(dayIndex);
      const claimed = claimedDateSet.has(dateKey);
      const isToday = dateKey === today.dateKey;
      const isFuture = dateKey > today.dateKey;
      const reward = rule?.reward || {};
      const rewardWithNames = attachItemNames(reward, itemNameMap, itemIconMap);
      const canClaim = isToday && !claimed && !isFuture && Boolean(rule?.enabled) && hasRewardValue(rewardWithNames);
      const status = claimed ? "claimed" : isFuture ? "future" : canClaim ? "claimable" : "missed";

      return {
        date: dateKey,
        day,
        dayIndex,
        weekdayLabel: WEEKDAY_LABELS[dayIndex - 1],
        claimed,
        canClaim,
        isToday,
        isFuture,
        status,
        rewardEnabled: Boolean(rule?.enabled),
        reward: rewardWithNames,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        month: targetMonth.monthKey,
        today: today.dateKey,
        canClaimToday: days.some((day) => day.date === today.dateKey && day.canClaim),
        days,
      },
    });
  } catch (error) {
    console.error("Checkin list error:", error);
    return NextResponse.json({ success: false, error: "获取签到信息失败" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const today = getShanghaiDateParts();
    const dayIndex = getDayIndexFromDateKey(today.dateKey);

    const result = await db.transaction(async (tx) => {
      const existed = await tx.select({ id: playerCheckinLogs.id })
        .from(playerCheckinLogs)
        .where(and(
          eq(playerCheckinLogs.playerId, player.id),
          eq(playerCheckinLogs.checkinDate, today.dateKey),
        ))
        .get();
      if (existed) {
        throw new CheckinError("今日已签到");
      }

      const rule = await tx.select({
        dayIndex: checkinRewardRules.dayIndex,
        reward: checkinRewardRules.reward,
        enabled: checkinRewardRules.enabled,
      })
        .from(checkinRewardRules)
        .where(eq(checkinRewardRules.dayIndex, dayIndex))
        .get();

      if (!rule) {
        throw new CheckinError("今日签到奖励未配置");
      }
      if (!rule.enabled) {
        throw new CheckinError("今日签到未开放");
      }

      const baseReward = normalizeCdkReward(rule.reward || {});
      const reward = baseReward;
      if (!hasRewardValue(reward)) {
        throw new CheckinError("今日签到奖励配置无效");
      }

      const grantedReward = await grantRewardToPlayer({
        tx,
        playerId: player.id,
        reward,
      });

      await tx.insert(playerCheckinLogs).values({
        playerId: player.id,
        checkinDate: today.dateKey,
        dayIndex: rule.dayIndex,
        rewardSnapshot: reward,
      }).run();

      return {
        checkinDate: today.dateKey,
        dayIndex: rule.dayIndex,
        reward: grantedReward,
      };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof CheckinError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    if (isAlreadyCheckedInError(error)) {
      return NextResponse.json({ success: false, error: "今日已签到" }, { status: 400 });
    }

    console.error("Checkin claim error:", error);
    return NextResponse.json({ success: false, error: "签到失败" }, { status: 500 });
  }
}

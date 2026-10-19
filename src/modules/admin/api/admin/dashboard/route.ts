import { NextResponse } from "next/server";
import { count, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  combatLogs,
  items,
  maps,
  monsters,
  npcs,
  players,
  quests,
  randomEvents,
  sessions,
  skills,
} from "@/db/schema";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";

type DashboardData = {
  generatedAt: string;
  users: {
    totalAccounts: number;
    totalCharacters: number;
    accountsWithCharacters: number;
    accountsWithoutCharacters: number;
    onlineSessions: number;
    adminAccounts: number;
    aliveCharacters: number;
    deadCharacters: number;
  };
  content: {
    mapCount: number;
    npcCount: number;
    monsterCount: number;
    questCount: number;
    eventCount: number;
    skillCount: number;
    itemCount: number;
  };
  activity: {
    totalCombats: number;
    todayCombats: number;
    todayNewAccounts: number;
    todayNewCharacters: number;
    last7DaysNewAccounts: number;
    last7DaysNewCharacters: number;
    last7DaysCombats: number;
    trend7d: Array<{
      date: string;
      newAccounts: number;
      newCharacters: number;
      combats: number;
    }>;
  };
};

type DashboardCacheGlobal = typeof globalThis & {
  __adminDashboardCache?: {
    data: DashboardData;
    expiresAt: number;
  };
  __adminDashboardPromise?: Promise<DashboardData> | null;
};

const DASHBOARD_CACHE_TTL_MS = 10 * 60 * 1000;

function getCachedDashboardData(): DashboardData | null {
  const globalStore = globalThis as DashboardCacheGlobal;
  const cache = globalStore.__adminDashboardCache;
  if (!cache) {
    return null;
  }
  if (cache.expiresAt <= Date.now()) {
    delete globalStore.__adminDashboardCache;
    return null;
  }
  return cache.data;
}

function setCachedDashboardData(data: DashboardData) {
  const globalStore = globalThis as DashboardCacheGlobal;
  globalStore.__adminDashboardCache = {
    data,
    expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
  };
}

function getDashboardPromise() {
  const globalStore = globalThis as DashboardCacheGlobal;
  return globalStore.__adminDashboardPromise || null;
}

function setDashboardPromise(promise: Promise<DashboardData> | null) {
  const globalStore = globalThis as DashboardCacheGlobal;
  globalStore.__adminDashboardPromise = promise;
}

function toCount(value: unknown) {
  return Number(value || 0);
}

function getTodayStart() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return toDateKey(date);
}

export async function GET() {
  try {
    const auth = await requireAdminApi();
    if (auth.response) {
      return auth.response;
    }

    const cachedData = getCachedDashboardData();
    if (cachedData) {
      return NextResponse.json({
        success: true,
        data: cachedData,
      });
    }
    let inFlightPromise = getDashboardPromise();
    if (!inFlightPromise) {
      inFlightPromise = (async () => {
        const now = new Date();
        const nowIso = now.toISOString();
        const todayStart = getTodayStart();
        const todayStartIso = todayStart.toISOString();
        const trendDays = 7;
        const trendStart = new Date(todayStart);
        trendStart.setDate(trendStart.getDate() - (trendDays - 1));
        const trendStartIso = trendStart.toISOString();

        const trendDateKeys = Array.from({ length: trendDays }, (_, index) => {
          const current = new Date(trendStart);
          current.setDate(trendStart.getDate() + index);
          return toDateKey(current);
        });
        const trendDateSet = new Set(trendDateKeys);

        const [
          totalAccountsRow,
          totalCharactersRow,
          adminAccountsRow,
          aliveCharactersRow,
          onlineSessionsRow,
          mapCountRow,
          npcCountRow,
          monsterCountRow,
          questCountRow,
          eventCountRow,
          skillCountRow,
          itemCountRow,
          totalCombatsRow,
          todayCombatsRow,
          todayNewAccountsRow,
          todayNewCharactersRow,
          accountsWithCharactersRows,
          recentAccountRows,
          recentCharacterRows,
          recentCombatRows,
        ] = await Promise.all([
          db.select({ total: count() }).from(accounts).get(),
          db.select({ total: count() }).from(players).get(),
          db.select({ total: count() }).from(accounts).where(eq(accounts.isAdmin, true)).get(),
          db.select({ total: count() }).from(players).where(eq(players.isAlive, true)).get(),
          db.select({ total: count() }).from(sessions).where(gte(sessions.expiresAt, nowIso)).get(),
          db.select({ total: count() }).from(maps).get(),
          db.select({ total: count() }).from(npcs).get(),
          db.select({ total: count() }).from(monsters).get(),
          db.select({ total: count() }).from(quests).get(),
          db.select({ total: count() }).from(randomEvents).get(),
          db.select({ total: count() }).from(skills).get(),
          db.select({ total: count() }).from(items).get(),
          db.select({ total: count() }).from(combatLogs).get(),
          db.select({ total: count() }).from(combatLogs).where(gte(combatLogs.createdAt, todayStartIso)).get(),
          db.select({ total: count() }).from(accounts).where(gte(accounts.createdAt, todayStartIso)).get(),
          db.select({ total: count() }).from(players).where(gte(players.createdAt, todayStartIso)).get(),
          db.select({ accountId: players.accountId }).from(players).groupBy(players.accountId).all(),
          db.select({ createdAt: accounts.createdAt }).from(accounts).where(gte(accounts.createdAt, trendStartIso)).all(),
          db.select({ createdAt: players.createdAt }).from(players).where(gte(players.createdAt, trendStartIso)).all(),
          db.select({ createdAt: combatLogs.createdAt }).from(combatLogs).where(gte(combatLogs.createdAt, trendStartIso)).all(),
        ]);

        const totalAccounts = toCount(totalAccountsRow?.total);
        const totalCharacters = toCount(totalCharactersRow?.total);
        const adminAccounts = toCount(adminAccountsRow?.total);
        const aliveCharacters = toCount(aliveCharactersRow?.total);
        const deadCharacters = Math.max(totalCharacters - aliveCharacters, 0);
        const onlineSessions = toCount(onlineSessionsRow?.total);
        const accountsWithCharacters = accountsWithCharactersRows.length;
        const accountsWithoutCharacters = Math.max(totalAccounts - accountsWithCharacters, 0);

        const mapCount = toCount(mapCountRow?.total);
        const npcCount = toCount(npcCountRow?.total);
        const monsterCount = toCount(monsterCountRow?.total);
        const questCount = toCount(questCountRow?.total);
        const eventCount = toCount(eventCountRow?.total);
        const skillCount = toCount(skillCountRow?.total);
        const itemCount = toCount(itemCountRow?.total);

        const totalCombats = toCount(totalCombatsRow?.total);
        const todayCombats = toCount(todayCombatsRow?.total);
        const todayNewAccounts = toCount(todayNewAccountsRow?.total);
        const todayNewCharacters = toCount(todayNewCharactersRow?.total);

        const accountTrendMap = new Map<string, number>();
        const characterTrendMap = new Map<string, number>();
        const combatTrendMap = new Map<string, number>();

        for (const row of recentAccountRows) {
          const key = parseDateKey(row.createdAt);
          if (!key || !trendDateSet.has(key)) continue;
          accountTrendMap.set(key, (accountTrendMap.get(key) || 0) + 1);
        }
        for (const row of recentCharacterRows) {
          const key = parseDateKey(row.createdAt);
          if (!key || !trendDateSet.has(key)) continue;
          characterTrendMap.set(key, (characterTrendMap.get(key) || 0) + 1);
        }
        for (const row of recentCombatRows) {
          const key = parseDateKey(row.createdAt);
          if (!key || !trendDateSet.has(key)) continue;
          combatTrendMap.set(key, (combatTrendMap.get(key) || 0) + 1);
        }

        const trend7d = trendDateKeys.map((date) => ({
          date,
          newAccounts: accountTrendMap.get(date) || 0,
          newCharacters: characterTrendMap.get(date) || 0,
          combats: combatTrendMap.get(date) || 0,
        }));

        const last7DaysNewAccounts = trend7d.reduce((sum, item) => sum + item.newAccounts, 0);
        const last7DaysNewCharacters = trend7d.reduce((sum, item) => sum + item.newCharacters, 0);
        const last7DaysCombats = trend7d.reduce((sum, item) => sum + item.combats, 0);

        const data: DashboardData = {
          generatedAt: nowIso,
          users: {
            totalAccounts,
            totalCharacters,
            accountsWithCharacters,
            accountsWithoutCharacters,
            onlineSessions,
            adminAccounts,
            aliveCharacters,
            deadCharacters,
          },
          content: {
            mapCount,
            npcCount,
            monsterCount,
            questCount,
            eventCount,
            skillCount,
            itemCount,
          },
          activity: {
            totalCombats,
            todayCombats,
            todayNewAccounts,
            todayNewCharacters,
            last7DaysNewAccounts,
            last7DaysNewCharacters,
            last7DaysCombats,
            trend7d,
          },
        };

        setCachedDashboardData(data);
        return data;
      })();
      setDashboardPromise(inFlightPromise);
    }

    const data = await inFlightPromise.finally(() => {
      setDashboardPromise(null);
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return NextResponse.json({ success: false, error: "获取仪表盘数据失败" }, { status: 500 });
  }
}

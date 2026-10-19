import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { accounts, players, combatLogs } from "@/db/schema";
import { count, eq, and, isNotNull } from "drizzle-orm";
import { calculateCombatPower } from "@/modules/character/services/combat-power";
import {
  buildPlayerStatsSnapshotWithEquipment,
  getPlayersEquipmentBonusMap,
  getPlayersPluginBonusMap,
} from "@/modules/character/services/player-stats";
import { getPlayerCosmeticMapByIds } from "@/modules/character/services/player-cosmetic-profile";
import { readThroughReadModelCache } from "@/modules/shared/services/read-model-cache";
import {
  buildRankingCacheKey,
  getRankingCacheTtlMs,
} from "@/modules/shared/services/read-model-cache-keys";

type RankingDimension = "realm" | "cultivation" | "gold" | "power" | "wins";

type RankingEntry = {
  playerId: string;
  name: string;
  realm: number;
  realmMajor: number;
  realmMinor: number;
  realmName: string;
  cultivationXp: number;
  gold: number;
  maxHp: number;
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
  combatPower: number;
  wins: number;
  avatarId: string | null;
  avatarImageUrl: string | null;
  avatarFrameId: string | null;
  avatarFrameImageUrl: string | null;
};

const VALID_DIMENSIONS: RankingDimension[] = ["realm", "cultivation", "gold", "power", "wins"];
const MAX_RANKING_LIMIT = 10;

function parseDimension(value: string | null): RankingDimension {
  if (!value) return "power";
  if (VALID_DIMENSIONS.includes(value as RankingDimension)) {
    return value as RankingDimension;
  }
  return "power";
}

function sortRankings(entries: RankingEntry[], dimension: RankingDimension): RankingEntry[] {
  return [...entries].sort((a, b) => {
    if (dimension === "realm") {
      return (b.realm - a.realm)
        || (b.cultivationXp - a.cultivationXp)
        || (b.combatPower - a.combatPower)
        || a.playerId.localeCompare(b.playerId);
    }
    if (dimension === "cultivation") {
      return (b.cultivationXp - a.cultivationXp)
        || (b.combatPower - a.combatPower)
        || a.playerId.localeCompare(b.playerId);
    }
    if (dimension === "gold") {
      return (b.gold - a.gold)
        || (b.combatPower - a.combatPower)
        || a.playerId.localeCompare(b.playerId);
    }
    if (dimension === "wins") {
      return (b.wins - a.wins)
        || (b.combatPower - a.combatPower)
        || a.playerId.localeCompare(b.playerId);
    }

    return (b.combatPower - a.combatPower)
      || (b.attack - a.attack)
      || (b.defense - a.defense)
      || (b.maxHp - a.maxHp)
      || a.playerId.localeCompare(b.playerId);
  });
}

async function buildRankedEntries(dimension: RankingDimension) {
  const playerRows = await db.select({
    playerId: players.id,
    name: players.name,
    realm: players.realm,
    realmMajor: players.realmMajor,
    realmMinor: players.realmMinor,
    realmName: players.realmName,
    cultivationXp: players.cultivationXp,
    gold: players.gold,
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
    .innerJoin(accounts, eq(players.accountId, accounts.id))
    .where(and(
      isNotNull(players.name),
      eq(accounts.isAdmin, false),
    ))
    .all();

  const winRows = await db.select({
    playerId: combatLogs.playerId,
    wins: count(),
  }).from(combatLogs)
    .where(eq(combatLogs.result, "win"))
    .groupBy(combatLogs.playerId)
    .all();

  const winMap = new Map<string, number>(
    winRows.map((row) => [row.playerId, Number(row.wins) || 0]),
  );
  const allPlayerIds = playerRows.map((row) => row.playerId);
  const [equipmentBonusMap, pluginBonusMap, playerCosmeticMap] = await Promise.all([
    getPlayersEquipmentBonusMap(allPlayerIds),
    getPlayersPluginBonusMap(allPlayerIds),
    getPlayerCosmeticMapByIds(allPlayerIds),
  ]);

  const entries: RankingEntry[] = playerRows.map((row) => {
    const snapshot = buildPlayerStatsSnapshotWithEquipment(
      row,
      equipmentBonusMap.get(row.playerId),
      pluginBonusMap.get(row.playerId),
    );
    const cosmetic = playerCosmeticMap.get(row.playerId) || {
      avatarId: null,
      avatarImageUrl: null,
      avatarFrameId: null,
      avatarFrameImageUrl: null,
    };
    const baseEntry = {
      playerId: row.playerId,
      name: row.name || "无名修士",
      realm: row.realm,
      realmMajor: row.realmMajor,
      realmMinor: row.realmMinor,
      realmName: row.realmName,
      cultivationXp: row.cultivationXp,
      gold: row.gold,
      maxHp: snapshot.total.maxHp,
      maxMp: snapshot.total.maxMp,
      attack: snapshot.total.attack,
      defense: snapshot.total.defense,
      speed: snapshot.total.speed,
      luck: snapshot.total.luck,
      spiritualSense: snapshot.total.spiritualSense,
      armorPenetration: snapshot.total.armorPenetration,
      block: snapshot.total.block,
      skillDamageBonus: snapshot.total.skillDamageBonus,
      skillDamageReduction: snapshot.total.skillDamageReduction,
      artifactDamageBonus: snapshot.total.artifactDamageBonus,
      artifactDamageReduction: snapshot.total.artifactDamageReduction,
    };

    return {
      ...baseEntry,
      combatPower: calculateCombatPower(baseEntry),
      wins: winMap.get(row.playerId) || 0,
      avatarId: cosmetic.avatarId,
      avatarImageUrl: cosmetic.avatarImageUrl,
      avatarFrameId: cosmetic.avatarFrameId,
      avatarFrameImageUrl: cosmetic.avatarFrameImageUrl,
    };
  });

  return sortRankings(entries, dimension);
}

async function getRankedEntriesByDimension(dimension: RankingDimension) {
  return await readThroughReadModelCache({
    key: buildRankingCacheKey(dimension),
    ttlMs: getRankingCacheTtlMs(),
    statGroup: "rankings",
    loader: async () => await buildRankedEntries(dimension),
  });
}

export async function GET(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dimension = parseDimension(searchParams.get("dimension"));
    const rawLimit = Number(searchParams.get("limit") || String(MAX_RANKING_LIMIT));
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(MAX_RANKING_LIMIT, Math.floor(rawLimit)))
      : MAX_RANKING_LIMIT;

    const ranked = (await getRankedEntriesByDimension(dimension)).map((entry, index) => ({
      rank: index + 1,
      isMe: entry.playerId === player.id,
      ...entry,
    }));

    const topList = ranked.slice(0, limit);
    const myRank = ranked.find((entry) => entry.playerId === player.id) || null;

    return NextResponse.json({
      success: true,
      data: {
        dimension,
        limit,
        list: topList,
        myRank,
      },
    });
  } catch (e) {
    console.error("Ranking error:", e);
    return NextResponse.json({ success: false, error: "获取封神榜失败" }, { status: 500 });
  }
}

import { createHash } from "crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { items, mapDailyRumors, mapEdges, maps, monsters, npcs } from "@/db/schema";
import { generateMapRumor, type MapRumorResult } from "@/modules/ai/services/world-flavor-generation";
import { listVisibleSecretRealmSpawns } from "@/modules/map/services/secret-realm-spawn-service";

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

interface MapRumorCachePayload {
  source: "ai" | "fallback";
  headline: string;
  rumors: Array<{
    text: string;
    credibility: "low" | "mid" | "high";
    tag?: string;
  }>;
  fixedFacts: string[];
  summaryVersion: string;
  generatedAt: string;
}

export interface MapRumorView extends MapRumorCachePayload {
  mapId: string;
  dateKey: string;
}

function isMissingRelationError(error: unknown, relationName: string) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const cause = "cause" in error ? (error as { cause?: unknown }).cause : null;
  const code = cause && typeof cause === "object" && "code" in cause
    ? String((cause as { code?: unknown }).code || "")
    : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "42P01" && message.includes(relationName);
}

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

function md5(input: string) {
  return createHash("md5").update(input).digest("hex");
}

function trimText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function buildDropThemeText(rows: Array<{
  name: string;
  drops: Array<{ itemId?: string; itemName?: string }>;
}>) {
  const names = new Set<string>();
  for (const row of rows) {
    for (const drop of row.drops) {
      const itemName = trimText(drop.itemName);
      if (itemName) {
        names.add(itemName);
      }
      if (names.size >= 4) {
        break;
      }
    }
    if (names.size >= 4) {
      break;
    }
  }
  return [...names];
}

function buildFallbackRumorPayload(params: {
  mapId: string;
  dateKey: string;
  summaryVersion: string;
  generatedAt: string;
  mapName: string;
  fixedFacts: string[];
  nearbyMapNames: string[];
  secretRealmNames: string[];
}): MapRumorView {
  const dangerLine = params.secretRealmNames.length > 0
    ? `${params.secretRealmNames[0]}的入口近来时隐时现`
    : params.nearbyMapNames.length > 0
      ? `有人说通往${params.nearbyMapNames[0]}的路上近来不太平`
      : `${params.mapName}近来人心浮动`;

  return {
    mapId: params.mapId,
    dateKey: params.dateKey,
    source: "fallback",
    headline: `${params.mapName}近闻`,
    rumors: [
      {
        text: `${params.fixedFacts[0] || `${params.mapName}里近来多了几分异动`}。`,
        credibility: "high",
        tag: "实闻",
      },
      {
        text: `${dangerLine}。`,
        credibility: "mid",
        tag: "风声",
      },
      {
        text: `老人都劝一句，到了${params.mapName}别只顾赶路，多留心脚下和四周动静。`,
        credibility: "mid",
        tag: "提醒",
      },
    ],
    fixedFacts: params.fixedFacts,
    summaryVersion: params.summaryVersion,
    generatedAt: params.generatedAt,
  };
}

function toCachePayload(params: {
  result: MapRumorResult;
  fixedFacts: string[];
  summaryVersion: string;
  generatedAt: string;
}): MapRumorCachePayload {
  return {
    source: params.result.source,
    headline: trimText(params.result.headline, "今日风闻"),
    rumors: Array.isArray(params.result.rumors) ? params.result.rumors : [],
    fixedFacts: params.fixedFacts,
    summaryVersion: params.summaryVersion,
    generatedAt: params.generatedAt,
  };
}

function parseCachePayload(value: unknown): MapRumorCachePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const rumors = Array.isArray(payload.rumors)
    ? payload.rumors
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => {
        const entry = item as Record<string, unknown>;
        const credibility = trimText(entry.credibility, "mid");
        return {
          text: trimText(entry.text),
          credibility: (["low", "mid", "high"].includes(credibility) ? credibility : "mid") as "low" | "mid" | "high",
          tag: trimText(entry.tag) || undefined,
        };
      })
      .filter((item) => item.text)
    : [];

  if (rumors.length < 1) {
    return null;
  }

  const source = trimText(payload.source, "fallback");
  return {
    source: source === "ai" ? "ai" : "fallback",
    headline: trimText(payload.headline, "今日风闻"),
    rumors,
    fixedFacts: Array.isArray(payload.fixedFacts)
      ? payload.fixedFacts.map((item) => trimText(item)).filter(Boolean)
      : [],
    summaryVersion: trimText(payload.summaryVersion),
    generatedAt: trimText(payload.generatedAt, new Date().toISOString()),
  };
}

export async function getMapDailyRumors(params: {
  playerId: string;
  mapId: string;
  playerRealmName: string;
}): Promise<MapRumorView> {
  const dateKey = getShanghaiDateKey();
  const generatedAt = new Date().toISOString();
  const mapRow = await db.select({
    id: maps.id,
    name: maps.name,
    description: maps.description,
    mapType: maps.mapType,
  }).from(maps).where(eq(maps.id, params.mapId)).get();
  if (!mapRow) {
    const fallbackSummaryVersion = md5(`${params.mapId}:${dateKey}:missing-map`);
    return buildFallbackRumorPayload({
      mapId: params.mapId,
      dateKey,
      summaryVersion: fallbackSummaryVersion,
      generatedAt,
      mapName: "此地",
      fixedFacts: ["此地地势未明，来往之人都只敢低声议论"],
      nearbyMapNames: [],
      secretRealmNames: [],
    });
  }

  const [npcRows, monsterRows, edgeRows, secretRealms] = await Promise.all([
    db.select({
      id: npcs.id,
      name: npcs.name,
      title: npcs.title,
    }).from(npcs).where(eq(npcs.mapId, params.mapId)).all(),
    db.select({
      id: monsters.id,
      name: monsters.name,
      drops: monsters.drops,
    }).from(monsters).where(eq(monsters.mapId, params.mapId)).all(),
    db.select({
      mapAId: mapEdges.mapAId,
      mapBId: mapEdges.mapBId,
    }).from(mapEdges).where(or(
      eq(mapEdges.mapAId, params.mapId),
      eq(mapEdges.mapBId, params.mapId),
    )).all(),
    listVisibleSecretRealmSpawns({
      mapId: params.mapId,
      playerId: params.playerId,
    }).catch(() => []),
  ]);

  const linkedMapIds = [...new Set(edgeRows.map((edge) => (
    edge.mapAId === params.mapId ? edge.mapBId : edge.mapAId
  )))];
  const linkedMaps = linkedMapIds.length > 0
    ? await db.select({
      id: maps.id,
      name: maps.name,
      mapType: maps.mapType,
    }).from(maps).where(inArray(maps.id, linkedMapIds)).all()
    : [];

  const dropItemIds = [...new Set(monsterRows.flatMap((row) => (
    Array.isArray(row.drops)
      ? row.drops
        .map((drop) => trimText((drop as unknown as Record<string, unknown>)?.itemId))
        .filter(Boolean)
      : []
  )))];
  const itemRows = dropItemIds.length > 0
    ? await db.select({
      id: items.id,
      name: items.name,
    }).from(items).where(inArray(items.id, dropItemIds)).all()
    : [];
  const itemNameMap = new Map(itemRows.map((item) => [item.id, item.name]));

  const npcNames = npcRows.map((npc) => npc.name).filter(Boolean);
  const monsterFacts = monsterRows.map((monster) => ({
    name: monster.name,
    drops: Array.isArray(monster.drops)
      ? monster.drops.map((drop) => {
        const itemId = trimText((drop as unknown as Record<string, unknown>)?.itemId);
        return {
          itemId,
          itemName: itemNameMap.get(itemId) || "",
        };
      })
      : [],
  }));
  const dropThemeNames = buildDropThemeText(monsterFacts);
  const linkedMapNames = linkedMaps.map((row) => row.name).filter(Boolean);
  const secretRealmNames = secretRealms.map((realm) => realm.name).filter(Boolean);

  const fixedFacts = [
    `${mapRow.name}是一处${trimText(mapRow.mapType, "未知")}地带`,
    npcNames.length > 0 ? `此地常见的人物有：${npcNames.slice(0, 4).join("、")}` : "",
    monsterRows.length > 0 ? `常出没的威胁包括：${monsterRows.slice(0, 4).map((row) => row.name).join("、")}` : "",
    dropThemeNames.length > 0 ? `修士们常提到的收获有：${dropThemeNames.join("、")}` : "",
    linkedMapNames.length > 0 ? `从这里可前往：${linkedMapNames.join("、")}` : "",
    secretRealms.length > 0
      ? `眼下可见的秘境入口有：${secretRealms.slice(0, 3).map((realm) => realm.name).join("、")}`
      : "",
  ].filter(Boolean);

  const summaryVersion = md5(JSON.stringify({
    mapName: mapRow.name,
    mapType: mapRow.mapType,
    mapDescription: trimText(mapRow.description),
    npcNames,
    monsterNames: monsterRows.map((row) => row.name),
    dropThemeNames,
    linkedMapNames,
    secretRealmNames,
  }));

  let todayRow:
    | {
      id: string;
      payloadJson: Record<string, unknown>;
      summaryVersion: string;
      dateKey: string;
    }
    | undefined;
  try {
    todayRow = await db.select({
      id: mapDailyRumors.id,
      payloadJson: mapDailyRumors.payloadJson,
      summaryVersion: mapDailyRumors.summaryVersion,
      dateKey: mapDailyRumors.dateKey,
    }).from(mapDailyRumors).where(and(
      eq(mapDailyRumors.mapId, params.mapId),
      eq(mapDailyRumors.dateKey, dateKey),
    )).get();
  } catch (error) {
    if (!isMissingRelationError(error, "map_daily_rumors")) {
      throw error;
    }
  }

  if (todayRow && todayRow.summaryVersion === summaryVersion) {
    const parsed = parseCachePayload(todayRow.payloadJson);
    if (parsed) {
      return {
        mapId: params.mapId,
        dateKey,
        ...parsed,
      };
    }
  }

  const rumorResult = await generateMapRumor({
    seed: `${params.mapId}:${dateKey}:${summaryVersion}`,
    realm: params.playerRealmName,
    mapName: mapRow.name,
    theme: trimText(mapRow.description),
    rumorSources: npcNames.length > 0 ? npcNames.slice(0, 4) : ["茶摊闲客"],
    fixedFacts,
    tabooTags: [
      linkedMapNames.length > 0 ? `去往${linkedMapNames[0]}的路上莫贪快` : "",
      secretRealms.length > 0 ? "秘境入口前莫贸然试探" : "",
    ].filter(Boolean),
    dangerTags: [
      monsterRows.length > 0 ? `${monsterRows[0].name}近来时常露面` : "",
      secretRealms.length > 0 ? `${secretRealms[0].name}附近灵机不稳` : "",
    ].filter(Boolean),
    rumorCount: 3,
  });

  const payload = toCachePayload({
    result: rumorResult,
    fixedFacts,
    summaryVersion,
    generatedAt,
  });
  const safePayload = payload.rumors.length > 0
    ? payload
    : buildFallbackRumorPayload({
      mapId: params.mapId,
      dateKey,
      summaryVersion,
      generatedAt,
      mapName: mapRow.name,
      fixedFacts,
      nearbyMapNames: linkedMapNames,
      secretRealmNames,
    });
  const safePayloadJson = safePayload as unknown as Record<string, unknown>;

  try {
    await db.insert(mapDailyRumors).values({
      mapId: params.mapId,
      dateKey,
      summaryVersion,
      payloadJson: safePayloadJson,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    }).onConflictDoUpdate({
      target: [mapDailyRumors.mapId, mapDailyRumors.dateKey],
      set: {
        summaryVersion,
        payloadJson: safePayloadJson,
        updatedAt: generatedAt,
      },
    }).run();
  } catch (error) {
    if (!isMissingRelationError(error, "map_daily_rumors")) {
      throw error;
    }
  }

  return {
    mapId: params.mapId,
    dateKey,
    ...safePayload,
  };
}

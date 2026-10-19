import { and, count, eq, inArray, sql } from "drizzle-orm";

import {
  aiMemories,
  bossInstances,
  fortunes,
  hongmengTreasureConfigs,
  items,
  mapEdges,
  mapOpportunitySpawns,
  maps,
  monsters,
  npcs,
  partyEncounters,
  playerFortuneAttrLedger,
  playerFortunes,
  playerHongmengTreasures,
  playerRandomEventCooldowns,
  players,
  quests,
  randomEvents,
  skills,
} from "../../src/db/schema";
import { fourRealmsPack } from "../../src/db/offline-packs/four-realms-pack";

export type PruneFourRealmsLegacyDataOptions = {
  execute: boolean;
  allowPlayers?: boolean;
  db?: Awaited<ReturnType<typeof loadDb>>;
};

export type PruneFourRealmsLegacyDataSummary = {
  execute: boolean;
  playerCount: number;
  stale: {
    maps: number;
    mapEdges: number;
    npcs: number;
    skills: number;
    items: number;
    monsters: number;
    quests: number;
    fortunes: number;
    playerFortunes: number;
    randomEvents: number;
    hongmengTreasureConfigs: number;
  };
  runtimeRows: {
    mapOpportunitySpawns: number;
    playerRandomEventCooldowns: number;
    bossInstances: number;
    partyEncounters: number;
    aiMemories: number;
    playerHongmengTreasures: number;
    hongmengTreasureConfigs: number;
    pluginSpiritualFieldPlayers: number;
    pluginSpiritualFieldPlots: number;
    pluginSpiritualFieldSeeds: number;
    alchemyRecipes: number;
    smithingRecipes: number;
  };
  note: string;
};

function diffIds(current: string[], allowed: Set<string>) {
  return current.filter((id) => !allowed.has(id));
}

type QueryWithAll<T> = {
  all: () => Promise<T[]>;
};

type QueryWithGet<T> = {
  get: () => Promise<T | undefined>;
};

function getExecuteRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as Array<Record<string, unknown>>;
  }

  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows as Array<Record<string, unknown>>;
    }
  }

  return [];
}

async function selectTextIds(source: QueryWithAll<{ id: string }>) {
  const rows = await source.all();
  return rows.map((row) => row.id);
}

async function countRows(source: QueryWithGet<{ c: number | string | bigint }>) {
  const row = await source.get();
  return Number(row?.c || 0);
}

async function doesTableExist(activeDb: Awaited<ReturnType<typeof loadDb>>, tableName: string) {
  const result = await activeDb.execute(sql`select to_regclass(${`public.${tableName}`}) as table_name`);
  const [row] = getExecuteRows(result);
  return typeof row?.table_name === "string" && row.table_name.length > 0;
}

async function countOptionalTableRows(activeDb: Awaited<ReturnType<typeof loadDb>>, tableName: string) {
  if (!(await doesTableExist(activeDb, tableName))) {
    return 0;
  }

  const result = await activeDb.execute<{ c: number | string | bigint }>(
    sql`select count(*)::int as c from ${sql.identifier(tableName)}`,
  );
  const [row] = getExecuteRows(result) as Array<{ c?: number | string | bigint }>;
  return Number(row?.c || 0);
}

async function deleteOptionalTableRows(activeDb: Awaited<ReturnType<typeof loadDb>>, tableName: string) {
  if (!(await doesTableExist(activeDb, tableName))) {
    return;
  }

  await activeDb.execute(sql`delete from ${sql.identifier(tableName)}`);
}

async function loadDb() {
  const { db } = await import("../../src/db");
  return db;
}

export async function pruneFourRealmsLegacyData(
  options: PruneFourRealmsLegacyDataOptions,
): Promise<PruneFourRealmsLegacyDataSummary> {
  const activeDb = options.db ?? await loadDb();
  const execute = options.execute;
  const allowPlayers = options.allowPlayers === true;
  const playerCount = await countRows(activeDb.select({ c: count() }).from(players));
  if (execute && playerCount > 0 && !allowPlayers) {
    throw new Error(`检测到仍有 ${playerCount} 个角色数据。请先删档，或显式设置 FOUR_REALMS_PRUNE_ALLOW_PLAYERS=1 再执行。`);
  }

  const allowedMapIds = new Set(fourRealmsPack.maps.map((row) => row.id));
  const allowedNpcIds = new Set(fourRealmsPack.npcs.map((row) => row.id));
  const allowedSkillIds = new Set(fourRealmsPack.skills.map((row) => row.id));
  const allowedItemIds = new Set(fourRealmsPack.items.map((row) => row.id));
  const allowedMonsterIds = new Set(fourRealmsPack.monsters.map((row) => row.id));
  const allowedQuestIds = new Set(fourRealmsPack.quests.map((row) => row.id));
  const allowedFortuneIds = new Set(fourRealmsPack.fortunes.map((row) => row.id));
  const allowedRandomEventIds = new Set(fourRealmsPack.randomEvents.map((row) => row.id));
  const allowedHongmengItemIds = new Set(fourRealmsPack.hongmengTreasureConfigs.map((row) => row.itemId));

  const staleMapIds = diffIds(
    await selectTextIds(activeDb.select({ id: maps.id }).from(maps)),
    allowedMapIds,
  );
  const staleNpcIds = diffIds(
    await selectTextIds(activeDb.select({ id: npcs.id }).from(npcs)),
    allowedNpcIds,
  );
  const staleSkillIds = diffIds(
    await selectTextIds(activeDb.select({ id: skills.id }).from(skills)),
    allowedSkillIds,
  );
  const staleItemIds = diffIds(
    await selectTextIds(activeDb.select({ id: items.id }).from(items)),
    allowedItemIds,
  );
  const staleMonsterIds = diffIds(
    await selectTextIds(activeDb.select({ id: monsters.id }).from(monsters)),
    allowedMonsterIds,
  );
  const staleQuestIds = diffIds(
    await selectTextIds(activeDb.select({ id: quests.id }).from(quests)),
    allowedQuestIds,
  );
  const staleFortuneIds = diffIds(
    await selectTextIds(activeDb.select({ id: fortunes.id }).from(fortunes)),
    allowedFortuneIds,
  );
  const staleRandomEventIds = diffIds(
    await selectTextIds(activeDb.select({ id: randomEvents.id }).from(randomEvents)),
    allowedRandomEventIds,
  );
  const staleHongmengConfigIds = diffIds(
    await selectTextIds(activeDb.select({ id: hongmengTreasureConfigs.itemId }).from(hongmengTreasureConfigs)),
    allowedHongmengItemIds,
  );

  const stalePlayerFortuneRows = staleFortuneIds.length > 0
    ? await activeDb.select({
      id: playerFortunes.id,
      fortuneId: playerFortunes.fortuneId,
    }).from(playerFortunes).where(inArray(playerFortunes.fortuneId, staleFortuneIds)).all()
    : [];
  const stalePlayerFortuneIds = stalePlayerFortuneRows.map((row) => Number(row.id));

  const staleMapEdgeRows = await activeDb.select({
    mapAId: mapEdges.mapAId,
    mapBId: mapEdges.mapBId,
  }).from(mapEdges).all();
  const staleMapEdges = staleMapEdgeRows.filter((row) => !allowedMapIds.has(row.mapAId) || !allowedMapIds.has(row.mapBId));

  const summary: PruneFourRealmsLegacyDataSummary = {
    execute,
    playerCount,
    stale: {
      maps: staleMapIds.length,
      mapEdges: staleMapEdges.length,
      npcs: staleNpcIds.length,
      skills: staleSkillIds.length,
      items: staleItemIds.length,
      monsters: staleMonsterIds.length,
      quests: staleQuestIds.length,
      fortunes: staleFortuneIds.length,
      playerFortunes: stalePlayerFortuneIds.length,
      randomEvents: staleRandomEventIds.length,
      hongmengTreasureConfigs: staleHongmengConfigIds.length,
    },
    runtimeRows: {
      mapOpportunitySpawns: await countRows(activeDb.select({ c: count() }).from(mapOpportunitySpawns)),
      playerRandomEventCooldowns: await countRows(activeDb.select({ c: count() }).from(playerRandomEventCooldowns)),
      bossInstances: await countRows(activeDb.select({ c: count() }).from(bossInstances)),
      partyEncounters: await countRows(activeDb.select({ c: count() }).from(partyEncounters)),
      aiMemories: await countRows(activeDb.select({ c: count() }).from(aiMemories)),
      playerHongmengTreasures: await countRows(activeDb.select({ c: count() }).from(playerHongmengTreasures)),
      hongmengTreasureConfigs: await countRows(activeDb.select({ c: count() }).from(hongmengTreasureConfigs)),
      pluginSpiritualFieldPlayers: await countOptionalTableRows(activeDb, "plugin_spiritual_field_players"),
      pluginSpiritualFieldPlots: await countOptionalTableRows(activeDb, "plugin_spiritual_field_plots"),
      pluginSpiritualFieldSeeds: await countOptionalTableRows(activeDb, "plugin_spiritual_field_seeds"),
      alchemyRecipes: await countOptionalTableRows(activeDb, "alchemy_recipes"),
      smithingRecipes: await countOptionalTableRows(activeDb, "smithing_recipes"),
    },
    note: execute
      ? "已执行旧数据清理。建议随后运行四境导入脚本。"
      : playerCount > 0
        ? `当前为预览模式。检测到仍有 ${playerCount} 个角色，正式执行前请先删档。设置 FOUR_REALMS_PRUNE=1 后才会真正写库。`
        : "当前为预览模式。设置 FOUR_REALMS_PRUNE=1 后才会真正写库。",
  };

  if (!execute) {
    return summary;
  }

  if (stalePlayerFortuneIds.length > 0) {
    await activeDb.delete(playerFortuneAttrLedger).where(inArray(playerFortuneAttrLedger.playerFortuneId, stalePlayerFortuneIds)).run();
    await activeDb.delete(playerFortunes).where(inArray(playerFortunes.id, stalePlayerFortuneIds)).run();
  }

  await activeDb.delete(mapOpportunitySpawns).run();
  await activeDb.delete(playerRandomEventCooldowns).run();
  await activeDb.delete(bossInstances).run();
  await activeDb.delete(partyEncounters).run();
  await activeDb.delete(aiMemories).run();
  await activeDb.delete(playerHongmengTreasures).run();
  await deleteOptionalTableRows(activeDb, "plugin_spiritual_field_plots");
  await deleteOptionalTableRows(activeDb, "plugin_spiritual_field_players");
  await deleteOptionalTableRows(activeDb, "plugin_spiritual_field_seeds");
  await deleteOptionalTableRows(activeDb, "alchemy_recipes");
  await deleteOptionalTableRows(activeDb, "smithing_recipes");

  if (staleHongmengConfigIds.length > 0) {
    await activeDb.delete(hongmengTreasureConfigs).where(inArray(hongmengTreasureConfigs.itemId, staleHongmengConfigIds)).run();
  }

  if (staleRandomEventIds.length > 0) {
    await activeDb.delete(randomEvents).where(inArray(randomEvents.id, staleRandomEventIds)).run();
  }
  if (staleQuestIds.length > 0) {
    await activeDb.delete(quests).where(inArray(quests.id, staleQuestIds)).run();
  }
  if (staleMonsterIds.length > 0) {
    await activeDb.delete(monsters).where(inArray(monsters.id, staleMonsterIds)).run();
  }
  if (staleFortuneIds.length > 0) {
    await activeDb.delete(fortunes).where(inArray(fortunes.id, staleFortuneIds)).run();
  }
  if (staleSkillIds.length > 0) {
    await activeDb.delete(skills).where(inArray(skills.id, staleSkillIds)).run();
  }
  if (staleItemIds.length > 0) {
    await activeDb.delete(items).where(inArray(items.id, staleItemIds)).run();
  }
  if (staleNpcIds.length > 0) {
    await activeDb.delete(npcs).where(inArray(npcs.id, staleNpcIds)).run();
  }

  for (const edge of staleMapEdges) {
    await activeDb.delete(mapEdges).where(and(
      eq(mapEdges.mapAId, edge.mapAId),
      eq(mapEdges.mapBId, edge.mapBId),
    )).run();
  }

  if (staleMapIds.length > 0) {
    await activeDb.delete(maps).where(inArray(maps.id, staleMapIds)).run();
  }

  return summary;
}

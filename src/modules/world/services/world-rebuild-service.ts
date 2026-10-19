import { db } from "@/db";
import { worldMapInstances } from "@/db/schema";
import { refreshOpenWorldFactionStoryFlavor } from "@/modules/world/services/world-faction-storyline-service";
import { ensureOpenWorldBootstrap } from "@/modules/world/services/world-map-service";
import { ensureOpenWorldDistrictRumors } from "@/modules/world/services/world-rumor-service";
import { ensureOpenWorldSchema } from "@/modules/world/services/world-schema";

export type OpenWorldRebuildSummary = {
  rebuilt: boolean;
  mapCount: number;
  rumorRefreshCount: number;
  refreshedFactionCount: number;
  refreshedDistrictCount: number;
  refreshedStorylineCount: number;
  rebuiltAt: string;
};

export type OpenWorldRebuildProgress = {
  phase: string;
  phaseLabel?: string;
  detail: string;
  current?: number;
  total?: number;
};

export async function rebuildOpenWorldFromWorldBook(options?: {
  onProgress?: (progress: OpenWorldRebuildProgress) => void;
}): Promise<OpenWorldRebuildSummary> {
  const rebuiltAt = new Date().toISOString();
  options?.onProgress?.({
    phase: "schema-check",
    phaseLabel: "前置校验",
    detail: "正在校验开放世界表结构与世界书重制前置条件",
    current: 0,
    total: 1,
  });
  if (!(await ensureOpenWorldSchema())) {
    return {
      rebuilt: false,
      mapCount: 0,
      rumorRefreshCount: 0,
      refreshedFactionCount: 0,
      refreshedDistrictCount: 0,
      refreshedStorylineCount: 0,
      rebuiltAt,
    };
  }
  options?.onProgress?.({
    phase: "schema-check",
    phaseLabel: "前置校验",
    detail: "开放世界表结构校验完成，准备进入内容重刷",
    current: 1,
    total: 1,
  });

  options?.onProgress?.({
    phase: "bootstrap",
    phaseLabel: "地图与 NPC",
    detail: "正在重刷开放世界地图与世界 NPC AI 元数据",
    current: 0,
    total: 1,
  });
  const bootstrapReady = await ensureOpenWorldBootstrap({
    forceAiRefresh: true,
  });
  if (!bootstrapReady) {
    return {
      rebuilt: false,
      mapCount: 0,
      rumorRefreshCount: 0,
      refreshedFactionCount: 0,
      refreshedDistrictCount: 0,
      refreshedStorylineCount: 0,
      rebuiltAt,
    };
  }
  options?.onProgress?.({
    phase: "bootstrap",
    phaseLabel: "地图与 NPC",
    detail: "地图与世界 NPC AI 元数据重刷完成",
    current: 1,
    total: 1,
  });

  const mapRows = await db.select({
    id: worldMapInstances.id,
  }).from(worldMapInstances).all();

  options?.onProgress?.({
    phase: "rumor-refresh",
    phaseLabel: "街区风闻",
    detail: `正在重刷 ${mapRows.length} 张地图的街区风闻`,
    current: 0,
    total: mapRows.length || 1,
  });
  let rumorCompleted = 0;
  const rumorRefreshResults = await Promise.all(mapRows.map(async (mapRow) => {
    const refreshed = await ensureOpenWorldDistrictRumors(mapRow.id, { force: true });
    rumorCompleted += 1;
    options?.onProgress?.({
      phase: "rumor-refresh",
      phaseLabel: "街区风闻",
      detail: `正在刷新街区风闻（${rumorCompleted}/${mapRows.length}）`,
      current: rumorCompleted,
      total: mapRows.length || 1,
    });
    return refreshed.rumors.length > 0 ? 1 : 0;
  }));
  const rumorRefreshCount = rumorRefreshResults.reduce<number>((sum, current) => sum + current, 0);

  options?.onProgress?.({
    phase: "faction-refresh",
    phaseLabel: "势力与故事链",
    detail: "正在刷新势力口风、街区态势与故事链摘要",
    current: 0,
    total: 1,
  });
  const factionRefresh = await refreshOpenWorldFactionStoryFlavor();
  const summary = {
    rebuilt: true,
    mapCount: mapRows.length,
    rumorRefreshCount,
    refreshedFactionCount: factionRefresh.refreshedFactionCount,
    refreshedDistrictCount: factionRefresh.refreshedDistrictCount,
    refreshedStorylineCount: factionRefresh.refreshedStorylineCount,
    rebuiltAt,
  };
  options?.onProgress?.({
    phase: "completed",
    phaseLabel: "已完成",
    detail: `重制完成：${summary.mapCount} 张地图、${summary.rumorRefreshCount} 组风闻、${summary.refreshedStorylineCount} 条故事链已刷新`,
    current: 1,
    total: 1,
  });
  return summary;
}

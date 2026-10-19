"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Drawer, Input, Select, Spin, Tag, message } from "antd";
import { useRouter } from "next/navigation";
import type { SectApplicationType, SectBuildingType, SectLevel, SectPermissionKey, SectRoleKey, SectState, SectSummary } from "@/types/game";
import { getSectPermissionLabel } from "@/modules/sect/services/sect-constants";
import { resolveSectPresenceRoomOptions } from "@immortality/shared-protocol/sect-presence";
import { REALTIME_OPCODE_BY_OUTPUT_TYPE, type AnyStateRefreshEnvelope } from "@immortality/shared-protocol";
import {
  applyStateRefreshFramesFromResponse,
} from "@/modules/shared/ui/hooks/useStateRefreshFrames";
import { useSocialRoomPresence } from "@/modules/social/ui/hooks/useSocialRoomPresence";

type ApiEnvelope<T> = { success: boolean; error?: string; data?: T };
type InventoryItem = { itemId: string; name: string; quantity: number; equipped?: boolean; isBound?: boolean };
type SectResourceRow = { spiritStone: number; wood: number; stone: number; sectMaterial: number; storageCapacity: number };
type SectBuildingRow = { buildingType: SectBuildingType; name: string; level: number; positionX: number; positionY: number; description?: string | null };
type SectMemberRow = { playerId: string; playerName: string; realmName: string; roleKey: SectRoleKey; roleLabel: string; lastSeenAt?: string | null };
type SectStorageRow = { id: number; slotIndex: number; itemId: string; itemName?: string | null; quantity: number };
type SectApplicationRow = { id: string; sectId?: string; sectName?: string; playerName?: string; type: SectApplicationType; status: string; note?: string | null; createdAt: string; expiresAt?: string | null };
type SectLevelConfigRow = { level: SectLevel; mapSize: number; memberLimit: number };
type SectBrowseRow = {
  id: string;
  name: string;
  announcement?: string | null;
  state: SectState;
  level: SectLevel;
  mapSize: number;
  memberCount: number;
  memberLimit: number;
  externalMapId?: string | null;
  externalPositionX?: number;
  externalPositionY?: number;
  externalMapName?: string | null;
};
type SectDetail = {
  id: string;
  name: string;
  state: SectState;
  announcement?: string | null;
  externalPositionX: number;
  externalPositionY: number;
  roleKey: SectRoleKey;
  roleLabel: string;
  summary: SectSummary;
  resources: SectResourceRow | null;
  buildings: SectBuildingRow[];
  members: SectMemberRow[];
  pendingApplications: SectApplicationRow[];
  storage: SectStorageRow[];
  permissions: SectPermissionKey[];
  permissionPreview?: {
    innerDiscipleReviewVisitEnabled: boolean;
  };
  levelConfig: SectLevelConfigRow[];
};
type SectDashboard = {
  currentPlayer: { id: string; createMinRealmName: string; gold: number; createGoldCost: number };
  canCreate: boolean;
  browse: { sects: SectBrowseRow[]; myApplications: SectApplicationRow[] };
  sect: SectDetail | null;
};
type MapTile = { x: number; y: number; type: string; walkable?: boolean; eventId?: string | null };
type MapSnapshot = {
  map: { id: string; name: string; width: number; height: number; tilesData: MapTile[] };
  npcs?: Array<{ positionX: number; positionY: number }>;
  monsters?: Array<{ positionX: number; positionY: number }>;
  opportunities?: Array<{ positionX: number; positionY: number }>;
};

const ROLE_OPTIONS: Array<{ label: string; value: SectRoleKey }> = [
  { label: "宗主（交接）", value: "leader" },
  { label: "副宗主", value: "vice_leader" },
  { label: "大长老", value: "grand_elder" },
  { label: "长老", value: "elder" },
  { label: "内门弟子", value: "inner_disciple" },
  { label: "外门弟子", value: "outer_disciple" },
  { label: "杂役弟子", value: "handyman" },
];
const APPLICATION_LABELS: Record<SectApplicationType, string> = { join: "入宗申请", visit: "访客申请" };
const TAB_OPTIONS = [
  { key: "overview", label: "总览" },
  { key: "members", label: "成员" },
  { key: "approvals", label: "审批" },
  { key: "hall", label: "大殿" },
  { key: "storage", label: "仓库" },
  { key: "peak", label: "灵气峰" },
] as const;
const cardStyle: React.CSSProperties = { background: "#171411", borderColor: "#4f432c", color: "#e8dcc4" };
const statCardStyle: React.CSSProperties = { padding: 12, borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(201,168,76,0.08)" };
const responsiveActionRowStyle: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const responsiveActionGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(132px, 100%), 1fr))", gap: 8 };
const responsiveInfoGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(116px, 100%), 1fr))", gap: 8 };
const mobileListRowStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  padding: "10px 0",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

function formatMemberRatio(memberCount: number, memberLimit: number) {
  if (memberLimit <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((memberCount / memberLimit) * 100)));
}

function getSectLevelGlow(level: SectLevel) {
  if (level >= 5) return "linear-gradient(180deg, #f7e3a0, #b98627)";
  if (level >= 4) return "linear-gradient(180deg, #f3c987, #9d5b20)";
  if (level >= 3) return "linear-gradient(180deg, #d4d2d1, #75706a)";
  if (level >= 2) return "linear-gradient(180deg, #9ec0b3, #4a6b61)";
  return "linear-gradient(180deg, #8f825d, #4e4229)";
}

function tileColor(type: string) {
  if (type === "portal") return "#7dc4ff";
  if (type === "building") return "#d7b369";
  if (type === "mountain") return "#51463a";
  if (type === "water") return "#2f5675";
  if (type === "road") return "#8b7251";
  if (type === "decor") return "#6e8154";
  if (type === "forest") return "#476042";
  return "#2f342e";
}

function formatDateTime(value?: string | null) {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function SectPage() {
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<(typeof TAB_OPTIONS)[number]["key"]>("overview");
  const [guestView, setGuestView] = useState<"browse" | "create">("browse");
  const [detailSectId, setDetailSectId] = useState<string | null>(null);
  const [sectData, setSectData] = useState<SectDashboard | null>(null);
  const [mapData, setMapData] = useState<MapSnapshot | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [createName, setCreateName] = useState("");
  const [createAnnouncement, setCreateAnnouncement] = useState("");
  const [selectedCreateTile, setSelectedCreateTile] = useState<{ x: number; y: number } | null>(null);
  const [appointRoleMap, setAppointRoleMap] = useState<Record<string, SectRoleKey | undefined>>({});
  const [applicationNoteMap, setApplicationNoteMap] = useState<Record<string, string>>({});
  const [announcementDraft, setAnnouncementDraft] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);

  /**
   * 收到刷新帧后必须让界面真实刷新，不能只打日志。
   * 只回 ACK 不带帧的接口会让界面停在旧值，这里对无帧响应做兜底刷新。
   */
  const handleStateRefresh = useCallback((frame: AnyStateRefreshEnvelope) => {
    if (
      frame.opcode === REALTIME_OPCODE_BY_OUTPUT_TYPE.inventory_refresh
      || frame.opcode === REALTIME_OPCODE_BY_OUTPUT_TYPE.asset_refresh
    ) {
      setRefreshTick((current) => current + 1);
      setLastRefreshAt(Date.now());
      return;
    }
    if (frame.opcode === REALTIME_OPCODE_BY_OUTPUT_TYPE.progress_refresh) {
      const scopes = (frame.payload as { scopes?: string[] } | undefined)?.scopes || [];
      if (scopes.includes("sect")) {
        setRefreshTick((current) => current + 1);
        setLastRefreshAt(Date.now());
      }
    }
  }, []);

  const applyRefreshFrames = useCallback((frames: unknown) => {
    const list = Array.isArray(frames) ? frames as AnyStateRefreshEnvelope[] : [];
    const applied = applyStateRefreshFramesFromResponse(list, handleStateRefresh);
    if (applied === 0) {
      setRefreshTick((current) => current + 1);
      setLastRefreshAt(Date.now());
    }
  }, [handleStateRefresh]);

  const postJson = useCallback(async <T,>(url: string, body?: Record<string, unknown>) => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const json = await response.json() as ApiEnvelope<T> & { refreshFrames?: AnyStateRefreshEnvelope[] };
    if (!json.success) throw new Error(json.error || "操作失败");
    applyRefreshFrames(json.refreshFrames);
    return json;
  }, [applyRefreshFrames]);

  /** presence 兜底落库：不产生资产 / 进度变化，因此不触发界面刷新。 */
  const postPresence = useCallback(async (command: string) => {
    try {
      await fetch("/api/game/sect/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
    } catch {
      // presence 落库失败不影响实时链路，静默忽略。
    }
  }, []);

  const refreshAll = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const sectRes = await fetch("/api/game/sect", { cache: "no-store" });
      const sectJson = await sectRes.json() as ApiEnvelope<SectDashboard>;
      if (!sectJson.success || !sectJson.data) throw new Error(sectJson.error || "获取宗门信息失败");
      setLoadError(null);
      setSectData(sectJson.data);
      setAnnouncementDraft(sectJson.data.sect?.announcement || "");
    } catch (error) {
      const nextError = error instanceof Error ? error.message : "加载宗门失败";
      setLoadError(nextError);
      messageApi.error(nextError);
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // 刷新帧到达后静默重拉宗门数据，保证成员 / 驻地 / 仓库界面真实更新。
  useEffect(() => {
    if (refreshTick === 0) {
      return;
    }
    void refreshAll({ silent: true });
  }, [refreshTick, refreshAll]);

  const loadCreateMap = useCallback(async () => {
    try {
      const response = await fetch("/api/game/map", { cache: "no-store" });
      const json = await response.json() as ApiEnvelope<MapSnapshot>;
      setMapData(json.success ? json.data || null : null);
    } catch {
      setMapData(null);
    }
  }, []);

  const loadInventoryPreview = useCallback(async () => {
    try {
      const response = await fetch("/api/game/inventory", { cache: "no-store" });
      const json = await response.json() as ApiEnvelope<{ items?: InventoryItem[] }>;
      setInventory(Array.isArray(json.data?.items) ? json.data.items : []);
    } catch {
      setInventory([]);
    }
  }, []);

  useEffect(() => {
    if (!sectData?.sect && sectData?.canCreate && guestView === "create") {
      void loadCreateMap();
      return;
    }
    setMapData(null);
  }, [guestView, loadCreateMap, sectData?.canCreate, sectData?.sect]);

  useEffect(() => {
    if (sectData?.sect && activeTab === "storage") {
      void loadInventoryPreview();
      return;
    }
    setInventory([]);
  }, [activeTab, loadInventoryPreview, sectData?.sect]);

  useEffect(() => {
    if (sectData?.sect) {
      setGuestView("browse");
    }
  }, [sectData?.sect]);

  const sect = sectData?.sect || null;
  // 宗门 presence 房间 join 上下文必须走统一解析，否则成员会落在不同分片上。
  const sectPresenceRoomOptions = useMemo(
    () => (sect ? resolveSectPresenceRoomOptions(sect.id) : null),
    [sect],
  );
  const sectPresence = useSocialRoomPresence({
    enabled: Boolean(sectData?.currentPlayer.id && sect?.id),
    playerId: sectData?.currentPlayer.id,
    mapId: sectPresenceRoomOptions?.mapId || null,
    shardId: sectPresenceRoomOptions?.shardId || "sect",
    sectId: sect?.id,
    onStateRefresh: handleStateRefresh,
  });
  const sendSectPresenceCommand = sectPresence.sendSectPresenceCommand;
  const onlineSectMemberIds = useMemo(
    () => new Set(
      sectPresence.presenceStale
        ? []
        : sectPresence.sectMembers.map((member) => member.playerId),
    ),
    [sectPresence.presenceStale, sectPresence.sectMembers],
  );
  // presence 未确认（未连上 / repair 未回包）时不许把旧列表当实时在线展示。
  const presenceLive = !sectPresence.presenceStale;
  const liveSectPresence = useMemo(
    () => (presenceLive ? sectPresence.sectPresence : []),
    [presenceLive, sectPresence.sectPresence],
  );
  const presenceByPlayerId = useMemo(
    () => new Map(liveSectPresence.map((member) => [member.playerId, member])),
    [liveSectPresence],
  );
  const atHomeMemberIds = useMemo(
    () => new Set(
      liveSectPresence
        .filter((member) => member.atHome)
        .map((member) => member.playerId),
    ),
    [liveSectPresence],
  );
  const onlineMemberCount = presenceLive ? sectPresence.sectMembers.length : 0;

  // 进入宗门页 = 进入驻地；离开页面（跳转地图等）要广播离开，避免幽灵在场成员。
  useEffect(() => {
    if (!sect || !sectPresenceRoomOptions || sectPresence.status !== "connected") {
      return;
    }
    sendSectPresenceCommand("sect_presence_home_enter");
    // presence 兜底落库不影响资产 / 进度，不需要触发界面刷新。
    void postPresence("sect_presence_home_enter");
    return () => {
      sendSectPresenceCommand("sect_presence_home_leave");
      void postPresence("sect_presence_home_leave");
    };
  }, [postPresence, sect, sectPresence.status, sectPresenceRoomOptions, sendSectPresenceCommand]);
  const selectedBrowseSect = useMemo(
    () => sectData?.browse.sects.find((item) => item.id === detailSectId) || null,
    [detailSectId, sectData?.browse.sects],
  );
  const createTileMap = useMemo(() => new Map((mapData?.map.tilesData || []).map((tile) => [`${tile.x},${tile.y}`, tile] as const)), [mapData]);
  const createBlockedCells = useMemo(() => {
    const blocked = new Set<string>();
    if (!mapData) return blocked;
    for (const tile of mapData.map.tilesData) {
      if (tile.walkable === false || tile.eventId || tile.type === "portal" || tile.type === "building" || tile.type === "mountain" || tile.type === "water") blocked.add(`${tile.x},${tile.y}`);
      if (tile.type === "portal") {
        for (let offsetX = -4; offsetX <= 4; offsetX += 1) {
          for (let offsetY = -4; offsetY <= 4; offsetY += 1) {
            blocked.add(`${tile.x + offsetX},${tile.y + offsetY}`);
          }
        }
      }
    }
    for (const npc of mapData.npcs || []) blocked.add(`${npc.positionX},${npc.positionY}`);
    for (const monster of mapData.monsters || []) blocked.add(`${monster.positionX},${monster.positionY}`);
    for (const point of mapData.opportunities || []) blocked.add(`${point.positionX},${point.positionY}`);
    for (const browseSect of sectData?.browse.sects || []) {
      if (browseSect.externalMapId !== mapData.map.id || typeof browseSect.externalPositionX !== "number" || typeof browseSect.externalPositionY !== "number") {
        continue;
      }
      for (let offsetX = -8; offsetX <= 8; offsetX += 1) {
        for (let offsetY = -8; offsetY <= 8; offsetY += 1) {
          blocked.add(`${browseSect.externalPositionX + offsetX},${browseSect.externalPositionY + offsetY}`);
        }
      }
    }
    return blocked;
  }, [mapData, sectData?.browse.sects]);

  const hasPermission = useCallback((permission: SectPermissionKey) => Boolean(sect?.permissions.includes(permission)), [sect]);
  const canReviewApplications = hasPermission("review_join") || hasPermission("review_visit");
  const sectResources = sect?.resources || { spiritStone: 0, wood: 0, stone: 0, sectMaterial: 0, storageCapacity: 20 };
  const lingqiPeak = sect?.buildings.find((building) => building.buildingType === "lingqi_peak") || null;
  const nextLevelConfig = sect?.levelConfig.find((item) => item.level === ((sect.summary.sectLevel + 1) as SectLevel)) || null;
  const innerDiscipleReviewVisitEnabled = Boolean(sect?.permissionPreview?.innerDiscipleReviewVisitEnabled);
  const isAbandonedPublicSect = sect?.state === "abandoned_public";
  const storageEligibleInventory = useMemo(
    () => inventory.filter((item) => !item.equipped && !item.isBound),
    [inventory],
  );

  const handleCreateSect = useCallback(async () => {
    if (!mapData || !selectedCreateTile) return messageApi.warning("请先选择立宗地块");
    if (!createName.trim()) return messageApi.warning("请先填写宗门名称");
    setSubmitting(true);
    try {
      await postJson("/api/game/sect/create", { sectName: createName.trim(), announcement: createAnnouncement.trim(), mapId: mapData.map.id, positionX: selectedCreateTile.x, positionY: selectedCreateTile.y });
      messageApi.success("宗门已创立");
      setCreateName("");
      setCreateAnnouncement("");
      setSelectedCreateTile(null);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "创建宗门失败");
    } finally {
      setSubmitting(false);
    }
  }, [createAnnouncement, createName, mapData, messageApi, postJson, selectedCreateTile]);

  const handleApply = useCallback(async (sectId: string, type: SectApplicationType) => {
    setSubmitting(true);
    try {
      await postJson(type === "join" ? "/api/game/sect/apply" : "/api/game/sect/visit/apply", {
        sectId,
        note: applicationNoteMap[sectId]?.trim() || undefined,
      });
      messageApi.success(type === "join" ? "入宗申请已提交" : "访客申请已提交");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "申请失败");
    } finally {
      setSubmitting(false);
    }
  }, [applicationNoteMap, messageApi, postJson]);

  const handleRespond = useCallback(async (applicationId: string, action: "approve" | "reject") => {
    setSubmitting(true);
    try {
      await postJson("/api/game/sect/applications/respond", { applicationId, action });
      messageApi.success(action === "approve" ? "申请已通过" : "申请已拒绝");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "处理申请失败");
    } finally {
      setSubmitting(false);
    }
  }, [messageApi, postJson]);

  const handleAppoint = useCallback(async (targetPlayerId: string) => {
    const roleKey = appointRoleMap[targetPlayerId];
    if (!roleKey) return messageApi.warning("请先选择目标职阶");
    setSubmitting(true);
    try {
      await postJson("/api/game/sect/appoint", { targetPlayerId, roleKey });
      // 任命变化要广播给同宗门在线成员，其他人的成员列表才会同步刷新。
      sendSectPresenceCommand("sect_presence_role_changed", { targetPlayerId, roleKey });
      messageApi.success("任命已生效");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "任命失败");
    } finally {
      setSubmitting(false);
    }
  }, [appointRoleMap, messageApi, postJson, sendSectPresenceCommand]);

  const handleStorageAction = useCallback(async (body: Record<string, unknown>, successText: string) => {
    setSubmitting(true);
    try {
      await postJson("/api/game/sect/storage", body);
      messageApi.success(successText);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "仓库操作失败");
    } finally {
      setSubmitting(false);
    }
  }, [messageApi, postJson]);

  const handleBuildingAction = useCallback(async (body: Record<string, unknown>, successText: string) => {
    setSubmitting(true);
    try {
      await postJson("/api/game/sect/buildings", body);
      messageApi.success(successText);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "宗门操作失败");
    } finally {
      setSubmitting(false);
    }
  }, [messageApi, postJson]);

  const handleExpandSect = useCallback(async () => {
    setSubmitting(true);
    try {
      await postJson("/api/game/sect/expand");
      messageApi.success("宗门扩建完成");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "扩建失败");
    } finally {
      setSubmitting(false);
    }
  }, [messageApi, postJson]);

  const handleLeaveSect = useCallback(async () => {
    if (!window.confirm("确认退出当前宗门吗？")) return;
    setSubmitting(true);
    try {
      await postJson("/api/game/sect", { action: "leave" });
      messageApi.success("已退出宗门");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "退出宗门失败");
    } finally {
      setSubmitting(false);
    }
  }, [messageApi, postJson]);

  if (!loading && loadError && !sectData) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 12px 88px" }}>
        {contextHolder}
        <Card style={cardStyle}>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>宗门页面加载失败</div>
            <div style={{ color: "#a79c83", fontSize: 13 }}>{loadError}</div>
            <div style={responsiveActionRowStyle}>
              <Button type="primary" onClick={() => void refreshAll()}>重新加载</Button>
              <Button onClick={() => router.push("/game/map")}>返回地图</Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (loading || !sectData) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {contextHolder}
        <Spin />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "10px 10px 88px", display: "grid", gap: 10 }}>
      {contextHolder}
      <Card style={{ background: "linear-gradient(180deg, rgba(31,25,19,0.98), rgba(14,12,10,0.98))", borderColor: "#4f432c", color: "#e8dcc4", position: "relative", overflow: "hidden" }}>
        {!sect && (
          <button
            type="button"
            onClick={() => setGuestView((current) => (current === "create" ? "browse" : "create"))}
            style={{
              position: "absolute",
              left: 12,
              top: 12,
              width: 44,
              height: 44,
              borderRadius: 999,
              border: "1px solid rgba(243,213,140,0.35)",
              background: guestView === "create" ? "linear-gradient(180deg, rgba(117,87,30,0.98), rgba(70,50,18,0.98))" : "linear-gradient(180deg, rgba(62,48,26,0.94), rgba(28,22,13,0.94))",
              color: "#f3e0b1",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 6px 18px rgba(0,0,0,0.22)",
            }}
            aria-label={guestView === "create" ? "返回宗门列表" : "进入宗门创建界面"}
          >
            {guestView === "create" ? "返回" : "创建"}
          </button>
        )}
        <div style={{ display: "grid", gap: 6, paddingLeft: !sect ? 48 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{sect ? sect.name : "宗门"}</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {sect ? (
                <Tag color={sectPresence.status === "connected" ? "green" : "default"}>
                  在线 {onlineMemberCount}
                </Tag>
              ) : null}
              {sect ? (
                <Tag color={atHomeMemberIds.size > 0 ? "gold" : "default"}>
                  驻地 {atHomeMemberIds.size}
                </Tag>
              ) : null}
              {sect ? (
                <Tag color={sectPresence.status === "connected" ? "blue" : "default"}>
                  {lastRefreshAt ? `已同步 ${new Date(lastRefreshAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "等待同步"}
                </Tag>
              ) : null}
              {sect?.state === "abandoned_public" && <Tag color="gold">公开荒废</Tag>}
            </div>
          </div>
          <div style={{ color: "#a79c83", fontSize: 13 }}>
            {sect
              ? `${sect.summary.isGovernor && sect.roleKey !== "leader" ? `${sect.roleLabel}（代行宗主权）` : sect.roleLabel} · ${sect.summary.sectMemberCount}/${sect.summary.sectMemberLimit}人 · ${sect.summary.sectLevel}级 · ${sect.summary.mapSize}x${sect.summary.mapSize}驻地`
              : guestView === "create"
                ? `创建需达到 ${sectData.currentPlayer.createMinRealmName}，此处为开宗立派二级界面`
                : `宗门列表已直出展示，加入不限修为，创建需达到 ${sectData.currentPlayer.createMinRealmName}`}
          </div>
          <div style={{ color: "#d8c18f", fontSize: 13 }}>
            {sect
              ? `灵气峰加成：+${Math.round((sect.summary.dongfuBonusRate || 0) * 100)}% · ${sect.state === "abandoned_public" ? "当前已公开荒废" : `待审批 ${sect.pendingApplications.length} 条`}`
              : guestView === "create"
                ? "选择正式地图上的合法地块后，即可生成独立宗门驻地并建立入口传送阵。"
                : `当前可浏览 ${sectData.browse.sects.length} 个宗门，点左上角小圆按钮进入创建界面。`}
          </div>
          <div style={{ color: "#8e846f", fontSize: 12 }}>{sect ? (sect.announcement || "暂无宗门公告") : guestView === "create" ? "创建页保持移动端单列流程，先看说明，再选地块，最后确认立宗。" : "当前默认直出宗门列表，创建从左上角小圆按钮进入二级界面。"}</div>
        </div>
      </Card>
      {!sect ? (
        <>
          <Card title="可加入宗门" style={cardStyle}>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ padding: 12, borderRadius: 16, background: "linear-gradient(180deg, rgba(76,58,24,0.26), rgba(20,16,10,0.32))", border: "1px solid rgba(201,168,76,0.12)", display: "grid", gap: 6 }}>
                <div style={{ color: "#f0ddaf", fontWeight: 700, fontSize: 15 }}>宗门名册</div>
                <div style={{ color: "#a79c83", fontSize: 12 }}>先浏览各宗门驻地规模、人数与公告，再决定申请加入或先以访客身份拜山。</div>
              </div>
              {sectData.browse.sects.length === 0 && <div style={{ color: "#8e846f", fontSize: 13 }}>当前暂无可浏览宗门。</div>}
              {sectData.browse.sects.map((item) => (
                <div
                  key={item.id}
                  style={{
                    border: "1px solid rgba(201,168,76,0.16)",
                    borderRadius: 18,
                    padding: 14,
                    display: "grid",
                    gap: 10,
                    background: "linear-gradient(180deg, rgba(40,31,20,0.88), rgba(18,14,10,0.96))",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 10px 24px rgba(0,0,0,0.14)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
                      <div
                        style={{
                          width: 46,
                          height: 46,
                          borderRadius: 14,
                          flex: "0 0 auto",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#1a140d",
                          fontWeight: 800,
                          fontSize: 14,
                          background: getSectLevelGlow(item.level),
                          boxShadow: "0 8px 18px rgba(0,0,0,0.22)",
                        }}
                      >
                        {item.level}阶
                      </div>
                      <div style={{ minWidth: 0, display: "grid", gap: 6 }}>
                        <div style={{ fontWeight: 700, color: "#f0ddaf", fontSize: 16, wordBreak: "break-all" }}>{item.name}</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <Tag color="default">{item.mapSize}x{item.mapSize}驻地</Tag>
                          <Tag color="default">上限 {item.memberLimit} 人</Tag>
                          {item.state === "abandoned_public" && <Tag color="gold">公开荒废</Tag>}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, color: "#c7b996", fontSize: 12 }}>
                      <span>门人规模</span>
                      <span>{item.memberCount}/{item.memberLimit} 人</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${formatMemberRatio(item.memberCount, item.memberLimit)}%`,
                          height: "100%",
                          borderRadius: 999,
                          background: item.state === "abandoned_public"
                            ? "linear-gradient(90deg, rgba(214,178,86,0.8), rgba(247,220,145,0.92))"
                            : "linear-gradient(90deg, rgba(138,110,54,0.92), rgba(240,210,129,0.96))",
                        }}
                      />
                    </div>
                  </div>
                  <div style={responsiveInfoGridStyle}>
                    <div style={{ minWidth: 0, padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <div style={{ color: "#8e846f", fontSize: 11 }}>外部入口</div>
                      <div style={{ color: "#e4d5b0", fontSize: 13, marginTop: 4, wordBreak: "break-word" }}>{item.externalMapName || "未知地图"}</div>
                    </div>
                    <div style={{ minWidth: 0, padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <div style={{ color: "#8e846f", fontSize: 11 }}>加入状态</div>
                      <div style={{ color: "#e4d5b0", fontSize: 13, marginTop: 4 }}>{item.state === "abandoned_public" ? "可公开拜山" : "需提交申请"}</div>
                    </div>
                  </div>
                  <div style={{ padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ color: "#8e846f", fontSize: 11, marginBottom: 6 }}>宗门公告</div>
                    <div style={{ color: "#cbbd9f", fontSize: 12, lineHeight: 1.6 }}>{item.announcement || "暂无公告"}</div>
                  </div>
                  <Button onClick={() => setDetailSectId(item.id)}>查看详情</Button>
                  <Input.TextArea
                    rows={2}
                    value={applicationNoteMap[item.id] || ""}
                    onChange={(event) => setApplicationNoteMap((current) => ({ ...current, [item.id]: event.target.value }))}
                    placeholder="附言（可选）：写明来意、修为或拜入原因"
                  />
                  <div style={responsiveActionGridStyle}>
                    <Button type="primary" onClick={() => void handleApply(item.id, "join")} loading={submitting}>申请加入</Button>
                    <Button onClick={() => void handleApply(item.id, "visit")} loading={submitting}>申请访客</Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Drawer
            open={Boolean(selectedBrowseSect)}
            onClose={() => setDetailSectId(null)}
            placement="bottom"
            height="78vh"
            title={selectedBrowseSect ? `${selectedBrowseSect.name} · 宗门详情` : "宗门详情"}
            styles={{
              body: {
                background: "#120f0b",
                padding: 14,
              },
              header: {
                background: "#171411",
                borderBottom: "1px solid rgba(201,168,76,0.12)",
                color: "#f0ddaf",
              },
            }}
          >
            {selectedBrowseSect && (
              <div style={{ display: "grid", gap: 12 }}>
                <div
                  style={{
                    borderRadius: 18,
                    padding: 14,
                    background: "linear-gradient(180deg, rgba(42,31,18,0.96), rgba(18,13,9,0.98))",
                    border: "1px solid rgba(201,168,76,0.12)",
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <div
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: 16,
                        flex: "0 0 auto",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#1a140d",
                        fontWeight: 800,
                        fontSize: 15,
                        background: getSectLevelGlow(selectedBrowseSect.level),
                      }}
                    >
                      {selectedBrowseSect.level}阶
                    </div>
                    <div style={{ minWidth: 0, display: "grid", gap: 6 }}>
                      <div style={{ color: "#f0ddaf", fontWeight: 700, fontSize: 18, wordBreak: "break-all" }}>{selectedBrowseSect.name}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <Tag color="default">{selectedBrowseSect.mapSize}x{selectedBrowseSect.mapSize}驻地</Tag>
                        <Tag color="default">成员上限 {selectedBrowseSect.memberLimit}</Tag>
                        {selectedBrowseSect.state === "abandoned_public" && <Tag color="gold">公开荒废</Tag>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "#c6b897", fontSize: 12 }}>
                      <span>当前门人</span>
                      <span>{selectedBrowseSect.memberCount}/{selectedBrowseSect.memberLimit}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${formatMemberRatio(selectedBrowseSect.memberCount, selectedBrowseSect.memberLimit)}%`,
                          height: "100%",
                          borderRadius: 999,
                          background: selectedBrowseSect.state === "abandoned_public"
                            ? "linear-gradient(90deg, rgba(214,178,86,0.8), rgba(247,220,145,0.92))"
                            : "linear-gradient(90deg, rgba(138,110,54,0.92), rgba(240,210,129,0.96))",
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div style={{ ...responsiveInfoGridStyle, gap: 10 }}>
                  <div style={{ minWidth: 0, padding: 12, borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ color: "#8e846f", fontSize: 11 }}>入口地图</div>
                    <div style={{ color: "#e4d5b0", fontSize: 14, marginTop: 4, wordBreak: "break-word" }}>{selectedBrowseSect.externalMapName || "未知地图"}</div>
                  </div>
                  <div style={{ minWidth: 0, padding: 12, borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ color: "#8e846f", fontSize: 11 }}>加入方式</div>
                    <div style={{ color: "#e4d5b0", fontSize: 14, marginTop: 4 }}>{selectedBrowseSect.state === "abandoned_public" ? "可公开拜山" : "需提交申请"}</div>
                  </div>
                </div>
                <div style={{ padding: 12, borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", display: "grid", gap: 8 }}>
                  <div style={{ color: "#8e846f", fontSize: 11 }}>宗门公告</div>
                  <div style={{ color: "#d6c8ab", fontSize: 13, lineHeight: 1.7 }}>{selectedBrowseSect.announcement || "暂无公告"}</div>
                </div>
                <Input.TextArea
                  rows={3}
                  value={applicationNoteMap[selectedBrowseSect.id] || ""}
                  onChange={(event) => setApplicationNoteMap((current) => ({ ...current, [selectedBrowseSect.id]: event.target.value }))}
                  placeholder="附言（可选）：可以写明来历、修为、来意或访山缘由"
                />
                <div style={responsiveActionGridStyle}>
                  <Button
                    type="primary"
                    onClick={() => void handleApply(selectedBrowseSect.id, "join")}
                    loading={submitting}
                  >
                    申请加入
                  </Button>
                  <Button
                    onClick={() => void handleApply(selectedBrowseSect.id, "visit")}
                    loading={submitting}
                  >
                    申请访客
                  </Button>
                </div>
              </div>
            )}
          </Drawer>

          {guestView === "create" && (
            <Card title="开宗立派" style={cardStyle}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ padding: 12, borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(201,168,76,0.1)", color: "#c7baa0", fontSize: 12 }}>
                  左上角按钮可随时返回宗门列表。
                  <br />
                  {sectData.canCreate
                    ? `当前地图：${mapData?.map.name || "未知地图"}。只能在城镇、山野这类常驻地图立宗，秘境、临时场景和其他宗门内都不能立宗。`
                    : `你当前还不能立宗。需要达到 ${sectData.currentPlayer.createMinRealmName}，并备齐 ${sectData.currentPlayer.createGoldCost} 灵石。`}
                </div>
                <div style={{ padding: 12, borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", display: "grid", gap: 6 }}>
                  <div style={{ color: "#f0ddaf", fontWeight: 700, fontSize: 13 }}>立宗条件</div>
                  <div style={{ color: "#c7baa0", fontSize: 12, lineHeight: 1.8 }}>
                    1. 修为至少达到 {sectData.currentPlayer.createMinRealmName}
                    <br />
                    2. 身上需要 {sectData.currentPlayer.createGoldCost} 灵石
                    <br />
                    3. 只能在城镇、山野这类常驻地图选址，不能在秘境、临时场景或其他宗门里立宗
                  </div>
                  <div style={{ color: Number(sectData.currentPlayer.gold || 0) >= sectData.currentPlayer.createGoldCost ? "#9ed7a0" : "#e7a780", fontSize: 12 }}>
                    当前灵石：{sectData.currentPlayer.gold} / {sectData.currentPlayer.createGoldCost}
                  </div>
                </div>
                <Input placeholder="宗门名称" value={createName} onChange={(event) => setCreateName(event.target.value)} disabled={!sectData.canCreate || submitting} />
                <Input.TextArea placeholder="宗门公告" value={createAnnouncement} onChange={(event) => setCreateAnnouncement(event.target.value)} rows={3} disabled={!sectData.canCreate || submitting} />
                {sectData.canCreate && mapData && (
                  <div style={{ border: "1px solid rgba(201,168,76,0.12)", borderRadius: 14, padding: 10, background: "rgba(0,0,0,0.12)" }}>
                    <div style={{ maxHeight: 420, overflowY: "auto", overflowX: "hidden", paddingBottom: 6 }}>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: `repeat(${mapData.map.width}, minmax(0, 1fr))`,
                          gap: 2,
                          width: "100%",
                          alignItems: "stretch",
                        }}
                      >
                        {Array.from({ length: mapData.map.width * mapData.map.height }).map((_, index) => {
                          const x = index % mapData.map.width;
                          const y = Math.floor(index / mapData.map.width);
                          const tile = createTileMap.get(`${x},${y}`);
                          const blocked = createBlockedCells.has(`${x},${y}`);
                          const selected = selectedCreateTile?.x === x && selectedCreateTile?.y === y;
                          return (
                            <button
                              key={`${x},${y}`}
                              type="button"
                              disabled={!sectData.canCreate || blocked}
                              onClick={() => setSelectedCreateTile({ x, y })}
                              style={{
                                width: "100%",
                                aspectRatio: "1 / 1",
                                minHeight: 14,
                                minWidth: 0,
                                padding: 0,
                                borderRadius: 6,
                                border: selected ? "2px solid #f3d58c" : "1px solid rgba(255,255,255,0.08)",
                                background: blocked ? "#2a221e" : tileColor(tile?.type || "grass"),
                                opacity: blocked ? 0.45 : 1,
                                cursor: blocked ? "not-allowed" : "pointer",
                              }}
                              title={`(${x}, ${y})`}
                            />
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ color: "#b6aa8d", fontSize: 12 }}>当前选中：{selectedCreateTile ? `${selectedCreateTile.x}, ${selectedCreateTile.y}` : "未选择地块"}</div>
                  </div>
                )}
                <div style={responsiveActionRowStyle}>
                  <Button type="primary" onClick={() => void handleCreateSect()} loading={submitting} disabled={!sectData.canCreate}>确认立宗</Button>
                  <Button onClick={() => setGuestView("browse")}>返回宗门列表</Button>
                </div>
              </div>
            </Card>
          )}

          <Card title="我的申请" style={cardStyle}>
            <div style={{ display: "grid", gap: 8 }}>
              {sectData.browse.myApplications.length === 0 && <div style={{ color: "#8e846f", fontSize: 13 }}>你当前没有宗门申请记录。</div>}
              {sectData.browse.myApplications.map((application) => (
                <div key={application.id} style={{ border: "1px solid rgba(201,168,76,0.14)", borderRadius: 14, padding: 12, display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 700, color: "#f0ddaf" }}>{application.sectName || "未知宗门"}</div>
                  <div style={{ color: "#a79c83", fontSize: 12 }}>{APPLICATION_LABELS[application.type]} · {application.status}</div>
                  <div style={{ color: "#8e846f", fontSize: 12 }}>提交时间：{formatDateTime(application.createdAt)}{application.expiresAt ? ` · 截止：${formatDateTime(application.expiresAt)}` : ""}</div>
                  <div style={{ color: "#8e846f", fontSize: 12 }}>{application.note || "无附言"}</div>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
            {TAB_OPTIONS.map((item) => (
              <button key={item.key} type="button" onClick={() => setActiveTab(item.key)} style={{ borderRadius: 12, border: "1px solid rgba(201,168,76,0.2)", background: activeTab === item.key ? "linear-gradient(180deg, rgba(73,58,31,0.95), rgba(31,25,14,0.95))" : "rgba(18,16,12,0.88)", color: activeTab === item.key ? "#f2dfae" : "#d9cfb3", padding: "9px 12px", fontSize: 13, whiteSpace: "nowrap" }}>{item.label}</button>
            ))}
          </div>
          {activeTab === "overview" && (
            <Card style={cardStyle}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                  <div style={statCardStyle}>成员上限：{sect.summary.sectMemberCount}/{sect.summary.sectMemberLimit}</div>
                  <div style={statCardStyle}>驻地入口：{sect.externalPositionX}, {sect.externalPositionY}</div>
                  <div style={statCardStyle}>当前等级：{sect.summary.sectLevel}级</div>
                  <div style={statCardStyle}>驻地尺寸：{sect.summary.mapSize}x{sect.summary.mapSize}</div>
                  <div style={statCardStyle}>驻地在场：{atHomeMemberIds.size} 人</div>
                  <div style={statCardStyle}>在线成员：{onlineMemberCount} 人</div>
                  <div style={statCardStyle}>仓库格位：{sect.storage.length}/{sectResources.storageCapacity}</div>
                </div>
                <div style={{ color: "#a79c83", fontSize: 13 }}>下一等级：{nextLevelConfig ? `${nextLevelConfig.level}级 · ${nextLevelConfig.mapSize}x${nextLevelConfig.mapSize} · 上限 ${nextLevelConfig.memberLimit} 人` : "已达到满级"}</div>
                <div style={responsiveActionRowStyle}>
                  <Button onClick={() => router.push("/game/sect/edit")} disabled={!hasPermission("edit_map")}>宗门编辑</Button>
                  <Button onClick={() => void handleExpandSect()} loading={submitting} disabled={!hasPermission("expand_sect")}>扩建宗门</Button>
                  <Button onClick={() => void handleStorageAction({ action: "donate_gold", quantity: 500 }, "已捐献 500 灵石")} disabled={isAbandonedPublicSect}>捐献 500 灵石</Button>
                  <Button danger onClick={() => void handleLeaveSect()} loading={submitting}>退出宗门</Button>
                </div>
                <div style={{ color: "#8e846f", fontSize: 12 }}>灵石 {sectResources.spiritStone} · 木材 {sectResources.wood} · 石料 {sectResources.stone} · 宗门材料 {sectResources.sectMaterial}</div>
              </div>
            </Card>
          )}

          {activeTab === "members" && (
            <Card style={cardStyle}>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ ...statCardStyle, display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 700, color: "#f0ddaf" }}>宗门驻地 presence</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <Tag color={sectPresence.status === "connected" ? "green" : "default"}>
                        {sectPresence.status === "connected" ? "实时已连接" : "实时未连接"}
                      </Tag>
                      <Tag color="gold">驻地在场 {atHomeMemberIds.size}</Tag>
                      <Tag color="blue">在线 {onlineMemberCount}</Tag>
                    </div>
                  </div>
                  <div style={{ color: "#8e846f", fontSize: 12 }}>
                    进入宗门页即在驻地，离开页面会广播离场；成员上线 / 下线 / 切换驻地 / 任命都会实时刷新本列表。
                  </div>
                  <div style={{ color: "#8e846f", fontSize: 12 }}>
                    最近同步：{lastRefreshAt
                      ? new Date(lastRefreshAt).toLocaleTimeString("zh-CN", { hour12: false })
                      : "尚未收到刷新帧"}
                  </div>
                </div>
                {sect.members.map((member) => (
                  <div key={member.playerId} style={{ border: "1px solid rgba(201,168,76,0.14)", borderRadius: 14, padding: 12, display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 700 }}>{member.playerName}</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        {presenceByPlayerId.get(member.playerId)?.atHome
                          ? <Tag color="gold">驻地</Tag>
                          : onlineSectMemberIds.has(member.playerId)
                            ? <Tag color="green">在线</Tag>
                            : <Tag>离线</Tag>}
                        <Tag color={member.roleKey === "leader" ? "gold" : "default"}>{member.roleLabel}</Tag>
                      </div>
                    </div>
                    <div style={{ color: "#a79c83", fontSize: 12 }}>{member.realmName}</div>
                    <div style={{ color: "#8e846f", fontSize: 12 }}>最近在线：{formatDateTime(member.lastSeenAt)}</div>
                    {hasPermission("appoint_member") && member.playerId !== sectData.currentPlayer.id && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Select<SectRoleKey> placeholder="调整职阶" value={appointRoleMap[member.playerId]} onChange={(value) => setAppointRoleMap((current) => ({ ...current, [member.playerId]: value }))} options={ROLE_OPTIONS} style={{ flex: "1 1 180px", minWidth: 0 }} />
                        <Button onClick={() => void handleAppoint(member.playerId)} loading={submitting}>任命</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {activeTab === "approvals" && (
            <Card style={cardStyle}>
              <div style={{ display: "grid", gap: 8 }}>
                {!canReviewApplications && <div style={{ color: "#8e846f", fontSize: 13 }}>你当前没有宗门审批权限。</div>}
                {canReviewApplications && sect.pendingApplications.length === 0 && <div style={{ color: "#8e846f", fontSize: 13 }}>当前没有待处理申请。</div>}
                {canReviewApplications && sect.pendingApplications.map((application) => (
                  <div key={application.id} style={{ border: "1px solid rgba(201,168,76,0.14)", borderRadius: 14, padding: 12, display: "grid", gap: 8 }}>
                    <div style={{ fontWeight: 700 }}>{application.playerName || "未知修士"}</div>
                    <div style={{ color: "#a79c83", fontSize: 12 }}>{APPLICATION_LABELS[application.type]}</div>
                    <div style={{ color: "#8e846f", fontSize: 12 }}>申请时间：{formatDateTime(application.createdAt)}{application.expiresAt ? ` · 截止：${formatDateTime(application.expiresAt)}` : ""}</div>
                    <div style={{ color: "#8e846f", fontSize: 12 }}>{application.note || "无附言"}</div>
                    <div style={responsiveActionRowStyle}>
                      <Button type="primary" onClick={() => void handleRespond(application.id, "approve")} loading={submitting}>通过</Button>
                      <Button onClick={() => void handleRespond(application.id, "reject")} loading={submitting}>拒绝</Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {activeTab === "hall" && (
            <Card style={cardStyle}>
              <div style={{ display: "grid", gap: 10 }}>
                <Input.TextArea rows={4} value={announcementDraft} onChange={(event) => setAnnouncementDraft(event.target.value)} disabled={!hasPermission("manage_notice")} />
                <div style={responsiveActionRowStyle}>
                  <Button onClick={() => void handleBuildingAction({ action: "update_announcement", announcement: announcementDraft }, "宗门公告已更新")} loading={submitting} disabled={!hasPermission("manage_notice")}>更新公告</Button>
                  <Button
                    onClick={() => void handleBuildingAction({
                      action: "toggle_permission",
                      roleKey: "inner_disciple",
                      permissionKey: "review_visit",
                      enabled: !innerDiscipleReviewVisitEnabled,
                    }, innerDiscipleReviewVisitEnabled ? "已关闭内门访客审批" : "已为内门弟子开放访客审批")}
                    disabled={!sect.summary.isGovernor}
                  >
                    {innerDiscipleReviewVisitEnabled ? "关闭内门访客审批" : "内门可审访客"}
                  </Button>
                </div>
                <div style={{ color: "#a79c83", fontSize: 12 }}>当前权限：{sect.permissions.length > 0 ? sect.permissions.map((permission) => getSectPermissionLabel(permission)).join(" / ") : "无管理权限"}</div>
              </div>
            </Card>
          )}

          {activeTab === "storage" && (
            <Card style={cardStyle}>
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ color: "#a79c83", fontSize: 12 }}>仓库容量：{sectResources.storageCapacity} 格，当前占用 {sect.storage.length} 格</div>
                  <div style={responsiveActionRowStyle}>
                    <Button onClick={() => void handleStorageAction({ action: "expand" }, "宗门仓库已扩容")} loading={submitting} disabled={!hasPermission("manage_storage")}>扩容仓库</Button>
                    <Button onClick={() => void handleStorageAction({ action: "donate_item", itemId: storageEligibleInventory[0]?.itemId, quantity: 1 }, "已转化为宗门材料")} disabled={!storageEligibleInventory[0] || isAbandonedPublicSect}>贡献首个背包物品</Button>
                  </div>
                  <div style={{ color: "#8e846f", fontSize: 12 }}>
                    当前宗门仓库已开放成员自由存取；扩容仍需有仓库管理权限。
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ color: "#f0ddaf", fontWeight: 700 }}>我的背包快捷存入</div>
                    <div style={{ color: "#8e846f", fontSize: 12 }}>已自动排除绑定物品与穿戴中的装备。</div>
                  {storageEligibleInventory.slice(0, 6).length === 0 && <div style={{ color: "#8e846f", fontSize: 12 }}>当前没有可存入宗门仓库的物品。</div>}
                  {storageEligibleInventory.slice(0, 6).map((item) => (
                    <div key={item.itemId} style={mobileListRowStyle}>
                      <span style={{ wordBreak: "break-all" }}>{item.name} x{item.quantity}</span>
                      <Button size="small" onClick={() => void handleStorageAction({ action: "deposit", itemId: item.itemId, quantity: 1 }, "已存入宗门仓库")} disabled={isAbandonedPublicSect}>存入 1 个</Button>
                    </div>
                  ))}
                </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ color: "#f0ddaf", fontWeight: 700 }}>宗门仓库</div>
                    {sect.storage.length === 0 && <div style={{ color: "#8e846f", fontSize: 12 }}>宗门仓库当前为空。</div>}
                    {sect.storage.map((item) => (
                      <div key={item.id} style={mobileListRowStyle}>
                        <span style={{ wordBreak: "break-all" }}>#{item.slotIndex} · {item.itemName || item.itemId} x{item.quantity}</span>
                        <Button size="small" onClick={() => void handleStorageAction({ action: "withdraw", storageItemId: item.id, quantity: 1 }, "已取出 1 个")} disabled={isAbandonedPublicSect}>取出 1 个</Button>
                      </div>
                    ))}
                  </div>
              </div>
            </Card>
          )}

          {activeTab === "peak" && (
            <Card style={cardStyle}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ color: "#f0ddaf", fontWeight: 700 }}>灵气峰</div>
                <div>当前等级：{lingqiPeak?.level || 1}</div>
                <div style={{ color: "#d8c18f" }}>洞府灵气加成：+{Math.round((sect.summary.dongfuBonusRate || 0) * 100)}%</div>
                <div style={{ color: "#8e846f", fontSize: 12 }}>默认全体成员享受加成，已自动联动洞府打坐收益。</div>
                <Button onClick={() => void handleBuildingAction({ action: "upgrade_lingqi_peak" }, "灵气峰已升级")} loading={submitting} disabled={!hasPermission("manage_buildings")}>升级灵气峰</Button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

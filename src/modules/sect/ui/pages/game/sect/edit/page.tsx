"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Select, Spin, message } from "antd";
import type { SectBuildingType } from "@/types/game";

type EditSnapshotResponse = {
  success: boolean;
  error?: string;
  data?: {
    sectId: string;
    sectName: string;
    map: {
      id: string;
      width: number;
      height: number;
      tilesData: Array<{ x: number; y: number; type: string; portalId?: string; description?: string; portalName?: string }>;
    };
    buildings: Array<{ buildingType: SectBuildingType; name: string; positionX: number; positionY: number }>;
  };
};

function colorByType(type: string) {
  if (type === "portal") return "#7dc4ff";
  if (type === "building") return "#d7b369";
  if (type === "road") return "#8b7251";
  if (type === "decor") return "#6e8154";
  if (type === "mountain") return "#51463a";
  if (type === "forest") return "#36513b";
  return "#2f342e";
}

function textColorByType(type: string) {
  if (type === "portal") return "#0d2237";
  if (type === "building") return "#34240d";
  if (type === "road") return "#f2e2c1";
  if (type === "decor") return "#f1f5dd";
  if (type === "mountain") return "#f0d8b4";
  if (type === "forest") return "#eff8eb";
  return "#d9e5d1";
}

function getBuildingShortLabel(name: string) {
  if (name.includes("大殿")) return "殿";
  if (name.includes("仓库")) return "仓";
  if (name.includes("灵气峰")) return "峰";
  return name.slice(0, 1) || "建";
}

function getTileShortLabel(params: {
  tile?: { type: string; portalId?: string } | null;
  building?: { name: string } | null;
}) {
  if (params.building) {
    return getBuildingShortLabel(params.building.name);
  }
  if (params.tile?.type === "portal") {
    return params.tile.portalId?.includes("home_start_portal") ? "乡" : "阵";
  }
  if (params.tile?.type === "road") return "路";
  if (params.tile?.type === "decor") return "景";
  if (params.tile?.type === "mountain") return "界";
  if (params.tile?.type === "forest") return "林";
  return "草";
}

function getTileDisplayName(params: {
  tile?: { type: string; portalId?: string; portalName?: string; description?: string } | null;
  building?: { name: string } | null;
}) {
  if (params.building) {
    return params.building.name;
  }
  if (params.tile?.type === "portal") {
    if (params.tile.portalId?.includes("home_start_portal")) {
      return params.tile.portalName || "回乡传送阵";
    }
    return params.tile.portalName || "宗门传送阵";
  }
  if (params.tile?.type === "road") return "道路";
  if (params.tile?.type === "decor") return params.tile.description || "装饰";
  if (params.tile?.type === "mountain") return "宗门边界";
  if (params.tile?.type === "forest") return "林地";
  return "草地";
}

const EDIT_LEGEND = [
  { key: "portal_main", label: "宗门传送阵", mark: "阵", color: colorByType("portal") },
  { key: "hall", label: "大殿", mark: "殿", color: colorByType("building") },
  { key: "storage", label: "仓库", mark: "仓", color: colorByType("building") },
  { key: "peak", label: "灵气峰", mark: "峰", color: colorByType("building") },
  { key: "road", label: "道路", mark: "路", color: colorByType("road") },
  { key: "decor", label: "装饰", mark: "景", color: colorByType("decor") },
  { key: "mountain", label: "边界", mark: "界", color: colorByType("mountain") },
  { key: "grass", label: "草地", mark: "草", color: colorByType("grass") },
];

export default function SectEditPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [snapshot, setSnapshot] = useState<EditSnapshotResponse["data"] | null>(null);
  const [selected, setSelected] = useState<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<"paint_tile" | "move_building" | "update_portal_meta">("paint_tile");
  const [tileType, setTileType] = useState("road");
  const [buildingType, setBuildingType] = useState<SectBuildingType>("main_hall");
  const [description, setDescription] = useState("");
  const [portalName, setPortalName] = useState("");

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/game/sect/edit-map", { cache: "no-store" });
      const json = await res.json() as EditSnapshotResponse;
      if (!json.success || !json.data) {
        throw new Error(json.error || "获取编辑器失败");
      }
      setLoadError(null);
      setSnapshot(json.data);
    } catch (error) {
      const nextError = error instanceof Error ? error.message : "获取编辑器失败";
      setLoadError(nextError);
      messageApi.error(nextError);
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const tileMap = useMemo(() => new Map((snapshot?.map.tilesData || []).map((tile) => [`${tile.x},${tile.y}`, tile] as const)), [snapshot]);
  const buildingMap = useMemo(() => new Map((snapshot?.buildings || []).map((item) => [`${item.positionX},${item.positionY}`, item] as const)), [snapshot]);
  const selectedTile = selected ? tileMap.get(`${selected.x},${selected.y}`) || null : null;
  const selectedBuilding = useMemo(
    () => snapshot?.buildings.find((item) => item.positionX === selected?.x && item.positionY === selected?.y) || null,
    [selected, snapshot],
  );
  const portalTile = useMemo(
    () => snapshot?.map.tilesData.find((tile) => tile.portalId?.startsWith("sect_home_portal_")) || null,
    [snapshot],
  );
  const mapWidth = snapshot?.map.width || 0;
  const cellSize = mapWidth >= 15 ? 20 : mapWidth >= 12 ? 22 : mapWidth >= 10 ? 24 : 28;
  const cellGap = mapWidth >= 15 ? 2 : 3;

  useEffect(() => {
    if (mode === "move_building" && selectedBuilding && selectedBuilding.buildingType !== "portal") {
      setBuildingType(selectedBuilding.buildingType);
    }
  }, [mode, selectedBuilding]);

  useEffect(() => {
    if (mode === "paint_tile" && selectedTile) {
      setDescription(selectedTile.description || "");
    }
  }, [mode, selectedTile]);

  useEffect(() => {
    if (mode !== "update_portal_meta" || !portalTile) {
      return;
    }
    if (!selectedTile?.portalId) {
      setSelected({ x: portalTile.x, y: portalTile.y });
    }
    setPortalName(portalTile.portalName || "");
    setDescription(portalTile.description || "");
  }, [mode, portalTile, selectedTile?.portalId]);

  async function submitEdit() {
    if (!selected && mode !== "update_portal_meta") {
      messageApi.warning("请先选中地块");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/game/sect/edit-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode,
          buildingType,
          positionX: selected?.x,
          positionY: selected?.y,
          tileType,
          description,
          portalName,
        }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) {
        throw new Error(json.error || "编辑失败");
      }
      messageApi.success("宗门地块已更新");
      await loadSnapshot();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "编辑失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (!loading && loadError && !snapshot) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 12px 80px" }}>
        {contextHolder}
        <Card style={{ background: "#171411", borderColor: "#4f432c", color: "#e8dcc4" }}>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>宗门编辑页加载失败</div>
            <div style={{ color: "#a79c83", fontSize: 13 }}>{loadError}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button type="primary" onClick={() => void loadSnapshot()}>重新加载</Button>
              <Button href="/game/sect">返回宗门主页</Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (loading || !snapshot) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {contextHolder}
        <Spin />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "10px 10px 80px", display: "grid", gap: 10 }}>
      {contextHolder}
      <Card title={`${snapshot.sectName} · 宗门编辑`} style={{ background: "#171411", borderColor: "#4f432c", color: "#e8dcc4" }}>
        <div style={{ color: "#a79c83", fontSize: 12, marginBottom: 10 }}>
          点击地块后在下方面板操作。地图里的字就是地块身份，不需要先点到底部才能认路；宗门主传送阵可同时通往宗门入口和出生点。
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {EDIT_LEGEND.map((item) => (
            <div
              key={item.key}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#d7ccb3",
                fontSize: 12,
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 6,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: item.color,
                  color: textColorByType(item.key === "grass" ? "grass" : item.key === "mountain" ? "mountain" : item.key === "road" ? "road" : item.key === "decor" ? "decor" : item.key.startsWith("portal") ? "portal" : "building"),
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {item.mark}
              </span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
        <div style={{ overflowX: "auto", paddingBottom: 2 }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${snapshot.map.width}, ${cellSize}px)`, gap: cellGap, minWidth: "fit-content" }}>
            {Array.from({ length: snapshot.map.width * snapshot.map.height }).map((_, index) => {
              const x = index % snapshot.map.width;
              const y = Math.floor(index / snapshot.map.width);
              const tile = tileMap.get(`${x},${y}`);
              const building = buildingMap.get(`${x},${y}`) || null;
              const selectedCell = selected?.x === x && selected?.y === y;
              const shortLabel = getTileShortLabel({ tile, building });
              const displayName = getTileDisplayName({ tile, building });
              const tileType = tile?.type || "grass";
              return (
                <button
                  key={`${x},${y}`}
                  type="button"
                  onClick={() => setSelected({ x, y })}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    borderRadius: cellSize >= 26 ? 8 : 6,
                    border: selectedCell ? "2px solid #f3d58c" : "1px solid rgba(255,255,255,0.08)",
                    background: colorByType(tileType),
                    cursor: "pointer",
                    color: textColorByType(tileType),
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: cellSize >= 26 ? 11 : 10,
                    fontWeight: 700,
                    boxShadow: tileType === "portal" || building ? "inset 0 0 0 1px rgba(255,255,255,0.12)" : "none",
                    padding: 0,
                  }}
                  title={`${displayName} (${x}, ${y})`}
                >
                  {shortLabel}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card title="编辑面板" style={{ background: "#171411", borderColor: "#4f432c", color: "#e8dcc4" }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(201,168,76,0.1)", color: "#c6b897", fontSize: 12 }}>
            当前选中：{selected ? `${selected.x}, ${selected.y}` : "未选择地块"}
            <br />
            当前地块：{getTileDisplayName({ tile: selectedTile, building: selectedBuilding })}{selectedTile?.description ? ` · ${selectedTile.description}` : ""}
          </div>
          <Select
            value={mode}
            onChange={(value) => setMode(value)}
            options={[
              { label: "铺设地块", value: "paint_tile" },
              { label: "移动建筑", value: "move_building" },
              { label: "修改传送阵信息", value: "update_portal_meta" },
            ]}
          />
          {mode === "paint_tile" && (
            <Select
              value={tileType}
              onChange={(value) => setTileType(value)}
              options={[
                { label: "道路", value: "road" },
                { label: "装饰", value: "decor" },
                { label: "草地", value: "grass" },
                { label: "林地", value: "forest" },
              ]}
            />
          )}
          {mode === "move_building" && (
            <Select
              value={buildingType}
              onChange={(value) => setBuildingType(value)}
              options={snapshot.buildings.filter((item) => item.buildingType !== "portal").map((item) => ({
                label: item.name,
                value: item.buildingType,
              }))}
            />
          )}
          <Input placeholder="地块说明" value={description} onChange={(event) => setDescription(event.target.value)} />
          {mode === "update_portal_meta" && (
            <Input placeholder="传送阵名称" value={portalName} onChange={(event) => setPortalName(event.target.value)} />
          )}
          <div style={{ color: "#9c927c", fontSize: 12 }}>
            {mode === "move_building"
              ? "提示：点中某个建筑后会自动带出建筑类型，再选择目标地块应用。"
              : mode === "update_portal_meta"
                ? "提示：这里只会修改宗门主传送阵的名称和说明，这个阵可同时返回宗门入口与出生点。"
                : "提示：道路、装饰、草地、林地都可在此轻量改造，固定传送阵与建筑格不会被覆盖。"}
          </div>
          <Button type="primary" onClick={() => void submitEdit()} loading={submitting} block>
            应用编辑
          </Button>
        </div>
      </Card>
    </div>
  );
}

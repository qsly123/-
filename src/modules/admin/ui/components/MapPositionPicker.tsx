"use client";

import { useEffect, useMemo, useState } from "react";
import { Empty, Form, Spin, Space, Typography } from "antd";
import type { FormInstance } from "antd/es/form";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import MapTileLegend from "@/modules/map/ui/components/MapTileLegend";
import { ADMIN_TILE_COLORS, TILE_ICONS, getDefaultTileType } from "@/modules/map/services/map-tile-visual";

const { Text } = Typography;
const GRID_PANEL_BORDER = "#3a405a";
const GRID_LINE_COLOR = "#424a6a";
const GRID_CELL_SELECTED_BORDER = "1px solid #d0ad5b";
const GRID_CELL_OCCUPIED_BORDER = "1px solid #c0605a";
const GRID_CELL_SELF_BORDER = "1px solid #5c8dc8";
const GRID_CELL_DEFAULT_BORDER = "1px solid transparent";

interface TileEntity {
  x: number;
  y: number;
  type: string;
  walkable?: boolean;
}

interface MapRecord {
  id: string;
  name: string;
  width: number;
  height: number;
  mapType: string;
  tilesData: TileEntity[];
}

interface MapPositionPickerProps {
  form: FormInstance;
  entity: "npcs" | "monsters" | "temporaryMonsters";
  selfEntityId?: string;
  disabled?: boolean;
}

interface PositionEntityRecord {
  id: string;
  name: string;
  positionX: number;
  positionY: number;
}

interface OccupiedEntity {
  id: string;
  name: string;
  type: "npc" | "monster";
  isSelf: boolean;
}

interface ListResponse {
  success: boolean;
  data?: {
    list: Record<string, unknown>[];
    pagination?: {
      page: number;
      pageSize: number;
      total: number;
    };
  };
}

function parseTilesData(raw: unknown): TileEntity[] {
  if (!raw) {
    return [];
  }

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      x: Number(item.x),
      y: Number(item.y),
      type: String(item.type || ""),
      walkable: item.walkable === undefined ? undefined : Boolean(item.walkable),
    }))
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y) && item.type);
}

function normalizeMapRecord(row: Record<string, unknown>): MapRecord {
  return {
    id: String(row.id || ""),
    name: String(row.name || row.id || ""),
    width: Math.max(1, Number(row.width) || 10),
    height: Math.max(1, Number(row.height) || 10),
    mapType: String(row.mapType || "field"),
    tilesData: parseTilesData(row.tilesData),
  };
}

function normalizePositionEntityRecords(rows: Record<string, unknown>[]): PositionEntityRecord[] {
  return rows
    .map((row) => ({
      id: String(row.id || "").trim(),
      name: String(row.name || row.id || "").trim(),
      positionX: Number(row.positionX),
      positionY: Number(row.positionY),
    }))
    .filter((row) => row.id && Number.isFinite(row.positionX) && Number.isFinite(row.positionY));
}

function resolveMapEntity(entity: MapPositionPickerProps["entity"]) {
  return entity === "temporaryMonsters" ? "temporaryMaps" : "maps";
}

function resolveMonsterEntity(entity: MapPositionPickerProps["entity"]) {
  return entity === "temporaryMonsters" ? "temporaryMonsters" : "monsters";
}

async function fetchPositionEntitiesByMap(
  entity: "npcs" | "monsters" | "temporaryMonsters",
  mapId: string,
): Promise<PositionEntityRecord[]> {
  const rows: PositionEntityRecord[] = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "50",
      mapId,
    });
    const res = await fetch(`/api/admin/${entity}?${params.toString()}`);
    const json: ListResponse = await res.json();

    if (!json.success || !json.data?.list) {
      throw new Error("位置实体加载失败");
    }

    rows.push(...normalizePositionEntityRecords(json.data.list));

    const pagination = json.data.pagination;
    if (!pagination || pagination.page * pagination.pageSize >= pagination.total) {
      break;
    }
    page += 1;
  }

  return rows;
}

export default function MapPositionPicker({ form, entity, selfEntityId, disabled }: MapPositionPickerProps) {
  const mapId = Form.useWatch("mapId", form);
  const positionX = Number(Form.useWatch("positionX", form) || 0);
  const positionY = Number(Form.useWatch("positionY", form) || 0);

  const [loading, setLoading] = useState(false);
  const [mapData, setMapData] = useState<MapRecord | null>(null);
  const [occupiedMap, setOccupiedMap] = useState<Map<string, OccupiedEntity[]>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const normalizedMapId = typeof mapId === "string" ? mapId.trim() : "";
    if (!normalizedMapId) {
      setMapData(null);
      setOccupiedMap(new Map());
      setError(null);
      return;
    }

    let mounted = true;

    const loadMap = async () => {
      setLoading(true);
      setError(null);
      try {
        const mapParams = new URLSearchParams({
          page: "1",
          pageSize: "1",
          mapId: normalizedMapId,
        });
        const mapEntity = resolveMapEntity(entity);
        const monsterEntity = resolveMonsterEntity(entity);
        const [mapRes, npcRows, monsterRows] = await Promise.all([
          fetch(`/api/admin/${mapEntity}?${mapParams.toString()}`),
          entity === "temporaryMonsters"
            ? Promise.resolve<PositionEntityRecord[]>([])
            : fetchPositionEntitiesByMap("npcs", normalizedMapId),
          fetchPositionEntitiesByMap(monsterEntity, normalizedMapId),
        ]);
        const mapJson: ListResponse = await mapRes.json();

        if (!mounted) {
          return;
        }

        if (!mapJson.success || !mapJson.data?.list) {
          setError("地图加载失败");
          setMapData(null);
          setOccupiedMap(new Map());
          return;
        }

        const matched = mapJson.data.list[0];
        if (!matched) {
          setError("未找到该地图");
          setMapData(null);
          setOccupiedMap(new Map());
          return;
        }

        const normalizedSelfId = (selfEntityId || "").trim();
        const occupied = new Map<string, OccupiedEntity[]>();

        npcRows.forEach((row) => {
          const key = `${row.positionX},${row.positionY}`;
          const current = occupied.get(key) || [];
          current.push({
            id: row.id,
            name: row.name,
            type: "npc",
            isSelf: entity === "npcs" && normalizedSelfId !== "" && row.id === normalizedSelfId,
          });
          occupied.set(key, current);
        });

        monsterRows.forEach((row) => {
          const key = `${row.positionX},${row.positionY}`;
          const current = occupied.get(key) || [];
          current.push({
            id: row.id,
            name: row.name,
            type: "monster",
            isSelf: entity !== "npcs" && normalizedSelfId !== "" && row.id === normalizedSelfId,
          });
          occupied.set(key, current);
        });

        setMapData(normalizeMapRecord(matched));
        setOccupiedMap(occupied);
      } catch {
        if (!mounted) {
          return;
        }
        setError("地图加载失败");
        setMapData(null);
        setOccupiedMap(new Map());
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadMap();

    return () => {
      mounted = false;
    };
  }, [mapId, entity, selfEntityId]);

  const tileMap = useMemo(() => {
    const map = new Map<string, TileEntity>();
    if (!mapData) {
      return map;
    }
    mapData.tilesData.forEach((tile) => {
      map.set(`${tile.x},${tile.y}`, tile);
    });
    return map;
  }, [mapData]);

  if (!mapId) {
    return <Text type="secondary">先选择地图，再点击格子设置坐标</Text>;
  }

  if (loading) {
    return <Spin size="small" />;
  }

  if (!mapData) {
    return <Text type="danger">{error || "地图不可用"}</Text>;
  }

  const defaultTileType = getDefaultTileType(mapData.mapType);

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Space>
        <DarkTag color="blue">当前地图：{mapData.name}</DarkTag>
        <DarkTag>坐标：({positionX}, {positionY})</DarkTag>
        <DarkTag color="red">占用格：{occupiedMap.size}</DarkTag>
      </Space>

      <div style={{ overflow: "auto", border: `1px solid ${GRID_PANEL_BORDER}`, borderRadius: 6, padding: 8, background: "#1f243d" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${mapData.width}, 22px)`,
            gap: 1,
            padding: 1,
            background: GRID_LINE_COLOR,
            borderRadius: 4,
            width: "max-content",
          }}
        >
          {Array.from({ length: mapData.width * mapData.height }, (_, index) => {
            const x = index % mapData.width;
            const y = Math.floor(index / mapData.width);
            const tile = tileMap.get(`${x},${y}`);
            const tileType = tile?.type ?? defaultTileType;
            const walkable = tile?.walkable ?? true;
            const selected = x === positionX && y === positionY;
            const occupiedEntities = occupiedMap.get(`${x},${y}`) || [];
            const occupiedByOthers = occupiedEntities.some((item) => !item.isSelf);
            const occupiedBySelfOnly = occupiedEntities.length > 0 && !occupiedByOthers;
            const canSelect = !disabled && walkable && !occupiedByOthers;
            const occupiedText = occupiedEntities.length > 0
              ? `；占用：${occupiedEntities.map((item) => `${item.type === "npc" ? "NPC" : "怪物"}:${item.name}`).join("、")}`
              : "";

            return (
              <button
                key={`${x}-${y}`}
                type="button"
                disabled={!canSelect}
                onClick={() => {
                  form.setFieldsValue({ positionX: x, positionY: y });
                }}
                title={`(${x},${y}) ${tileType} ${
                  occupiedByOthers ? "已占用" : walkable ? "可通行" : "不可通行"
                }${occupiedText}`}
                style={{
                  width: 22,
                  height: 22,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: selected
                    ? GRID_CELL_SELECTED_BORDER
                    : occupiedByOthers
                      ? GRID_CELL_OCCUPIED_BORDER
                      : occupiedBySelfOnly
                        ? GRID_CELL_SELF_BORDER
                        : GRID_CELL_DEFAULT_BORDER,
                  background: occupiedByOthers
                    ? "#4a2a2a"
                    : occupiedBySelfOnly
                      ? "#263752"
                      : ADMIN_TILE_COLORS[tileType] || ADMIN_TILE_COLORS.empty,
                  opacity: walkable ? 1 : 0.78,
                  cursor: canSelect ? "pointer" : "not-allowed",
                  fontSize: 12,
                  lineHeight: 1,
                }}
              >
                <span aria-hidden="true">{TILE_ICONS[tileType] || ""}</span>
              </button>
            );
          })}
        </div>
      </div>

      <MapTileLegend title="地形图例" tileSize={10} colorMap={ADMIN_TILE_COLORS} borderColor={GRID_PANEL_BORDER} />

      <Space wrap size={12}>
        <Text type="secondary">状态图例：</Text>
        <Space size={4}>
          <span style={{ display: "inline-block", width: 10, height: 10, background: "#2d4e31", border: `1px solid ${GRID_PANEL_BORDER}` }} />
          <Text type="secondary">可选</Text>
        </Space>
        <Space size={4}>
          <span style={{ display: "inline-block", width: 10, height: 10, background: "#4a2a2a", border: GRID_CELL_OCCUPIED_BORDER }} />
          <Text type="secondary">已占用</Text>
        </Space>
        <Space size={4}>
          <span style={{ display: "inline-block", width: 10, height: 10, background: "#263752", border: GRID_CELL_SELF_BORDER }} />
          <Text type="secondary">当前实体位置</Text>
        </Space>
      </Space>
      <Text type="secondary">已占用格不可点击；编辑时可保留自己当前所在格。</Text>
      {mapData.width * mapData.height === 0 && <Empty description="地图无可用格子" />}
    </Space>
  );
}

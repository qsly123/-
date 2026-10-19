"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { Button, Input, Select, Space, Switch, Typography } from "antd";
import type { AdminFieldConfig, AdminSelectOption } from "@/modules/admin/services/admin-ui-config";
import ReferenceSelect from "@/modules/admin/ui/components/ReferenceSelect";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import MapTileLegend from "@/modules/map/ui/components/MapTileLegend";
import { ADMIN_TILE_COLORS, TILE_ICONS, getDefaultTileType, getTileTypeOptions } from "@/modules/map/services/map-tile-visual";

const { Text, Paragraph } = Typography;

interface TileEntity {
  x: number;
  y: number;
  type: string;
  walkable?: boolean;
  description?: string;
  imageUrl?: string;
  portalId?: string;
  portalName?: string;
  portalTargetMapId?: string;
  portalTargetPortalId?: string;
  portalTargetName?: string;
}

interface CellPoint {
  x: number;
  y: number;
}

interface PortalSelectOption {
  value: string;
  label: string;
  portalName: string;
  x: number;
  y: number;
}

interface TargetMapPortalState {
  loading: boolean;
  mapId: string;
  mapName: string;
  sourceEntity: "maps" | "temporaryMaps" | null;
  options: PortalSelectOption[];
  error: string | null;
}

interface MapTileGridEditorProps {
  field: AdminFieldConfig;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  mapWidth?: number;
  mapHeight?: number;
  mapType?: string;
  backgroundImageUrl?: string;
}

const DEFAULT_TILE_OPTIONS: AdminSelectOption[] = getTileTypeOptions();
const GRID_PANEL_BORDER = "#3a405a";
const GRID_LINE_COLOR = "#424a6a";
const GRID_CELL_DEFAULT_BORDER = "1px solid transparent";
const GRID_CELL_EDITED_BORDER = "1px solid #bfa056";
const GRID_CELL_PREVIEW_BORDER = "1px solid #74c8ff";
const GRID_CELL_SIZE = 24;

function getDefaultWalkableByType(type: string) {
  return type !== "mountain" && type !== "water" && type !== "building";
}

function resolveGridSize(value?: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }
  return Math.floor(parsed);
}

function parseTiles(raw?: string): { tiles: TileEntity[]; parseError: string | null } {
  if (!raw || !raw.trim()) {
    return { tiles: [], parseError: null };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return { tiles: [], parseError: "JSON 必须是数组" };
    }

    const tiles = parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .map((item) => ({
        x: Number(item.x),
        y: Number(item.y),
        type: String(item.type || ""),
        walkable: item.walkable === undefined ? undefined : Boolean(item.walkable),
        description: typeof item.description === "string" ? item.description : undefined,
        imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : undefined,
        portalId: typeof item.portalId === "string" ? item.portalId : undefined,
        portalName: typeof item.portalName === "string" ? item.portalName : undefined,
        portalTargetMapId: typeof item.portalTargetMapId === "string" ? item.portalTargetMapId : undefined,
        portalTargetPortalId: typeof item.portalTargetPortalId === "string" ? item.portalTargetPortalId : undefined,
        portalTargetName: typeof item.portalTargetName === "string" ? item.portalTargetName : undefined,
      }))
      .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y) && item.type);

    return { tiles, parseError: null };
  } catch (error) {
    return { tiles: [], parseError: (error as Error).message || "JSON 解析失败" };
  }
}

function trimOptionalText(value?: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function omitPortalFields(tile: TileEntity) {
  const next = { ...tile };
  delete next.portalId;
  delete next.portalName;
  delete next.portalTargetMapId;
  delete next.portalTargetPortalId;
  delete next.portalTargetName;
  return next;
}

function normalizeSingleTile(
  tile: TileEntity,
  width: number,
  height: number,
  defaultTileType: string,
  pruneDefaultTiles: boolean = true,
) {
  const normalizedType = typeof tile.type === "string" ? tile.type.trim() : "";
  if (!normalizedType) {
    return null;
  }

  const x = Math.floor(Number(tile.x));
  const y = Math.floor(Number(tile.y));
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= width || y >= height) {
    return null;
  }

  const normalized: TileEntity = {
    x,
    y,
    type: normalizedType,
  };

  if (tile.walkable === false) {
    normalized.walkable = false;
  }

  const description = trimOptionalText(tile.description);
  if (description) {
    normalized.description = description;
  }

  const imageUrl = trimOptionalText(tile.imageUrl);
  if (imageUrl) {
    normalized.imageUrl = imageUrl;
  }

  if (normalized.type === "portal") {
    const portalId = trimOptionalText(tile.portalId);
    const portalName = trimOptionalText(tile.portalName);
    const portalTargetMapId = trimOptionalText(tile.portalTargetMapId);
    const portalTargetPortalId = trimOptionalText(tile.portalTargetPortalId);
    const portalTargetName = trimOptionalText(tile.portalTargetName);

    if (portalId) {
      normalized.portalId = portalId;
    }
    if (portalName) {
      normalized.portalName = portalName;
    }
    if (portalTargetMapId) {
      normalized.portalTargetMapId = portalTargetMapId;
    }
    if (portalTargetPortalId) {
      normalized.portalTargetPortalId = portalTargetPortalId;
    }
    if (portalTargetName) {
      normalized.portalTargetName = portalTargetName;
    }
  }

  const isDefault = normalized.type === defaultTileType
    && (normalized.walkable ?? true) === true
    && !normalized.description
    && !normalized.imageUrl;

  if (pruneDefaultTiles && isDefault) {
    return null;
  }

  return normalized;
}

function normalizeTiles(
  tiles: TileEntity[],
  width: number,
  height: number,
  defaultTileType: string,
  pruneDefaultTiles: boolean = true,
) {
  const unique = new Map<string, TileEntity>();

  for (const tile of tiles) {
    const normalized = normalizeSingleTile(tile, width, height, defaultTileType, pruneDefaultTiles);
    if (!normalized) {
      continue;
    }

    unique.set(`${normalized.x},${normalized.y}`, normalized);
  }

  return Array.from(unique.values()).sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });
}

function stringifyTiles(tiles: TileEntity[]) {
  if (tiles.length === 0) {
    return "";
  }
  return JSON.stringify(tiles, null, 2);
}

function buildPortalOptionLabel(tile: TileEntity) {
  const portalName = trimOptionalText(tile.portalName) || `传送阵(${tile.x},${tile.y})`;
  const portalId = trimOptionalText(tile.portalId) || `x${tile.x}y${tile.y}`;
  return `${portalName} [${portalId}]`;
}

function extractPortalSelectOptions(tiles: Iterable<TileEntity>, excludePoint?: CellPoint | null) {
  const options: PortalSelectOption[] = [];

  for (const tile of tiles) {
    if (tile.type !== "portal") {
      continue;
    }
    if (excludePoint && tile.x === excludePoint.x && tile.y === excludePoint.y) {
      continue;
    }

    const normalizedPortalId = trimOptionalText(tile.portalId);
    if (!normalizedPortalId) {
      continue;
    }

    options.push({
      value: normalizedPortalId,
      label: buildPortalOptionLabel(tile),
      portalName: trimOptionalText(tile.portalName) || `传送阵(${tile.x},${tile.y})`,
      x: tile.x,
      y: tile.y,
    });
  }

  return options.sort((a, b) => {
    if (a.y !== b.y) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });
}

async function fetchMapRowById(mapId: string): Promise<{
  entity: "maps" | "temporaryMaps";
  row: Record<string, unknown>;
} | null> {
  const normalizedMapId = mapId.trim();
  if (!normalizedMapId) {
    return null;
  }

  for (const entity of ["maps", "temporaryMaps"] as const) {
    const params = new URLSearchParams({
      keyword: normalizedMapId,
      page: "1",
      pageSize: "20",
    });
    const response = await fetch(`/api/admin/${entity}?${params.toString()}`);
    const json = await response.json() as {
      success?: boolean;
      data?: {
        list?: Record<string, unknown>[];
      };
    };
    if (!json.success || !Array.isArray(json.data?.list)) {
      continue;
    }

    const matched = json.data.list.find((item) => String(item.id || "").trim() === normalizedMapId);
    if (matched) {
      return { entity, row: matched };
    }
  }

  return null;
}

function getRectCells(start: CellPoint, end: CellPoint) {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  const cells: CellPoint[] = [];

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      cells.push({ x, y });
    }
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    cells,
  };
}

export default function MapTileGridEditor({
  field,
  value,
  onChange,
  disabled,
  mapWidth,
  mapHeight,
  mapType,
  backgroundImageUrl,
}: MapTileGridEditorProps) {
  const resolvedWidth = resolveGridSize(mapWidth);
  const resolvedHeight = resolveGridSize(mapHeight);
  const hasResolvedGridSize = resolvedWidth !== undefined && resolvedHeight !== undefined;
  const width = resolvedWidth ?? 10;
  const height = resolvedHeight ?? 10;
  const normalizedMapType = typeof mapType === "string" && mapType.trim() ? mapType.trim() : "";
  const normalizedBackgroundImageUrl = typeof backgroundImageUrl === "string" && backgroundImageUrl.trim()
    ? backgroundImageUrl.trim()
    : "";
  const hasResolvedMapType = normalizedMapType.length > 0;
  const hasBackgroundImage = normalizedBackgroundImageUrl.length > 0;
  const defaultTileType = getDefaultTileType(normalizedMapType || undefined);

  const tileTypeOptions = useMemo(() => {
    const options = field.jsonSchema?.fields?.find((it) => it.key === "type")?.options;
    return options && options.length > 0 ? options : DEFAULT_TILE_OPTIONS;
  }, [field.jsonSchema]);

  const [mode, setMode] = useState<"grid" | "raw">("grid");
  const [eraseMode, setEraseMode] = useState(false);
  const [boxSelectMode, setBoxSelectMode] = useState(false);
  const [brushType, setBrushType] = useState(defaultTileType);
  const [brushWalkable, setBrushWalkable] = useState(getDefaultWalkableByType(defaultTileType));
  const [brushDescription, setBrushDescription] = useState("");
  const [selectedCell, setSelectedCell] = useState<CellPoint | null>(null);
  const [targetMapPortalState, setTargetMapPortalState] = useState<TargetMapPortalState>({
    loading: false,
    mapId: "",
    mapName: "",
    sourceEntity: null,
    options: [],
    error: null,
  });
  const [dragStart, setDragStart] = useState<CellPoint | null>(null);
  const [dragCurrent, setDragCurrent] = useState<CellPoint | null>(null);

  useEffect(() => {
    setBrushType(defaultTileType);
    setBrushWalkable(getDefaultWalkableByType(defaultTileType));
  }, [defaultTileType]);

  const { tiles, parseError } = useMemo(() => parseTiles(value), [value]);

  useEffect(() => {
    if (!hasResolvedMapType) {
      return;
    }
    if (!hasResolvedGridSize) {
      return;
    }
    if (parseError) {
      return;
    }
    const normalized = normalizeTiles(tiles, width, height, defaultTileType, true);
    const normalizedRaw = stringifyTiles(normalized);
    const currentRaw = (value || "").trim();
    if (normalizedRaw.trim() !== currentRaw) {
      onChange?.(normalizedRaw);
    }
  }, [defaultTileType, hasResolvedGridSize, hasResolvedMapType, onChange, parseError, tiles, value, width, height]);

  const tileMap = useMemo(() => {
    const normalized = normalizeTiles(tiles, width, height, defaultTileType, hasResolvedMapType && hasResolvedGridSize);
    const map = new Map<string, TileEntity>();
    normalized.forEach((tile) => {
      map.set(`${tile.x},${tile.y}`, tile);
    });
    return map;
  }, [defaultTileType, hasResolvedGridSize, hasResolvedMapType, tiles, width, height]);

  const commitTileMap = useCallback((nextMap: Map<string, TileEntity>) => {
    const nextTiles = normalizeTiles(
      Array.from(nextMap.values()),
      width,
      height,
      defaultTileType,
      hasResolvedMapType && hasResolvedGridSize,
    );
    onChange?.(stringifyTiles(nextTiles));
  }, [defaultTileType, hasResolvedGridSize, hasResolvedMapType, height, onChange, width]);

  const applyToCells = useCallback((cells: CellPoint[]) => {
    if (disabled || parseError || !hasResolvedGridSize) {
      return;
    }

    const nextMap = new Map(tileMap);
    const normalizedDescription = brushDescription.trim();

    for (const cell of cells) {
      const key = `${cell.x},${cell.y}`;
      if (eraseMode) {
        nextMap.delete(key);
        continue;
      }

      const previousTile = nextMap.get(key);
      const nextTile: TileEntity = {
        ...(previousTile || {}),
        x: cell.x,
        y: cell.y,
        type: brushType,
      };

      if (brushWalkable === false) {
        nextTile.walkable = false;
      } else {
        delete nextTile.walkable;
      }
      if (normalizedDescription) {
        nextTile.description = normalizedDescription;
      } else {
        delete nextTile.description;
      }
      if (brushType !== "portal") {
        const withoutPortalFields = omitPortalFields(nextTile);
        nextMap.set(key, withoutPortalFields);
        continue;
      }
      nextMap.set(key, nextTile);
    }

    commitTileMap(nextMap);
  }, [brushDescription, brushType, brushWalkable, commitTileMap, disabled, eraseMode, hasResolvedGridSize, parseError, tileMap]);

  const selectedTile = useMemo(() => {
    if (!selectedCell) {
      return null;
    }
    return tileMap.get(`${selectedCell.x},${selectedCell.y}`) || null;
  }, [selectedCell, tileMap]);

  const selectedTileDraft = useMemo(() => {
    if (!selectedCell) {
      return null;
    }
    const currentType = selectedTile?.type || defaultTileType;
    return {
      x: selectedCell.x,
      y: selectedCell.y,
      type: currentType,
      walkable: selectedTile ? selectedTile.walkable !== false : getDefaultWalkableByType(currentType),
      description: selectedTile?.description || "",
      imageUrl: selectedTile?.imageUrl || "",
      portalId: selectedTile?.portalId || "",
      portalName: selectedTile?.portalName || "",
      portalTargetMapId: selectedTile?.portalTargetMapId || "",
      portalTargetPortalId: selectedTile?.portalTargetPortalId || "",
      portalTargetName: selectedTile?.portalTargetName || "",
    };
  }, [defaultTileType, selectedCell, selectedTile]);

  const currentMapPortalOptions = useMemo(
    () => extractPortalSelectOptions(tileMap.values(), selectedCell),
    [selectedCell, tileMap],
  );

  const portalIdCountMap = useMemo(() => {
    const counter = new Map<string, number>();
    tileMap.forEach((tile) => {
      if (tile.type !== "portal") {
        return;
      }
      const portalId = trimOptionalText(tile.portalId);
      if (!portalId) {
        return;
      }
      counter.set(portalId, (counter.get(portalId) || 0) + 1);
    });
    return counter;
  }, [tileMap]);

  const duplicatePortalIds = useMemo(
    () => Array.from(portalIdCountMap.entries()).filter(([, count]) => count > 1).map(([portalId]) => portalId),
    [portalIdCountMap],
  );

  useEffect(() => {
    const normalizedTargetMapId = selectedTileDraft?.type === "portal"
      ? selectedTileDraft.portalTargetMapId.trim()
      : "";

    if (!normalizedTargetMapId) {
      setTargetMapPortalState({
        loading: false,
        mapId: "",
        mapName: "",
        sourceEntity: null,
        options: [],
        error: null,
      });
      return;
    }

    let cancelled = false;
    setTargetMapPortalState((previous) => ({
      ...previous,
      loading: true,
      mapId: normalizedTargetMapId,
      error: null,
    }));

    const loadTargetMap = async () => {
      try {
        const matched = await fetchMapRowById(normalizedTargetMapId);
        if (cancelled) {
          return;
        }
        if (!matched) {
          setTargetMapPortalState({
            loading: false,
            mapId: normalizedTargetMapId,
            mapName: "",
            sourceEntity: null,
            options: [],
            error: "未找到目标地图，可能是 ID 还未保存或填写有误",
          });
          return;
        }

        const parsed = parseTiles(typeof matched.row.tilesData === "string"
          ? matched.row.tilesData
          : JSON.stringify(matched.row.tilesData || []));
        setTargetMapPortalState({
          loading: false,
          mapId: normalizedTargetMapId,
          mapName: String(matched.row.name || matched.row.id || normalizedTargetMapId),
          sourceEntity: matched.entity,
          options: extractPortalSelectOptions(parsed.tiles),
          error: parsed.parseError,
        });
      } catch {
        if (cancelled) {
          return;
        }
        setTargetMapPortalState({
          loading: false,
          mapId: normalizedTargetMapId,
          mapName: "",
          sourceEntity: null,
          options: [],
          error: "目标地图阵点加载失败",
        });
      }
    };

    void loadTargetMap();

    return () => {
      cancelled = true;
    };
  }, [selectedTileDraft?.portalTargetMapId, selectedTileDraft?.type]);

  const selectedPortalIssues = useMemo(() => {
    if (!selectedTileDraft || selectedTileDraft.type !== "portal") {
      return [];
    }

    const issues: string[] = [];
    const portalId = selectedTileDraft.portalId.trim();
    const targetMapId = selectedTileDraft.portalTargetMapId.trim();
    const targetPortalId = selectedTileDraft.portalTargetPortalId.trim();

    if (!portalId) {
      issues.push("当前阵点还没有填写本阵 ID，后续做严格单对单时不方便反向定位。");
    } else if ((portalIdCountMap.get(portalId) || 0) > 1) {
      issues.push(`当前本阵 ID「${portalId}」在本图内重复，请改成唯一值。`);
    }

    if (!targetMapId) {
      issues.push("当前阵点还没有填写目标地图。");
    }

    if (targetMapId && targetMapPortalState.error) {
      issues.push(targetMapPortalState.error);
    }

    if (targetMapId && !targetPortalId && targetMapPortalState.options.length > 1) {
      issues.push("目标地图存在多个阵点，建议补上目标阵 ID，避免落点不明确。");
    }

    if (
      targetMapId
      && targetPortalId
      && targetMapPortalState.options.length > 0
      && !targetMapPortalState.options.some((option) => option.value === targetPortalId)
    ) {
      issues.push(`目标阵 ID「${targetPortalId}」不在已加载的目标地图阵点列表内。`);
    }

    return issues;
  }, [portalIdCountMap, selectedTileDraft, targetMapPortalState.error, targetMapPortalState.options]);

  const updateSelectedTile = useCallback((updater: (tile: TileEntity) => TileEntity | null) => {
    if (!selectedCell || disabled || parseError || !hasResolvedGridSize) {
      return;
    }

    const key = `${selectedCell.x},${selectedCell.y}`;
    const nextMap = new Map(tileMap);
    const current = nextMap.get(key);
    const nextTile = updater(current
      ? { ...current }
      : {
        x: selectedCell.x,
        y: selectedCell.y,
        type: defaultTileType,
      });

    if (!nextTile) {
      nextMap.delete(key);
      commitTileMap(nextMap);
      return;
    }

    nextMap.set(key, nextTile);
    commitTileMap(nextMap);
  }, [commitTileMap, defaultTileType, disabled, hasResolvedGridSize, parseError, selectedCell, tileMap]);

  const previewRect = useMemo(() => {
    if (!boxSelectMode || !dragStart || !dragCurrent) {
      return null;
    }
    return getRectCells(dragStart, dragCurrent);
  }, [boxSelectMode, dragCurrent, dragStart]);

  const finishBoxSelection = useCallback(() => {
    if (!previewRect) {
      return;
    }
    applyToCells(previewRect.cells);
    setDragStart(null);
    setDragCurrent(null);
  }, [applyToCells, previewRect]);

  useEffect(() => {
    if (!boxSelectMode || disabled || parseError || !hasResolvedGridSize) {
      setDragStart(null);
      setDragCurrent(null);
    }
  }, [boxSelectMode, disabled, hasResolvedGridSize, parseError]);

  useEffect(() => {
    if (!boxSelectMode || !dragStart) {
      return;
    }

    const handleMouseUp = () => {
      finishBoxSelection();
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [boxSelectMode, dragStart, finishBoxSelection]);

  const handleCellMouseDown = (x: number, y: number, event: MouseEvent<HTMLButtonElement>) => {
    if (!boxSelectMode || disabled || parseError || !hasResolvedGridSize || event.button !== 0) {
      return;
    }
    event.preventDefault();
    setDragStart({ x, y });
    setDragCurrent({ x, y });
  };

  const handleCellMouseEnter = (x: number, y: number) => {
    if (!boxSelectMode || !dragStart || disabled || parseError || !hasResolvedGridSize) {
      return;
    }
    setDragCurrent({ x, y });
  };

  const rawText = value || "";

  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      <Space>
        <Button
          size="small"
          type={mode === "grid" ? "primary" : "default"}
          onClick={() => setMode("grid")}
        >
          网格编辑
        </Button>
        <Button
          size="small"
          type={mode === "raw" ? "primary" : "default"}
          onClick={() => setMode("raw")}
        >
          原始JSON
        </Button>
        {parseError && <DarkTag color="red">JSON格式错误</DarkTag>}
      </Space>

      {mode === "grid" ? (
        <>
          <Space wrap>
            <Select
              style={{ minWidth: 140 }}
              disabled={disabled}
              value={brushType}
              options={tileTypeOptions}
              onChange={(nextType) => {
                setBrushType(nextType);
                setBrushWalkable(getDefaultWalkableByType(nextType));
              }}
            />
            <Space>
              <Text>可通行</Text>
              <Switch
                disabled={disabled}
                checked={brushWalkable}
                onChange={(next) => setBrushWalkable(next)}
              />
            </Space>
            <Input
              style={{ width: 220 }}
              disabled={disabled}
              placeholder="地块描述(可选)"
              value={brushDescription}
              onChange={(e) => setBrushDescription(e.target.value)}
            />
            <Button
              disabled={disabled}
              type={eraseMode ? "primary" : "default"}
              danger={eraseMode}
              onClick={() => setEraseMode((prev) => !prev)}
            >
              {eraseMode ? "橡皮擦开启" : "橡皮擦关闭"}
            </Button>
            <Button
              disabled={disabled || Boolean(parseError) || !hasResolvedGridSize}
              type={boxSelectMode ? "primary" : "default"}
              onClick={() => setBoxSelectMode((prev) => !prev)}
            >
              {boxSelectMode ? "框选开启" : "框选关闭"}
            </Button>
          </Space>

          <Paragraph type="secondary" style={{ margin: 0 }}>
            点击格子应用画笔；开启橡皮擦后点击可清除该格。开启框选后可拖拽矩形批量应用。默认地块不落库（{defaultTileType}）。
          </Paragraph>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            右键格子可只选中并编辑该格的 ICON、传送阵目标等附加配置，不会额外重刷整张图。
          </Paragraph>
          {!hasResolvedMapType && (
            <Paragraph type="secondary" style={{ margin: 0 }}>
              地图类型未确定，当前不会自动清理默认地块。
            </Paragraph>
          )}
          {!hasResolvedGridSize && (
            <Paragraph type="secondary" style={{ margin: 0 }}>
              地图宽高未确定，网格暂不可编辑，也不会自动改写地块数据。
            </Paragraph>
          )}
          {hasBackgroundImage && (
            <Paragraph type="secondary" style={{ margin: 0 }}>
              当前已加载背景图，未设置的默认地块会以半透明方式显示。
            </Paragraph>
          )}
          <MapTileLegend colorMap={ADMIN_TILE_COLORS} borderColor={GRID_PANEL_BORDER} />
          {previewRect && (
            <Text type="secondary">
              当前框选：({previewRect.minX},{previewRect.minY}) ~ ({previewRect.maxX},{previewRect.maxY})，共 {previewRect.cells.length} 格
            </Text>
          )}

          <div style={{ overflow: "auto", border: `1px solid ${GRID_PANEL_BORDER}`, borderRadius: 6, padding: 8, background: "#1f243d" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${width}, ${GRID_CELL_SIZE}px)`,
                gap: 1,
                padding: 1,
                background: GRID_LINE_COLOR,
                borderRadius: 4,
                width: "max-content",
                userSelect: "none",
              }}
            >
              {Array.from({ length: width * height }, (_, index) => {
                const x = index % width;
                const y = Math.floor(index / width);
                const tile = tileMap.get(`${x},${y}`);
                const type = tile?.type ?? defaultTileType;
                const walkable = tile?.walkable ?? true;
                const hasEntity = Boolean(tile);
                const inPreview = Boolean(
                  previewRect
                    && x >= previewRect.minX
                    && x <= previewRect.maxX
                    && y >= previewRect.minY
                    && y <= previewRect.maxY,
                );

                return (
                  <button
                    key={`${x}-${y}`}
                    type="button"
                    disabled={disabled || Boolean(parseError) || !hasResolvedGridSize}
                    onClick={() => {
                      if (boxSelectMode) {
                        return;
                      }
                      setSelectedCell({ x, y });
                      applyToCells([{ x, y }]);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (disabled || Boolean(parseError) || !hasResolvedGridSize) {
                        return;
                      }
                      setSelectedCell({ x, y });
                    }}
                    onMouseDown={(event) => handleCellMouseDown(x, y, event)}
                    onMouseEnter={() => handleCellMouseEnter(x, y)}
                    title={`(${x},${y}) ${type} ${walkable ? "可通行" : "不可通行"}${tile?.description ? ` - ${tile.description}` : ""}`}
                    style={{
                      width: GRID_CELL_SIZE,
                      height: GRID_CELL_SIZE,
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: inPreview
                        ? GRID_CELL_PREVIEW_BORDER
                        : hasEntity
                          ? GRID_CELL_EDITED_BORDER
                          : GRID_CELL_DEFAULT_BORDER,
                      backgroundColor: hasEntity
                        ? (ADMIN_TILE_COLORS[type] || ADMIN_TILE_COLORS.empty)
                        : hasBackgroundImage
                          ? "rgba(19, 24, 40, 0.2)"
                          : (ADMIN_TILE_COLORS[type] || ADMIN_TILE_COLORS.empty),
                      backgroundImage: hasBackgroundImage ? `url("${normalizedBackgroundImageUrl}")` : undefined,
                      backgroundSize: hasBackgroundImage ? `${width * GRID_CELL_SIZE}px ${height * GRID_CELL_SIZE}px` : undefined,
                      backgroundPosition: hasBackgroundImage ? `${-x * GRID_CELL_SIZE}px ${-y * GRID_CELL_SIZE}px` : undefined,
                      backgroundRepeat: "no-repeat",
                      opacity: walkable ? 1 : 0.78,
                      boxShadow: inPreview ? "inset 0 0 0 999px rgba(124, 200, 255, 0.12)" : "none",
                      cursor: disabled || !hasResolvedGridSize ? "not-allowed" : boxSelectMode ? "crosshair" : "pointer",
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                  >
                    <span aria-hidden="true">{TILE_ICONS[type] || ""}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedTileDraft ? (
            <Space
              orientation="vertical"
              style={{
                width: "100%",
                border: `1px solid ${GRID_PANEL_BORDER}`,
                borderRadius: 8,
                padding: 12,
                background: "#1f243d",
              }}
            >
              <Space wrap>
                <DarkTag color="gold">当前格：({selectedTileDraft.x}, {selectedTileDraft.y})</DarkTag>
                <DarkTag color={selectedTile ? "blue" : "default"}>
                  {selectedTile ? "已写入地块" : "默认地块"}
                </DarkTag>
                <Button
                  size="small"
                  disabled={disabled || (!selectedTile && selectedTileDraft.type === defaultTileType)}
                  onClick={() => {
                    if (!selectedCell) {
                      return;
                    }
                    updateSelectedTile(() => null);
                  }}
                >
                  恢复默认
                </Button>
              </Space>

              <Space wrap style={{ width: "100%" }}>
                <Select
                  style={{ minWidth: 140 }}
                  disabled={disabled}
                  value={selectedTileDraft.type}
                  options={tileTypeOptions}
                  onChange={(nextType) => {
                    updateSelectedTile((tile) => {
                      const nextTile: TileEntity = {
                        ...tile,
                        x: selectedTileDraft.x,
                        y: selectedTileDraft.y,
                        type: nextType,
                      };
                      if (getDefaultWalkableByType(nextType)) {
                        delete nextTile.walkable;
                      } else {
                        nextTile.walkable = false;
                      }
                      return nextType === "portal" ? nextTile : omitPortalFields(nextTile);
                    });
                  }}
                />
                <Space>
                  <Text>可通行</Text>
                  <Switch
                    disabled={disabled}
                    checked={selectedTileDraft.walkable}
                    onChange={(next) => {
                      updateSelectedTile((tile) => {
                        const nextTile = { ...tile };
                        if (next) {
                          delete nextTile.walkable;
                        } else {
                          nextTile.walkable = false;
                        }
                        return nextTile;
                      });
                    }}
                  />
                </Space>
              </Space>

              <Input
                disabled={disabled}
                placeholder="地块描述"
                value={selectedTileDraft.description}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  updateSelectedTile((tile) => ({
                    ...tile,
                    description: nextValue,
                  }));
                }}
              />

              <Input
                disabled={disabled}
                placeholder="ICON/图片地址，例如 /uploads/cosmetics/map-marker/sea-gate.webp"
                value={selectedTileDraft.imageUrl}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  updateSelectedTile((tile) => ({
                    ...tile,
                    imageUrl: nextValue,
                  }));
                }}
              />

              {selectedTileDraft.type === "portal" && (
                <>
                  <Space wrap>
                    <DarkTag color="blue">本图阵点数：{currentMapPortalOptions.length + 1}</DarkTag>
                    <DarkTag color={duplicatePortalIds.length > 0 ? "red" : "green"}>
                      {duplicatePortalIds.length > 0 ? `重复阵ID：${duplicatePortalIds.length}` : "阵ID唯一"}
                    </DarkTag>
                    {targetMapPortalState.mapId && (
                      <DarkTag color={targetMapPortalState.error ? "red" : "gold"}>
                        目标图阵点：{targetMapPortalState.loading ? "加载中" : targetMapPortalState.options.length}
                      </DarkTag>
                    )}
                  </Space>

                  {currentMapPortalOptions.length > 0 && (
                    <Text type="secondary">
                      本图其他阵点：{currentMapPortalOptions.map((option) => option.label).join("、")}
                    </Text>
                  )}

                  {selectedPortalIssues.length > 0 ? (
                    <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                      {selectedPortalIssues.map((issue) => (
                        <Text key={issue} type="warning">{issue}</Text>
                      ))}
                    </Space>
                  ) : (
                    <Text type="secondary">当前阵点配置看起来没有明显冲突，可以继续补齐成对关系。</Text>
                  )}

                  <Space wrap style={{ width: "100%" }}>
                    <Input
                      style={{ width: 220 }}
                      disabled={disabled}
                      placeholder="本阵ID，例如 portal_qingshili_to_penglai"
                      value={selectedTileDraft.portalId}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        updateSelectedTile((tile) => ({
                          ...tile,
                          portalId: nextValue,
                        }));
                      }}
                    />
                    <Input
                      style={{ width: 220 }}
                      disabled={disabled}
                      placeholder="传送阵名，例如 青石海口阵"
                      value={selectedTileDraft.portalName}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        updateSelectedTile((tile) => ({
                          ...tile,
                          portalName: nextValue,
                        }));
                      }}
                    />
                  </Space>

                  <Space wrap style={{ width: "100%" }}>
                    <div style={{ minWidth: 260, flex: "1 1 260px" }}>
                      <ReferenceSelect
                        entity="maps"
                        labelKey="name"
                        value={selectedTileDraft.portalTargetMapId || undefined}
                        onChange={(nextValue) => {
                          updateSelectedTile((tile) => ({
                            ...tile,
                            portalTargetMapId: nextValue || "",
                          }));
                        }}
                        onSelectOption={(nextValue, option) => {
                          updateSelectedTile((tile) => ({
                            ...tile,
                            portalTargetMapId: nextValue || "",
                            portalTargetName: option?.rawLabel || tile.portalTargetName || "",
                          }));
                        }}
                        disabled={disabled}
                        allowClear
                        placeholder="快捷选择正式地图"
                      />
                    </div>
                    <Select
                      allowClear
                      showSearch
                      style={{ width: 260 }}
                      disabled={disabled || targetMapPortalState.loading || targetMapPortalState.options.length === 0}
                      placeholder={
                        targetMapPortalState.loading
                          ? "目标阵点加载中"
                          : targetMapPortalState.options.length > 0
                            ? "从目标图阵点中选择"
                            : "目标图暂无可选阵点"
                      }
                      value={selectedTileDraft.portalTargetPortalId || undefined}
                      options={targetMapPortalState.options}
                      optionFilterProp="label"
                      onChange={(nextValue) => {
                        const matchedOption = targetMapPortalState.options.find((option) => option.value === nextValue);
                        updateSelectedTile((tile) => ({
                          ...tile,
                          portalTargetPortalId: String(nextValue || ""),
                          portalTargetName: tile.portalTargetName || targetMapPortalState.mapName || matchedOption?.portalName || "",
                        }));
                      }}
                    />
                  </Space>

                  <Space wrap style={{ width: "100%" }}>
                    <Input
                      style={{ width: 260 }}
                      disabled={disabled}
                      placeholder="目标地图ID，例如 map_qingshili"
                      value={selectedTileDraft.portalTargetMapId}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        updateSelectedTile((tile) => ({
                          ...tile,
                          portalTargetMapId: nextValue,
                        }));
                      }}
                    />
                    <Input
                      style={{ width: 220 }}
                      disabled={disabled}
                      placeholder="目标地图名，例如 青石里"
                      value={selectedTileDraft.portalTargetName}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        updateSelectedTile((tile) => ({
                          ...tile,
                          portalTargetName: nextValue,
                        }));
                      }}
                    />
                  </Space>

                  <Input
                    style={{ width: 260 }}
                    disabled={disabled}
                    placeholder="手填目标阵ID，例如 portal_penglai_to_qingshili"
                    value={selectedTileDraft.portalTargetPortalId}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      updateSelectedTile((tile) => ({
                        ...tile,
                        portalTargetPortalId: nextValue,
                      }));
                    }}
                  />

                  <Text type="secondary">
                    传送阵建议至少配置目标地图；若要严格单对单，请同时填写本阵 ID 与目标阵 ID。上面的下拉会优先读取目标图已有阵点，找不到时仍可手填。
                  </Text>
                  {targetMapPortalState.mapName && (
                    <Text type="secondary">
                      当前目标图：{targetMapPortalState.mapName}
                      {targetMapPortalState.sourceEntity === "temporaryMaps" ? "（临时地图）" : targetMapPortalState.sourceEntity === "maps" ? "（正式地图）" : ""}
                    </Text>
                  )}
                </>
              )}
            </Space>
          ) : (
            <Text type="secondary">点击格子即可快速绘制；右键格子后可在下方编辑该格的附加配置。</Text>
          )}
        </>
      ) : (
        <Input.TextArea
          rows={10}
          disabled={disabled}
          placeholder={field.placeholder || "请输入合法 JSON"}
          value={rawText}
          onChange={(e) => onChange?.(e.target.value)}
        />
      )}

      {parseError && mode === "raw" && (
        <Text type="danger">{parseError}</Text>
      )}
    </Space>
  );
}

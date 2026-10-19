"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type {
  MapSceneEntity,
  MapSceneNpcEntity,
  MapSceneMonsterEntity,
  MapSceneOpportunityEntity,
  MapScenePlayerEntity,
  MapSceneSnapshot,
} from "@/modules/map/services/map-scene-state";
import {
  isMapSceneSelfCorrectionActive,
  resolveMapSceneRenderEntities,
  type MapSceneSelfCorrection,
} from "@/modules/map/services/map-scene-render-state";
import {
  normalizeCenteredMapViewSize,
  resolveMapFogLevel,
  resolveMapVisionProfile,
  type MapFogLevel,
} from "@/modules/map/services/map-vision";
import {
  TILE_COLORS,
  TILE_ICONS,
  TILE_LABELS,
  getDefaultTileType,
} from "@/modules/map/services/map-tile-visual";

interface TileData {
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

interface NpcData {
  id: string;
  name: string;
  positionX: number;
  positionY: number;
  avatarImageUrl?: string | null;
}

interface MonsterData {
  id: string;
  name: string;
  avatarImageUrl?: string | null;
  monsterType?: string;
  positionX: number;
  positionY: number;
}

interface MapGridProps {
  mapId: string;
  tiles: TileData[];
  width: number;
  height: number;
  mapType: string;
  backgroundImageUrl?: string | null;
  sceneSnapshot?: MapSceneSnapshot | null;
  previousSceneSnapshot?: MapSceneSnapshot | null;
  selfRenderCorrection?: MapSceneSelfCorrection | null;
  npcs: NpcData[];
  monsters: MonsterData[];
  onTileClick: (x: number, y: number) => void;
  onCellClick?: (cell: MapGridCellClickPayload) => boolean | void;
  viewSize?: number;
  maxMoveDistance?: number;
  spiritualSense?: number;
  allowPlayerMove?: boolean;
  maxDisplayHeight?: number;
}

type ImageCacheEntry = {
  image: HTMLImageElement;
  status: "loading" | "loaded" | "error";
};

type ViewportWindow = {
  cameraOriginX: number;
  cameraOriginY: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  columns: number;
  rows: number;
};

type LayoutMetrics = {
  outerWidth: number;
  outerHeight: number;
  mapLeft: number;
  mapTop: number;
  tileSize: number;
  columns: number;
  rows: number;
  avatarSize: number;
  nameplateHeight: number;
};

type SceneRenderableEntity = {
  id: string;
  name: string;
  positionX: number;
  positionY: number;
  renderPositionX: number;
  renderPositionY: number;
  snappedRenderX: number;
  snappedRenderY: number;
  type: "self" | "player" | "opportunity" | "npc" | "monster";
  subType?: string;
  iconImageUrl?: string | null;
  avatarImageUrl?: string | null;
  avatarFrameImageUrl?: string | null;
};

type ResolvedVisual = {
  mode: "icon" | "avatar" | "opportunity";
  icon: string;
  entityLabel: string;
  entityLabelType: SceneRenderableEntity["type"] | null;
  avatarImageUrl: string | null;
  avatarFrameImageUrl: string | null;
  avatarFallbackText: string;
  avatarFallbackColor: string;
  avatarFallbackFontWeight: number;
  avatarBorderColor: string;
  avatarBackground: string;
  opportunityIconImageUrl: string | null;
};

type VisibleCell = {
  x: number;
  y: number;
  tileType: string;
  tileWalkable: boolean;
  tileDescription?: string;
  tileImageUrl?: string;
  isPortalTile: boolean;
  portalName?: string;
  portalTargetName?: string;
  isVoid: boolean;
  isPlayer: boolean;
  canMove: boolean;
  fogLevel: MapFogLevel;
  remembered: boolean;
  entitiesHere: SceneRenderableEntity[];
  visual: ResolvedVisual;
};

export type MapGridCellClickPayload = Pick<
  VisibleCell,
  "x" | "y" | "tileType" | "tileWalkable" | "tileDescription" | "isPortalTile" | "isVoid" | "canMove" | "fogLevel"
>;

const PANEL_PADDING = 12;
const MIN_TILE_SIZE = 20;
const MAX_TILE_SIZE = 64;
const PANEL_MAX_WIDTH = 520;
const DEFAULT_PANEL_WIDTH = 360;
const FOG_MEMORY_STORAGE_PREFIX = "immortality:map:fog-memory:";
const MAX_CANVAS_DPR = 2;
const MAP_REMOTE_PLAYER_INTERPOLATION_DELAY_MS = 40;
const MAP_REMOTE_PLAYER_MAX_EXTRAPOLATION_MS = 140;
const ENTITY_ICONS: Record<string, string> = {
  npc: "商",
  monster: "怪",
  player: "友",
  self: "我",
  opportunity: "缘",
  elite: "精",
  boss: "首",
};

function resolveEntityDisplayName(entity: {
  name?: string | null;
  type?: SceneRenderableEntity["type"];
  entityType?: MapScenePlayerEntity["entityType"] | MapSceneNpcEntity["entityType"] | MapSceneOpportunityEntity["entityType"] | MapSceneMonsterEntity["entityType"];
}) {
  const normalized = String(entity.name || "").trim();
  if (normalized) {
    return normalized;
  }

  const resolvedType = entity.type || entity.entityType;
  if (resolvedType === "self") {
    return "你";
  }
  if (resolvedType === "player") {
    return "道友";
  }
  if (resolvedType === "npc") {
    return "商人";
  }
  if (resolvedType === "monster") {
    return "妖兽";
  }
  if (resolvedType === "opportunity") {
    return "机缘";
  }
  return "未知目标";
}

const TILE_ICON_FALLBACKS: Record<string, string> = {
  mountain: "^",
  water: "~",
  forest: "*",
  portal: "O",
  building: "#",
  grass: "",
  empty: "",
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function snapToGridCoordinate(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value);
}

function getDefaultWalkable() {
  return true;
}

function isMapScenePlayerEntity(entity: MapSceneEntity): entity is MapScenePlayerEntity {
  return entity.entityType === "self" || entity.entityType === "player";
}

function isMapSceneOpportunityEntity(entity: MapSceneEntity): entity is MapSceneOpportunityEntity {
  return entity.entityType === "opportunity";
}

function isMapSceneNpcEntity(entity: MapSceneEntity): entity is MapSceneNpcEntity {
  return entity.entityType === "npc";
}

function isMapSceneMonsterEntity(entity: MapSceneEntity): entity is MapSceneMonsterEntity {
  return entity.entityType === "monster";
}

function getEntityPriority(entity: SceneRenderableEntity) {
  if (entity.type === "self") return 5;
  if (entity.type === "npc" || entity.type === "monster") return 4;
  if (entity.type === "opportunity") return 3;
  if (entity.type === "player") return 2;
  return 1;
}

function filterEntitiesByFogLevel(
  entities: SceneRenderableEntity[],
  fogLevel: MapFogLevel,
) {
  if (fogLevel === "clear") {
    return entities;
  }

  if (fogLevel === "shallow") {
    return entities.filter((entity) => (
      entity.type === "npc"
      || entity.type === "monster"
    ));
  }

  return [];
}

function buildFogMemoryStorageKey(mapId: string) {
  return `${FOG_MEMORY_STORAGE_PREFIX}${mapId}`;
}

function createViewportWindow(params: {
  width: number;
  height: number;
  playerX: number;
  playerY: number;
  viewSize: number;
}): ViewportWindow {
  const windowSize = normalizeCenteredMapViewSize(params.viewSize);
  const cameraOriginX = params.playerX + 0.5 - windowSize / 2;
  const cameraOriginY = params.playerY + 0.5 - windowSize / 2;
  const startX = Math.floor(cameraOriginX);
  const startY = Math.floor(cameraOriginY);
  const endX = Math.ceil(cameraOriginX + windowSize) - 1;
  const endY = Math.ceil(cameraOriginY + windowSize) - 1;

  return {
    cameraOriginX,
    cameraOriginY,
    startX,
    startY,
    endX,
    endY,
    columns: windowSize,
    rows: windowSize,
  };
}

function buildLayoutMetrics(viewport: ViewportWindow, containerWidth: number): LayoutMetrics {
  const boundedPanelWidth = clamp(
    Math.round(containerWidth || DEFAULT_PANEL_WIDTH),
    260,
    PANEL_MAX_WIDTH,
  );
  const minimumTileSize = viewport.columns >= 11 || viewport.rows >= 11 ? MIN_TILE_SIZE : 24;
  const tileSize = clamp(
    Math.floor((boundedPanelWidth - PANEL_PADDING * 2) / Math.max(viewport.columns, viewport.rows, 1)),
    minimumTileSize,
    MAX_TILE_SIZE,
  );
  const mapWidth = viewport.columns * tileSize;
  const mapHeight = viewport.rows * tileSize;
  const outerWidth = mapWidth + PANEL_PADDING * 2;
  const outerHeight = mapHeight + PANEL_PADDING * 2;

  return {
    outerWidth,
    outerHeight,
    mapLeft: PANEL_PADDING,
    mapTop: PANEL_PADDING,
    tileSize,
    columns: viewport.columns,
    rows: viewport.rows,
    avatarSize: Math.max(18, Math.round(tileSize * 0.58)),
    nameplateHeight: tileSize >= 36 ? 14 : 12,
  };
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + safeRadius, safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.arcTo(x + width, y + height, x + width - safeRadius, y + height, safeRadius);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.arcTo(x, y + height, x, y + height - safeRadius, safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.arcTo(x, y, x + safeRadius, y, safeRadius);
  ctx.closePath();
}

function drawPanelBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);

  const fill = ctx.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, "rgba(16, 19, 33, 0.98)");
  fill.addColorStop(1, "rgba(8, 10, 17, 0.98)");
  drawRoundedRectPath(ctx, 0.5, 0.5, width - 1, height - 1, 16);
  ctx.fillStyle = fill;
  ctx.fill();

  const glow = ctx.createRadialGradient(width * 0.22, height * 0.16, 12, width * 0.22, height * 0.16, width * 0.4);
  glow.addColorStop(0, "rgba(88, 110, 170, 0.18)");
  glow.addColorStop(1, "rgba(88, 110, 170, 0)");
  ctx.fillStyle = glow;
  drawRoundedRectPath(ctx, 0.5, 0.5, width - 1, height - 1, 16);
  ctx.fill();

  ctx.strokeStyle = "rgba(103, 119, 163, 0.34)";
  ctx.lineWidth = 1;
  drawRoundedRectPath(ctx, 0.5, 0.5, width - 1, height - 1, 16);
  ctx.stroke();
}

function drawMapAreaBackdrop(
  ctx: CanvasRenderingContext2D,
  metrics: LayoutMetrics,
) {
  const mapWidth = metrics.columns * metrics.tileSize;
  const mapHeight = metrics.rows * metrics.tileSize;
  drawRoundedRectPath(ctx, metrics.mapLeft, metrics.mapTop, mapWidth, mapHeight, 10);
  const fill = ctx.createLinearGradient(metrics.mapLeft, metrics.mapTop, metrics.mapLeft, metrics.mapTop + mapHeight);
  fill.addColorStop(0, "rgba(15, 18, 30, 0.98)");
  fill.addColorStop(1, "rgba(9, 11, 18, 0.98)");
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawTileBackground(
  ctx: CanvasRenderingContext2D,
  backgroundImage: HTMLImageElement | null,
  metrics: LayoutMetrics,
  cell: VisibleCell,
  width: number,
  height: number,
  left: number,
  top: number,
) {
  if (cell.isVoid) {
    const voidFill = ctx.createLinearGradient(left, top, left, top + metrics.tileSize);
    voidFill.addColorStop(0, "rgba(4, 5, 11, 0.98)");
    voidFill.addColorStop(1, "rgba(1, 2, 6, 1)");
    ctx.fillStyle = voidFill;
    ctx.fillRect(left, top, metrics.tileSize, metrics.tileSize);

    const mist = ctx.createRadialGradient(
      left + metrics.tileSize * 0.5,
      top + metrics.tileSize * 0.45,
      1,
      left + metrics.tileSize * 0.5,
      top + metrics.tileSize * 0.45,
      metrics.tileSize * 0.7,
    );
    mist.addColorStop(0, "rgba(61, 76, 120, 0.16)");
    mist.addColorStop(1, "rgba(61, 76, 120, 0)");
    ctx.fillStyle = mist;
    ctx.fillRect(left, top, metrics.tileSize, metrics.tileSize);

    ctx.fillStyle = "rgba(112, 126, 170, 0.08)";
    ctx.fillRect(left, top, metrics.tileSize, 1);
    ctx.fillRect(left, top + metrics.tileSize - 1, metrics.tileSize, 1);
    return;
  }

  const tileColor = TILE_COLORS[cell.tileType] || TILE_COLORS.empty;

  if (backgroundImage) {
    const sourceWidth = backgroundImage.naturalWidth || backgroundImage.width;
    const sourceHeight = backgroundImage.naturalHeight || backgroundImage.height;
    if (sourceWidth > 0 && sourceHeight > 0) {
      const sliceWidth = sourceWidth / Math.max(width, 1);
      const sliceHeight = sourceHeight / Math.max(height, 1);
      ctx.drawImage(
        backgroundImage,
        cell.x * sliceWidth,
        cell.y * sliceHeight,
        sliceWidth,
        sliceHeight,
        left,
        top,
        metrics.tileSize,
        metrics.tileSize,
      );
    }
  } else {
    ctx.fillStyle = tileColor;
    ctx.fillRect(left, top, metrics.tileSize, metrics.tileSize);
  }

  ctx.fillStyle = backgroundImage ? "rgba(8, 11, 18, 0.18)" : tileColor;
  ctx.fillRect(left, top, metrics.tileSize, metrics.tileSize);

  if (backgroundImage) {
    ctx.fillStyle = `${tileColor}70`;
    ctx.fillRect(left, top, metrics.tileSize, metrics.tileSize);
  }

  if (cell.isPortalTile) {
    const portalTint = ctx.createLinearGradient(left, top, left, top + metrics.tileSize);
    portalTint.addColorStop(0, "rgba(72, 122, 186, 0.16)");
    portalTint.addColorStop(0.55, "rgba(40, 189, 198, 0.12)");
    portalTint.addColorStop(1, "rgba(224, 194, 113, 0.18)");
    ctx.fillStyle = portalTint;
    ctx.fillRect(left, top, metrics.tileSize, metrics.tileSize);
  }

  if (cell.canMove) {
    ctx.fillStyle = "rgba(201, 168, 76, 0.14)";
    ctx.fillRect(left, top, metrics.tileSize, metrics.tileSize);
  }

  if (cell.isPlayer) {
    const playerGlow = ctx.createRadialGradient(
      left + metrics.tileSize / 2,
      top + metrics.tileSize / 2,
      3,
      left + metrics.tileSize / 2,
      top + metrics.tileSize / 2,
      metrics.tileSize * 0.7,
    );
    playerGlow.addColorStop(0, "rgba(226, 193, 104, 0.32)");
    playerGlow.addColorStop(1, "rgba(226, 193, 104, 0)");
    ctx.fillStyle = playerGlow;
    ctx.fillRect(left, top, metrics.tileSize, metrics.tileSize);
  }

  if (!cell.tileWalkable) {
    ctx.fillStyle = "rgba(6, 8, 14, 0.42)";
    ctx.fillRect(left, top, metrics.tileSize, metrics.tileSize);
  }
}

function drawTileBorder(
  ctx: CanvasRenderingContext2D,
  cell: VisibleCell,
  left: number,
  top: number,
  tileSize: number,
  isHovered: boolean,
  isPressed: boolean,
) {
  ctx.strokeStyle = isPressed
    ? "rgba(255, 231, 162, 1)"
    : isHovered
    ? "rgba(240, 218, 150, 0.94)"
    : cell.isPortalTile
      ? "rgba(109, 222, 221, 0.72)"
    : cell.isVoid
      ? "rgba(74, 86, 120, 0.28)"
    : cell.isPlayer
      ? "rgba(212, 184, 95, 0.94)"
      : cell.canMove
        ? "rgba(201, 168, 76, 0.48)"
        : "rgba(0, 0, 0, 0.28)";
  ctx.lineWidth = isPressed ? 2.4 : isHovered || cell.isPlayer || cell.isPortalTile ? 1.6 : 1;
  ctx.strokeRect(left + 0.5, top + 0.5, tileSize - 1, tileSize - 1);
}

function drawTileInteractionAccent(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  tileSize: number,
  options: {
    canMove: boolean;
    hovered: boolean;
    pressed: boolean;
    phase: number;
  },
) {
  const pulse = (Math.sin(options.phase * Math.PI * 2) + 1) / 2;
  const centerX = left + tileSize / 2;
  const centerY = top + tileSize / 2;

  if (options.canMove && !options.hovered && !options.pressed) {
    const moveGlow = ctx.createRadialGradient(centerX, centerY, 2, centerX, centerY, tileSize * 0.72);
    moveGlow.addColorStop(0, `rgba(226, 193, 104, ${0.09 + pulse * 0.04})`);
    moveGlow.addColorStop(0.7, "rgba(226, 193, 104, 0.04)");
    moveGlow.addColorStop(1, "rgba(226, 193, 104, 0)");
    ctx.fillStyle = moveGlow;
    ctx.fillRect(left, top, tileSize, tileSize);

    ctx.fillStyle = `rgba(255, 234, 178, ${0.03 + pulse * 0.03})`;
    ctx.fillRect(left + 1, top + 1, tileSize - 2, 1);
  }

  if (!options.hovered && !options.pressed) {
    return;
  }

  const accentAlpha = options.pressed ? 0.22 : 0.16 + pulse * 0.05;
  const accentGlow = ctx.createRadialGradient(centerX, centerY, 2, centerX, centerY, tileSize * 0.9);
  accentGlow.addColorStop(0, `rgba(255, 233, 174, ${accentAlpha})`);
  accentGlow.addColorStop(0.52, `rgba(201, 168, 76, ${accentAlpha * 0.56})`);
  accentGlow.addColorStop(1, "rgba(201, 168, 76, 0)");
  ctx.fillStyle = accentGlow;
  ctx.fillRect(left - 1, top - 1, tileSize + 2, tileSize + 2);

  ctx.strokeStyle = options.pressed
    ? "rgba(255, 240, 198, 0.96)"
    : `rgba(248, 225, 162, ${0.72 + pulse * 0.16})`;
  ctx.lineWidth = options.pressed ? 1.8 : 1.35;
  ctx.strokeRect(left + 2, top + 2, tileSize - 4, tileSize - 4);
}

function drawSelfPresencePulse(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  tileSize: number,
  phase: number,
) {
  const centerX = left + tileSize / 2;
  const centerY = top + tileSize / 2 - Math.max(1, Math.round(tileSize * 0.04));
  const pulse = (Math.sin(phase * Math.PI * 2) + 1) / 2;
  const outerRadius = tileSize * (0.34 + pulse * 0.08);
  const innerRadius = tileSize * (0.2 + pulse * 0.04);

  const floorGlow = ctx.createRadialGradient(centerX, centerY, 2, centerX, centerY, tileSize * 0.9);
  floorGlow.addColorStop(0, `rgba(226, 193, 104, ${0.18 + pulse * 0.08})`);
  floorGlow.addColorStop(0.58, "rgba(226, 193, 104, 0.06)");
  floorGlow.addColorStop(1, "rgba(226, 193, 104, 0)");
  ctx.fillStyle = floorGlow;
  ctx.fillRect(left - 4, top - 4, tileSize + 8, tileSize + 8);

  ctx.strokeStyle = `rgba(255, 228, 158, ${0.38 + pulse * 0.2})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = `rgba(120, 176, 255, ${0.24 + pulse * 0.14})`;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPortalMarker(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  tileSize: number,
  options?: {
    dimmed?: boolean;
    active?: boolean;
    hovered?: boolean;
    pressed?: boolean;
  },
) {
  const dimmed = Boolean(options?.dimmed);
  const active = Boolean(options?.active);
  const hovered = Boolean(options?.hovered);
  const pressed = Boolean(options?.pressed);
  const centerX = left + tileSize / 2;
  const centerY = top + tileSize / 2;
  const outerRadius = Math.max(6, tileSize * 0.33);
  const innerRadius = Math.max(4, tileSize * 0.18);
  const alphaScale = dimmed ? 0.52 : 1;

  ctx.save();

  const outerGlow = ctx.createRadialGradient(
    centerX,
    centerY,
    2,
    centerX,
    centerY,
    outerRadius * (active ? 1.95 : hovered ? 1.72 : 1.55),
  );
  outerGlow.addColorStop(0, `rgba(120, 236, 255, ${0.34 * alphaScale})`);
  outerGlow.addColorStop(0.52, `rgba(94, 193, 255, ${0.18 * alphaScale})`);
  outerGlow.addColorStop(1, "rgba(94, 193, 255, 0)");
  ctx.fillStyle = outerGlow;
  ctx.fillRect(
    centerX - outerRadius * 2,
    centerY - outerRadius * 2,
    outerRadius * 4,
    outerRadius * 4,
  );

  ctx.strokeStyle = `rgba(109, 222, 221, ${(active ? 0.98 : 0.86) * alphaScale})`;
  ctx.lineWidth = pressed ? 2.6 : active ? 2.35 : hovered ? 2.05 : 1.8;
  ctx.beginPath();
  ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = `rgba(239, 214, 132, ${(active ? 0.95 : 0.76) * alphaScale})`;
  ctx.lineWidth = active ? 1.55 : 1.25;
  ctx.beginPath();
  ctx.arc(centerX, centerY, innerRadius + Math.max(2, tileSize * 0.05), 0, Math.PI * 2);
  ctx.stroke();

  const diamondRadius = Math.max(4, tileSize * 0.12);
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - diamondRadius);
  ctx.lineTo(centerX + diamondRadius, centerY);
  ctx.lineTo(centerX, centerY + diamondRadius);
  ctx.lineTo(centerX - diamondRadius, centerY);
  ctx.closePath();
  const coreFill = ctx.createLinearGradient(
    centerX - diamondRadius,
    centerY - diamondRadius,
    centerX + diamondRadius,
    centerY + diamondRadius,
  );
  coreFill.addColorStop(0, `rgba(141, 247, 255, ${(active ? 0.92 : 0.7) * alphaScale})`);
  coreFill.addColorStop(1, `rgba(255, 220, 136, ${(active ? 0.9 : 0.66) * alphaScale})`);
  ctx.fillStyle = coreFill;
  ctx.fill();

  ctx.strokeStyle = `rgba(255, 245, 220, ${(active ? 0.86 : 0.58) * alphaScale})`;
  ctx.lineWidth = 1;
  ctx.stroke();

  const sparkleOffset = Math.max(5, tileSize * 0.19);
  ctx.strokeStyle = `rgba(255, 224, 154, ${(active ? 0.92 : 0.7) * alphaScale})`;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(centerX - sparkleOffset, centerY);
  ctx.lineTo(centerX + sparkleOffset, centerY);
  ctx.moveTo(centerX, centerY - sparkleOffset);
  ctx.lineTo(centerX, centerY + sparkleOffset);
  ctx.stroke();

  if (active) {
    ctx.strokeStyle = "rgba(255, 242, 188, 0.92)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(centerX, centerY, outerRadius + Math.max(3, tileSize * 0.08), 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawFogOverlay(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  tileSize: number,
  fogLevel: MapFogLevel,
  remembered: boolean,
) {
  if (fogLevel === "clear") {
    return;
  }

  if (fogLevel === "shallow") {
    const shallowFog = ctx.createLinearGradient(left, top, left, top + tileSize);
    shallowFog.addColorStop(0, "rgba(122, 132, 148, 0.24)");
    shallowFog.addColorStop(1, "rgba(72, 82, 96, 0.38)");
    ctx.fillStyle = shallowFog;
    ctx.fillRect(left, top, tileSize, tileSize);
    return;
  }

  const deepFog = ctx.createLinearGradient(left, top, left, top + tileSize);
  void remembered;
  deepFog.addColorStop(0, "rgba(158, 166, 176, 0.28)");
  deepFog.addColorStop(1, "rgba(88, 96, 108, 0.48)");
  ctx.fillStyle = deepFog;
  ctx.fillRect(left, top, tileSize, tileSize);
}

function drawCenterGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: string,
  left: number,
  top: number,
  tileSize: number,
  color: string,
) {
  if (!glyph) {
    return;
  }

  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `700 ${Math.max(16, Math.round(tileSize * 0.42))}px "Segoe UI", "PingFang SC", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, left + tileSize / 2, top + tileSize / 2, tileSize - 6);
  ctx.restore();
}

function drawTileDecorationImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  left: number,
  top: number,
  tileSize: number,
  opacity = 1,
) {
  if (!image) {
    return;
  }

  const size = Math.max(12, Math.round(tileSize * 0.62));
  const x = left + (tileSize - size) / 2;
  const y = top + (tileSize - size) / 2 - Math.max(1, Math.round(tileSize * 0.05));
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(image, x, y, size, size);
  ctx.restore();
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  frameImage: HTMLImageElement | null,
  left: number,
  top: number,
  tileSize: number,
  size: number,
  options: {
    fallbackText: string;
    fallbackColor: string;
    fallbackFontWeight: number;
    borderColor: string;
    background: string;
  },
) {
  const radius = size / 2;
  const centerX = left + tileSize / 2;
  const centerY = top + tileSize / 2 - Math.max(1, Math.round(tileSize * 0.04));
  const avatarInset = frameImage ? Math.max(2, Math.round(size * 0.08)) : 0;

  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = options.background;
  ctx.fill();
  ctx.strokeStyle = options.borderColor;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  const innerRadius = Math.max(8, radius - avatarInset);
  if (image) {
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (sourceWidth > 0 && sourceHeight > 0) {
      const sourceSize = Math.min(sourceWidth, sourceHeight);
      const sourceX = (sourceWidth - sourceSize) / 2;
      const sourceY = (sourceHeight - sourceSize) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(
        image,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        centerX - innerRadius,
        centerY - innerRadius,
        innerRadius * 2,
        innerRadius * 2,
      );
      ctx.restore();
    }
  } else {
    ctx.save();
    ctx.fillStyle = options.fallbackColor;
    ctx.font = `${options.fallbackFontWeight} ${Math.max(12, Math.round(size * 0.36))}px "Segoe UI", "PingFang SC", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(options.fallbackText, centerX, centerY + 1, innerRadius * 1.6);
    ctx.restore();
  }

  if (frameImage) {
    const frameRadius = radius + 1.5;
    ctx.drawImage(
      frameImage,
      centerX - frameRadius,
      centerY - frameRadius,
      frameRadius * 2,
      frameRadius * 2,
    );
  }
}

function drawOpportunity(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  left: number,
  top: number,
  tileSize: number,
) {
  const size = Math.max(14, Math.round(tileSize * 0.46));
  const x = left + (tileSize - size) / 2;
  const y = top + (tileSize - size) / 2 - Math.max(1, Math.round(tileSize * 0.03));

  if (image) {
    drawRoundedRectPath(ctx, x, y, size, size, Math.max(4, Math.round(size * 0.18)));
    ctx.save();
    ctx.clip();
    ctx.drawImage(image, x, y, size, size);
    ctx.restore();
    ctx.strokeStyle = "rgba(138, 106, 42, 0.96)";
    ctx.lineWidth = 1;
    drawRoundedRectPath(ctx, x, y, size, size, Math.max(4, Math.round(size * 0.18)));
    ctx.stroke();
    return;
  }

  drawCenterGlyph(ctx, ENTITY_ICONS.opportunity, left, top, tileSize, "#f2d58c");
}

function drawNameplate(
  ctx: CanvasRenderingContext2D,
  label: string,
  type: SceneRenderableEntity["type"] | null,
  left: number,
  top: number,
  tileSize: number,
  height: number,
) {
  const displayLabel = label.trim();
  if (!displayLabel) {
    return;
  }

  const width = Math.min(tileSize - 4, Math.max(28, tileSize * 0.86));
  const x = left + (tileSize - width) / 2;
  const y = top + tileSize - height - 2;
  const background = type === "npc"
    ? "rgba(64, 42, 16, 0.86)"
    : type === "player" || type === "self"
      ? "rgba(27, 41, 74, 0.82)"
      : "rgba(22, 24, 38, 0.78)";
  const color = type === "npc"
    ? "#f3d7a6"
    : type === "player" || type === "self"
      ? "#cfe0ff"
      : "#b0b7cb";

  ctx.save();
  drawRoundedRectPath(ctx, x, y, width, height, Math.max(4, height / 2));
  ctx.fillStyle = background;
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = `${type === "npc" ? 700 : 500} ${Math.max(8, Math.min(11, Math.round(tileSize * 0.18)))}px "Segoe UI", "PingFang SC", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(displayLabel, x + width / 2, y + height / 2, width - 6);
  ctx.restore();
}

function resolveTileIcon(tileType: string) {
  return TILE_ICONS[tileType] || TILE_ICON_FALLBACKS[tileType] || "";
}

function resolveCellVisual(params: {
  cell: Pick<VisibleCell, "isPortalTile" | "entitiesHere">;
}): ResolvedVisual {
  const visual: ResolvedVisual = {
    mode: "icon",
    icon: "",
    entityLabel: "",
    entityLabelType: null,
    avatarImageUrl: null,
    avatarFrameImageUrl: null,
    avatarFallbackText: "我",
    avatarFallbackColor: "#d4defe",
    avatarFallbackFontWeight: 600,
    avatarBorderColor: "#3b4c75",
    avatarBackground: "rgba(20, 27, 46, 0.9)",
    opportunityIconImageUrl: null,
  };

  if (params.cell.isPortalTile) {
    return visual;
  }

  const entity = params.cell.entitiesHere
    .slice()
    .sort((a, b) => getEntityPriority(b) - getEntityPriority(a))[0];
  if (!entity) {
    return visual;
  }

  visual.entityLabel = resolveEntityDisplayName(entity);
  visual.entityLabelType = entity.type;

  if (entity.type === "self") {
    visual.mode = "avatar";
    visual.avatarImageUrl = entity.avatarImageUrl || null;
    visual.avatarFrameImageUrl = entity.avatarFrameImageUrl || null;
    visual.avatarFallbackText = resolveEntityDisplayName(entity).slice(0, 1);
    visual.avatarBorderColor = "#6b5a2f";
    visual.avatarBackground = "rgba(201, 168, 76, 0.16)";
    return visual;
  }

  if (entity.type === "player" || entity.type === "npc") {
    visual.mode = "avatar";
    visual.avatarImageUrl = entity.avatarImageUrl || null;
    visual.avatarFrameImageUrl = entity.type === "player" ? (entity.avatarFrameImageUrl || null) : null;
    visual.avatarFallbackText = resolveEntityDisplayName(entity).slice(0, 1);
    if (entity.type === "npc") {
      visual.avatarFallbackColor = "#f3d7a6";
      visual.avatarFallbackFontWeight = 700;
      visual.avatarBorderColor = "#8a6a2a";
      visual.avatarBackground = "rgba(66, 46, 20, 0.9)";
    }
    return visual;
  }

  if (entity.type === "monster" && entity.avatarImageUrl) {
    visual.mode = "avatar";
    visual.avatarImageUrl = entity.avatarImageUrl;
    visual.avatarFallbackText = resolveEntityDisplayName(entity).slice(0, 1);
    visual.avatarFallbackColor = "#ffd3c7";
    visual.avatarFallbackFontWeight = 700;
    visual.avatarBorderColor = entity.subType === "boss" ? "#9b4b42" : entity.subType === "elite" ? "#7a5fbe" : "#8d4545";
    visual.avatarBackground = entity.subType === "boss"
      ? "rgba(95, 28, 28, 0.9)"
      : entity.subType === "elite"
        ? "rgba(60, 35, 92, 0.9)"
        : "rgba(68, 24, 24, 0.88)";
    return visual;
  }

  if (entity.type === "opportunity") {
    visual.mode = "opportunity";
    visual.opportunityIconImageUrl = entity.iconImageUrl || null;
    visual.icon = ENTITY_ICONS.opportunity;
    return visual;
  }

  visual.mode = "icon";
  visual.icon = entity.subType === "boss"
    ? ENTITY_ICONS.boss
    : entity.subType === "elite"
      ? ENTITY_ICONS.elite
      : ENTITY_ICONS[entity.type] || "位";
  return visual;
}

function resolveSceneEntityVisual(entity: SceneRenderableEntity) {
  return resolveCellVisual({
    cell: {
      isPortalTile: false,
      entitiesHere: [entity],
    },
  });
}

function getCellDescription(cell: VisibleCell) {
  if (cell.isVoid) {
    return `虚无边界 (${cell.x}, ${cell.y}) · 地图之外，无法移动`;
  }

  if (cell.fogLevel === "hidden") {
    return cell.remembered
      ? `迷雾 (${cell.x}, ${cell.y}) · 已记忆地形`
      : `迷雾 (${cell.x}, ${cell.y}) · 未探索区域`;
  }
  const parts = [
    `地块 (${cell.x}, ${cell.y})`,
    TILE_LABELS[cell.tileType] || cell.tileType,
  ];

  if (cell.tileDescription?.trim()) {
    parts.push(cell.tileDescription.trim());
  }

  if (cell.isPortalTile) {
    parts.push(cell.portalName?.trim() || "传送阵");
    if (cell.portalTargetName?.trim()) {
      parts.push(`可前往 ${cell.portalTargetName.trim()}`);
    }
  }

  if (cell.isPlayer) {
    parts.push("你当前所在位置");
  }

  if (cell.visual.entityLabel) {
    parts.push(cell.visual.entityLabel);
  }

  if (cell.fogLevel === "shallow") {
    parts.push("视野受限");
  }

  if (!cell.tileWalkable) {
    parts.push("不可通行");
  } else if (cell.canMove) {
    parts.push("点击即可移动");
  }

  return parts.join(" · ");
}

function getLoadedImageFromCache(
  cache: Map<string, ImageCacheEntry>,
  url?: string | null,
) {
  if (!url) {
    return null;
  }
  const cached = cache.get(url);
  return cached?.status === "loaded" ? cached.image : null;
}

function collectSceneAssetUrls(snapshot?: MapSceneSnapshot | null) {
  const urls = new Set<string>();
  (snapshot?.entities ?? []).forEach((entity) => {
    if ((isMapScenePlayerEntity(entity) || isMapSceneNpcEntity(entity) || isMapSceneMonsterEntity(entity)) && entity.avatarImageUrl) {
      urls.add(entity.avatarImageUrl);
    }
    if ("avatarFrameImageUrl" in entity && entity.avatarFrameImageUrl) {
      urls.add(entity.avatarFrameImageUrl);
    }
    if ("iconImageUrl" in entity && entity.iconImageUrl) {
      urls.add(entity.iconImageUrl);
    }
  });
  return Array.from(urls);
}

function drawTerrainLayer(params: {
  ctx: CanvasRenderingContext2D;
  dpr: number;
  layout: LayoutMetrics;
  visibleCells: VisibleCell[];
  width: number;
  height: number;
  viewport: ViewportWindow;
  backgroundImage: HTMLImageElement | null;
  imageCache: Map<string, ImageCacheEntry>;
}) {
  const {
    ctx,
    dpr,
    layout,
    visibleCells,
    width,
    height,
    viewport,
    backgroundImage,
    imageCache,
  } = params;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, Math.round(layout.outerWidth * dpr), Math.round(layout.outerHeight * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawPanelBackground(ctx, layout.outerWidth, layout.outerHeight);
  drawMapAreaBackdrop(ctx, layout);

  ctx.save();
  drawRoundedRectPath(
    ctx,
    layout.mapLeft,
    layout.mapTop,
    layout.columns * layout.tileSize,
    layout.rows * layout.tileSize,
    10,
  );
  ctx.clip();

  visibleCells.forEach((cell) => {
    const left = layout.mapLeft + (cell.x - viewport.cameraOriginX) * layout.tileSize;
    const top = layout.mapTop + (cell.y - viewport.cameraOriginY) * layout.tileSize;
    drawTileBackground(ctx, backgroundImage, layout, cell, width, height, left, top);

    const tileDecorationImage = getLoadedImageFromCache(imageCache, cell.tileImageUrl);
    const shouldDrawTileDecoration = Boolean(tileDecorationImage) && (cell.fogLevel !== "hidden" || cell.remembered);
    if (shouldDrawTileDecoration) {
      drawTileDecorationImage(
        ctx,
        tileDecorationImage,
        left,
        top,
        layout.tileSize,
        cell.fogLevel === "hidden" ? 0.38 : cell.fogLevel === "shallow" ? 0.74 : 0.94,
      );
    }
  });

  ctx.restore();

  ctx.strokeStyle = "rgba(126, 139, 179, 0.3)";
  ctx.lineWidth = 1;
  drawRoundedRectPath(
    ctx,
    layout.mapLeft + 0.5,
    layout.mapTop + 0.5,
    layout.columns * layout.tileSize - 1,
    layout.rows * layout.tileSize - 1,
    10,
  );
  ctx.stroke();
}

function buildSceneEntities(params: {
  snapshot?: MapSceneSnapshot | null;
  previousSnapshot?: MapSceneSnapshot | null;
  renderTimeMs: number;
  selfRenderCorrection?: MapSceneSelfCorrection | null;
  npcs: NpcData[];
  monsters: MonsterData[];
}) {
  const dynamicEntities: SceneRenderableEntity[] = resolveMapSceneRenderEntities({
    snapshot: params.snapshot,
    previousSnapshot: params.previousSnapshot,
    renderTimeMs: params.renderTimeMs,
    playerInterpolationDelayMs: MAP_REMOTE_PLAYER_INTERPOLATION_DELAY_MS,
    playerMaxExtrapolationMs: MAP_REMOTE_PLAYER_MAX_EXTRAPOLATION_MS,
    selfCorrection: params.selfRenderCorrection,
  }).map((entity): SceneRenderableEntity => {
    if (isMapScenePlayerEntity(entity)) {
      return {
        id: entity.id,
        name: resolveEntityDisplayName(entity),
        positionX: entity.positionX,
        positionY: entity.positionY,
        renderPositionX: entity.renderPositionX,
        renderPositionY: entity.renderPositionY,
        snappedRenderX: entity.snappedRenderX,
        snappedRenderY: entity.snappedRenderY,
        type: entity.entityType,
        avatarImageUrl: entity.avatarImageUrl || null,
        avatarFrameImageUrl: entity.avatarFrameImageUrl || null,
      };
    }

    if (isMapSceneOpportunityEntity(entity)) {
      return {
        id: entity.id,
        name: resolveEntityDisplayName(entity),
        positionX: entity.positionX,
        positionY: entity.positionY,
        renderPositionX: entity.renderPositionX,
        renderPositionY: entity.renderPositionY,
        snappedRenderX: entity.snappedRenderX,
        snappedRenderY: entity.snappedRenderY,
        type: "opportunity",
        iconImageUrl: entity.iconImageUrl || null,
      };
    }

    if (isMapSceneNpcEntity(entity)) {
      return {
        id: entity.id,
        name: resolveEntityDisplayName(entity),
        positionX: entity.positionX,
        positionY: entity.positionY,
        renderPositionX: entity.renderPositionX,
        renderPositionY: entity.renderPositionY,
        snappedRenderX: entity.snappedRenderX,
        snappedRenderY: entity.snappedRenderY,
        type: "npc",
        avatarImageUrl: entity.avatarImageUrl || null,
      };
    }

    if (isMapSceneMonsterEntity(entity)) {
      return {
        id: entity.id,
        name: resolveEntityDisplayName(entity),
        positionX: entity.positionX,
        positionY: entity.positionY,
        renderPositionX: entity.renderPositionX,
        renderPositionY: entity.renderPositionY,
        snappedRenderX: entity.snappedRenderX,
        snappedRenderY: entity.snappedRenderY,
        type: "monster",
        avatarImageUrl: entity.avatarImageUrl || null,
        subType: entity.monsterType,
      };
    }

    throw new Error("未知的地图场景实体");
  });
  const dynamicNpcIdSet = new Set(
    dynamicEntities
      .filter((entity) => entity.type === "npc")
      .map((entity) => entity.id),
  );
  const dynamicMonsterIdSet = new Set(
    dynamicEntities
      .filter((entity) => entity.type === "monster")
      .map((entity) => entity.id),
  );

  const staticEntities: SceneRenderableEntity[] = [
    ...params.npcs
      .filter((npc) => !dynamicNpcIdSet.has(npc.id))
      .map((npc) => ({
        id: npc.id,
        name: resolveEntityDisplayName({ name: npc.name, type: "npc" }),
        positionX: npc.positionX,
        positionY: npc.positionY,
        renderPositionX: npc.positionX,
        renderPositionY: npc.positionY,
        snappedRenderX: snapToGridCoordinate(npc.positionX),
        snappedRenderY: snapToGridCoordinate(npc.positionY),
        type: "npc" as const,
        avatarImageUrl: npc.avatarImageUrl || null,
      })),
    ...params.monsters
      .filter((monster) => !dynamicMonsterIdSet.has(monster.id))
      .map((monster) => ({
        id: monster.id,
        name: resolveEntityDisplayName({ name: monster.name, type: "monster" }),
        positionX: monster.positionX,
        positionY: monster.positionY,
        renderPositionX: monster.positionX,
        renderPositionY: monster.positionY,
        snappedRenderX: snapToGridCoordinate(monster.positionX),
        snappedRenderY: snapToGridCoordinate(monster.positionY),
        type: "monster" as const,
        avatarImageUrl: monster.avatarImageUrl || null,
        subType: monster.monsterType,
      })),
  ];

  return [...staticEntities, ...dynamicEntities];
}

function MapGrid({
  mapId,
  tiles,
  width,
  height,
  mapType,
  backgroundImageUrl,
  sceneSnapshot,
  previousSceneSnapshot,
  selfRenderCorrection,
  npcs,
  monsters,
  onTileClick,
  onCellClick,
  viewSize = 7,
  maxMoveDistance,
  spiritualSense = 0,
  allowPlayerMove = true,
  maxDisplayHeight,
}: MapGridProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticLayerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCacheRef = useRef<Map<string, ImageCacheEntry>>(new Map());
  const hoveredCellKeyRef = useRef<string | null>(null);
  const pendingHoverCellKeyRef = useRef<string | null>(null);
  const hoverFrameRef = useRef<number | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [hoveredCellKey, setHoveredCellKey] = useState<string | null>(null);
  const [pressedCellKey, setPressedCellKey] = useState<string | null>(null);
  const [rememberedCellKeys, setRememberedCellKeys] = useState<Set<string>>(new Set());
  const [imageVersion, setImageVersion] = useState(0);
  const [renderClockMs, setRenderClockMs] = useState(() => Date.now());
  const [supportsHoverPreview, setSupportsHoverPreview] = useState(() => (
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(hover: hover) and (pointer: fine)").matches
  ));

  useEffect(() => {
    hoveredCellKeyRef.current = hoveredCellKey;
  }, [hoveredCellKey]);

  const shouldAnimateScene = useMemo(() => {
    const correctionActive = isMapSceneSelfCorrectionActive(selfRenderCorrection, renderClockMs);
    if (correctionActive) {
      return true;
    }
    if (!sceneSnapshot) {
      return false;
    }
    const hasRenderableVelocity = sceneSnapshot.entities.some((entity) => (
      Math.abs(entity.velocityXPerSecond || 0) > 0.001
      || Math.abs(entity.velocityYPerSecond || 0) > 0.001
    ));
    if (!hasRenderableVelocity) {
      return false;
    }
    return renderClockMs - sceneSnapshot.serverTimeMs <= 220;
  }, [renderClockMs, sceneSnapshot, selfRenderCorrection]);

  const shouldAnimateCanvasEffects = shouldAnimateScene
    || Boolean(hoveredCellKey)
    || Boolean(pressedCellKey);

  useEffect(() => {
    if (!shouldAnimateCanvasEffects) {
      return;
    }
    let animationFrameId = 0;
    let lastPaintAt = 0;
    const minFrameGap = shouldAnimateScene ? 33 : 66;
    const tick = (now: number) => {
      if (now - lastPaintAt >= minFrameGap) {
        lastPaintAt = now;
        setRenderClockMs(now);
      }
      animationFrameId = window.requestAnimationFrame(tick);
    };
    animationFrameId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [
    hoveredCellKey,
    pressedCellKey,
    sceneSnapshot?.sequence,
    selfRenderCorrection?.startedAtMs,
    shouldAnimateCanvasEffects,
    shouldAnimateScene,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setSupportsHoverPreview(mediaQuery.matches);
    sync();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", sync);
      return () => mediaQuery.removeEventListener("change", sync);
    }

    mediaQuery.addListener(sync);
    return () => mediaQuery.removeListener(sync);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;
    const frameId = window.requestAnimationFrame(() => {
      if (cancelled) {
        return;
      }

      try {
        const raw = window.localStorage.getItem(buildFogMemoryStorageKey(mapId));
        if (!raw) {
          setRememberedCellKeys(new Set());
          return;
        }

        const parsed = JSON.parse(raw) as unknown;
        const rememberedKeys = Array.isArray(parsed)
          ? parsed.map((item) => String(item || "").trim()).filter(Boolean)
          : [];
        setRememberedCellKeys(new Set(rememberedKeys));
      } catch {
        setRememberedCellKeys(new Set());
      }
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [mapId]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.max(260, Math.round(element.clientWidth || DEFAULT_PANEL_WIDTH));
      setContainerWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    updateWidth();

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const normalizedBackgroundImageUrl = typeof backgroundImageUrl === "string" && backgroundImageUrl.trim()
    ? backgroundImageUrl.trim()
    : "";

  const sceneEntities = useMemo(() => buildSceneEntities({
    snapshot: sceneSnapshot,
    previousSnapshot: previousSceneSnapshot,
    renderTimeMs: renderClockMs,
    selfRenderCorrection,
    npcs,
    monsters,
  }), [monsters, npcs, previousSceneSnapshot, renderClockMs, sceneSnapshot, selfRenderCorrection]);

  const tileMap = useMemo(() => {
    const map = new Map<string, TileData>();
    (Array.isArray(tiles) ? tiles : []).forEach((tile) => {
      map.set(`${tile.x},${tile.y}`, tile);
    });
    return map;
  }, [tiles]);

  const selfEntity = useMemo(() => (
    sceneEntities.find((entity): entity is SceneRenderableEntity & { type: "self" } => entity.type === "self") || null
  ), [sceneEntities]);

  const playerRenderX = selfEntity?.renderPositionX ?? 0;
  const playerRenderY = selfEntity?.renderPositionY ?? 0;
  const playerX = selfEntity?.snappedRenderX ?? 0;
  const playerY = selfEntity?.snappedRenderY ?? 0;

  const viewport = useMemo(() => createViewportWindow({
    width,
    height,
    playerX: playerRenderX,
    playerY: playerRenderY,
    viewSize,
  }), [height, playerRenderX, playerRenderY, viewSize, width]);
  const visionProfile = useMemo(() => resolveMapVisionProfile(spiritualSense), [spiritualSense]);

  const entityMap = useMemo(() => {
    const map = new Map<string, SceneRenderableEntity[]>();
    sceneEntities.forEach((entity) => {
      const key = `${entity.snappedRenderX},${entity.snappedRenderY}`;
      const current = map.get(key) || [];
      current.push(entity);
      map.set(key, current);
    });
    return map;
  }, [sceneEntities]);

  const baseVisibleCells = useMemo(() => {
    const cells: VisibleCell[] = [];
    for (let y = viewport.startY; y <= viewport.endY; y += 1) {
      for (let x = viewport.startX; x <= viewport.endX; x += 1) {
        const isVoid = x < 0 || x >= width || y < 0 || y >= height;
        const tile = isVoid ? null : (tileMap.get(`${x},${y}`) || null);
        const tileType = isVoid ? "void" : (tile?.type ?? getDefaultTileType(mapType));
        const tileWalkable = isVoid ? false : (tile?.walkable ?? getDefaultWalkable());
        const entitiesHere = isVoid ? [] : (entityMap.get(`${x},${y}`) || []);
        const isPlayer = x === playerX && y === playerY;
        const isPortalTile = !isVoid && tileType === "portal";

        const dx = x - playerX;
        const dy = y - playerY;
        const moveDistance = Math.max(Math.abs(dx), Math.abs(dy));
        const fogLevel = isVoid
          ? "clear"
          : resolveMapFogLevel({
            deltaX: dx,
            deltaY: dy,
            profile: visionProfile,
          });
        const visibleEntitiesHere = filterEntitiesByFogLevel(entitiesHere, fogLevel);
        const canMove = allowPlayerMove
          && !isVoid
          && tileWalkable
          && !isPlayer
          && (typeof maxMoveDistance !== "number" || moveDistance <= maxMoveDistance)
          && fogLevel !== "hidden";

        cells.push({
          x,
          y,
          tileType,
          tileWalkable,
          tileDescription: tile?.description,
          tileImageUrl: tile?.imageUrl,
          isPortalTile,
          portalName: tile?.portalName,
          portalTargetName: tile?.portalTargetName,
          isVoid,
          isPlayer,
          canMove,
          fogLevel,
          remembered: isVoid || fogLevel !== "hidden",
          entitiesHere: visibleEntitiesHere,
          visual: resolveCellVisual({
            cell: {
              isPortalTile,
              entitiesHere: visibleEntitiesHere,
            },
          }),
        });
      }
    }
    return cells;
  }, [
    allowPlayerMove,
    entityMap,
    height,
    mapType,
    maxMoveDistance,
    playerX,
    playerY,
    visionProfile,
    tileMap,
    viewport.endX,
    viewport.endY,
    viewport.startX,
    viewport.startY,
    width,
  ]);

  const visibleCells = useMemo(() => baseVisibleCells.map((cell) => {
    const cellKey = `${cell.x},${cell.y}`;
    return {
      ...cell,
      remembered: cell.remembered || rememberedCellKeys.has(cellKey),
    };
  }), [baseVisibleCells, rememberedCellKeys]);

  const visibleCellMap = useMemo(() => {
    const map = new Map<string, VisibleCell>();
    visibleCells.forEach((cell) => {
      map.set(`${cell.x},${cell.y}`, cell);
    });
    return map;
  }, [visibleCells]);

  const renderableSceneEntities = useMemo(() => {
    return sceneEntities
      .filter((entity) => {
        const hostCell = visibleCellMap.get(`${entity.snappedRenderX},${entity.snappedRenderY}`);
        if (!hostCell || hostCell.isVoid) {
          return false;
        }
        return filterEntitiesByFogLevel([entity], hostCell.fogLevel).length > 0;
      })
      .sort((left, right) => {
        if (left.renderPositionY !== right.renderPositionY) {
          return left.renderPositionY - right.renderPositionY;
        }
        return getEntityPriority(left) - getEntityPriority(right);
      })
      .map((entity) => ({
        entity,
        visual: resolveSceneEntityVisual(entity),
      }));
  }, [sceneEntities, visibleCellMap]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const needsUpdate = visibleCells.some((cell) => (
      !cell.isVoid && cell.fogLevel !== "hidden" && !rememberedCellKeys.has(`${cell.x},${cell.y}`)
    ));
    if (!needsUpdate) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      setRememberedCellKeys((current) => {
        const nextRememberedKeys = new Set(current);
        let changed = false;

        visibleCells.forEach((cell) => {
          if (cell.isVoid || cell.fogLevel === "hidden") {
            return;
          }

          const cellKey = `${cell.x},${cell.y}`;
          if (nextRememberedKeys.has(cellKey)) {
            return;
          }

          nextRememberedKeys.add(cellKey);
          changed = true;
        });

        if (!changed) {
          return current;
        }

        try {
          window.localStorage.setItem(
            buildFogMemoryStorageKey(mapId),
            JSON.stringify(Array.from(nextRememberedKeys)),
          );
        } catch {
          // Ignore localStorage quota or availability failures.
        }

        return nextRememberedKeys;
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [mapId, rememberedCellKeys, visibleCells]);

  const layout = useMemo(() => buildLayoutMetrics(viewport, containerWidth), [containerWidth, viewport]);
  const displayScale = useMemo(() => {
    const widthScale = containerWidth / Math.max(layout.outerWidth, 1);
    const heightScale = typeof maxDisplayHeight === "number" && Number.isFinite(maxDisplayHeight) && maxDisplayHeight > 0
      ? maxDisplayHeight / Math.max(layout.outerHeight, 1)
      : 1;
    return Math.min(1, widthScale, heightScale);
  }, [containerWidth, layout.outerHeight, layout.outerWidth, maxDisplayHeight]);
  const displayWidth = useMemo(() => Math.round(layout.outerWidth * displayScale), [displayScale, layout.outerWidth]);
  const displayHeight = useMemo(() => Math.round(layout.outerHeight * displayScale), [displayScale, layout.outerHeight]);
  const isHeightConstrainedLayout = typeof maxDisplayHeight === "number" && Number.isFinite(maxDisplayHeight) && maxDisplayHeight > 0;
  const sceneAssetUrls = useMemo(() => collectSceneAssetUrls(sceneSnapshot), [sceneSnapshot]);
  const visibleTileImageUrls = useMemo(() => {
    const urls = new Set<string>();
    visibleCells.forEach((cell) => {
      if (cell.tileImageUrl) {
        urls.add(cell.tileImageUrl);
      }
    });
    return Array.from(urls);
  }, [visibleCells]);

  const imageUrls = useMemo(() => {
    const urls = new Set<string>();
    if (normalizedBackgroundImageUrl) {
      urls.add(normalizedBackgroundImageUrl);
    }
    sceneAssetUrls.forEach((url) => urls.add(url));
    visibleTileImageUrls.forEach((url) => urls.add(url));
    return Array.from(urls);
  }, [normalizedBackgroundImageUrl, sceneAssetUrls, visibleTileImageUrls]);

  useEffect(() => {
    imageUrls.forEach((url) => {
      if (!url || imageCacheRef.current.has(url)) {
        return;
      }

      const image = new Image();
      imageCacheRef.current.set(url, { image, status: "loading" });
      image.onload = () => {
        const current = imageCacheRef.current.get(url);
        if (current) {
          current.status = "loaded";
        }
        setImageVersion((value) => value + 1);
      };
      image.onerror = () => {
        const current = imageCacheRef.current.get(url);
        if (current) {
          current.status = "error";
        }
        setImageVersion((value) => value + 1);
      };
      image.src = url;
    });
  }, [imageUrls]);

  useEffect(() => {
    const cachedCanvas = staticLayerCanvasRef.current
      || (typeof document === "undefined" ? null : document.createElement("canvas"));
    if (!cachedCanvas) {
      return;
    }
    staticLayerCanvasRef.current = cachedCanvas;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR);
    cachedCanvas.width = Math.round(layout.outerWidth * dpr);
    cachedCanvas.height = Math.round(layout.outerHeight * dpr);

    const ctx = cachedCanvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const backgroundImage = getLoadedImageFromCache(
      imageCacheRef.current,
      normalizedBackgroundImageUrl,
    );

    drawTerrainLayer({
      ctx,
      dpr,
      layout,
      visibleCells,
      width,
      height,
      viewport,
      backgroundImage,
      imageCache: imageCacheRef.current,
    });
  }, [
    height,
    imageVersion,
    layout,
    normalizedBackgroundImageUrl,
    visibleCells,
    viewport,
    width,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR);
    canvas.width = Math.round(layout.outerWidth * dpr);
    canvas.height = Math.round(layout.outerHeight * dpr);
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cachedTerrainCanvas = staticLayerCanvasRef.current;
    if (cachedTerrainCanvas) {
      ctx.drawImage(
        cachedTerrainCanvas,
        0,
        0,
        cachedTerrainCanvas.width,
        cachedTerrainCanvas.height,
        0,
        0,
        layout.outerWidth,
        layout.outerHeight,
      );
    } else {
      drawTerrainLayer({
        ctx,
        dpr,
        layout,
        visibleCells,
        width,
        height,
        viewport,
        backgroundImage: getLoadedImageFromCache(imageCacheRef.current, normalizedBackgroundImageUrl),
        imageCache: imageCacheRef.current,
      });
    }

    ctx.save();
    const canvasEffectPhase = (renderClockMs % 2400) / 2400;
    drawRoundedRectPath(
      ctx,
      layout.mapLeft,
      layout.mapTop,
      layout.columns * layout.tileSize,
      layout.rows * layout.tileSize,
      10,
    );
    ctx.clip();

    visibleCells.forEach((cell) => {
      const left = layout.mapLeft + (cell.x - viewport.cameraOriginX) * layout.tileSize;
      const top = layout.mapTop + (cell.y - viewport.cameraOriginY) * layout.tileSize;
      const cellKey = `${cell.x},${cell.y}`;
      const hovered = hoveredCellKey === cellKey;
      const pressed = pressedCellKey === cellKey;

      if (pressed) {
        ctx.fillStyle = cell.canMove
          ? "rgba(255, 224, 132, 0.2)"
          : "rgba(171, 185, 214, 0.14)";
        ctx.fillRect(left, top, layout.tileSize, layout.tileSize);
      }

      const tileDecorationImage = getLoadedImageFromCache(imageCacheRef.current, cell.tileImageUrl);
      const shouldDrawTileDecoration = Boolean(tileDecorationImage) && (cell.fogLevel !== "hidden" || cell.remembered);

      if ((cell.fogLevel !== "hidden" || cell.remembered) && cell.isPortalTile) {
        drawPortalMarker(ctx, left, top, layout.tileSize, {
          dimmed: cell.fogLevel === "hidden",
          active: cell.isPlayer,
          hovered,
          pressed,
        });
      } else if (cell.isVoid) {
        drawCenterGlyph(ctx, "虚", left, top, layout.tileSize, "rgba(146, 162, 207, 0.42)");
      } else if (cell.fogLevel !== "hidden" && !shouldDrawTileDecoration) {
        const icon = resolveTileIcon(cell.tileType);
        const iconColor = cell.tileType === "water"
          ? "#b9d8ff"
          : "#e8e0d0";
        drawCenterGlyph(ctx, icon, left, top, layout.tileSize, iconColor);
      }

      drawFogOverlay(ctx, left, top, layout.tileSize, cell.fogLevel, cell.remembered);

      if (cell.canMove || hovered || pressed) {
        drawTileInteractionAccent(ctx, left, top, layout.tileSize, {
          canMove: cell.canMove,
          hovered,
          pressed,
          phase: canvasEffectPhase,
        });
      }

      drawTileBorder(ctx, cell, left, top, layout.tileSize, hovered, pressed);
    });

    renderableSceneEntities.forEach(({ entity, visual }) => {
      const left = layout.mapLeft + (entity.renderPositionX - viewport.cameraOriginX) * layout.tileSize;
      const top = layout.mapTop + (entity.renderPositionY - viewport.cameraOriginY) * layout.tileSize;

      if (entity.type === "self") {
        drawSelfPresencePulse(ctx, left, top, layout.tileSize, canvasEffectPhase);
      }

      if (visual.mode === "avatar") {
        drawAvatar(
          ctx,
          getLoadedImageFromCache(imageCacheRef.current, visual.avatarImageUrl),
          getLoadedImageFromCache(imageCacheRef.current, visual.avatarFrameImageUrl),
          left,
          top,
          layout.tileSize,
          layout.avatarSize,
          {
            fallbackText: visual.avatarFallbackText,
            fallbackColor: visual.avatarFallbackColor,
            fallbackFontWeight: visual.avatarFallbackFontWeight,
            borderColor: visual.avatarBorderColor,
            background: visual.avatarBackground,
          },
        );
      } else if (visual.mode === "opportunity") {
        drawOpportunity(
          ctx,
          getLoadedImageFromCache(imageCacheRef.current, visual.opportunityIconImageUrl),
          left,
          top,
          layout.tileSize,
        );
      } else {
        const iconColor = entity.type === "monster"
          ? "#f2c7c7"
          : entity.type === "npc"
            ? "#f3d7a6"
            : "#e8e0d0";
        drawCenterGlyph(ctx, visual.icon, left, top, layout.tileSize, iconColor);
      }

      if (visual.entityLabel && entity.type !== "self" && layout.tileSize >= 32) {
        drawNameplate(
          ctx,
          visual.entityLabel,
          visual.entityLabelType,
          left,
          top,
          layout.tileSize,
          layout.nameplateHeight,
        );
      }
    });

    ctx.restore();

    ctx.strokeStyle = "rgba(126, 139, 179, 0.3)";
    ctx.lineWidth = 1;
    drawRoundedRectPath(
      ctx,
      layout.mapLeft + 0.5,
      layout.mapTop + 0.5,
      layout.columns * layout.tileSize - 1,
      layout.rows * layout.tileSize - 1,
      10,
    );
    ctx.stroke();
  }, [
    displayHeight,
    displayWidth,
    height,
    hoveredCellKey,
    imageVersion,
    layout,
    normalizedBackgroundImageUrl,
    pressedCellKey,
    renderClockMs,
    renderableSceneEntities,
    visibleCells,
    viewport,
    width,
  ]);

  const pickCellAtClientPoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const scaleX = layout.outerWidth / rect.width;
    const scaleY = layout.outerHeight / rect.height;
    const localX = (clientX - rect.left) * scaleX;
    const localY = (clientY - rect.top) * scaleY;
    const mapRight = layout.mapLeft + layout.columns * layout.tileSize;
    const mapBottom = layout.mapTop + layout.rows * layout.tileSize;
    if (
      localX < layout.mapLeft
      || localY < layout.mapTop
      || localX >= mapRight
      || localY >= mapBottom
    ) {
      return null;
    }

    const x = Math.floor(viewport.cameraOriginX + (localX - layout.mapLeft) / layout.tileSize);
    const y = Math.floor(viewport.cameraOriginY + (localY - layout.mapTop) / layout.tileSize);
    return visibleCellMap.get(`${x},${y}`) || null;
  };

  const hoveredCell = hoveredCellKey ? (visibleCellMap.get(hoveredCellKey) || null) : null;
  const activeDescription = hoveredCell
    ? getCellDescription(hoveredCell)
    : `当前位置（${playerX}, ${playerY}），请选择一个地块`;

  const flushHoveredCellKey = (nextKey: string | null) => {
    if (hoveredCellKeyRef.current === nextKey) {
      return;
    }
    hoveredCellKeyRef.current = nextKey;
    setHoveredCellKey(nextKey);
  };

  const flushPressedCellKey = (nextKey: string | null) => {
    setPressedCellKey((current) => (current === nextKey ? current : nextKey));
  };

  const scheduleHoveredCellKey = (nextKey: string | null) => {
    pendingHoverCellKeyRef.current = nextKey;
    if (hoverFrameRef.current !== null) {
      return;
    }

    hoverFrameRef.current = window.requestAnimationFrame(() => {
      hoverFrameRef.current = null;
      flushHoveredCellKey(pendingHoverCellKeyRef.current);
    });
  };

  useEffect(() => (
    () => {
      if (hoverFrameRef.current !== null) {
        window.cancelAnimationFrame(hoverFrameRef.current);
        hoverFrameRef.current = null;
      }
      activePointerIdRef.current = null;
    }
  ), []);

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: isHeightConstrainedLayout ? 6 : 8,
        width: "100%",
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={(event) => {
          if (!event.isPrimary) {
            return;
          }

          activePointerIdRef.current = event.pointerId;
          const nextCell = pickCellAtClientPoint(event.clientX, event.clientY);
          const nextKey = nextCell ? `${nextCell.x},${nextCell.y}` : null;
          flushPressedCellKey(nextKey);
          flushHoveredCellKey(nextKey);

          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Ignore browsers that do not support pointer capture reliably.
          }
        }}
        onPointerMove={(event) => {
          if (!supportsHoverPreview) {
            return;
          }
          const nextCell = pickCellAtClientPoint(event.clientX, event.clientY);
          const nextKey = nextCell ? `${nextCell.x},${nextCell.y}` : null;
          scheduleHoveredCellKey(nextKey);
        }}
        onPointerUp={(event) => {
          const nextCell = pickCellAtClientPoint(event.clientX, event.clientY);
          const nextKey = nextCell ? `${nextCell.x},${nextCell.y}` : null;

          if (activePointerIdRef.current === event.pointerId) {
            activePointerIdRef.current = null;
            try {
              event.currentTarget.releasePointerCapture(event.pointerId);
            } catch {
              // Ignore browsers that do not support pointer capture reliably.
            }
          }

          flushPressedCellKey(null);
          flushHoveredCellKey(nextKey);

          if (!nextCell || nextCell.isVoid || nextCell.fogLevel === "hidden") {
            return;
          }

          const handled = onCellClick?.({
            x: nextCell.x,
            y: nextCell.y,
            tileType: nextCell.tileType,
            tileWalkable: nextCell.tileWalkable,
            tileDescription: nextCell.tileDescription,
            isPortalTile: nextCell.isPortalTile,
            isVoid: nextCell.isVoid,
            canMove: nextCell.canMove,
            fogLevel: nextCell.fogLevel,
          });

          if (handled === true) {
            return;
          }

          if (!nextCell.canMove) {
            return;
          }

          onTileClick(nextCell.x, nextCell.y);
        }}
        onPointerCancel={() => {
          activePointerIdRef.current = null;
          flushPressedCellKey(null);
        }}
        onPointerLeave={() => {
          pendingHoverCellKeyRef.current = null;
          if (hoverFrameRef.current !== null) {
            window.cancelAnimationFrame(hoverFrameRef.current);
            hoverFrameRef.current = null;
          }
          if (activePointerIdRef.current === null) {
            flushPressedCellKey(null);
          }
          flushHoveredCellKey(null);
        }}
        style={{
          display: "block",
          width: `${displayWidth}px`,
          height: `${displayHeight}px`,
          maxWidth: "100%",
          borderRadius: 14,
          border: "1px solid rgba(113, 128, 170, 0.56)",
          background: "radial-gradient(circle at top center, rgba(201, 168, 76, 0.08), transparent 28%), linear-gradient(180deg, rgba(17, 21, 35, 0.98), rgba(8, 11, 21, 0.99))",
          boxShadow: "inset 0 1px 0 rgba(214, 223, 255, 0.08), inset 0 0 0 1px rgba(60, 74, 111, 0.34), 0 12px 28px rgba(4, 7, 16, 0.22)",
          cursor: hoveredCell?.canMove ? "pointer" : "default",
          touchAction: "manipulation",
        }}
        aria-label="地图网格"
      />
      <div
        style={{
          width: "min(100%, 520px)",
          minHeight: isHeightConstrainedLayout ? 28 : 32,
          padding: isHeightConstrainedLayout ? "6px 10px" : "7px 12px",
          borderRadius: 12,
          border: hoveredCell?.canMove
            ? "1px solid rgba(168, 132, 58, 0.72)"
            : "1px solid rgba(72, 86, 128, 0.82)",
          background: hoveredCell?.canMove
            ? "radial-gradient(circle at left center, rgba(201, 168, 76, 0.12), transparent 34%), linear-gradient(180deg, rgba(29, 25, 18, 0.96), rgba(14, 14, 20, 0.96))"
            : "linear-gradient(180deg, rgba(16, 21, 37, 0.94), rgba(9, 12, 22, 0.96))",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 18px rgba(4, 7, 16, 0.14)",
          color: hoveredCell?.canMove ? "#f1d48b" : "#b0bddc",
          fontSize: isHeightConstrainedLayout ? 11 : 12,
          lineHeight: isHeightConstrainedLayout ? 1.4 : 1.5,
          letterSpacing: "0.01em",
        }}
      >
        {activeDescription}
      </div>
      <div
        style={{
          display: "none",
          width: "min(100%, 520px)",
          padding: "8px 10px",
          borderRadius: 8,
          border: "1px solid rgba(62, 70, 96, 0.7)",
          background: "rgba(8, 10, 18, 0.88)",
          gap: 6,
          justifyItems: "center",
        }}
      >
        <div style={{ color: "#8f98b3", fontSize: 11 }}>
          地图概览
        </div>
        <canvas
          ref={overviewCanvasRef}
          style={{
            display: "block",
            maxWidth: "100%",
            imageRendering: "pixelated",
            borderRadius: 4,
            border: "1px solid rgba(104, 118, 160, 0.35)",
            background: "rgba(6, 9, 15, 0.92)",
          }}
          aria-label="地图概览"
        />
        <div style={{ color: "#6f7a95", fontSize: 11, textAlign: "center" }}>
          概览仅显示当前可见地形与附近单位。</div>
      </div>
    </div>
  );
}

export default memo(MapGrid);

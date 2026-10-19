"use client";

import { useEffect, useMemo, useRef } from "react";
import type { RealtimeInputAck, WorldMapAoiEntity } from "@immortality/shared-protocol";
import type { MapSceneSnapshot } from "@/modules/map/services/map-scene-state";
import {
  resolveMapSceneRenderEntities,
  type MapSceneSelfCorrection,
} from "@/modules/map/services/map-scene-render-state";

type PhaserGameLike = {
  destroy(removeCanvas?: boolean): void;
};

type PhaserGraphicsLike = {
  clear(): void;
  lineStyle(width: number, color: number, alpha?: number): PhaserGraphicsLike;
  strokeRect(x: number, y: number, width: number, height: number): PhaserGraphicsLike;
  strokeCircle(x: number, y: number, radius: number): PhaserGraphicsLike;
  fillStyle(color: number, alpha?: number): PhaserGraphicsLike;
  fillRect(x: number, y: number, width: number, height: number): PhaserGraphicsLike;
  fillCircle(x: number, y: number, radius: number): PhaserGraphicsLike;
};

type PhaserTextLike = {
  setText(value: string): void;
  setPosition(x: number, y: number): void;
};

type PhaserSceneLike = {
  add: {
    graphics(): PhaserGraphicsLike;
    text(x: number, y: number, value: string, style?: Record<string, unknown>): PhaserTextLike;
  };
  input: {
    on(eventName: string, handler: (pointer: PhaserPointerLike) => void): void;
  };
  scale: {
    width: number;
    height: number;
  };
};

type PhaserPointerLike = {
  id?: number;
  x: number;
  y: number;
  isDown?: boolean;
};

type PhaserModuleLike = {
  AUTO: number;
  Scale: {
    RESIZE: string | number;
  };
  Game: new(config: Record<string, unknown>) => PhaserGameLike;
};

export type WorldMapPhaserEntity = Pick<WorldMapAoiEntity, "id" | "kind" | "name" | "x" | "y">;

export interface WorldMapPhaserSceneProps {
  mapId: string;
  width: number;
  height: number;
  player: {
    positionX: number;
    positionY: number;
  };
  sceneSnapshot: MapSceneSnapshot | null;
  previousSceneSnapshot?: MapSceneSnapshot | null;
  selfRenderCorrection?: MapSceneSelfCorrection | null;
  entities: WorldMapPhaserEntity[];
  connectionStatus?: "idle" | "sdk_unavailable" | "connecting" | "reconnecting" | "connected" | "error";
  weakNetwork?: boolean;
  lastAck?: RealtimeInputAck | null;
  onTileClick(x: number, y: number): void;
  onRepair?(): void;
}

type WorldMapPhaserRenderState = Pick<
  WorldMapPhaserSceneProps,
  "mapId" | "width" | "height" | "player" | "sceneSnapshot" | "onTileClick"
> & {
  previousSceneSnapshot?: MapSceneSnapshot | null;
  selfRenderCorrection?: MapSceneSelfCorrection | null;
  entities: WorldMapPhaserEntity[];
  connectionStatus?: WorldMapPhaserSceneProps["connectionStatus"];
  weakNetwork?: boolean;
  lastAck?: RealtimeInputAck | null;
  onRepair?: () => void;
};

type WorldMapPhaserRenderStateRef = {
  current: WorldMapPhaserRenderState;
};

type WorldMapPhaserRenderEntity = {
  id: string;
  kind: string;
  name: string;
  x: number;
  y: number;
  isSelf?: boolean;
};

type WorldMapPhaserLayout = {
  sceneWidth: number;
  sceneHeight: number;
  tileSize: number;
  originX: number;
  originY: number;
  joystickCenterX: number;
  joystickCenterY: number;
  joystickRadius: number;
};

type WorldMapJoystickState = {
  active: boolean;
  pointerId: number | null;
  dx: number;
  dy: number;
  lastMoveAt: number;
};

function resolveEntityColor(kind: string) {
  if (kind === "self") return 0x63d5ff;
  if (kind === "player") return 0x63d5ff;
  if (kind === "npc") return 0xf4d35e;
  if (kind === "monster") return 0xff6b6b;
  if (kind === "opportunity") return 0x80ed99;
  if (kind === "portal") return 0xb388ff;
  if (kind === "secret_realm") return 0xff9f1c;
  return 0xd8dee9;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolveLayout(params: {
  scene: PhaserSceneLike;
  host: HTMLDivElement;
  state: WorldMapPhaserRenderState;
}): WorldMapPhaserLayout {
  const sceneWidth = Math.max(1, params.scene.scale.width || params.host.clientWidth || 320);
  const sceneHeight = Math.max(1, params.scene.scale.height || params.host.clientHeight || 320);
  const tileSize = Math.max(8, Math.floor(Math.min(sceneWidth / params.state.width, sceneHeight / params.state.height)));
  const originX = Math.floor((sceneWidth - tileSize * params.state.width) / 2);
  const originY = Math.floor((sceneHeight - tileSize * params.state.height) / 2);
  const joystickRadius = clamp(Math.floor(Math.min(sceneWidth, sceneHeight) * 0.11), 34, 52);

  return {
    sceneWidth,
    sceneHeight,
    tileSize,
    originX,
    originY,
    joystickCenterX: 18 + joystickRadius,
    joystickCenterY: sceneHeight - 18 - joystickRadius,
    joystickRadius,
  };
}

function screenToTile(params: {
  pointer: PhaserPointerLike;
  layout: WorldMapPhaserLayout;
  state: WorldMapPhaserRenderState;
}) {
  const x = Math.floor((params.pointer.x - params.layout.originX) / params.layout.tileSize);
  const y = Math.floor((params.pointer.y - params.layout.originY) / params.layout.tileSize);
  if (x < 0 || y < 0 || x >= params.state.width || y >= params.state.height) {
    return null;
  }
  return { x, y };
}

function resolveRenderableEntities(state: WorldMapPhaserRenderState): WorldMapPhaserRenderEntity[] {
  if (state.sceneSnapshot) {
    return resolveMapSceneRenderEntities({
      snapshot: state.sceneSnapshot,
      previousSnapshot: state.previousSceneSnapshot,
      renderTimeMs: Date.now(),
      selfCorrection: state.selfRenderCorrection,
    }).map((entity) => ({
      id: entity.id,
      kind: entity.entityType,
      name: entity.name || entity.id,
      x: entity.renderPositionX,
      y: entity.renderPositionY,
      isSelf: entity.entityType === "self",
    }));
  }

  return [
    ...state.entities.map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      name: entity.name || entity.id,
      x: entity.x,
      y: entity.y,
      isSelf: false,
    })),
    {
      id: "self",
      kind: "self",
      name: "self",
      x: state.player.positionX,
      y: state.player.positionY,
      isSelf: true,
    },
  ];
}

function drawJoystick(params: {
  graphics: PhaserGraphicsLike | null;
  layout: WorldMapPhaserLayout;
  joystick: WorldMapJoystickState;
}) {
  const { graphics, layout, joystick } = params;
  const handleMaxDistance = layout.joystickRadius * 0.62;
  const magnitude = Math.hypot(joystick.dx, joystick.dy);
  const normalized = magnitude > 0
    ? Math.min(handleMaxDistance, magnitude) / magnitude
    : 0;
  const handleX = layout.joystickCenterX + joystick.dx * normalized;
  const handleY = layout.joystickCenterY + joystick.dy * normalized;

  graphics?.lineStyle(2, 0xd8dee9, joystick.active ? 0.78 : 0.42)
    .strokeCircle(layout.joystickCenterX, layout.joystickCenterY, layout.joystickRadius);
  graphics?.fillStyle(0x1f2937, joystick.active ? 0.42 : 0.24)
    .fillCircle(layout.joystickCenterX, layout.joystickCenterY, layout.joystickRadius);
  graphics?.fillStyle(0x63d5ff, joystick.active ? 0.92 : 0.58)
    .fillCircle(handleX, handleY, Math.max(12, layout.joystickRadius * 0.34));
}

function isPointerInJoystick(pointer: PhaserPointerLike, layout: WorldMapPhaserLayout) {
  return Math.hypot(pointer.x - layout.joystickCenterX, pointer.y - layout.joystickCenterY)
    <= layout.joystickRadius * 1.35;
}

function updateJoystickVector(params: {
  joystick: WorldMapJoystickState;
  pointer: PhaserPointerLike;
  layout: WorldMapPhaserLayout;
}) {
  const maxDistance = params.layout.joystickRadius;
  const rawDx = params.pointer.x - params.layout.joystickCenterX;
  const rawDy = params.pointer.y - params.layout.joystickCenterY;
  const magnitude = Math.hypot(rawDx, rawDy);
  const scale = magnitude > maxDistance && magnitude > 0 ? maxDistance / magnitude : 1;
  params.joystick.dx = rawDx * scale;
  params.joystick.dy = rawDy * scale;
}

function maybeSendJoystickMove(params: {
  joystick: WorldMapJoystickState;
  state: WorldMapPhaserRenderState;
  nowMs: number;
}) {
  if (!params.joystick.active || params.nowMs - params.joystick.lastMoveAt < 260) {
    return;
  }

  const magnitude = Math.hypot(params.joystick.dx, params.joystick.dy);
  if (magnitude < 14) {
    return;
  }

  const normalizedX = params.joystick.dx / magnitude;
  const normalizedY = params.joystick.dy / magnitude;
  const stepX = Math.abs(normalizedX) > 0.38 ? Math.sign(normalizedX) : 0;
  const stepY = Math.abs(normalizedY) > 0.38 ? Math.sign(normalizedY) : 0;
  if (stepX === 0 && stepY === 0) {
    return;
  }

  params.joystick.lastMoveAt = params.nowMs;
  params.state.onTileClick(
    clamp(params.state.player.positionX + stepX, 0, params.state.width - 1),
    clamp(params.state.player.positionY + stepY, 0, params.state.height - 1),
  );
}

function resolvePhaserStatusColor(state: WorldMapPhaserRenderState) {
  if (state.connectionStatus === "connected" && !state.weakNetwork) {
    return 0x80ed99;
  }
  if (state.connectionStatus === "reconnecting" || state.weakNetwork) {
    return 0xffc857;
  }
  if (state.connectionStatus === "error") {
    return 0xff6b6b;
  }
  return 0x94a3b8;
}

function renderWorldMapPhaserScene(params: {
  scene: PhaserSceneLike;
  host: HTMLDivElement;
  state: WorldMapPhaserRenderState;
  graphics: PhaserGraphicsLike | null;
  titleText: PhaserTextLike | null;
  joystick: WorldMapJoystickState;
}) {
  const {
    scene,
    host,
    state,
    graphics,
    titleText,
    joystick,
  } = params;
  const layout = resolveLayout({ scene, host, state });
  const renderEntities = resolveRenderableEntities(state);
  graphics?.clear();
  graphics?.fillStyle(0x111827, 1).fillRect(0, 0, layout.sceneWidth, layout.sceneHeight);
  graphics?.lineStyle(1, 0x374151, 0.72);

  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      graphics?.strokeRect(
        layout.originX + x * layout.tileSize,
        layout.originY + y * layout.tileSize,
        layout.tileSize,
        layout.tileSize,
      );
    }
  }

  for (const entity of renderEntities.filter((item) => !item.isSelf)) {
    const centerX = layout.originX + entity.x * layout.tileSize + layout.tileSize / 2;
    const centerY = layout.originY + entity.y * layout.tileSize + layout.tileSize / 2;
    graphics?.fillStyle(resolveEntityColor(entity.kind), 0.9)
      .fillCircle(centerX, centerY, Math.max(3, layout.tileSize * 0.28));
  }

  const selfEntity = renderEntities.find((entity) => entity.isSelf);
  const selfX = selfEntity?.x ?? state.player.positionX;
  const selfY = selfEntity?.y ?? state.player.positionY;
  graphics?.fillStyle(resolveEntityColor("player"), 1)
    .fillCircle(
      layout.originX + selfX * layout.tileSize + layout.tileSize / 2,
      layout.originY + selfY * layout.tileSize + layout.tileSize / 2,
      Math.max(4, layout.tileSize * 0.34),
    );

  if (state.selfRenderCorrection || state.lastAck?.accepted === false) {
    graphics?.lineStyle(2, 0xffc857, 0.8)
      .strokeCircle(
        layout.originX + selfX * layout.tileSize + layout.tileSize / 2,
        layout.originY + selfY * layout.tileSize + layout.tileSize / 2,
        Math.max(8, layout.tileSize * 0.48),
      );
  }

  graphics?.fillStyle(resolvePhaserStatusColor(state), 0.95)
    .fillCircle(layout.sceneWidth - 18, 18, 6);
  drawJoystick({ graphics, layout, joystick });

  titleText?.setText(`${state.sceneSnapshot?.tick ?? 0}`);
  titleText?.setPosition(10, 8);
}

function createWorldMapPhaserGameConfig(params: {
  Phaser: PhaserModuleLike;
  host: HTMLDivElement;
  renderStateRef: WorldMapPhaserRenderStateRef;
}) {
  let graphics: PhaserGraphicsLike | null = null;
  let titleText: PhaserTextLike | null = null;
  const joystick: WorldMapJoystickState = {
    active: false,
    pointerId: null,
    dx: 0,
    dy: 0,
    lastMoveAt: 0,
  };

  const render = (scene: PhaserSceneLike) => {
    renderWorldMapPhaserScene({
      scene,
      host: params.host,
      state: params.renderStateRef.current,
      graphics,
      titleText,
      joystick,
    });
  };

  return {
    type: params.Phaser.AUTO,
    parent: params.host,
    backgroundColor: "#111827",
    scale: {
      mode: params.Phaser.Scale.RESIZE,
      width: params.host.clientWidth || 360,
      height: params.host.clientHeight || 420,
    },
    scene: {
      create(this: PhaserSceneLike) {
        graphics = this.add.graphics();
        titleText = this.add.text(10, 8, "", {
          color: "#f8fafc",
          fontFamily: "sans-serif",
          fontSize: "12px",
        });
        this.input.on("pointerdown", (pointer) => {
          const state = params.renderStateRef.current;
          const layout = resolveLayout({ scene: this, host: params.host, state });
          if (isPointerInJoystick(pointer, layout)) {
            joystick.active = true;
            joystick.pointerId = pointer.id ?? 0;
            updateJoystickVector({ joystick, pointer, layout });
            maybeSendJoystickMove({ joystick, state, nowMs: Date.now() });
            return;
          }

          if (
            pointer.x >= layout.sceneWidth - 42
            && pointer.y <= 42
            && state.onRepair
            && (state.weakNetwork || state.connectionStatus === "reconnecting" || state.connectionStatus === "error")
          ) {
            state.onRepair();
            return;
          }

          const tile = screenToTile({ pointer, layout, state });
          if (tile) {
            state.onTileClick(tile.x, tile.y);
          }
        });
        this.input.on("pointermove", (pointer) => {
          if (!joystick.active || joystick.pointerId !== (pointer.id ?? 0)) {
            return;
          }
          const state = params.renderStateRef.current;
          const layout = resolveLayout({ scene: this, host: params.host, state });
          updateJoystickVector({ joystick, pointer, layout });
          maybeSendJoystickMove({ joystick, state, nowMs: Date.now() });
        });
        this.input.on("pointerup", (pointer) => {
          if (joystick.pointerId !== null && joystick.pointerId !== (pointer.id ?? 0)) {
            return;
          }
          joystick.active = false;
          joystick.pointerId = null;
          joystick.dx = 0;
          joystick.dy = 0;
        });
        this.input.on("pointerupoutside", () => {
          joystick.active = false;
          joystick.pointerId = null;
          joystick.dx = 0;
          joystick.dy = 0;
        });
        render(this);
      },
      update(this: PhaserSceneLike) {
        maybeSendJoystickMove({
          joystick,
          state: params.renderStateRef.current,
          nowMs: Date.now(),
        });
        render(this);
      },
    },
  };
}

export default function WorldMapPhaserScene({
  mapId,
  width,
  height,
  player,
  sceneSnapshot,
  previousSceneSnapshot,
  selfRenderCorrection,
  entities,
  connectionStatus,
  weakNetwork,
  lastAck,
  onTileClick,
  onRepair,
}: WorldMapPhaserSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<PhaserGameLike | null>(null);
  const renderStateRef = useRef({
    mapId,
    width,
    height,
    player,
    sceneSnapshot,
    previousSceneSnapshot,
    selfRenderCorrection,
    entities,
    connectionStatus,
    weakNetwork,
    lastAck,
    onTileClick,
    onRepair,
  });

  const stableEntities = useMemo(() => entities.map((entity) => ({ ...entity })), [entities]);

  useEffect(() => {
    renderStateRef.current = {
      mapId,
      width,
      height,
      player,
      sceneSnapshot,
      previousSceneSnapshot,
      selfRenderCorrection,
      entities: stableEntities,
      connectionStatus,
      weakNetwork,
      lastAck,
      onTileClick,
      onRepair,
    };
  }, [
    mapId,
    width,
    height,
    player,
    sceneSnapshot,
    previousSceneSnapshot,
    selfRenderCorrection,
    stableEntities,
    connectionStatus,
    weakNetwork,
    lastAck,
    onTileClick,
    onRepair,
  ]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || gameRef.current) {
      return;
    }

    let disposed = false;

    void import("phaser").then((moduleValue) => {
      if (disposed || !hostRef.current) {
        return;
      }
      const Phaser = moduleValue as unknown as PhaserModuleLike;
      const config = createWorldMapPhaserGameConfig({
        Phaser,
        host: hostRef.current,
        renderStateRef,
      });
      gameRef.current = new Phaser.Game(config);
    });

    return () => {
      disposed = true;
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={hostRef}
      style={{
        width: "100%",
        aspectRatio: "1 / 1",
        minHeight: 320,
        maxHeight: "70vh",
        overflow: "hidden",
        borderRadius: 8,
        background: "#111827",
        touchAction: "none",
      }}
    />
  );
}

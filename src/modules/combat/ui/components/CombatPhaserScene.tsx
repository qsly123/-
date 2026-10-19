"use client";

import { useEffect, useMemo, useRef } from "react";
import type { CombatSceneEntity, CombatSceneEnvelope, RealtimeInputAck } from "@immortality/shared-protocol";

type PhaserGameLike = {
  destroy(removeCanvas?: boolean): void;
};

type PhaserGraphicsLike = {
  clear(): void;
  fillStyle(color: number, alpha?: number): PhaserGraphicsLike;
  fillRect(x: number, y: number, width: number, height: number): PhaserGraphicsLike;
  fillCircle(x: number, y: number, radius: number): PhaserGraphicsLike;
  lineStyle(width: number, color: number, alpha?: number): PhaserGraphicsLike;
  strokeCircle(x: number, y: number, radius: number): PhaserGraphicsLike;
  strokeRect(x: number, y: number, width: number, height: number): PhaserGraphicsLike;
};

type PhaserTextLike = {
  setText(value: string): void;
  setPosition(x: number, y: number): void;
};

type PhaserPointerLike = {
  x: number;
  y: number;
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

type PhaserModuleLike = {
  AUTO: number;
  Scale: {
    RESIZE: string | number;
  };
  Game: new(config: Record<string, unknown>) => PhaserGameLike;
};

export interface CombatPhaserFallbackUnit {
  id: string;
  name: string;
  role: "player" | "enemy" | "boss";
  isDead?: boolean;
}

export interface CombatPhaserSceneProps {
  snapshot: CombatSceneEnvelope | null;
  fallbackUnits: CombatPhaserFallbackUnit[];
  status: "idle" | "sdk_unavailable" | "connecting" | "reconnecting" | "connected" | "error";
  lastAck?: RealtimeInputAck | null;
  onMove?(x: number, y: number): void;
  onRepair?(): void;
}

type RenderState = CombatPhaserSceneProps;

type RenderStateRef = {
  current: RenderState;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function entityColor(entity: Pick<CombatSceneEntity, "id" | "kind">) {
  if (entity.id.includes("enemy") || entity.id.includes("boss")) {
    return 0xff6b6b;
  }
  if (entity.kind === "combatant") {
    return 0x63d5ff;
  }
  return 0xd8dee9;
}

function statusColor(state: RenderState) {
  if (state.status === "connected" && state.lastAck?.accepted !== false) {
    return 0x80ed99;
  }
  if (state.status === "reconnecting" || state.status === "connecting") {
    return 0xffc857;
  }
  if (state.status === "error" || state.lastAck?.accepted === false) {
    return 0xff6b6b;
  }
  return 0x94a3b8;
}

function fallbackEntities(units: CombatPhaserFallbackUnit[]): CombatSceneEntity[] {
  return units.map((unit, index) => {
    const isEnemy = unit.role === "enemy" || unit.role === "boss";
    return {
      id: unit.id,
      kind: "combatant",
      name: unit.name,
      x: isEnemy ? 52 : 42 + index * 8,
      y: isEnemy ? 24 : 76,
      velocityX: 0,
      velocityY: 0,
      updatedAt: 0,
    };
  });
}

function resolveEntities(state: RenderState) {
  return state.snapshot?.authoritativeState.entities?.length
    ? state.snapshot.authoritativeState.entities
    : fallbackEntities(state.fallbackUnits);
}

function drawCombatScene(params: {
  scene: PhaserSceneLike;
  host: HTMLDivElement;
  state: RenderState;
  graphics: PhaserGraphicsLike | null;
  label: PhaserTextLike | null;
}) {
  const width = Math.max(1, params.scene.scale.width || params.host.clientWidth || 360);
  const height = Math.max(1, params.scene.scale.height || params.host.clientHeight || 320);
  const entities = resolveEntities(params.state);

  params.graphics?.clear();
  params.graphics?.fillStyle(0x111827, 1).fillRect(0, 0, width, height);
  params.graphics?.lineStyle(1, 0x334155, 0.72).strokeRect(12, 12, width - 24, height - 24);
  params.graphics?.lineStyle(1, 0x475569, 0.36);
  for (let x = 20; x < width; x += Math.max(36, width / 8)) {
    params.graphics?.strokeRect(x, 20, 1, height - 40);
  }

  for (const entity of entities) {
    const x = clamp(entity.x, 0, 100) / 100 * width;
    const y = clamp(entity.y, 0, 100) / 100 * height;
    const radius = entity.id.includes("boss") ? 30 : 20;
    params.graphics?.fillStyle(entityColor(entity), 0.9).fillCircle(x, y, radius);
    params.graphics?.lineStyle(2, 0xf8fafc, entity.velocityX || entity.velocityY ? 0.66 : 0.22)
      .strokeCircle(x, y, radius + 5);
  }

  params.graphics?.fillStyle(statusColor(params.state), 0.95).fillCircle(width - 18, 18, 6);
  params.label?.setText(`${params.state.snapshot?.authoritativeState.mode || "combat"} · ${params.state.snapshot?.serverTick ?? 0}`);
  params.label?.setPosition(10, 8);
}

function createCombatPhaserGameConfig(params: {
  Phaser: PhaserModuleLike;
  host: HTMLDivElement;
  renderStateRef: RenderStateRef;
}) {
  let graphics: PhaserGraphicsLike | null = null;
  let label: PhaserTextLike | null = null;

  const render = (scene: PhaserSceneLike) => {
    drawCombatScene({
      scene,
      host: params.host,
      state: params.renderStateRef.current,
      graphics,
      label,
    });
  };

  return {
    type: params.Phaser.AUTO,
    parent: params.host,
    backgroundColor: "#111827",
    scale: {
      mode: params.Phaser.Scale.RESIZE,
      width: params.host.clientWidth || 360,
      height: params.host.clientHeight || 320,
    },
    scene: {
      create(this: PhaserSceneLike) {
        graphics = this.add.graphics();
        label = this.add.text(10, 8, "", {
          color: "#f8fafc",
          fontFamily: "sans-serif",
          fontSize: "12px",
        });
        this.input.on("pointerdown", (pointer) => {
          const state = params.renderStateRef.current;
          const width = Math.max(1, this.scale.width || params.host.clientWidth || 360);
          const height = Math.max(1, this.scale.height || params.host.clientHeight || 320);
          if (pointer.x >= width - 42 && pointer.y <= 42 && state.onRepair) {
            state.onRepair();
            return;
          }
          state.onMove?.(
            Math.round((clamp(pointer.x, 0, width) / width) * 100),
            Math.round((clamp(pointer.y, 0, height) / height) * 100),
          );
        });
        render(this);
      },
      update(this: PhaserSceneLike) {
        render(this);
      },
    },
  };
}

export default function CombatPhaserScene(props: CombatPhaserSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<PhaserGameLike | null>(null);
  const stableFallbackUnits = useMemo(
    () => props.fallbackUnits.map((unit) => ({ ...unit })),
    [props.fallbackUnits],
  );
  const renderStateRef = useRef<RenderState>({
    ...props,
    fallbackUnits: stableFallbackUnits,
  });

  useEffect(() => {
    renderStateRef.current = {
      ...props,
      fallbackUnits: stableFallbackUnits,
    };
  }, [props, stableFallbackUnits]);

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
      gameRef.current = new Phaser.Game(createCombatPhaserGameConfig({
        Phaser,
        host: hostRef.current,
        renderStateRef,
      }));
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
        minHeight: 320,
        height: "min(58vh, 520px)",
        overflow: "hidden",
        borderRadius: 8,
        background: "#111827",
        touchAction: "none",
      }}
    />
  );
}

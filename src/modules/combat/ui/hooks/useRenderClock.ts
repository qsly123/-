"use client";

import { useEffect, useRef, useState } from "react";
import type { BattleSceneSnapshot } from "@/modules/combat/services/battle-scene-state";

type RenderClockSubscriber = (nowMs: number) => void;

type RenderClockStore = {
  activeTokens: Set<symbol>;
  subscribers: Set<RenderClockSubscriber>;
  nowMs: number;
  rafId: number | null;
  visibilityBound: boolean;
};

type RenderClockGlobal = typeof globalThis & {
  __combatRenderClockStore?: RenderClockStore;
};

function getRenderClockStore() {
  const globalStore = globalThis as RenderClockGlobal;
  if (!globalStore.__combatRenderClockStore) {
    globalStore.__combatRenderClockStore = {
      activeTokens: new Set<symbol>(),
      subscribers: new Set<RenderClockSubscriber>(),
      nowMs: Date.now(),
      rafId: null,
      visibilityBound: false,
    };
  }
  return globalStore.__combatRenderClockStore;
}

function canRunClock() {
  if (typeof document === "undefined") {
    return true;
  }
  return document.visibilityState === "visible";
}

function publishRenderClock(nowMs: number) {
  const store = getRenderClockStore();
  store.nowMs = nowMs;
  for (const subscriber of store.subscribers) {
    subscriber(nowMs);
  }
}

function stopRenderClockLoop() {
  const store = getRenderClockStore();
  if (store.rafId !== null) {
    window.cancelAnimationFrame(store.rafId);
    store.rafId = null;
  }
}

function startRenderClockLoop() {
  const store = getRenderClockStore();
  if (store.rafId !== null || store.activeTokens.size === 0 || !canRunClock()) {
    return;
  }

  const tick = () => {
    const currentStore = getRenderClockStore();
    if (currentStore.activeTokens.size === 0 || !canRunClock()) {
      stopRenderClockLoop();
      return;
    }

    publishRenderClock(Date.now());
    currentStore.rafId = window.requestAnimationFrame(tick);
  };

  publishRenderClock(Date.now());
  store.rafId = window.requestAnimationFrame(tick);
}

function ensureVisibilityListener() {
  const store = getRenderClockStore();
  if (store.visibilityBound || typeof document === "undefined") {
    return;
  }

  store.visibilityBound = true;
  document.addEventListener("visibilitychange", () => {
    if (canRunClock()) {
      startRenderClockLoop();
    } else {
      stopRenderClockLoop();
    }
  });
}

export function shouldAnimateBattleSceneSnapshot(snapshot?: BattleSceneSnapshot | null) {
  if (!snapshot) {
    return false;
  }

  if (hasActiveBattleSceneTimeline(snapshot)) {
    return true;
  }

  return snapshot.units.some((unit) => (
    Math.abs(unit.velocityXPercentPerSecond) > 0.01
    || Math.abs(unit.velocityYPercentPerSecond) > 0.01
  ));
}

export function hasActiveBattleSceneTimeline(
  snapshot?: BattleSceneSnapshot | null,
  nowMs = Date.now(),
) {
  if (!snapshot) {
    return false;
  }

  return (snapshot.timeline || []).some((event) => {
    const totalDuration = Math.max(0, event.windupMs + event.activeMs + event.recoverMs);
    return nowMs <= (event.startedAtMs + totalDuration + 48);
  });
}

export function useRenderClock(active: boolean) {
  const [nowMs, setNowMs] = useState(() => getRenderClockStore().nowMs);
  const tokenRef = useRef<symbol | null>(null);

  if (!tokenRef.current) {
    tokenRef.current = Symbol("combat-render-clock");
  }

  useEffect(() => {
    ensureVisibilityListener();
    const store = getRenderClockStore();
    const subscriber: RenderClockSubscriber = (nextNowMs) => {
      setNowMs(nextNowMs);
    };
    store.subscribers.add(subscriber);

    return () => {
      store.subscribers.delete(subscriber);
    };
  }, []);

  useEffect(() => {
    const store = getRenderClockStore();
    const token = tokenRef.current;
    if (!token) {
      return;
    }

    if (active) {
      store.activeTokens.add(token);
      startRenderClockLoop();
    } else {
      store.activeTokens.delete(token);
      if (store.activeTokens.size === 0) {
        stopRenderClockLoop();
      }
    }

    return () => {
      store.activeTokens.delete(token);
      if (store.activeTokens.size === 0) {
        stopRenderClockLoop();
      }
    };
  }, [active]);

  return nowMs;
}

"use client";

export type ClientRuntimeKind = "web" | "pwa" | "capacitor";

type MaybeCapacitor = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

function getCapacitorBridge(): MaybeCapacitor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const maybeWindow = window as typeof window & {
    Capacitor?: MaybeCapacitor;
  };

  return maybeWindow.Capacitor || null;
}

export function isCapacitorRuntime(): boolean {
  const bridge = getCapacitorBridge();
  if (!bridge) {
    return false;
  }

  if (typeof bridge.isNativePlatform === "function") {
    return bridge.isNativePlatform();
  }

  const platform = typeof bridge.getPlatform === "function" ? bridge.getPlatform() : "";
  return platform === "ios" || platform === "android";
}

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const mediaStandalone = typeof window.matchMedia === "function"
    ? window.matchMedia("(display-mode: standalone)").matches
    : false;

  const navigatorStandalone = typeof navigator !== "undefined"
    ? Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
    : false;

  return mediaStandalone || navigatorStandalone;
}

export function getClientRuntimeKind(): ClientRuntimeKind {
  if (isCapacitorRuntime()) {
    return "capacitor";
  }

  if (isStandaloneDisplayMode()) {
    return "pwa";
  }

  return "web";
}

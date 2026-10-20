"use client";

import { useEffect } from "react";
import { bootstrapManagedAssetSync } from "@/modules/shared/services/capacitor-asset-sync";
import { getClientRuntimeKind } from "@/modules/shared/services/client-runtime";

function applyRuntimeDocumentState() {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  const runtime = getClientRuntimeKind();
  const viewport = window.visualViewport;
  // 移动浏览器在自动缩放/旋转的瞬间会把视口高度报得偏大，直接采用会把页面撑长。
  // 取三者最小值钳制：键盘弹出时 visualViewport.height 变小仍正常生效（min 逻辑保留它）。
  const rawHeight = Math.round(viewport?.height || window.innerHeight);
  const innerHeight = Math.round(window.innerHeight || rawHeight);
  const docHeight = document.documentElement.clientHeight || innerHeight;
  const viewportHeight = `${Math.max(120, Math.min(rawHeight, innerHeight, docHeight))}px`;
  const viewportWidth = `${Math.round(viewport?.width || window.innerWidth)}px`;

  document.documentElement.dataset.runtime = runtime;
  document.body.dataset.runtime = runtime;
  document.documentElement.style.setProperty("--app-height", viewportHeight);
  document.documentElement.style.setProperty("--app-width", viewportWidth);
}

export default function ClientRuntimeBoot() {
  useEffect(() => {
    applyRuntimeDocumentState();
    void bootstrapManagedAssetSync();

    const updateLayoutMetrics = () => {
      applyRuntimeDocumentState();
    };
    const syncAssetsOnForeground = () => {
      void bootstrapManagedAssetSync();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void bootstrapManagedAssetSync();
      }
    };

    const handleOrientationChange = () => {
      updateLayoutMetrics();
      window.setTimeout(updateLayoutMetrics, 250);
    };

    window.addEventListener("resize", updateLayoutMetrics);
    window.visualViewport?.addEventListener("resize", updateLayoutMetrics);
    window.visualViewport?.addEventListener("scroll", updateLayoutMetrics);
    window.addEventListener("orientationchange", handleOrientationChange);
    window.addEventListener("focus", syncAssetsOnForeground);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("resize", updateLayoutMetrics);
      window.visualViewport?.removeEventListener("resize", updateLayoutMetrics);
      window.visualViewport?.removeEventListener("scroll", updateLayoutMetrics);
      window.removeEventListener("orientationchange", handleOrientationChange);
      window.removeEventListener("focus", syncAssetsOnForeground);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}

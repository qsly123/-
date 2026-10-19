"use client";

import { useEffect, useRef } from "react";
import type { RealtimeRepairTrigger } from "@immortality/shared-protocol";

/**
 * 前后台恢复统一 repair 触发器。
 *
 * 背景：iOS 锁屏 / 切后台时浏览器会冻结或断开 WebSocket，回到前台时客户端手上的
 * 地图 / 战斗 / 聊天 presence 状态全部是旧值。如果不同步发一次权威 repair，界面
 * 就会显示"我已在线、附近还有这些道友"，但服务端早就把它踢掉了 —— 也就是假在线。
 *
 * 实现约束：
 * - 不区分 iOS / Android，统一监听 `visibilitychange / pageshow / focus / online`，
 *   由浏览器自行决定哪些事件会触发，禁止按 UA 或平台分叉主流程。
 * - 多个事件几乎同一时刻触发，必须合并成一次 repair，避免三连发。
 * - `visibilitychange` 归到 `visibility_restore`，`focus / pageshow` 归到
 *   `foreground_restore`，`online` 归到 `reconnect`，便于真机日志检索。
 */

export const DEFAULT_REPAIR_MIN_INTERVAL_MS = 800;

export interface UseForegroundRepairTriggerParams {
  enabled?: boolean;
  onRepair: (trigger: RealtimeRepairTrigger, source: string) => void;
  /** 两次 repair 之间的最小间隔，防止 focus / pageshow / visibilitychange 抖动刷屏。 */
  minIntervalMs?: number;
}

export function isDocumentVisible() {
  if (typeof document === "undefined") {
    return true;
  }
  return document.visibilityState !== "hidden";
}

export function useForegroundRepairTrigger(params: UseForegroundRepairTriggerParams) {
  const enabled = params.enabled ?? true;
  const minIntervalMs = params.minIntervalMs ?? DEFAULT_REPAIR_MIN_INTERVAL_MS;
  const onRepairRef = useRef(params.onRepair);

  useEffect(() => {
    onRepairRef.current = params.onRepair;
  }, [params.onRepair]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    let lastRunAt = 0;

    const schedule = (trigger: RealtimeRepairTrigger, source: string) => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      const now = Date.now();
      if (lastRunAt > 0 && now - lastRunAt < minIntervalMs) {
        return;
      }
      lastRunAt = now;
      onRepairRef.current(trigger, source);
    };

    const handleVisibilityChange = () => {
      schedule("visibility_restore", "visibilitychange");
    };
    const handleFocus = () => {
      schedule("foreground_restore", "focus");
    };
    const handlePageShow = () => {
      schedule("foreground_restore", "pageshow");
    };
    const handleOnline = () => {
      schedule("reconnect", "online");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("online", handleOnline);
    };
  }, [enabled, minIntervalMs]);
}

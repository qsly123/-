"use client";

import { useEffect, useRef, useState } from "react";

type ElementSize = {
  width: number;
  height: number;
};

const INITIAL_SIZE = {
  width: 0,
  height: 0,
} satisfies ElementSize;

export function useObservedElementSize<T extends HTMLElement>() {
  const elementRef = useRef<T | null>(null);
  const [size, setSize] = useState<ElementSize>(INITIAL_SIZE);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    let frameId: number | null = null;
    let probeTimer: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const applyMeasuredSize = () => {
      const rect = element.getBoundingClientRect();
      const nextSize = {
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      } satisfies ElementSize;
      setSize((current) => (
        current.width === nextSize.width && current.height === nextSize.height
          ? current
          : nextSize
      ));

      if (nextSize.width > 0 && nextSize.height > 0 && probeTimer !== null) {
        window.clearInterval(probeTimer);
        probeTimer = null;
      }
    };

    const scheduleMeasure = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        applyMeasuredSize();
      });
    };

    const handleVisibilityChange = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        scheduleMeasure();
      }
    };

    scheduleMeasure();

    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(() => {
        scheduleMeasure();
      });
      resizeObserver.observe(element);
    }

    probeTimer = window.setInterval(() => {
      applyMeasuredSize();
    }, 250);

    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("orientationchange", scheduleMeasure);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      if (probeTimer !== null) {
        window.clearInterval(probeTimer);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("orientationchange", scheduleMeasure);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, []);

  return {
    elementRef,
    size,
  };
}

"use client";

import { useEffect, useSyncExternalStore } from "react";
import { rewriteLegacyCosmeticUrl } from "@/modules/shared/services/cosmetic-url";
import {
  ensureManagedAssetRegistryLoaded,
  resolveManagedAssetUrl,
  subscribeManagedAssetRegistry,
} from "@/modules/shared/services/capacitor-asset-sync";

export function useResolvedAssetUrl(src?: string | null) {
  const normalizedSrc = rewriteLegacyCosmeticUrl(src);
  const resolvedSrc = useSyncExternalStore(
    subscribeManagedAssetRegistry,
    () => resolveManagedAssetUrl(normalizedSrc),
    () => normalizedSrc,
  );

  useEffect(() => {
    void ensureManagedAssetRegistryLoaded();
  }, []);

  return resolvedSrc;
}

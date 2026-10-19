import { cleanupExpiredSecretRealmInstances } from "@/modules/map/services/secret-realm-instance-service";
import { scheduleAiItemAutoCleanup } from "@/modules/admin/services/ai-item-auto-cleanup";

const SECRET_REALM_RUNTIME_CLEANUP_THROTTLE_MS = 60 * 1000;

type SecretRealmRuntimeMaintenanceGlobal = typeof globalThis & {
  __immortalitySecretRealmRuntimeCleanupPromise?: Promise<void> | null;
  __immortalitySecretRealmRuntimeCleanupLastRunAt?: number;
};

const runtimeMaintenanceGlobal = globalThis as SecretRealmRuntimeMaintenanceGlobal;

export async function ensureSecretRealmRuntimeCleanup() {
  const now = Date.now();
  const lastRunAt = runtimeMaintenanceGlobal.__immortalitySecretRealmRuntimeCleanupLastRunAt || 0;
  const inFlight = runtimeMaintenanceGlobal.__immortalitySecretRealmRuntimeCleanupPromise;

  if (inFlight) {
    await inFlight;
    return;
  }

  if (lastRunAt + SECRET_REALM_RUNTIME_CLEANUP_THROTTLE_MS > now) {
    return;
  }

  runtimeMaintenanceGlobal.__immortalitySecretRealmRuntimeCleanupLastRunAt = now;
  runtimeMaintenanceGlobal.__immortalitySecretRealmRuntimeCleanupPromise = (async () => {
    try {
      await cleanupExpiredSecretRealmInstances();
      void scheduleAiItemAutoCleanup({
        trigger: "secret_realm_runtime_cleanup",
      });
    } catch (error) {
      console.error("[secret-realm-runtime-cleanup] opportunistic cleanup failed:", error);
    } finally {
      runtimeMaintenanceGlobal.__immortalitySecretRealmRuntimeCleanupPromise = null;
    }
  })();

  await runtimeMaintenanceGlobal.__immortalitySecretRealmRuntimeCleanupPromise;
}

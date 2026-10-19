import { cleanupExpiredSecretRealmInstances } from "@/modules/map/services/secret-realm-instance-service";
import { runSecretRealmTick } from "@/modules/map/services/secret-realm-spawn-service";

/**
 * 秘境后台维护：过期实例回收 + 入口过期清理 / 全局入口补充刷新。
 *
 * 之前只依赖玩家请求 /api/game/map 时顺带触发，一旦入口被消耗，
 * 地图可能长时间没有任何秘境入口（玩家体感“进不去秘境”）。
 * 由 systemd timer（immortality-secret-realm-tick.timer）每 2 分钟调用一次。
 */
async function main() {
  const cleanupResult = await cleanupExpiredSecretRealmInstances();
  await runSecretRealmTick();
  console.log(JSON.stringify({
    executedAt: new Date().toISOString(),
    cleanupResult,
  }));
}

main().catch((error) => {
  console.error("[secret-realm-tick] failed", error);
  process.exit(1);
});

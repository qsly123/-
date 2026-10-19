import { cleanupExpiredSecretRealmInstances } from "@/modules/map/services/secret-realm-instance-service";

async function main() {
  const summary = await cleanupExpiredSecretRealmInstances();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[secret-realm-cleanup] failed", error);
  process.exit(1);
});

import { pruneFourRealmsLegacyData } from "./lib/four-realms-legacy-prune";

const EXECUTE_PRUNE = process.env.FOUR_REALMS_PRUNE === "1";
const ALLOW_PLAYERS = process.env.FOUR_REALMS_PRUNE_ALLOW_PLAYERS === "1";

async function main() {
  const summary = await pruneFourRealmsLegacyData({
    execute: EXECUTE_PRUNE,
    allowPlayers: ALLOW_PLAYERS,
  });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[four-realms] 旧数据清理失败", error);
  process.exit(1);
});

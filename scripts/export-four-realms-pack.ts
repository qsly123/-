import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { fourRealmsPack } from "../src/db/offline-packs/four-realms-pack";

async function main() {
  const outputPath = path.join(process.cwd(), "docs", "generated", "four-realms-offline-pack.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(fourRealmsPack, null, 2), "utf8");

  console.log(JSON.stringify({
    outputPath,
    questCount: fourRealmsPack.quests.length,
    fortuneCount: fourRealmsPack.fortunes.length,
    randomEventCount: fourRealmsPack.randomEvents.length,
    linearRealmCount: fourRealmsPack.metadata.linearRealmCount,
    itemCount: fourRealmsPack.items.length,
    monsterCount: fourRealmsPack.monsters.length,
    pillToxicityConfigCount: fourRealmsPack.pillToxicityConfigs.length,
    recipeCount: fourRealmsPack.alchemyRecipes.length + fourRealmsPack.smithingRecipes.length,
    spiritualFieldSeedCount: fourRealmsPack.spiritualFieldSeeds.length,
    hongmengTreasureConfigCount: fourRealmsPack.hongmengTreasureConfigs.length,
  }, null, 2));
}

main().catch((error) => {
  console.error("[four-realms] 导出失败", error);
  process.exit(1);
});

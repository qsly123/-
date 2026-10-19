import { access } from "node:fs/promises";
import path from "node:path";

import { fourRealmsPack } from "../src/db/offline-packs/four-realms-pack";

function fail(message: string): never {
  throw new Error(message);
}

function ensureUnique(values: string[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      fail(`${label} 存在重复值: ${value}`);
    }
    seen.add(value);
  }
}

async function ensureIconsExist() {
  for (const icon of fourRealmsPack.iconAssets) {
    if (icon.publicPath.startsWith("/uploads/cosmetics/")) {
      continue;
    }
    const publicIconPath = path.join(
      process.cwd(),
      "public",
      icon.publicPath.replace(/^\//, "").replaceAll("/", path.sep),
    );
    try {
      await access(publicIconPath);
    } catch {
      throw new Error(`离线包公开图标缺失: ${icon.publicPath} -> ${publicIconPath}`);
    }
  }
}

async function ensureSourceIconsExistWhenRequested() {
  if (process.env.FOUR_REALMS_VALIDATE_SOURCE_ASSETS !== "1") {
    return;
  }

  for (const icon of fourRealmsPack.iconAssets) {
    const sourceIconPath = path.join(process.cwd(), icon.sourcePath);
    try {
      await access(sourceIconPath);
    } catch {
      throw new Error(`离线包源图标缺失: ${icon.sourcePath} -> ${sourceIconPath}`);
    }
  }
}

async function ensureUploadedIconsExistWhenRequested() {
  if (process.env.FOUR_REALMS_VALIDATE_UPLOADED_ASSETS !== "1") {
    return;
  }

  const stagingRoot = path.join(process.cwd(), "lingxu", "uploads", "cosmetics");
  for (const icon of fourRealmsPack.iconAssets) {
    if (!icon.publicPath.startsWith("/uploads/cosmetics/")) {
      continue;
    }
    const stagedIconPath = path.join(
      stagingRoot,
      icon.publicPath.replace(/^\/uploads\/cosmetics\//, "").replaceAll("/", path.sep),
    );
    try {
      await access(stagedIconPath);
    } catch {
      throw new Error(`本地待上传图标缺失: ${icon.publicPath} -> ${stagedIconPath}`);
    }
  }
}

async function main() {
  const questIds = fourRealmsPack.quests.map((quest) => quest.id);
  const mapIds = new Set(fourRealmsPack.maps.map((map) => map.id));
  const npcIds = new Set(fourRealmsPack.npcs.map((npc) => npc.id));
  const itemIds = new Set(fourRealmsPack.items.map((item) => item.id));
  const skillIds = new Set(fourRealmsPack.skills.map((skill) => skill.id));
  const monsterIds = new Set(fourRealmsPack.monsters.map((monster) => monster.id));
  const fortuneIds = new Set(fourRealmsPack.fortunes.map((fortune) => fortune.id));
  const randomEventIds = fourRealmsPack.randomEvents.map((event) => event.id);
  const spiritualFieldSeedIds = fourRealmsPack.spiritualFieldSeeds.map((row) => row.seedItemId);
  const hongmengItemIds = fourRealmsPack.hongmengTreasureConfigs.map((row) => row.itemId);

  ensureUnique(questIds, "任务ID");
  ensureUnique([...mapIds], "地图ID");
  ensureUnique([...npcIds], "NPC ID");
  ensureUnique([...itemIds], "物品ID");
  ensureUnique([...skillIds], "技能ID");
  ensureUnique([...monsterIds], "怪物ID");
  ensureUnique([...fortuneIds], "气运ID");
  ensureUnique(randomEventIds, "随机事件ID");
  ensureUnique(spiritualFieldSeedIds, "灵田种子物品ID");
  ensureUnique(hongmengItemIds, "鸿蒙至宝物品ID");

  if (fourRealmsPack.quests.length !== 61) {
    fail(`主线数量不正确，期望 61，实际 ${fourRealmsPack.quests.length}`);
  }

  const realmStageCount = fourRealmsPack.realmMajors.reduce((sum, major) => sum + major.stages.length, 0);
  if (realmStageCount !== 44) {
    fail(`线性境界数量不正确，期望 44，实际 ${realmStageCount}`);
  }

  const questCountByPrefix = {
    lianqi: fourRealmsPack.quests.filter((quest) => quest.id.startsWith("quest_main_lianqi_")).length,
    zhuji: fourRealmsPack.quests.filter((quest) => quest.id.startsWith("quest_main_zhuji_")).length,
    jiedan: fourRealmsPack.quests.filter((quest) => quest.id.startsWith("quest_main_jiedan_")).length,
    yuanying: fourRealmsPack.quests.filter((quest) => quest.id.startsWith("quest_main_yuanying_")).length,
  };

  if (questCountByPrefix.lianqi !== 12 || questCountByPrefix.zhuji !== 14 || questCountByPrefix.jiedan !== 15 || questCountByPrefix.yuanying !== 20) {
    fail(`四境任务数量不匹配: ${JSON.stringify(questCountByPrefix)}`);
  }

  const stageXpList = fourRealmsPack.realmMajors.flatMap((major) => major.stages.map((stage) => stage.requiredXp));
  for (let index = 1; index < stageXpList.length; index += 1) {
    if (stageXpList[index] <= stageXpList[index - 1]) {
      fail(`requiredXp 未严格递增，位置 ${index} => ${stageXpList[index - 1]} / ${stageXpList[index]}`);
    }
  }

  for (const edge of fourRealmsPack.mapEdges) {
    if (!mapIds.has(edge.mapAId) || !mapIds.has(edge.mapBId)) {
      fail(`地图连线引用缺失: ${edge.mapAId} <-> ${edge.mapBId}`);
    }
  }

  for (const npc of fourRealmsPack.npcs) {
    if (!mapIds.has(npc.mapId)) {
      fail(`NPC ${npc.id} 指向未知地图 ${npc.mapId}`);
    }
    for (const shopItem of npc.shopItems) {
      if (!itemIds.has(shopItem.itemId)) {
        fail(`NPC ${npc.id} 商店引用未知物品 ${shopItem.itemId}`);
      }
    }
  }

  for (const item of fourRealmsPack.items) {
    const hasXpEffect = item.effects.some((effect) => effect.type === "boost_xp" && Number(effect.value || 0) > 0);
    if (hasXpEffect && Number(item.pillToxicity || 0) <= 0) {
      fail(`修为丹 ${item.id} 未配置有效丹毒值`);
    }
    if (!hasXpEffect && Number(item.pillToxicity || 0) !== 0) {
      fail(`非修为丹 ${item.id} 不应配置丹毒值`);
    }
    for (const effect of item.effects) {
      if ((effect.type === "learn_skill" || effect.type === "bind_skill") && typeof effect.skillId === "string" && effect.skillId.trim()) {
        if (!skillIds.has(effect.skillId.trim())) {
          fail(`物品 ${item.id} 引用了未知技能 ${effect.skillId}`);
        }
      }
    }
  }

  for (const map of fourRealmsPack.maps) {
    const seenTileKeys = new Set<string>();
    for (const tile of map.tilesData || []) {
      if (tile.x < 0 || tile.y < 0 || tile.x >= map.width || tile.y >= map.height) {
        fail(`地图 ${map.id} 的地块越界: (${tile.x}, ${tile.y})`);
      }
      const key = `${tile.x},${tile.y}`;
      if (seenTileKeys.has(key)) {
        fail(`地图 ${map.id} 的地块重复: ${key}`);
      }
      seenTileKeys.add(key);
    }
  }

  for (const seed of fourRealmsPack.spiritualFieldSeeds) {
    if (!itemIds.has(seed.seedItemId)) {
      fail(`灵田种子配置引用未知种子物品 ${seed.seedItemId}`);
    }
    if (!itemIds.has(seed.outputItemId)) {
      fail(`灵田种子配置引用未知产出物品 ${seed.outputItemId}`);
    }
    if (seed.minYield <= 0 || seed.maxYield < seed.minYield) {
      fail(`灵田种子配置产量异常: ${seed.seedItemId}`);
    }
  }

  for (const config of fourRealmsPack.hongmengTreasureConfigs) {
    if (!itemIds.has(config.itemId)) {
      fail(`鸿蒙至宝配置引用未知物品 ${config.itemId}`);
    }
    if (config.maxStar < 0) {
      fail(`鸿蒙至宝 ${config.itemId} 的 maxStar 非法`);
    }
    for (const starConfig of config.starConfigs) {
      if (starConfig.energyCap <= 0 || starConfig.regenSecondsPerEnergy <= 0) {
        fail(`鸿蒙至宝 ${config.itemId} 的星级配置非法`);
      }
    }
  }

  for (const skill of fourRealmsPack.skills) {
    const payload = skill.effects;
    if (payload && !Array.isArray(payload) && payload.visualEffect?.spriteUrl) {
      const spriteUrl = payload.visualEffect.spriteUrl;
      const hasIcon = fourRealmsPack.iconAssets.some((icon) => icon.publicPath === spriteUrl);
      if (!hasIcon) {
        fail(`技能 ${skill.id} 使用了未登记图标 ${spriteUrl}`);
      }
    }
  }

  for (const monster of fourRealmsPack.monsters) {
    if (Number(monster.xpReward || 0) !== 0) {
      fail(`怪物 ${monster.id} 的 xpReward 必须为 0`);
    }
    if (!mapIds.has(monster.mapId)) {
      fail(`怪物 ${monster.id} 指向未知地图 ${monster.mapId}`);
    }
    for (const skillId of monster.skills) {
      if (!skillIds.has(skillId)) {
        fail(`怪物 ${monster.id} 引用了未知技能 ${skillId}`);
      }
    }
    for (const drop of monster.drops) {
      if (!itemIds.has(drop.itemId)) {
        fail(`怪物 ${monster.id} 引用了未知掉落 ${drop.itemId}`);
      }
    }
  }

  for (const quest of fourRealmsPack.quests) {
    if (Number(quest.rewards.xp || 0) !== 0) {
      fail(`任务 ${quest.id} 的奖励修为必须为 0`);
    }
    if (!npcIds.has(quest.acceptNpcId) || !npcIds.has(quest.completeNpcId)) {
      fail(`任务 ${quest.id} 的接取/提交 NPC 不存在`);
    }
    for (const requirement of quest.requirements) {
      if (requirement.type === "kill" && !monsterIds.has(requirement.targetId)) {
        fail(`任务 ${quest.id} 引用了未知怪物 ${requirement.targetId}`);
      }
      if (requirement.type === "collect" && !itemIds.has(requirement.targetId)) {
        fail(`任务 ${quest.id} 引用了未知物品 ${requirement.targetId}`);
      }
      if (requirement.type === "talk" && !npcIds.has(requirement.targetId)) {
        fail(`任务 ${quest.id} 引用了未知 NPC ${requirement.targetId}`);
      }
    }
    for (const rewardItem of quest.rewards.items || []) {
      if (!itemIds.has(rewardItem.itemId)) {
        fail(`任务 ${quest.id} 奖励引用未知物品 ${rewardItem.itemId}`);
      }
    }
    for (const rewardFortuneId of quest.rewards.fortuneIds || []) {
      if (!fortuneIds.has(rewardFortuneId)) {
        fail(`任务 ${quest.id} 奖励引用未知气运 ${rewardFortuneId}`);
      }
    }
    for (const removeFortuneId of quest.rewards.removeFortuneIds || []) {
      if (!fortuneIds.has(removeFortuneId)) {
        fail(`任务 ${quest.id} 移除未知气运 ${removeFortuneId}`);
      }
    }
    for (const prerequisite of quest.prerequisites) {
      if (!questIds.includes(prerequisite)) {
        fail(`任务 ${quest.id} 的前置任务不存在: ${prerequisite}`);
      }
    }
  }

  const starterFortunes = fourRealmsPack.fortunes.filter((fortune) => fortune.isStarter);
  if (starterFortunes.length < 10) {
    fail(`开局气运数量过少，至少应提供 10 条，实际 ${starterFortunes.length}`);
  }

  for (const fortune of fourRealmsPack.fortunes) {
    if (fortune.isStarter && fortune.starterWeight <= 0) {
      fail(`开局气运 ${fortune.id} 的 starterWeight 必须大于 0`);
    }
    if (!fortune.isStarter && fortune.starterWeight !== 0) {
      fail(`非开局气运 ${fortune.id} 的 starterWeight 必须为 0`);
    }
  }

  for (const event of fourRealmsPack.randomEvents) {
    if (Number(event.rewards.xp || 0) !== 0) {
      fail(`随机事件 ${event.id} 的奖励修为必须为 0`);
    }
    const scopedMapIds = Array.isArray(event.mapIds) ? event.mapIds : [];
    for (const mapId of scopedMapIds) {
      if (!mapIds.has(mapId)) {
        fail(`随机事件 ${event.id} 引用了未知地图 ${mapId}`);
      }
    }
    for (const rewardItem of event.rewards.items || []) {
      if (!itemIds.has(rewardItem.itemId)) {
        fail(`随机事件 ${event.id} 奖励引用未知物品 ${rewardItem.itemId}`);
      }
    }
    for (const rewardFortuneId of event.rewards.fortuneIds || []) {
      if (!fortuneIds.has(rewardFortuneId)) {
        fail(`随机事件 ${event.id} 奖励引用未知气运 ${rewardFortuneId}`);
      }
    }
    for (const removeFortuneId of event.rewards.removeFortuneIds || []) {
      if (!fortuneIds.has(removeFortuneId)) {
        fail(`随机事件 ${event.id} 移除未知气运 ${removeFortuneId}`);
      }
    }
    for (const condition of event.judgeConditions?.fortuneConditions || []) {
      if (!fortuneIds.has(condition.fortuneId)) {
        fail(`随机事件 ${event.id} 判定引用未知气运 ${condition.fortuneId}`);
      }
    }
  }

  const defaultPillToxicityConfig = fourRealmsPack.pillToxicityConfigs.find((config) => config.key === "default");
  if (!defaultPillToxicityConfig) {
    fail("缺少默认丹毒配置");
  }
  if (Number(defaultPillToxicityConfig?.maxToxicity || 0) !== 20) {
    fail(`默认丹毒上限必须为 20，实际 ${defaultPillToxicityConfig?.maxToxicity}`);
  }

  for (const recipe of [...fourRealmsPack.alchemyRecipes, ...fourRealmsPack.smithingRecipes]) {
    if (!itemIds.has(recipe.resultItemId) || !itemIds.has(recipe.mainItemId)) {
      fail(`配方 ${recipe.id} 的产出或主材不存在`);
    }
    for (const extraId of [recipe.auxAItemId, recipe.auxBItemId, recipe.auxCItemId]) {
      if (extraId && !itemIds.has(extraId)) {
        fail(`配方 ${recipe.id} 引用了未知辅材 ${extraId}`);
      }
    }
  }

  await ensureIconsExist();
  await ensureUploadedIconsExistWhenRequested();
  await ensureSourceIconsExistWhenRequested();

  console.log(JSON.stringify({
    ok: true,
    questCount: fourRealmsPack.quests.length,
    realmStageCount,
    mapCount: fourRealmsPack.maps.length,
    npcCount: fourRealmsPack.npcs.length,
    itemCount: fourRealmsPack.items.length,
    skillCount: fourRealmsPack.skills.length,
    monsterCount: fourRealmsPack.monsters.length,
    fortuneCount: fourRealmsPack.fortunes.length,
    randomEventCount: fourRealmsPack.randomEvents.length,
    alchemyRecipeCount: fourRealmsPack.alchemyRecipes.length,
    smithingRecipeCount: fourRealmsPack.smithingRecipes.length,
    pillToxicityConfigCount: fourRealmsPack.pillToxicityConfigs.length,
    questCountByPrefix,
  }, null, 2));
}

main().catch((error) => {
  console.error("[four-realms] 校验失败", error);
  process.exit(1);
});

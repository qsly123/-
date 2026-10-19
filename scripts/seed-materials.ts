/**
 * 材料扩充：50 → 90。
 *
 * 现状（实测）：
 *   材料已有种植线（种子→药材），但 common 仅 1 件，练气期可选材料太少，
 *   撑不起后续丹方与装备的配方。
 *
 * 本脚本：
 *   1. 新增 40 个材料（每段 10 个：2 基础 / 4 常见 / 2 稀有 / 1 珍品 / 1 灵种）；
 *   2. 把其中的非种子材料追加进同段怪物的 drops，确保玩家真的能打到——
 *      追加而非覆盖，不破坏既有掉落；
 *   3. 种子不挂掉落，留给种植线与商铺。
 *
 * 用法：
 *   bun run scripts/seed-materials.ts --apply
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { items, monsters } from "@/db/schema";

type Rarity = "common" | "uncommon" | "rare" | "epic";
type DropRow = { chance: number; itemId: string; minQuantity: number; maxQuantity: number };

const SEGMENTS = [
  { key: "lq", label: "练气", minRealm: 1, maxRealm: 12, price: 12 },
  { key: "zj", label: "筑基", minRealm: 13, maxRealm: 16, price: 40 },
  { key: "jd", label: "结丹", minRealm: 17, maxRealm: 20, price: 120 },
  { key: "yy", label: "元婴", minRealm: 21, maxRealm: 44, price: 320 },
] as const;

const PRICE_MULT: Record<Rarity, number> = { common: 0.5, uncommon: 1, rare: 2.6, epic: 6 };

interface MatBlueprint {
  name: string;
  desc: string;
  rarity: Rarity;
  /** 种子不挂掉落 */
  seed?: boolean;
  chance?: number;
}

/** 每段 10 个：2 基础 / 4 常见 / 2 稀有 / 1 珍品 / 1 灵种 */
const MATERIALS: Record<string, MatBlueprint[]> = {
  lq: [
    { name: "碎贝壳", desc: "礁岸上到处都是，踩上去会响。不值钱，但磨成粉能入药。", rarity: "common", chance: 0.55 },
    { name: "咸风草", desc: "长在迎风坡上的矮草，嚼起来发咸。渔家拿它治晕船。", rarity: "common", chance: 0.5 },
    { name: "礁铁砂", desc: "礁石缝里刮出来的黑砂，含一点铁。孟老说：能打铁，也能伤人。", rarity: "uncommon", chance: 0.45 },
    { name: "螺壳粉", desc: "海螺壳碾的粉，白。止血尚可，别的用处不大。", rarity: "uncommon", chance: 0.45 },
    { name: "浅滩泥", desc: "退潮后挖的泥，腥。敷在伤口上凉，凉就够了。", rarity: "uncommon", chance: 0.42 },
    { name: "蟹钳", desc: "金背礁蟹的钳，硬。掰下来还能当夹子用。", rarity: "uncommon", chance: 0.4 },
    { name: "潮心砂", desc: "潮眼处沉积的砂，一天只积一撮。潮眼的水魄守着它。", rarity: "rare", chance: 0.3 },
    { name: "雾藤芯", desc: "缠雾藤妖被斩后，藤心还留着一缕雾。抽出来就是芯。", rarity: "rare", chance: 0.28 },
    { name: "深海沉木", desc: "沉在海底不知多少年的木，捞上来还是湿的。烧不着，据说压得住火毒。", rarity: "epic", chance: 0.15 },
    { name: "咸风草种", desc: "咸风草的籽，撒在坡上就能活。岛上穷人家都种这个。", rarity: "common", seed: true },
  ],
  zj: [
    { name: "粗铁矿", desc: "太行山随处可见的铁矿，杂质多。够打农具，不够打法器。", rarity: "common", chance: 0.5 },
    { name: "干柴枝", desc: "樵子捆好的柴，一根一根都是力气换的。", rarity: "common", chance: 0.48 },
    { name: "赤砂砾", desc: "赤砂驿路上的红砂，风一吹满嘴都是。入药要洗七遍。", rarity: "uncommon", chance: 0.42 },
    { name: "铁木根", desc: "铁木的根，砍断一把刀。药铺收它，说能续骨。", rarity: "uncommon", chance: 0.4 },
    { name: "兽骨屑", desc: "不知什么兽的骨，碎成屑。熬汤能补，也能骗人说是虎骨。", rarity: "uncommon", chance: 0.4 },
    { name: "火油砂", desc: "地火谷外渗出的油砂，遇火就着。带在身上是货，也是祸。", rarity: "uncommon", chance: 0.38 },
    { name: "庚金屑", desc: "庚煞铁尸身上刮下的金屑，冷。放在掌心，掌心的汗会结冰。", rarity: "rare", chance: 0.28 },
    { name: "炉心灰", desc: "守火人炉底最下一层灰，攒一年才一捧。池焰从不白给。", rarity: "rare", chance: 0.26 },
    { name: "地火玉髓", desc: "火脉之心凝出的髓，捧着像捧一块烧红的玉。池焰说：这不是你的，是山的。", rarity: "epic", chance: 0.14 },
    { name: "火晶草种", desc: "火晶草的籽，得种在暖处。赤砂驿的丹房常年收购。", rarity: "uncommon", seed: true },
  ],
  jd: [
    { name: "河淤", desc: "夜河古冢外捞上的淤泥，凉得刺手。里头偶尔能摸出别的东西。", rarity: "common", chance: 0.48 },
    { name: "旧骨片", desc: "不知是谁的骨，被水磨得发亮。堆在古冢口，没人敢清理。", rarity: "common", chance: 0.45 },
    { name: "雾海盐", desc: "雾海泽晒出的盐，带一点灵气。柳渡集的菜里都放它。", rarity: "uncommon", chance: 0.42 },
    { name: "骨灰晶", desc: "骨灰压成的晶，硬。古冢里多，活人手里少。", rarity: "uncommon", chance: 0.4 },
    { name: "渡口苔", desc: "柳渡集渡口石阶上的青苔，踩上去滑。刮下来能入药。", rarity: "uncommon", chance: 0.38 },
    { name: "水魅鳞", desc: "玄露水魅身上剥下的鳞，离水就干。干透了还能照出个人影。", rarity: "uncommon", chance: 0.36 },
    { name: "莲心粉", desc: "雾海灵莲的莲心磨的粉，苦。苦的东西多半有用。", rarity: "rare", chance: 0.27 },
    { name: "冥河砂", desc: "夜河底的砂，据说能压住心魔。压得住压不住，全看你自己。", rarity: "rare", chance: 0.25 },
    { name: "夜河心晶", desc: "古冢最深处结的晶，黑得发亮。看着它久了，会觉得它在看你。", rarity: "epic", chance: 0.13 },
    { name: "冥河藻种", desc: "冥河藻的种，得种在不见光的地方。种出来是什么，没人说得清。", rarity: "uncommon", seed: true },
  ],
  yy: [
    { name: "铁砂", desc: "边锋城外矿里的砂，粗。城主的军械要得多，矿工的命要得更多。", rarity: "common", chance: 0.46 },
    { name: "鸦羽", desc: "血河妖鸦落下的羽，红得发暗。捡一片要抬头看天，天上有危险。", rarity: "common", chance: 0.44 },
    { name: "寒鲛鳞", desc: "北溟寒鲛的鳞，常年不化霜。贴身带着，夏天也凉。", rarity: "uncommon", chance: 0.4 },
    { name: "魔血砂", desc: "魔物血浸过的砂，黑。踩过的人说脚底发烫。", rarity: "uncommon", chance: 0.38 },
    { name: "风羽屑", desc: "云门峰的风羽碎成屑，轻得没有分量。攥紧了会从指缝漏走。", rarity: "uncommon", chance: 0.36 },
    { name: "裂天石粉", desc: "裂天墟崩碎的石磨成粉。墟本身还在碎，粉也在变多。", rarity: "uncommon", chance: 0.34 },
    { name: "北溟冰心", desc: "寒鲛心口那一点冰，取出来时不化，离体三日才开始滴。", rarity: "rare", chance: 0.25 },
    { name: "魔髓砂", desc: "魔髓渗进砂里结成的粒。握久了，做梦会梦见不该梦的。", rarity: "rare", chance: 0.23 },
    { name: "裂天天晶", desc: "裂天墟核心崩出的晶，据说本是天的一部分。天碎了，落下来就成了矿。", rarity: "epic", chance: 0.12 },
    { name: "冰心草种", desc: "冰心草的籽，得种在冻土上。边锋城只有三块地能种活。", rarity: "rare", seed: true },
  ],
};

function buildItemRows() {
  const rows: (typeof items.$inferInsert)[] = [];
  for (const segment of SEGMENTS) {
    const list = MATERIALS[segment.key] || [];
    list.forEach((bp, index) => {
      rows.push({
        id: `item_four_realms_${segment.key}_mat_x${index + 1}`,
        name: bp.name,
        description: bp.desc,
        itemType: "material",
        rarity: bp.rarity,
        price: Math.round(segment.price * PRICE_MULT[bp.rarity]),
        stackable: true,
        isBound: false,
        minRealm: segment.minRealm,
        maxRealm: segment.maxRealm,
      });
    });
  }
  return rows;
}

/** 把非种子材料追加进同段怪物的掉落表 */
async function attachDrops(rows: (typeof items.$inferInsert)[]) {
  let attached = 0;
  for (const segment of SEGMENTS) {
    const candidates = rows.filter(
      (row) => String(row.id).startsWith(`item_four_realms_${segment.key}_mat_x`)
        && !(MATERIALS[segment.key] || []).some((bp, i) => bp.seed && String(row.id).endsWith(`x${i + 1}`)),
    );
    const monsterRows = await db.select().from(monsters).all();
    const sameSegment = monsterRows.filter((monster) => monster.id.includes(`_${segment.key}_`));

    for (let i = 0; i < candidates.length; i += 1) {
      const monster = sameSegment[i % sameSegment.length];
      if (!monster) continue;
      const blueprint = (MATERIALS[segment.key] || [])[
        Number(String(candidates[i].id).replace(/^.*x/, "")) - 1
      ];
      const existing: DropRow[] = Array.isArray(monster.drops) ? (monster.drops as DropRow[]) : [];
      if (existing.some((drop) => drop.itemId === candidates[i].id)) continue;
      const next: DropRow[] = [
        ...existing,
        {
          chance: blueprint?.chance ?? 0.35,
          itemId: String(candidates[i].id),
          minQuantity: 1,
          maxQuantity: blueprint?.rarity === "epic" ? 1 : 2,
        },
      ];
      await db.update(monsters).set({ drops: next }).where(eq(monsters.id, monster.id)).run();
      attached += 1;
    }
  }
  return attached;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = buildItemRows();
  const seedCount = Object.values(MATERIALS).flat().filter((bp) => bp.seed).length;
  console.log(`新增材料 ${rows.length} 个（其中种子 ${seedCount} 个不挂掉落）`);

  if (!apply) {
    for (const row of rows.slice(0, 6)) {
      console.log(`  [${row.rarity}] ${row.name} (${row.minRealm}-${row.maxRealm}) ${row.price}灵石`);
    }
    console.log("  …（加 --apply 写入并挂掉落）");
    return;
  }

  for (const row of rows) {
    await db.insert(items).values(row)
      .onConflictDoUpdate({ target: items.id, set: row })
      .run();
  }
  const attached = await attachDrops(rows);
  console.log(`写入完成，挂载掉落 ${attached} 条`);
}

void main();

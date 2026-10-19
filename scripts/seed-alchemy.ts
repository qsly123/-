/**
 * 丹药与丹方扩充：丹方 12 → 36。
 *
 * 现状：每段只有 3 类丹（修为 / 突破 / 疗伤），且每段仅一档，
 *       既没有"更好的丹"可追求，也缺解毒、回气等功用。
 *
 * 参考《凡人修仙传》丹药体系的做法：
 *   - 按功用分家（修为 / 突破 / 疗伤 / 解毒 / 辅助）；
 *   - 同功用分档（低档已有，本脚本补中档与高档），形成段内追求。
 *
 * 只用既有丹药效果键：boost_xp / boost_breakthrough / heal_hp / heal_mp / reduce_toxicity。
 *
 * 用法：
 *   bun run scripts/seed-alchemy.ts --apply
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";

type ItemEffect = NonNullable<typeof items.$inferInsert["effects"]>[number];

/** 数值按段递增：修为 ×4 起跳（练气 1600 → 筑基 12000 量级） */
const SEGMENTS = [
  { key: "lianqi", label: "练气", minRealm: 1, maxRealm: 12, xp: 3200, heal: 200, mp: 200, rate: 0.72, sort: 20 },
  { key: "zhuji", label: "筑基", minRealm: 13, maxRealm: 16, xp: 12000, heal: 500, mp: 500, rate: 0.66, sort: 30 },
  { key: "jiedan", label: "结丹", minRealm: 17, maxRealm: 20, xp: 40000, heal: 2000, mp: 2000, rate: 0.58, sort: 40 },
  { key: "yuanying", label: "元婴", minRealm: 21, maxRealm: 44, xp: 150000, heal: 6000, mp: 6000, rate: 0.5, sort: 50 },
] as const;

type PillKind = "xp_mid" | "xp_high" | "heal" | "breakthrough" | "detox" | "mana";

interface PillBlueprint {
  kind: PillKind;
  name: string;
  desc: string;
  rarity: "rare" | "epic" | "legendary";
  mainItemId: string;
  mainItemName: string;
  mainQuantity: number;
  auxA?: { id: string; name: string; quantity: number; bonus: number };
  auxB?: { id: string; name: string; quantity: number; bonus: number };
}

/** 每段 6 个新丹方：修为中档 / 修为高档 / 疗伤 / 突破 / 解毒 / 回气 */
const PILLS: Record<string, PillBlueprint[]> = {
  lianqi: [
    {
      kind: "xp_mid", name: "凝元丹", rarity: "rare",
      desc: "海雾草熬足火候才凝得出。比凝露丹稠，咽下去胸口发热。",
      mainItemId: "item_four_realms_lianqi_material_1", mainItemName: "海雾草", mainQuantity: 6,
      auxA: { id: "item_four_realms_lq_mat_x1", name: "碎贝壳", quantity: 2, bonus: 0.06 },
    },
    {
      kind: "xp_high", name: "凝灵丹", rarity: "epic",
      desc: "岛上能炼出这个的，一只手数得过来。药力猛，练气后期的人也扛得住。",
      mainItemId: "item_four_realms_lianqi_material_1", mainItemName: "海雾草", mainQuantity: 10,
      auxA: { id: "item_four_realms_lq_mat_x7", name: "潮心砂", quantity: 2, bonus: 0.1 },
      auxB: { id: "item_four_realms_lianqi_material_3", name: "石骨碎片", quantity: 2, bonus: 0.06 },
    },
    {
      kind: "heal", name: "海雾生肌膏", rarity: "rare",
      desc: "敷在伤口上先是凉，后是痒。痒说明肉在长。",
      mainItemId: "item_four_realms_lianqi_material_1", mainItemName: "海雾草", mainQuantity: 5,
      auxA: { id: "item_four_realms_lq_mat_x4", name: "螺壳粉", quantity: 3, bonus: 0.08 },
    },
    {
      kind: "breakthrough", name: "启脉丹", rarity: "rare",
      desc: "启的是最细那条脉。成了，气顺；败了，脉伤。没人替你试。",
      mainItemId: "item_four_realms_lianqi_material_2", mainItemName: "潮纹寒铁", mainQuantity: 4,
      auxA: { id: "item_four_realms_lq_mat_x8", name: "雾藤芯", quantity: 2, bonus: 0.08 },
    },
    {
      kind: "detox", name: "海雾清瘴散", rarity: "rare",
      desc: "岛上瘴气重，出海的人随身带一包。苦，但吐出来就好了。",
      mainItemId: "item_four_realms_lq_mat_x2", mainItemName: "咸风草", mainQuantity: 5,
      auxA: { id: "item_four_realms_lianqi_material_4", name: "蚁酸囊", quantity: 2, bonus: 0.05 },
    },
    {
      kind: "mana", name: "回气散", rarity: "rare",
      desc: "法力见底时的一口气。不多，但够你再出一招。",
      mainItemId: "item_four_realms_lq_mat_x1", mainItemName: "碎贝壳", mainQuantity: 4,
      auxA: { id: "item_four_realms_lq_mat_x3", name: "礁铁砂", quantity: 2, bonus: 0.06 },
    },
  ],
  zhuji: [
    {
      kind: "xp_mid", name: "赤元丹", rarity: "rare",
      desc: "赤砂驿的丹房一天出二十枚，十九枚不是这个成色。",
      mainItemId: "item_four_realms_zhuji_material_herb", mainItemName: "赤髓芝", mainQuantity: 6,
      auxA: { id: "item_four_realms_zj_mat_x3", name: "赤砂砾", quantity: 2, bonus: 0.06 },
    },
    {
      kind: "xp_high", name: "赤炁金丹", rarity: "epic",
      desc: "丹上有金纹，纹越密越烈。任丹娘说：纹走到头，人也走到头。",
      mainItemId: "item_four_realms_zhuji_material_herb", mainItemName: "赤髓芝", mainQuantity: 10,
      auxA: { id: "item_four_realms_zj_mat_x7", name: "庚金屑", quantity: 2, bonus: 0.1 },
      auxB: { id: "item_four_realms_zj_mat_x8", name: "炉心灰", quantity: 2, bonus: 0.06 },
    },
    {
      kind: "heal", name: "血纹续骨膏", rarity: "rare",
      desc: "骨断了敷它，接的时候会疼得清醒。清醒着接，才不会接歪。",
      mainItemId: "item_four_realms_zhuji_material_3", mainItemName: "血纹符皮", mainQuantity: 4,
      auxA: { id: "item_four_realms_zj_mat_x4", name: "铁木根", quantity: 3, bonus: 0.08 },
    },
    {
      kind: "breakthrough", name: "固基丹", rarity: "rare",
      desc: "筑基的人求它，求的是那三成把握。三成不多，可总比一成强。",
      mainItemId: "item_four_realms_zhuji_material_herb", mainItemName: "赤髓芝", mainQuantity: 8,
      auxA: { id: "item_four_realms_zj_mat_x2", name: "干柴枝", quantity: 4, bonus: 0.05 },
    },
    {
      kind: "detox", name: "赤砂涤毒散", rarity: "rare",
      desc: "赤砂驿的魔煞入体要趁早涤。晚了，涤的是血，不是毒。",
      mainItemId: "item_four_realms_zj_mat_x3", mainItemName: "赤砂砾", mainQuantity: 5,
      auxA: { id: "item_four_realms_zj_mat_x1", name: "粗铁矿", quantity: 3, bonus: 0.05 },
    },
    {
      kind: "mana", name: "养元露", rarity: "rare",
      desc: "装在瓷瓶里，一日饮一口。驿卒跑长路都靠它吊着。",
      mainItemId: "item_four_realms_zj_mat_x2", mainItemName: "干柴枝", mainQuantity: 4,
      auxA: { id: "item_four_realms_zj_mat_x5", name: "兽骨屑", quantity: 2, bonus: 0.06 },
    },
  ],
  jiedan: [
    {
      kind: "xp_mid", name: "金液玄丹", rarity: "epic",
      desc: "金液凝成的丹，晃一晃能看见里头的丝。价值不菲，也确实有效。",
      mainItemId: "item_four_realms_jiedan_material_1", mainItemName: "雾海灵莲", mainQuantity: 6,
      auxA: { id: "item_four_realms_jd_mat_x3", name: "雾海盐", quantity: 2, bonus: 0.06 },
    },
    {
      kind: "xp_high", name: "紫府金丹", rarity: "legendary",
      desc: "结丹修士梦寐以求的一枚。紫府是自家的地方，丹只是把门推开一点。",
      mainItemId: "item_four_realms_jiedan_material_1", mainItemName: "雾海灵莲", mainQuantity: 12,
      auxA: { id: "item_four_realms_jd_mat_x7", name: "莲心粉", quantity: 3, bonus: 0.1 },
      auxB: { id: "item_four_realms_jd_mat_x8", name: "冥河砂", quantity: 2, bonus: 0.06 },
    },
    {
      kind: "heal", name: "莲心玉髓膏", rarity: "epic",
      desc: "莲心太苦，得拿玉髓压。压住了，就是救命的东西。",
      mainItemId: "item_four_realms_jiedan_material_1", mainItemName: "雾海灵莲", mainQuantity: 5,
      auxA: { id: "item_four_realms_jd_mat_x6", name: "水魅鳞", quantity: 3, bonus: 0.08 },
    },
    {
      kind: "breakthrough", name: "破婴丹", rarity: "epic",
      desc: "结丹圆满之后要问的一颗丹。问得成，是婴；问不成，是空。",
      mainItemId: "item_four_realms_jiedan_material_3", mainItemName: "戒律玄铁", mainQuantity: 5,
      auxA: { id: "item_four_realms_jd_mat_x7", name: "莲心粉", quantity: 3, bonus: 0.08 },
    },
    {
      kind: "detox", name: "夜河涤魂散", rarity: "epic",
      desc: "古冢里沾的东西，不只是毒。这散涤毒，也涤一点别的东西。",
      mainItemId: "item_four_realms_jd_mat_x8", mainItemName: "冥河砂", mainQuantity: 5,
      auxA: { id: "item_four_realms_jd_mat_x1", name: "河淤", quantity: 3, bonus: 0.05 },
    },
    {
      kind: "mana", name: "冥河回气丹", rarity: "epic",
      desc: "气从河底来，凉。喝多了，说话都带一股河底的味。",
      mainItemId: "item_four_realms_jd_mat_x1", mainItemName: "河淤", mainQuantity: 5,
      auxA: { id: "item_four_realms_jd_mat_x2", name: "旧骨片", quantity: 3, bonus: 0.06 },
    },
  ],
  yuanying: [
    {
      kind: "xp_mid", name: "婴元紫丹", rarity: "legendary",
      desc: "元婴修士的日常用丹。说是日常，散修一辈子也吃不了几枚。",
      mainItemId: "item_four_realms_yuanying_material_herb", mainItemName: "守心雪参", mainQuantity: 6,
      auxA: { id: "item_four_realms_yy_mat_x3", name: "寒鲛鳞", quantity: 2, bonus: 0.06 },
    },
    {
      kind: "xp_high", name: "玉髓元婴丹", rarity: "legendary",
      desc: "一枚抵百日苦修。城主说过：抵的是苦修，抵不掉该有的劫。",
      mainItemId: "item_four_realms_yuanying_material_herb", mainItemName: "守心雪参", mainQuantity: 12,
      auxA: { id: "item_four_realms_yy_mat_x7", name: "北溟冰心", quantity: 3, bonus: 0.1 },
      auxB: { id: "item_four_realms_yy_mat_x6", name: "裂天石粉", quantity: 3, bonus: 0.06 },
    },
    {
      kind: "heal", name: "寒鲛生髓膏", rarity: "legendary",
      desc: "鲛的髓冷，敷上去先是疼得发木，之后才知道伤好了。",
      mainItemId: "item_four_realms_yuanying_material_herb", mainItemName: "守心雪参", mainQuantity: 5,
      auxA: { id: "item_four_realms_yy_mat_x3", name: "寒鲛鳞", quantity: 4, bonus: 0.08 },
    },
    {
      kind: "breakthrough", name: "问天丹", rarity: "legendary",
      desc: "元婴之后的路，这丹只能送到门口。门后是什么，得自己走进去。",
      mainItemId: "item_four_realms_yuanying_material_4", mainItemName: "血河魔髓", mainQuantity: 6,
      auxA: { id: "item_four_realms_yy_mat_x8", name: "魔髓砂", quantity: 3, bonus: 0.08 },
    },
    {
      kind: "detox", name: "北溟涤魔散", rarity: "legendary",
      desc: "魔髓入体的解药。解得掉毒，解不掉你当初为什么碰它。",
      mainItemId: "item_four_realms_yy_mat_x7", mainItemName: "北溟冰心", mainQuantity: 4,
      auxA: { id: "item_four_realms_yy_mat_x2", name: "鸦羽", quantity: 3, bonus: 0.05 },
    },
    {
      kind: "mana", name: "云门回气丹", rarity: "legendary",
      desc: "云门峰的风装进丹里，一口下去，气从脚底涌上来。",
      mainItemId: "item_four_realms_yy_mat_x5", mainItemName: "风羽屑", mainQuantity: 5,
      auxA: { id: "item_four_realms_yy_mat_x1", name: "铁砂", quantity: 3, bonus: 0.06 },
    },
  ],
};

const BREAKTHROUGH_VALUE: Record<string, number> = {
  lianqi: 0.08,
  zhuji: 0.1,
  jiedan: 0.12,
  yuanying: 0.14,
};

const RARITY_MULT: Record<string, number> = { rare: 1, epic: 1.8, legendary: 3.2 };

function buildEffects(kind: PillKind, segmentKey: string, rarity: string): ItemEffect[] {
  const segment = SEGMENTS.find((item) => item.key === segmentKey)!;
  const mult = RARITY_MULT[rarity] || 1;
  switch (kind) {
    case "xp_mid":
      return [{ type: "boost_xp", value: Math.round(segment.xp * mult) }];
    case "xp_high":
      return [{ type: "boost_xp", value: Math.round(segment.xp * 2.2 * mult) }];
    case "heal":
      return [
        { type: "heal_hp", value: Math.round(segment.heal * mult) },
        { type: "heal_mp", value: Math.round(segment.mp * 0.6 * mult) },
      ];
    case "breakthrough":
      return [{ type: "boost_breakthrough", value: BREAKTHROUGH_VALUE[segmentKey] }];
    case "detox":
      return [{ type: "reduce_toxicity", value: Math.round(30 * mult) }];
    case "mana":
      return [{ type: "heal_mp", value: Math.round(segment.mp * mult) }];
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  let pillCount = 0;
  let recipeCount = 0;

  for (const segment of SEGMENTS) {
    const list = PILLS[segment.key] || [];
    for (const [index, bp] of list.entries()) {
      const pillId = `item_four_realms_${segment.key}_pill_x${index + 1}`;
      const effects = buildEffects(bp.kind, segment.key, bp.rarity);
      const pillPrice = Math.round(segment.xp / 12 * (RARITY_MULT[bp.rarity] || 1));

      if (apply) {
        await db.insert(items).values({
          id: pillId,
          name: bp.name,
          description: bp.desc,
          itemType: "consumable",
          rarity: bp.rarity,
          effects,
          pillToxicity: 0,
          price: pillPrice,
          stackable: true,
          isBound: false,
          minRealm: segment.minRealm,
          maxRealm: segment.maxRealm,
        }).onConflictDoUpdate({
          target: items.id,
          set: { name: bp.name, description: bp.desc, effects, price: pillPrice, rarity: bp.rarity },
        }).run();

        // alchemy_recipes 不在 drizzle schema 里（由炼丹服务 raw SQL 建表），
        // 因此这里同样用 raw SQL，并沿用服务端的「按 recipe_code 去重」写法，
        // 避免与离线包同步逻辑互相覆盖。
        const recipeCode = `alchemy_${segment.key}_x${index + 1}`;
        const rate = Number((segment.rate - (bp.rarity === "legendary" ? 0.06 : 0)).toFixed(2));
        await db.execute(sql`
          INSERT INTO "alchemy_recipes" (
            "recipe_code","result_item_id","result_item_name","result_quantity",
            "main_item_id","main_item_name","main_quantity","base_success_rate",
            "aux_a_item_id","aux_a_item_name","aux_a_quantity","aux_a_bonus_rate",
            "aux_b_item_id","aux_b_item_name","aux_b_quantity","aux_b_bonus_rate",
            "enabled","sort_order"
          )
          SELECT
            ${recipeCode},${pillId},${bp.name},1,
            ${bp.mainItemId},${bp.mainItemName},${bp.mainQuantity},${rate},
            ${bp.auxA?.id ?? null},${bp.auxA?.name ?? ""},${bp.auxA?.quantity ?? 0},${bp.auxA?.bonus ?? 0},
            ${bp.auxB?.id ?? null},${bp.auxB?.name ?? ""},${bp.auxB?.quantity ?? 0},${bp.auxB?.bonus ?? 0},
            true,${segment.sort + index}
          WHERE NOT EXISTS (
            SELECT 1 FROM "alchemy_recipes" WHERE "recipe_code" = ${recipeCode}
          )
        `);
      }
      pillCount += 1;
      recipeCount += 1;
    }
  }

  console.log(`新增丹药 ${pillCount} 个，丹方 ${recipeCount} 条`);
  if (!apply) {
    console.log("  （加 --apply 写入）");
    return;
  }
  console.log("写入完成");
}

void main();

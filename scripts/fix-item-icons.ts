/**
 * 修复物品图标。
 *
 * 起因：玩家反馈「武器没有图标」。查下来是两个叠加的问题：
 *
 * 1. 内容扩充新增的物品没写 icon_url，而 ItemIcon 在 icon_url 为空时直接 return null，
 *    玩家看到的就是空白。
 * 2. **更狠的是：库里原有的 icon_url 也全是坏链接。**
 *    存的是 `/uploads/cosmetics/item/four-realms/weapon-sword.png`，但磁盘上根本没有
 *    `/uploads` 这份资源（curl 一律 404）。真实图标在
 *    `public/worldpack-icons/four-realms/items/` 下，共 12 个文件。
 *    `rewriteLegacyCosmeticUrl` 只映射了 4 个 ai-smithing 别名，不会把 /uploads 改对，
 *    ai-smithing 那几个连本地文件都没有。
 *
 * 本脚本不新增图片，只把全库图标**统一收敛到磁盘上真实存在的 12 个文件**，
 * 让「有图标」等于「真的能显示」。
 *
 * 用法：bun run scripts/fix-item-icons.ts          # 预览
 *       bun run scripts/fix-item-icons.ts --apply  # 写入
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";

type ItemRow = typeof items.$inferSelect;

const BASE = "/worldpack-icons/four-realms/items";

/** 磁盘上真实存在的文件（curl 验证过 200），只用这些 */
const VALID_ICONS = new Set([
  `${BASE}/weapon-sword.png`,
  `${BASE}/weapon-blade.png`,
  `${BASE}/weapon-needle.png`,
  `${BASE}/armor-robe.png`,
  `${BASE}/armor-helmet.png`,
  `${BASE}/artifact-shield.png`,
  `${BASE}/artifact-talisman.png`,
  `${BASE}/material-jade.png`,
  `${BASE}/material-orb.png`,
  `${BASE}/pill-red.png`,
  `${BASE}/pill-blue.png`,
  `${BASE}/pill-bottle.png`,
]);

const ICON = {
  sword: `${BASE}/weapon-sword.png`,
  blade: `${BASE}/weapon-blade.png`,
  needle: `${BASE}/weapon-needle.png`,
  robe: `${BASE}/armor-robe.png`,
  helmet: `${BASE}/armor-helmet.png`,
  shield: `${BASE}/artifact-shield.png`,
  talisman: `${BASE}/artifact-talisman.png`,
  jade: `${BASE}/material-jade.png`,
  orb: `${BASE}/material-orb.png`,
  pillRed: `${BASE}/pill-red.png`,
  pillBlue: `${BASE}/pill-blue.png`,
  pillBottle: `${BASE}/pill-bottle.png`,
} as const;

/** 稳定哈希：同一物品每次跑拿到同一个图标，避免刷新后图标乱跳 */
function stableIndex(seed: string, size: number): number {
  let sum = 0;
  for (let i = 0; i < seed.length; i += 1) sum = (sum * 31 + seed.charCodeAt(i)) >>> 0;
  return sum % size;
}

function pickWeaponIcon(item: ItemRow): string {
  const name = item.name;
  if (/剑|锋|岚|鸣|枪|戟/.test(name)) return ICON.sword;
  if (/刀|刃|斩|斧|钺|叉|矛/.test(name)) return ICON.blade;
  if (/针|丝|刺|锥/.test(name)) return ICON.needle;
  // 珠/尺/环/印 之类没有专属图标，按 id 稳定落到现有三种之一
  return [ICON.sword, ICON.blade, ICON.needle][stableIndex(item.id, 3)];
}

function pickArtifactIcon(item: ItemRow): string {
  const name = item.name;
  if (/盾|甲|钟|塔|鼎/.test(name)) return ICON.shield;
  if (/符|幡|旗|环|印|珠|镜/.test(name)) return ICON.talisman;
  return [ICON.shield, ICON.talisman][stableIndex(item.id, 2)];
}

function pickMaterialIcon(item: ItemRow): string {
  const name = item.name;
  if (/晶|玉|石|砂|铁|矿/.test(name)) return ICON.jade;
  if (/草|花|露|液|血|魂|雾/.test(name)) return ICON.orb;
  return [ICON.jade, ICON.orb][stableIndex(item.id, 2)];
}

/** 丹药按效果分：回血红、回蓝蓝、其余瓶装 */
function pickConsumableIcon(item: ItemRow): string {
  const effects = item.effects as unknown as Array<{ type?: string }> | null;
  const types = new Set((effects ?? []).map((entry) => String(entry?.type || "")));
  if (types.has("heal_hp")) return ICON.pillRed;
  if (types.has("heal_mp")) return ICON.pillBlue;
  return ICON.pillBottle;
}

function pickIcon(item: ItemRow): string | null {
  switch (item.itemType) {
    case "weapon":
      return pickWeaponIcon(item);
    case "armor":
    case "shoes":
      return ICON.robe; // shoes 也只有 armor-robe 这一张
    case "helmet":
      return ICON.helmet;
    case "artifact":
      return pickArtifactIcon(item);
    case "material":
      return pickMaterialIcon(item);
    case "consumable":
      return pickConsumableIcon(item);
    case "quest":
    case "skill_book":
      return ICON.jade; // 沿用原先的做法
    default:
      return null;
  }
}

async function main() {
  const apply = process.argv.includes("--apply");

  const all = await db.select().from(items).all();

  // 需要修的不只是「空」，还有指向不存在文件的坏链接
  const broken = all.filter((item) => !VALID_ICONS.has(item.iconUrl ?? ""));

  const plan: Array<{ item: ItemRow; icon: string }> = [];
  const skipped: string[] = [];
  for (const item of broken) {
    const icon = pickIcon(item);
    if (!icon) {
      skipped.push(`${item.itemType}/${item.name}`);
      continue;
    }
    plan.push({ item, icon });
  }

  const byType = new Map<string, number>();
  for (const entry of plan) byType.set(entry.item.itemType, (byType.get(entry.item.itemType) ?? 0) + 1);

  console.log(`全库物品 ${all.length} 个，图标需要修的 ${broken.length} 个，可修 ${plan.length} 个`);
  for (const [type, count] of [...byType].sort()) console.log(`  ${type}: ${count}`);
  if (skipped.length > 0) console.log(`  跳过：${skipped.slice(0, 5).join("、")}`);

  if (!apply) {
    console.log("\n预览模式，加 --apply 写入。样例：");
    for (const entry of plan.slice(0, 6)) {
      console.log(`  ${entry.item.name}: ${entry.item.iconUrl ?? "(空)"} → ${entry.icon.replace(BASE + "/", "")}`);
    }
    return;
  }

  for (const entry of plan) {
    await db.update(items).set({ iconUrl: entry.icon }).where(eq(items.id, entry.item.id)).run();
  }

  const after = await db.select({ iconUrl: items.iconUrl }).from(items).all();
  const stillBroken = after.filter((row) => !VALID_ICONS.has(row.iconUrl ?? ""));
  console.log(`\n已写入 ${plan.length} 个，仍不可显示 ${stillBroken.length} 个（全库 ${after.length}）`);
}

await main();

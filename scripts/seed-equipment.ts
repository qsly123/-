/**
 * 装备扩充：把每段（练气/筑基/结丹/元婴）的装备从 7 件补到 24 件。
 *
 * 现状问题（实测）：
 *   每段只有 weapon 4 / armor 1 / helmet 1 / shoes 1，且段内品质单一
 *   （练气全 uncommon、筑基全 rare…）——玩家既没有配装选择，也没有品质追求。
 *
 * 本脚本新增 68 件，达成：
 *   每段 weapon 8 / armor 6 / helmet 5 / shoes 5 = 24 件，段内含 common→legendary 五档。
 *   每件带流派倾向（剑修/体修/符修/丹修/通用），让配装与天赋流派联动。
 *
 * 用法：
 *   bun run scripts/seed-equipment.ts --apply
 */
import { db } from "@/db";
import { items } from "@/db/schema";

type ItemEffect = NonNullable<typeof items.$inferInsert["effects"]>[number];
type School = "sword" | "body" | "talisman" | "pill" | "general";
type Slot = "weapon" | "armor" | "helmet" | "shoes";
type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

/** 境界段：数值倍率对标既有一件（练气青箬法衣 hp40/def5 → 结丹云纹道衣 hp120/def15） */
const SEGMENTS = [
  { key: "lianqi", label: "练气", minRealm: 1, maxRealm: 12, mult: 1 },
  { key: "zhuji", label: "筑基", minRealm: 13, maxRealm: 16, mult: 2 },
  { key: "jiedan", label: "结丹", minRealm: 17, maxRealm: 20, mult: 3.5 },
  { key: "yuanying", label: "元婴", minRealm: 21, maxRealm: 44, mult: 6 },
] as const;

/** 品质倍率：一件装备在同段内的强弱梯度 */
const RARITY_MULT: Record<Rarity, number> = {
  common: 0.7,
  uncommon: 1,
  rare: 1.7,
  epic: 2.6,
  legendary: 3.8,
};

/** 各部位的基础数值 × 流派副属性 */
const SLOT_BASE: Record<Slot, { atk?: number; hp: number; def: number; speed?: number; sense?: number }> = {
  weapon: { atk: 10, hp: 0, def: 0, speed: 0, sense: 1 },
  armor: { hp: 60, def: 8, sense: 0 },
  helmet: { hp: 20, def: 6, sense: 2 },
  shoes: { hp: 30, def: 3, speed: 4, sense: 0 },
};

const SCHOOL_SECONDARY: Record<School, string> = {
  sword: "穿透",
  body: "格挡",
  talisman: "神识",
  pill: "减伤",
  general: "机变",
};

function num(base: number, mult: number, rarity: Rarity) {
  const value = base * mult * RARITY_MULT[rarity];
  return value < 1 ? 0 : Math.round(value);
}

/** 按部位 + 流派 + 段 + 品质生成效果数组（只用既有的 11 个属性键） */
function buildEffects(slot: Slot, school: School, mult: number, rarity: Rarity): ItemEffect[] {
  const base = SLOT_BASE[slot];
  const r = RARITY_MULT[rarity];
  const effects: ItemEffect[] = [];

  if (base.atk) {
    effects.push({ type: "boost_atk", value: num(base.atk, mult, rarity) });
  }
  if (base.hp > 0) {
    effects.push({ type: "boost_hp", value: num(base.hp, mult, rarity) });
  }
  if (base.def > 0) {
    effects.push({ type: "boost_def", value: num(base.def, mult, rarity) });
  }
  if (base.speed) {
    effects.push({ type: "boost_speed", value: num(base.speed, mult, rarity) });
  }
  if (base.sense && (school === "talisman" || slot === "helmet" || slot === "weapon")) {
    effects.push({ type: "boost_spiritual_sense", value: num(base.sense, mult, rarity) });
  }

  // 流派副属性：让同一部位的不同装备真的不一样
  switch (school) {
    case "sword":
      effects.push({ type: "boost_armor_penetration", value: Math.max(1, Math.round(3 * mult * r)) });
      break;
    case "body":
      effects.push({ type: "boost_block", value: Math.max(1, Math.round(4 * mult * r)) });
      break;
    case "talisman":
      effects.push({ type: "boost_skill_damage_bonus", value: Math.max(1, Math.round(3 * mult * r)) });
      break;
    case "pill":
      effects.push({ type: "boost_skill_damage_reduction", value: Math.max(1, Math.round(3 * mult * r)) });
      break;
    case "general":
      effects.push({ type: "boost_luck", value: Math.max(1, Math.round(2 * mult * r)) });
      break;
  }
  return effects;
}

interface Blueprint {
  name: string;
  desc: string;
  school: School;
  rarity: Rarity;
}

/** 新增装备名册：每段每部位一组，名字不与既有的重复 */
const BLUEPRINTS: Record<string, Partial<Record<Slot, Blueprint[]>>> = {
  lianqi: {
    weapon: [
      { name: "礁岩钝剑", desc: "海边捡来的断剑磨了磨，刃口发白。砍不快，但砍得实。", school: "body", rarity: "common" },
      { name: "渔叉改", desc: "渔家的叉子接了木柄，叉尖还带着咸味。练气散修的第一件兵器多半是这样来的。", school: "general", rarity: "common" },
      { name: "引雷木符尺", desc: "尺身刻满细符，握久了手心发麻。木头的，不值钱，但能引一点雷意。", school: "talisman", rarity: "uncommon" },
      { name: "雾隐细剑", desc: "剑身窄得像一道雾，出手不见影。岛上人说这剑太薄，薄的东西容易折，也容易见血。", school: "sword", rarity: "rare" },
    ],
    armor: [
      { name: "粗麻道袍", desc: "麻布缝的，洗得发白。挡不住什么，但比光着强。", school: "general", rarity: "common" },
      { name: "蓑衣改", desc: "渔家蓑衣里衬了旧甲片，雨天挡水，打架挡刀。算不上法衣，可岛上人穿它活得更久。", school: "pill", rarity: "common" },
      { name: "蟹壳背甲", desc: "金背礁蟹的壳串成一片，硬且腥。丑，但初次挨刀的人顾不上丑。", school: "body", rarity: "uncommon" },
      { name: "符纹布衣", desc: "衣上用米汤写了符，洗一次淡一层。有一点用，不多。", school: "talisman", rarity: "uncommon" },
      { name: "潮纹软甲", desc: "孟老用潮纹寒铁抽的丝织成，贴身，不响。他只做了三件，自己一件也没留。", school: "pill", rarity: "rare" },
    ],
    helmet: [
      { name: "竹编遮阳笠", desc: "挡太阳的。真挨了刀，它什么也挡不住。", school: "general", rarity: "common" },
      { name: "铜环束发", desc: "一圈铜环把头发束住，顺带护住额角。修士讲究体面，体面有时候能救命。", school: "pill", rarity: "uncommon" },
      { name: "玄龟壳冠", desc: "龟壳削的冠，沉。戴上后脖子酸，但刀砍上来只留白印。", school: "body", rarity: "rare" },
      { name: "观澜额饰", desc: "一片磨薄的螺壳贴在额前，据说能听潮。听不听得见，看你自己的神识。", school: "talisman", rarity: "uncommon" },
    ],
    shoes: [
      { name: "草绳绑履", desc: "草绳缠脚，走礁石不打滑。跑不快，可也不容易摔死。", school: "general", rarity: "common" },
      { name: "涉水木屐", desc: "木底高齿，过浅滩不湿鞋。追人的时候嫌笨，逃命的时候嫌慢。", school: "pill", rarity: "uncommon" },
      { name: "踏潮软靴", desc: "靴底随潮软硬变化，踩在湿礁上不响。丁巡海说：声音小的人活得长。", school: "talisman", rarity: "rare" },
      { name: "龟息重履", desc: "厚重如石，迈一步一个坑。跑不掉，但站着挨打也不倒。", school: "body", rarity: "uncommon" },
    ],
  },
  zhuji: {
    weapon: [
      { name: "驿卒铁刀", desc: "驿卒配的制式刀，刃口卷了。杀过人，也只杀过一次。", school: "general", rarity: "common" },
      { name: "火脉凿", desc: "地火谷采石用的凿子，被池焰改成了兵器。笨，但砸下去石头也裂。", school: "body", rarity: "common" },
      { name: "血纹符剑", desc: "剑脊嵌着一道血符，出鞘时符会发暗。用多了，握剑的人会做噩梦。", school: "talisman", rarity: "uncommon" },
      { name: "庚金短戈", desc: "庚煞铁尸身上剥下的金，打成一柄短戈。重在手心，砸在人身上就是个坑。", school: "sword", rarity: "rare" },
    ],
    armor: [
      { name: "驿道皮甲", desc: "牛皮泡过盐水，硬了一层。挡得住砍，挡不住刺。", school: "general", rarity: "common" },
      { name: "炉火围裙", desc: "守火人的皮围裙，焦黑一片。近火的人不怕火，怕的是背后的刀。", school: "pill", rarity: "common" },
      { name: "符箓长衫", desc: "衫上缝了三十七张符纸，走起路来哗哗响。灵气没多少，气势倒足。", school: "talisman", rarity: "uncommon" },
      { name: "砂隐袍", desc: "赤砂染的袍子，风一起就与沙同色。看不见你，就砍不到你。", school: "general", rarity: "uncommon" },
      { name: "庚煞铁甲", desc: "铁尸甲片穿成，冷得刺骨。穿上它的人，冬天不再觉得冷——别的季节也是。", school: "body", rarity: "rare" },
    ],
    helmet: [
      { name: "皮护额", desc: "一条厚皮带勒在额上。护不了脑后，护得住正面那一下。", school: "general", rarity: "common" },
      { name: "符纸幞头", desc: "幞头里塞了符纸，据说能定神。多半是心理，但定神本身就是本事。", school: "talisman", rarity: "uncommon" },
      { name: "铁面罩", desc: "遮住半张脸的铁片，呼吸声在里头回响。看不清你的表情，对手就猜不出你的伤。", school: "body", rarity: "uncommon" },
      { name: "赤铜兜鍪", desc: "赤砂驿的旧军盔，铜色发暗。戴它的驿卒大多没回来，盔还在。", school: "body", rarity: "rare" },
    ],
    shoes: [
      { name: "麻底快靴", desc: "麻编的底，轻。驿卒跑路穿的，跑烂了就再编一双。", school: "general", rarity: "common" },
      { name: "铁趾战靴", desc: "靴头包铁，踢在人身上是钝响。走路沉，站得稳。", school: "body", rarity: "uncommon" },
      { name: "驿程长靴", desc: "筒高及膝，走长路不磨腿。路是走出来的，脚先坏了就走不了。", school: "pill", rarity: "uncommon" },
      { name: "踏火软履", desc: "用火脉边的软石粉鞣过，踩在灼石上不焦。地火谷的人都有这么一双。", school: "talisman", rarity: "rare" },
    ],
  },
  jiedan: {
    weapon: [
      { name: "戒律铁尺", desc: "执法堂外门弟子用的铁尺，刻度是打人多少下。尺还是尺，用法不同。", school: "general", rarity: "common" },
      { name: "渡水扁担", desc: "柳渡集挑夫的扁担，两头包铁。挑货的武器，杀了人还是能挑货。", school: "body", rarity: "common" },
      { name: "骨笛", desc: "夜河的骨磨成笛，吹出来的声音不入耳，但能让尸骨里的东西安静一会儿。", school: "talisman", rarity: "uncommon" },
      { name: "雾海刺", desc: "雾海泽的灵莲茎抽出的刺，细而韧。刺入时几乎无声，拔出来才见血。", school: "sword", rarity: "rare" },
    ],
    armor: [
      { name: "素麻道袍", desc: "结丹修士也有穿素麻的。衣不在贵，在于你还活着穿它。", school: "general", rarity: "common" },
      { name: "雾绡衣", desc: "雾海泽的绡，薄得能看见后面的灯。穿上像没穿，刀砍上来才知道有。", school: "general", rarity: "uncommon" },
      { name: "戒律法衣", desc: "执法堂的法衣，背后绣着戒条。穿上它就得守，守不住就别穿。", school: "talisman", rarity: "uncommon" },
      { name: "骨鳞甲", desc: "古冢的骨片一片片缀起来，夜里会响。你知道它在响，可敌人也知道你在哪。", school: "body", rarity: "rare" },
      { name: "夜河蓑", desc: "河底捞起的旧蓑，浸了百年的凉。挡不住刀，挡得住那些说不清的东西。", school: "pill", rarity: "rare" },
    ],
    helmet: [
      { name: "素巾", desc: "一条白头巾。系上它，说明你还记得自己是谁。", school: "general", rarity: "common" },
      { name: "骨箍", desc: "骨片箍在额上，凉。心魔最怕这股凉——怕不多，但够用。", school: "body", rarity: "uncommon" },
      { name: "雾隐面纱", desc: "薄纱遮面，别人看不清你的脸，你也看不太清别人。各有各的打算。", school: "talisman", rarity: "uncommon" },
      { name: "观心玉额", desc: "玉贴额心，心魔近时会起雾。起雾就是提醒：该退了。", school: "talisman", rarity: "rare" },
    ],
    shoes: [
      { name: "素布鞋", desc: "布底，针脚密。走得多的人做的鞋，往往最不起眼。", school: "general", rarity: "common" },
      { name: "骨趾靴", desc: "靴尖嵌骨，硬。踢在石上有声，踢在人有坑。", school: "body", rarity: "uncommon" },
      { name: "渡船木屐", desc: "船上的木屐，湿了不滑。船夫说：站稳比跑快重要。", school: "pill", rarity: "uncommon" },
      { name: "踏雾履", desc: "踏在雾上能借一点力，走三丈就散。够你从刀下离开。", school: "talisman", rarity: "rare" },
    ],
  },
  yuanying: {
    weapon: [
      { name: "城卫制式刀", desc: "边锋城军械库发下来的刀，一样长，一样重。城主要的就是一样。", school: "general", rarity: "common" },
      { name: "魔髓符杖", desc: "杖头嵌着魔髓，握久了掌心发烫。用魔物的东西打魔物，划算，也危险。", school: "talisman", rarity: "uncommon" },
      { name: "铁胆锤", desc: "边锋铁胆铸的锤，抡起来风声先到。慢，但到的那一下没有第二个结果。", school: "body", rarity: "rare" },
      { name: "裂天断刃", desc: "裂天墟里捡的断刃，缺口处还在崩碎。它自己也在碎，可碎之前够你砍几刀。", school: "sword", rarity: "epic" },
    ],
    armor: [
      { name: "城卫铁甲", desc: "制式铁甲，胸前有编号。穿上它你就是第几百几十个，死了也有编号。", school: "general", rarity: "common" },
      { name: "魔纹袍", desc: "袍上纹路是魔物的血画的，会动。穿的人说暖和，旁人看着发冷。", school: "talisman", rarity: "uncommon" },
      { name: "北溟鲛皮", desc: "寒鲛的皮，湿冷，刀砍上去会滑开。代价是穿上后身上常年不干。", school: "pill", rarity: "rare" },
      { name: "血河鳞甲", desc: "血河妖鸦的羽与鳞混编，红得发暗。它挡过一次致命伤，之后就再没洗过。", school: "body", rarity: "rare" },
      { name: "云门羽衣", desc: "云门峰的风羽织成，轻得几乎不存在。穿它的人多半跑得快——因为护不住。", school: "general", rarity: "epic" },
    ],
    helmet: [
      { name: "铁盔", desc: "一整块铁压在头上，视野只剩一条缝。看得少，挨得也少。", school: "general", rarity: "common" },
      { name: "魔角盔", desc: "盔上两支魔角，看着唬人。唬人也是本事，能少打一场是一场。", school: "body", rarity: "uncommon" },
      { name: "观星额环", desc: "环上嵌着七颗碎石，据说是星。真假不知，但神识确实清了些。", school: "talisman", rarity: "rare" },
      { name: "寒鲛面甲", desc: "鲛皮贴面，呼吸时一层白霜。看不见你的脸，也看不见你怕不怕。", school: "talisman", rarity: "epic" },
    ],
    shoes: [
      { name: "军靴", desc: "边锋城发的靴子，磨脚。城主说：脚磨破了才会记住走过的路。", school: "general", rarity: "common" },
      { name: "铁蹄战靴", desc: "靴底钉铁，踩在石上冒火星。重，但站住了就推不动。", school: "body", rarity: "uncommon" },
      { name: "踏风羽履", desc: "风羽编的履，落地无声。轻的东西都脆，别指望它挡刀。", school: "general", rarity: "rare" },
      { name: "魔血重靴", desc: "浸过魔血的靴，沉得像灌了铅。跑不快，可站在原地就是一堵墙。", school: "body", rarity: "epic" },
    ],
  },
};

function buildRows() {
  const rows: (typeof items.$inferInsert)[] = [];
  for (const segment of SEGMENTS) {
    const plan = BLUEPRINTS[segment.key];
    if (!plan) continue;
    for (const [slot, list] of Object.entries(plan)) {
      (list || []).forEach((bp, index) => {
        const typedSlot = slot as Slot;
        rows.push({
          id: `item_four_realms_${segment.key}_${typedSlot}_x${index + 1}`,
          name: bp.name,
          description: `${bp.desc}（${SCHOOL_SECONDARY[bp.school]}倾向）`,
          itemType: typedSlot,
          rarity: bp.rarity,
          effects: buildEffects(typedSlot, bp.school, segment.mult, bp.rarity),
          price: Math.round(30 * segment.mult * RARITY_MULT[bp.rarity]),
          stackable: false,
          isBound: false,
          minRealm: segment.minRealm,
          maxRealm: segment.maxRealm,
        });
      });
    }
  }
  return rows;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = buildRows();
  console.log(`新增装备 ${rows.length} 件`);
  if (!apply) {
    for (const row of rows.slice(0, 8)) {
      console.log(`  [${row.rarity}] ${row.name} (${row.minRealm}-${row.maxRealm}) ${JSON.stringify(row.effects)}`);
    }
    console.log("  …（加 --apply 写入）");
    return;
  }
  for (const row of rows) {
    await db.insert(items).values(row)
      .onConflictDoUpdate({ target: items.id, set: row })
      .run();
  }
  console.log("写入完成");
}

void main();

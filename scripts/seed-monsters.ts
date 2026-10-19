/**
 * 野怪扩充：40 → 80。
 *
 * 现状：13 张图共 40 只怪，最稀疏的图只有 2 只（蓬莱岛/裂天墟/雾海泽/云门峰），
 *       每段 10 只，打到后期反复刷同样的几只。
 *
 * 本脚本新增 40 只（每段各 10 只），并按「同图同段」放置：
 *   蓬莱岛/黑松林/石骨洞/青石里 → 练气；赤砂驿/地火谷/太行山 → 筑基；
 *   雾海泽/夜河古冢/柳渡集 → 结丹；边锋城/裂天墟/云门峰 → 元婴。
 *   柳渡集、青石里、太行山本就跨段（通道图），新怪沿用各自图内已有段位。
 *
 * 数值不拍脑袋：用库里真实怪物的等级锚点做线性插值，
 * 保证新怪与同图同段的老怪强度一致（练气 lv7 hp437/atk36/def18，元婴 lv22 hp2913/atk248/def126）。
 *
 * 用法：
 *   bun run scripts/seed-monsters.ts --apply
 */
import { db } from "@/db";
import { monsters } from "@/db/schema";

type DropRow = { chance: number; itemId: string; minQuantity: number; maxQuantity: number };
type MonsterType = "normal" | "elite" | "boss";

interface Anchor {
  lv: number;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  luck: number;
  sense: number;
}

/** 锚点取自库里真实怪物，中间等级线性插值 */
const ANCHORS: Anchor[] = [
  { lv: 2, hp: 309, atk: 26, def: 13, spd: 7, luck: 4, sense: 0 },
  { lv: 7, hp: 437, atk: 36, def: 18, spd: 9, luck: 5, sense: 1 },
  { lv: 12, hp: 900, atk: 62, def: 30, spd: 11, luck: 6, sense: 2 },
  { lv: 16, hp: 1400, atk: 120, def: 55, spd: 13, luck: 7, sense: 3 },
  { lv: 20, hp: 2200, atk: 200, def: 95, spd: 16, luck: 9, sense: 5 },
  { lv: 24, hp: 3200, atk: 280, def: 140, spd: 19, luck: 11, sense: 7 },
];

function statsForLevel(level: number, type: MonsterType) {
  let lower = ANCHORS[0];
  let upper = ANCHORS[ANCHORS.length - 1];
  for (let i = 0; i < ANCHORS.length - 1; i += 1) {
    if (level >= ANCHORS[i].lv && level <= ANCHORS[i + 1].lv) {
      lower = ANCHORS[i];
      upper = ANCHORS[i + 1];
      break;
    }
  }
  const span = upper.lv - lower.lv || 1;
  const t = (level - lower.lv) / span;
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
  // 精英与首领在基础值上加压，沿用既有怪的强弱层次
  const boost = type === "elite" ? 1.35 : type === "boss" ? 1.8 : 1;
  return {
    hp: Math.round(lerp(lower.hp, upper.hp) * boost),
    attack: Math.round(lerp(lower.atk, upper.atk) * boost),
    defense: Math.round(lerp(lower.def, upper.def) * boost),
    speed: lerp(lower.spd, upper.spd),
    luck: lerp(lower.luck, upper.luck),
    spiritualSense: lerp(lower.sense, upper.sense),
  };
}

/** 地图尺寸，用来把怪放在图内（不越界） */
const MAPS: Record<string, { w: number; h: number }> = {
  map_four_realms_penglai_island: { w: 18, h: 26 },
  map_four_realms_heisonglin: { w: 22, h: 22 },
  map_four_realms_shigudong: { w: 20, h: 24 },
  map_four_realms_qingshili: { w: 18, h: 22 },
  map_four_realms_chisha_post: { w: 18, h: 22 },
  map_four_realms_dihuogu: { w: 24, h: 24 },
  map_four_realms_taihang: { w: 50, h: 50 },
  map_four_realms_wuhaize: { w: 22, h: 24 },
  map_four_realms_yehe_catacomb: { w: 22, h: 24 },
  map_four_realms_liuduji: { w: 18, h: 24 },
  map_four_realms_bianfeng_city: { w: 20, h: 28 },
  map_four_realms_lietianxu: { w: 24, h: 24 },
  map_four_realms_yunmen_peak: { w: 20, h: 24 },
};

/** 各段可掉材料（复用已入库的材料，确保掉落物真实存在） */
const SEGMENT_MATERIALS: Record<string, string[]> = {
  lq: [
    "item_four_realms_lq_mat_x1", "item_four_realms_lq_mat_x2", "item_four_realms_lq_mat_x3",
    "item_four_realms_lq_mat_x4", "item_four_realms_lq_mat_x5", "item_four_realms_lq_mat_x6",
  ],
  zj: [
    "item_four_realms_zj_mat_x1", "item_four_realms_zj_mat_x2", "item_four_realms_zj_mat_x3",
    "item_four_realms_zj_mat_x4", "item_four_realms_zj_mat_x5", "item_four_realms_zj_mat_x6",
  ],
  jd: [
    "item_four_realms_jd_mat_x1", "item_four_realms_jd_mat_x2", "item_four_realms_jd_mat_x3",
    "item_four_realms_jd_mat_x4", "item_four_realms_jd_mat_x5", "item_four_realms_jd_mat_x6",
  ],
  yy: [
    "item_four_realms_yy_mat_x1", "item_four_realms_yy_mat_x2", "item_four_realms_yy_mat_x3",
    "item_four_realms_yy_mat_x4", "item_four_realms_yy_mat_x5", "item_four_realms_yy_mat_x6",
  ],
};

const SEGMENT_SKILLS: Record<string, string[][]> = {
  lq: [
    ["skill_four_realms_qianchao_jianqi"],
    ["skill_four_realms_xuanshui_huti"],
    ["skill_four_realms_lingsha_fuyu"],
    ["skill_four_realms_yousi_zhenjue"],
  ],
  zj: [
    ["skill_four_realms_posha_daolun"],
    ["skill_four_realms_xueying_fufu"],
    ["skill_four_realms_guiyuan_dunguang"],
    ["skill_four_realms_chuanxin_zhenyu"],
  ],
  jd: [
    ["skill_four_realms_wenxin_lihuo"],
    ["skill_four_realms_jielv_jianyin"],
    ["skill_four_realms_zhaogu_lingfu"],
    ["skill_four_realms_huannian_shihun"],
  ],
  yy: [
    ["skill_four_realms_zhencheng_jianhe"],
    ["skill_four_realms_zhongsheng_yuandun"],
    ["skill_four_realms_huichen_hupo"],
    ["skill_four_realms_xingmang_shehun"],
  ],
};

interface MonsterBlueprint {
  slug: string;
  name: string;
  desc: string;
  level: number;
  type: MonsterType;
  mapId: string;
  segment: "lq" | "zj" | "jd" | "yy";
}

const BLUEPRINTS: MonsterBlueprint[] = [
  // ── 练气（蓬莱岛 3 / 黑松林 3 / 石骨洞 2 / 青石里 2）──
  { slug: "chaochen_jixie", name: "潮痕寄居蟹", level: 3, type: "normal", mapId: "map_four_realms_penglai_island", segment: "lq",
    desc: "背着螺壳在潮线上爬。壳不是它的，是捡来的——岛上谁不是捡别人的东西活着。" },
  { slug: "shibei_haiyao", name: "拾贝海妖", level: 4, type: "normal", mapId: "map_four_realms_penglai_island", segment: "lq",
    desc: "半人半贝，蹲在浅滩捡贝壳。你捡它，它就捡你。" },
  { slug: "wuming_luonu", name: "雾鸣螺女", level: 5, type: "elite", mapId: "map_four_realms_penglai_island", segment: "lq",
    desc: "螺壳里住着个女人的影子，潮起时唱歌。听久了会往海里走。" },
  { slug: "songzhen_due", name: "松针毒蛾", level: 6, type: "normal", mapId: "map_four_realms_heisonglin", segment: "lq",
    desc: "翅膀上的粉沾了要痒三天。林子里的毒，多半不致命，只折磨。" },
  { slug: "fuye_guitu", name: "腐叶鬼菇", level: 7, type: "normal", mapId: "map_four_realms_heisonglin", segment: "lq",
    desc: "长在腐叶下的伞，踩一脚喷一股黑雾。它不动，但你得先踩上去。" },
  { slug: "heisong_xiongyao", name: "黑松熊妖", level: 9, type: "elite", mapId: "map_four_realms_heisonglin", segment: "lq",
    desc: "成了精的黑熊，胸口一道旧疤。猎户的枪留在里头，它没死，猎户死了。" },
  { slug: "gufeng_xie", name: "骨缝蝎", level: 10, type: "normal", mapId: "map_four_realms_shigudong", segment: "lq",
    desc: "住在石骨缝里的蝎子，尾钩发白。它咬过的骨头，会慢慢变成石头的颜色。" },
  { slug: "shisui_chong", name: "石髓虫", level: 11, type: "elite", mapId: "map_four_realms_shigudong", segment: "lq",
    desc: "啃石髓为生，爬过的地方留下一条白痕。洞里的白痕越多，说明它越肥。" },
  { slug: "tiandian_daomei", name: "田间稻魅", level: 5, type: "normal", mapId: "map_four_realms_qingshili", segment: "lq",
    desc: "稻子成精，最爱在夜里拔别人的秧。农人不赶它，赶了要歉收。" },
  { slug: "mopan_shiyao", name: "磨盘石妖", level: 8, type: "normal", mapId: "map_four_realms_qingshili", segment: "lq",
    desc: "村口废弃的磨盘成了精，推着人转圈。转够了才放人走。" },

  // ── 筑基（赤砂驿 4 / 地火谷 3 / 太行山 3）──
  { slug: "shadao_youqi", name: "沙盗游骑", level: 13, type: "normal", mapId: "map_four_realms_chisha_post", segment: "zj",
    desc: "赤砂驿外绕圈的散匪，不抢大的，只抢落单的。" },
  { slug: "yilu_elang", name: "驿路饿狼", level: 14, type: "normal", mapId: "map_four_realms_chisha_post", segment: "zj",
    desc: "跟着驿路走的狼，认得包裹的气味。它不咬最壮的，咬最后一个。" },
  { slug: "chisha_xiewang", name: "赤砂蝎王", level: 15, type: "elite", mapId: "map_four_realms_chisha_post", segment: "zj",
    desc: "砂下藏着的一只大蝎，尾钩一刺入骨。驿卒说：被它扎过的人，活不过三天。" },
  { slug: "shabao_meiying", name: "沙暴魅影", level: 16, type: "normal", mapId: "map_four_realms_chisha_post", segment: "zj",
    desc: "风起时成形，风停时散。你砍到的那一刀，砍的是砂。" },
  { slug: "rongyan_xie", name: "熔岩蟹", level: 15, type: "normal", mapId: "map_four_realms_dihuogu", segment: "zj",
    desc: "壳是烧红的，走在灰里留一行焦印。抓它要等它蜕壳那半个时辰。" },
  { slug: "huomai_shiling", name: "火脉石灵", level: 16, type: "elite", mapId: "map_four_realms_dihuogu", segment: "zj",
    desc: "守着火脉的石头成了精。它不说话，只是站在那里，谁靠近就把谁烤熟。" },
  { slug: "huijin_fu", name: "灰烬蝠", level: 15, type: "normal", mapId: "map_four_realms_dihuogu", segment: "zj",
    desc: "倒挂在火口上方，翅膀一扇落一层灰。灰里带着火星，落在身上就是一串泡。" },
  { slug: "shandao_jianjingke", name: "山道剪径客", level: 13, type: "normal", mapId: "map_four_realms_taihang", segment: "zj",
    desc: "太行山道上的劫匪，刀不利，话很多。话多是因为他们还想谈。" },
  { slug: "tieti_langqi", name: "铁蹄狼骑", level: 14, type: "normal", mapId: "map_four_realms_taihang", segment: "zj",
    desc: "狼背上坐着个没脸的骑手。狼跑得快，骑手从不下来。" },
  { slug: "yading_yingyao", name: "崖顶鹰妖", level: 16, type: "elite", mapId: "map_four_realms_taihang", segment: "zj",
    desc: "蹲在崖顶看人爬山，等你到最险处才俯冲。它很有耐心。" },

  // ── 结丹（雾海泽 4 / 夜河古冢 4 / 柳渡集 2）──
  { slug: "wuzhong_yugui", name: "雾中渔鬼", level: 17, type: "normal", mapId: "map_four_realms_wuhaize", segment: "jd",
    desc: "溺死在雾里的渔人，还在撒网。它撒的网上来的是活人。" },
  { slug: "zepan_shuihouzi", name: "泽畔水猴子", level: 18, type: "normal", mapId: "map_four_realms_wuhaize", segment: "jd",
    desc: "蹲在水边学人哭。你过去看，它的手已经抓住你的脚踝。" },
  { slug: "lianxin_yaoe", name: "莲心妖娥", level: 18, type: "elite", mapId: "map_four_realms_wuhaize", segment: "jd",
    desc: "附在灵莲上的蛾，翅膀是莲心磨的粉。它护莲，也吃采莲的人。" },
  { slug: "wuhai_shayao", name: "雾海鲨妖", level: 19, type: "normal", mapId: "map_four_realms_wuhaize", segment: "jd",
    desc: "雾里游的鲨，看不见血也能找到你。泽上没有船是安全的。" },
  { slug: "zhongzhong_shoudenggui", name: "冢中守灯鬼", level: 17, type: "normal", mapId: "map_four_realms_yehe_catacomb", segment: "jd",
    desc: "提着灯在墓道里走，灯是给死人照路的。你把灯吹了，它就看不见自己。" },
  { slug: "poguan_shikui", name: "破棺尸傀", level: 18, type: "normal", mapId: "map_four_realms_yehe_catacomb", segment: "jd",
    desc: "棺破了它也没躺回去，站在旁边等。等什么，它自己大概也忘了。" },
  { slug: "yehe_yuantong", name: "夜河怨童", level: 19, type: "elite", mapId: "map_four_realms_yehe_catacomb", segment: "jd",
    desc: "孩子的模样，声音也是孩子的。它问你要糖，你给了，它还要别的。" },
  { slug: "daomu_guixiu", name: "盗墓鬼修", level: 20, type: "normal", mapId: "map_four_realms_yehe_catacomb", segment: "jd",
    desc: "活着的时候盗墓，死了接着盗。它比守墓的更熟悉墓。" },
  { slug: "dukou_taozhaigui", name: "渡口讨债鬼", level: 17, type: "normal", mapId: "map_four_realms_liuduji", segment: "jd",
    desc: "站在渡口向每个上岸的人讨船钱。它生前欠了别人的，死后改讨别人的。" },
  { slug: "chenchuan_shuigui", name: "沉船水鬼", level: 19, type: "normal", mapId: "map_four_realms_liuduji", segment: "jd",
    desc: "跟着沉船沉下去的，船烂了它还在。水面上看是浮萍，水下是手。" },

  // ── 元婴（边锋城 4 / 裂天墟 3 / 云门峰 3）──
  { slug: "chengjiao_moquan", name: "城郊魔犬", level: 22, type: "normal", mapId: "map_four_realms_bianfeng_city", segment: "yy",
    desc: "吃过魔髓的狗，眼睛是红的。它认得城门，也从城门出去。" },
  { slug: "taobing_yuanhun", name: "逃兵怨魂", level: 23, type: "normal", mapId: "map_four_realms_bianfeng_city", segment: "yy",
    desc: "临阵脱逃被斩的城卫，还在城下排队。他不知道自己已经死了。" },
  { slug: "tiejia_mowei", name: "铁甲魔卫", level: 24, type: "elite", mapId: "map_four_realms_bianfeng_city", segment: "yy",
    desc: "穿着制式铁甲的魔物，甲上有编号。编号是城主的，不是它的。" },
  { slug: "chengxia_qihuogui", name: "城下乞活鬼", level: 22, type: "normal", mapId: "map_four_realms_bianfeng_city", segment: "yy",
    desc: "蹲在城墙根讨一口气的鬼。城门开了三十年，它没进去过。" },
  { slug: "bengshi_mokui", name: "崩石魔傀", level: 23, type: "normal", mapId: "map_four_realms_lietianxu", segment: "yy",
    desc: "墟里崩碎的石头聚成的傀儡，一边走一边掉渣。它自己也在崩。" },
  { slug: "xuzhong_tianlieshou", name: "墟中天裂兽", level: 24, type: "elite", mapId: "map_four_realms_lietianxu", segment: "yy",
    desc: "从裂口里下来的兽，身上还挂着不属于这边的天。它回不去了，所以很凶。" },
  { slug: "shihuang_moxiu", name: "拾荒魔修", level: 23, type: "normal", mapId: "map_four_realms_lietianxu", segment: "yy",
    desc: "在墟里捡东西的魔修，捡什么都往怀里塞。你杀他，他怀里掉出来的都是别人的。" },
  { slug: "fengding_fengsun", name: "峰顶风隼", level: 23, type: "normal", mapId: "map_four_realms_yunmen_peak", segment: "yy",
    desc: "云门峰顶的隼，逆着风也不扇翅膀。它比风更懂这座山。" },
  { slug: "yunzhong_jianling", name: "云中剑灵", level: 24, type: "elite", mapId: "map_four_realms_yunmen_peak", segment: "yy",
    desc: "断在云里的剑成了灵，还在找它的主人。主人早死了，它不信。" },
  { slug: "xuexian_baiyuan", name: "雪线白猿", level: 22, type: "normal", mapId: "map_four_realms_yunmen_peak", segment: "yy",
    desc: "雪线以上的白猿，不伤人，只抢东西。抢了也不吃，堆在窝里。" },
];

function buildRows() {
  const perMapIndex: Record<string, number> = {};
  return BLUEPRINTS.map((bp) => {
    const stats = statsForLevel(bp.level, bp.type);
    const map = MAPS[bp.mapId] || { w: 20, h: 24 };
    // 在图内按索引错开摆放，避免叠在同一格，也绝不越界
    const idx = perMapIndex[bp.mapId] ?? 0;
    perMapIndex[bp.mapId] = idx + 1;
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const positionX = Math.min(map.w - 2, Math.round(map.w * 0.3) + col * 3);
    const positionY = Math.min(map.h - 2, Math.round(map.h * 0.3) + row * 3);

    const materialPool = SEGMENT_MATERIALS[bp.segment];
    const drops: DropRow[] = [
      {
        chance: bp.type === "elite" ? 0.5 : 0.38,
        itemId: materialPool[idx % materialPool.length],
        minQuantity: 1,
        maxQuantity: 2,
      },
    ];
    // 精英多掉一份，给反复刷一个理由
    if (bp.type === "elite") {
      drops.push({
        chance: 0.28,
        itemId: materialPool[(idx + 3) % materialPool.length],
        minQuantity: 1,
        maxQuantity: 1,
      });
    }

    const skillPool = SEGMENT_SKILLS[bp.segment];
    const skills = skillPool[idx % skillPool.length];

    return {
      id: `mon_four_realms_${bp.segment}_${bp.slug}`,
      name: bp.name,
      description: bp.desc,
      monsterType: bp.type,
      level: bp.level,
      hp: stats.hp,
      attack: stats.attack,
      defense: stats.defense,
      speed: stats.speed,
      luck: stats.luck,
      spiritualSense: stats.spiritualSense,
      armorPenetration: bp.type === "elite" ? Math.round(bp.level * 0.8) : 0,
      block: bp.type === "elite" ? Math.round(bp.level * 0.5) : 0,
      // 注意：skill_damage_bonus 是 integer（不是小数），按等级给整数百分比
      skillDamageBonus: bp.type === "elite" ? Math.round(bp.level * 0.4) : 0,
      skillDamageReduction: 0,
      artifactDamageBonus: 0,
      artifactDamageReduction: 0,
      skills,
      drops,
      xpReward: 0,
      goldReward: Math.round(12 + bp.level * 4 + (bp.type === "elite" ? 30 : 0)),
      mapId: bp.mapId,
      positionX,
      positionY,
      respawnSeconds: bp.type === "elite" ? 300 : 120,
    };
  });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = buildRows();
  console.log(`新增野怪 ${rows.length} 只`);
  if (!apply) {
    for (const row of rows.slice(0, 6)) {
      console.log(`  lv${row.level} [${row.monsterType}] ${row.name} hp${row.hp}/atk${row.attack}/def${row.defense} @(${row.positionX},${row.positionY})`);
    }
    console.log("  …（加 --apply 写入）");
    return;
  }
  for (const row of rows) {
    await db.insert(monsters).values(row)
      .onConflictDoUpdate({ target: monsters.id, set: row })
      .run();
  }
  console.log("写入完成");
}

void main();

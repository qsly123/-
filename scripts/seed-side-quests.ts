/**
 * 播种静态任务：支线剧情（不可重复）+ 日常（每日可重复一次）。
 *
 * 全部为固定文本，不依赖 AI：接取台词、完成台词、需求、奖励都写死。
 * 需求目标（怪物 / 物品 / NPC）全部取自离线包已有数据，保证真实可获得。
 *
 * 用法：
 *   bun run scripts/seed-side-quests.ts --apply
 */
import { db } from "@/db";
import { quests } from "@/db/schema";

type SeedQuest = typeof quests.$inferInsert;

/** 需求：击杀 */
function kill(targetId: string, targetName: string, quantity: number) {
  return { type: "kill", quantity, targetId, targetName } as never;
}

/** 需求：收集 */
function collect(targetId: string, targetName: string, quantity: number) {
  return { type: "collect", quantity, targetId, targetName } as never;
}

/** 需求：传话（找某 NPC 交谈） */
function talk(targetId: string, targetName: string) {
  return { type: "talk", quantity: 1, targetId, targetName } as never;
}

// ────────────────────────────── 支线剧情 ──────────────────────────────
// 定位：一次性小故事，补世界观，不与主线争道。基调沿用主线——
// 「这里没有人会白白护着你」，所以支线也少有感激，多是各取所需。

const SIDE_QUESTS: SeedQuest[] = [
  // ── 蓬莱岛（练气） ──
  {
    id: "quest_side_pl_menglao_net",
    name: "补网的规矩",
    description: "孟老的渔网烂了三处，他需要泡网的药草。",
    questCategory: "side",
    questType: "collect",
    acceptNpcId: "npc_four_realms_menglao",
    completeNpcId: "npc_four_realms_menglao",
    acceptStory: "孟老把一张烂网摔在你脚边，网眼大得能漏过一条狗。“网烂了，鱼跑了，人就饿。”他蹲下去补，“你要么帮我，要么看着。”",
    completeStory: "孟老把草浸进木盆，手上的裂口泡得发白。他没道谢，只从腰间摸出一串钱塞给你。“岛上的规矩：干活有价，谢字不值钱。”",
    requirements: [collect("item_four_realms_lianqi_material_1", "海雾草", 3)],
    rewards: { gold: 12, xp: 30 },
    prerequisites: [],
    minRealm: 1,
    maxRealm: 12,
    repeatable: false,
    repeatCycle: "none",
  },
  {
    id: "quest_side_pl_zhou_scale",
    name: "药铺的秤",
    description: "周娘子要的石骨碎片，说是入药，可她不肯说治谁。",
    questCategory: "side",
    questType: "collect",
    acceptNpcId: "npc_four_realms_zhouniangzi",
    completeNpcId: "npc_four_realms_zhouniangzi",
    acceptStory: "周娘子的秤杆搁在柜上，秤砣压着一张空药方。“石骨碎片三片，磨了入药。”她抬眼看你，“别问治谁。”",
    completeStory: "她把碎片倒进碾槽，碾得很慢。“码头那个扛包的，肺里进了海雾。”她终于说，“他没钱。这药我贴。”说完把秤砣往回一拨，不再看你。",
    requirements: [collect("item_four_realms_lianqi_material_3", "石骨碎片", 3)],
    rewards: { gold: 18, xp: 40, items: [{ itemId: "item_four_realms_lianqi_pill_xp", quantity: 1 }] },
    prerequisites: [],
    minRealm: 1,
    maxRealm: 12,
    repeatable: false,
    repeatCycle: "none",
  },
  {
    id: "quest_side_pl_ding_wound",
    name: "巡海的旧伤",
    description: "丁巡海腿上有旧伤，礁岸的蟹却越聚越多。",
    questCategory: "side",
    questType: "kill",
    acceptNpcId: "npc_four_realms_dingxunhai",
    completeNpcId: "npc_four_realms_dingxunhai",
    acceptStory: "丁巡海拄着枪站在礁上，裤管卷起，小腿一道旧疤泛着青。“礁缝里的蟹又肥了。”他往海里努嘴，“我这条腿追不动，你替我跑一趟。”",
    completeStory: "他验过蟹壳上的裂口，点头。“是它们。”枪尖在地上顿了顿，“我十七岁挨了这一下，躺了半年。岛上没人替我出头——所以后来我自己站出来了。”",
    requirements: [kill("mon_four_realms_lq_jinbei_jiaxie", "金背礁蟹", 5)],
    rewards: { gold: 15, xp: 45 },
    prerequisites: [],
    minRealm: 1,
    maxRealm: 12,
    repeatable: false,
    repeatCycle: "none",
  },

  // ── 太行山（筑基） ──
  {
    id: "quest_side_th_li_vine",
    name: "枯藤噬骨",
    description: "李师兄要清掉山道上的噬骨藤，他不许弟子单独上山。",
    questCategory: "side",
    questType: "kill",
    acceptNpcId: "npc_four_realms_lishixiong",
    completeNpcId: "npc_four_realms_lishixiong",
    acceptStory: "李师兄把一截断藤丢在你面前，断口还挂着血丝。“去年有个弟子不信邪，一个人上去。”他停了停，“藤还活着，他没回来。”",
    completeStory: "他听完你的回报，只说了句“记下了”。末了又补一句：“下次别一个人。山上不缺勇，缺活着回来的。”",
    requirements: [kill("mon_four_realms_zj_kuteng_shigu", "枯藤噬骨藤", 5)],
    rewards: { gold: 26, xp: 120 },
    prerequisites: [],
    minRealm: 13,
    maxRealm: 16,
    repeatable: false,
    repeatCycle: "none",
  },
  {
    id: "quest_side_th_wang_burden",
    name: "樵子的担子",
    description: "王二狗的柴道被魔犬堵了，他不敢自己走。",
    questCategory: "side",
    questType: "kill",
    acceptNpcId: "npc_four_realms_wangergou",
    completeNpcId: "npc_four_realms_wangergou",
    acceptStory: "王二狗把柴担搁在地上，手心全是汗。“不是我懒。”他压低声音，“山那头有东西叫，叫得像我娘。”",
    completeStory: "他听完，蹲下去把柴绳重新捆了一遍，捆得很紧。“我娘死了十年。”他说，“它叫得不像。可我还是不敢走。”他把担子挑起来，这次没再搁下。",
    requirements: [kill("mon_four_realms_zj_liegu_moquan", "裂骨魔犬", 4)],
    rewards: { gold: 24, xp: 110 },
    prerequisites: [],
    minRealm: 13,
    maxRealm: 16,
    repeatable: false,
    repeatCycle: "none",
  },

  // ── 赤砂驿（筑基） ──
  {
    id: "quest_side_cs_jiang_road",
    name: "驿道不宁",
    description: "江望北要重开驿道，得先清掉路上拦人的魔徒。",
    questCategory: "side",
    questType: "kill",
    acceptNpcId: "npc_four_realms_jiangwangbei",
    completeNpcId: "npc_four_realms_jiangwangbei",
    acceptStory: "江望北摊开一张驿路图，几处标了红。“这条路断了两个月。”他敲了敲图，“商队绕行，驿卒饿死。我不求他们感激，只求路通。”",
    completeStory: "他拔掉最后一处红标。“路通了。”他把图卷起，又松开，“你知道最难过的是什么？不是魔徒，是等路的人等成了不等。”",
    requirements: [kill("mon_four_realms_zj_yidao_motu", "驿道魔徒", 5)],
    rewards: { gold: 28, xp: 130 },
    prerequisites: [],
    minRealm: 13,
    maxRealm: 16,
    repeatable: false,
    repeatCycle: "none",
  },
  {
    id: "quest_side_cs_rendan_debt",
    name: "丹房的赊账",
    description: "任丹娘缺一味血纹符皮，她说赊账的多了，丹房快撑不住。",
    questCategory: "side",
    questType: "collect",
    acceptNpcId: "npc_four_realms_rendanniang",
    completeNpcId: "npc_four_realms_rendanniang",
    acceptStory: "任丹娘翻着账本，一页页都是名字，没一页有钱。“符皮两片，我从太行走货。”她合上账，“这单我不加价，你也别劝我关门。”",
    completeStory: "她把符皮铺在案上，指尖划过纹路。“这些名字里，有三个是死人。”她抬眼，“死人的账我不划，留着。活人问我为何不关门——因为关门了，就没人记得他们赊过。”",
    requirements: [collect("item_four_realms_zhuji_material_3", "血纹符皮", 2)],
    rewards: { gold: 30, xp: 120, items: [{ itemId: "item_four_realms_lianqi_pill_xp", quantity: 2 }] },
    prerequisites: [],
    minRealm: 13,
    maxRealm: 16,
    repeatable: false,
    repeatCycle: "none",
  },

  // ── 地火谷（筑基） ──
  {
    id: "quest_side_dh_chiyan_fire",
    name: "守火人不灭火",
    description: "池焰守着谷里的火脉，蜈蚣却在啃火脉的根。",
    questCategory: "side",
    questType: "kill",
    acceptNpcId: "npc_four_realms_chiyan",
    completeNpcId: "npc_four_realms_chiyan",
    acceptStory: "池焰蹲在火脉旁，用铁钳夹起一只烧焦的蜈蚣。“它在啃根。”他把焦尸丢进火里，“火灭了，谷里的炉子全停。我不灭火，我只灭它。”",
    completeStory: "火脉的火苗稳了些。池焰没看火，看着你的手：“你手上没起泡，说明你没贪近。”他把铁钳递过来，“下次还你来夹。守火的人，得学会忍热。”",
    requirements: [kill("mon_four_realms_zj_lihuo_wugong", "离火蜈蚣", 6)],
    rewards: { gold: 32, xp: 140 },
    prerequisites: [],
    minRealm: 13,
    maxRealm: 16,
    repeatable: false,
    repeatCycle: "none",
  },

  // ── 柳渡集（结丹） ──
  {
    id: "quest_side_ld_liu_ledger",
    name: "渡口的旧账",
    description: "柳娘让你去看一个垂暮的老者，她说那是她欠的账。",
    questCategory: "side",
    questType: "talk",
    acceptNpcId: "npc_four_realms_liuniang",
    completeNpcId: "npc_four_realms_liuniang",
    acceptStory: "柳娘擦着柜台，擦到一处停住。“渡口西头有个老人，姓王。”她说得很平，“你去看看他还在不在。别提我。”",
    completeStory: "你回来说他还活着。柳娘“嗯”了一声，继续擦柜台，那处木纹已被她擦得发亮。“二十年前他替我挡过一刀。”她说，“我不去看他，是不想让他知道我还记着。记着就要还，我还没还清。”",
    requirements: [talk("npc_four_realms_old_wangergou", "垂暮王二狗")],
    rewards: { gold: 45, xp: 260 },
    prerequisites: [],
    minRealm: 17,
    maxRealm: 20,
    repeatable: false,
    repeatCycle: "none",
  },
  {
    id: "quest_side_ld_wang_lotus",
    name: "垂暮的一句话",
    description: "垂暮的王二狗想要三朵雾海灵莲，他说有句话要带走。",
    questCategory: "side",
    questType: "collect",
    acceptNpcId: "npc_four_realms_old_wangergou",
    completeNpcId: "npc_four_realms_old_wangergou",
    acceptStory: "老人靠在门框上，呼吸像破风箱。“灵莲三朵，摆在床头。”他咳了两声，“我不入药，我就想闻着它走。”",
    completeStory: "灵莲摆上时，他闭着眼闻了很久。“她当年头上别这个。”他没睁眼，“这辈子我没敢跟她说一句话。你要是遇见想说的人，趁还能说。”当晚他没有再开口。",
    requirements: [collect("item_four_realms_jiedan_material_1", "雾海灵莲", 3)],
    rewards: { gold: 50, xp: 280 },
    prerequisites: [],
    minRealm: 17,
    maxRealm: 20,
    repeatable: false,
    repeatCycle: "none",
  },

  // ── 青石里 / 边锋城（元婴） ──
  {
    id: "quest_side_qs_yun_endgame",
    name: "隐修的残局",
    description: "云老摆了一局残棋，棋缺一枚，缺的那枚在林中成了精。",
    questCategory: "side",
    questType: "kill",
    acceptNpcId: "npc_four_realms_yunlao",
    completeNpcId: "npc_four_realms_yunlao",
    acceptStory: "云老指着石桌上的残局：“这局我下了四十年，缺一枚‘建木’。”他抬手往林里一指，“它自己成了精，不肯回来当棋子。”",
    completeStory: "你把残灵的气息收回。云老把最后一枚按进棋盘，局面立时死了。“赢了。”他笑了一下，随即收了棋，“下棋的人都知道：赢的那刻最空。所以我不急着赢，我急着有得下。”",
    requirements: [kill("mon_four_realms_yy_jianmu_canling", "建木残灵", 4)],
    rewards: { gold: 80, xp: 420 },
    prerequisites: [],
    minRealm: 21,
    maxRealm: 44,
    repeatable: false,
    repeatCycle: "none",
  },
  {
    id: "quest_side_bf_yue_test",
    name: "城主的试探",
    description: "岳定山要你清掉城外的魔化玄狼，他想看看你是什么路数。",
    questCategory: "side",
    questType: "kill",
    acceptNpcId: "npc_four_realms_yuedingshan",
    completeNpcId: "npc_four_realms_yuedingshan",
    acceptStory: "岳定山在高台上俯看你，没请你坐。“城外的狼魔化了六头。”他递下令牌，“去。我看的不是狼死没死，是你怎么杀。”",
    completeStory: "他听完回报，第一次请你上座。“你杀得干净，没多伤一草一木。”他斟了杯酒，“边锋城不缺狠人，缺知道停手的人。这杯给你。”",
    requirements: [kill("mon_four_realms_yy_mohua_xuanlang", "魔化玄狼", 6)],
    rewards: { gold: 90, xp: 460 },
    prerequisites: [],
    minRealm: 21,
    maxRealm: 44,
    repeatable: false,
    repeatCycle: "none",
  },
  {
    id: "quest_side_bf_ali_gall",
    name: "狐崽的铁胆",
    description: "阿狸想要一枚边锋铁胆，说是磨牙用——多半是嘴馋。",
    questCategory: "side",
    questType: "collect",
    acceptNpcId: "npc_four_realms_ali",
    completeNpcId: "npc_four_realms_ali",
    acceptStory: "小狐崽蹲在墙头，尾巴一甩一甩。“铁胆两枚！”她比着爪子，“磨牙的！很硬的！”你分明看见她在咽口水。",
    completeStory: "她抱着铁胆啃了一口，崩了牙，捂着嘴呜呜叫。半晌又从怀里摸出一串糖塞给你：“这个给你。别跟城主说我又崩牙。”说完跳下墙头，尾巴还在甩。",
    requirements: [collect("item_four_realms_yuanying_material_1", "边锋铁胆", 2)],
    rewards: { gold: 40, xp: 300, items: [{ itemId: "item_four_realms_yuanying_material_2", quantity: 1 }] },
    prerequisites: [],
    minRealm: 21,
    maxRealm: 44,
    repeatable: false,
    repeatCycle: "none",
  },
];

// ────────────────────────────── 日常（每日一次） ──────────────────────────────
// 定位：给每个境界段一份稳定的日课，奖励克制（比支线低），
// 用 repeatCycle=daily 限制每日一次，避免无限刷。

const DAILY_QUESTS: SeedQuest[] = [
  {
    id: "quest_daily_pl_reef",
    name: "日课·礁岸清剿",
    description: "丁巡海每日清剿礁岸的蟹群，多一人多一双眼睛。",
    questCategory: "side",
    questType: "kill",
    acceptNpcId: "npc_four_realms_dingxunhai",
    completeNpcId: "npc_four_realms_dingxunhai",
    acceptStory: "丁巡海把枪往礁石上一顿。“老规矩：清六只，报给我。”他补一句，“别贪，蟹群后头有大的。”",
    completeStory: "他数过你报的数，点头。“收工。”枪尖挑起一只蟹壳丢进筐，“明日还有。这活儿没有完的一天。”",
    requirements: [kill("mon_four_realms_lq_jinbei_jiaxie", "金背礁蟹", 6)],
    rewards: { gold: 8, xp: 20 },
    prerequisites: [],
    minRealm: 1,
    maxRealm: 12,
    repeatable: true,
    repeatCycle: "daily",
  },
  {
    id: "quest_daily_pl_herb",
    name: "日课·海雾采药",
    description: "周娘子每日要一批新鲜海雾草，隔夜的不要。",
    questCategory: "side",
    questType: "collect",
    acceptNpcId: "npc_four_realms_zhouniangzi",
    completeNpcId: "npc_four_realms_zhouniangzi",
    acceptStory: "周娘子把空篓递过来。“三株，带露的。”她指了指天，“太阳一高，药性就散了。”",
    completeStory: "她逐株看过叶背的露痕，收下。“够。”她把铜钱数在你手心，一枚一枚，“明日同一时辰。晚了就不要了。”",
    requirements: [collect("item_four_realms_lianqi_material_1", "海雾草", 3)],
    rewards: { gold: 6, xp: 18 },
    prerequisites: [],
    minRealm: 1,
    maxRealm: 12,
    repeatable: true,
    repeatCycle: "daily",
  },
  {
    id: "quest_daily_th_patrol",
    name: "日课·太行巡山",
    description: "李师兄的巡山表，每日一轮，风雨不改。",
    questCategory: "side",
    questType: "kill",
    acceptNpcId: "npc_four_realms_lishixiong",
    completeNpcId: "npc_four_realms_lishixiong",
    acceptStory: "李师兄把巡山牌挂回墙上。“六头魔犬，沿山道走一趟。”他看了看你，“一个人够就一个人去，不够就喊。”",
    completeStory: "他接过巡山牌，在上面刻了一道。“今日无缺。”刻完抬眼，“明日卯时。巡山这差事，最怕的不是险，是有人觉得今日可以不去。”",
    requirements: [kill("mon_four_realms_zj_liegu_moquan", "裂骨魔犬", 6)],
    rewards: { gold: 14, xp: 60 },
    prerequisites: [],
    minRealm: 13,
    maxRealm: 16,
    repeatable: true,
    repeatCycle: "daily",
  },
  {
    id: "quest_daily_cs_escort",
    name: "日课·驿道护送",
    description: "江望北每日要护一批货过驿道，路上总有魔徒。",
    questCategory: "side",
    questType: "kill",
    acceptNpcId: "npc_four_realms_jiangwangbei",
    completeNpcId: "npc_four_realms_jiangwangbei",
    acceptStory: "江望北清点着货箱。“今日六头魔徒，按老例清掉。”他把一盏灯塞给你，“天黑得快，拿着。”",
    completeStory: "货队过去，他吹熄了灯。“人到齐，货没少。”他把灯收回，“明日还有一趟。路是一天一天通出来的。”",
    requirements: [kill("mon_four_realms_zj_yidao_motu", "驿道魔徒", 6)],
    rewards: { gold: 16, xp: 65 },
    prerequisites: [],
    minRealm: 13,
    maxRealm: 16,
    repeatable: true,
    repeatCycle: "daily",
  },
  {
    id: "quest_daily_ld_dredge",
    name: "日课·雾海疏浚",
    description: "柳娘雇人每日疏浚渡口的雾，水魅聚了就得出事。",
    questCategory: "side",
    questType: "kill",
    acceptNpcId: "npc_four_realms_liuniang",
    completeNpcId: "npc_four_realms_liuniang",
    acceptStory: "柳娘用竿子拨着雾。“水魅六只，散在渡口。”她收回竿子，“雾太厚，明早的船就开不了。”",
    completeStory: "雾薄了一层，能看见对岸的灯。柳娘把工钱放在柜上。“今日的。”她顿了顿，“明日若起大雾，工钱翻倍。开不了船，客人是要骂人的。”",
    requirements: [kill("mon_four_realms_jd_xuanlu_shuimei", "玄露水魅", 6)],
    rewards: { gold: 26, xp: 140 },
    prerequisites: [],
    minRealm: 17,
    maxRealm: 20,
    repeatable: true,
    repeatCycle: "daily",
  },
  {
    id: "quest_daily_bf_watch",
    name: "日课·边锋城防",
    description: "岳定山的城防日课：城外十里，狼群不退。",
    questCategory: "side",
    questType: "kill",
    acceptNpcId: "npc_four_realms_yuedingshan",
    completeNpcId: "npc_four_realms_yuedingshan",
    acceptStory: "岳定山递下巡防牌。“十里之内，六头。”他没多说，“牌还回来的时候，我要知道每一头死在哪。”",
    completeStory: "你看过巡防牌上圈出的六处，点头收下。“城防没有奇功。”他说，“只有今天和明天。今天清了，明天还得清。”",
    requirements: [kill("mon_four_realms_yy_mohua_xuanlang", "魔化玄狼", 6)],
    rewards: { gold: 45, xp: 220 },
    prerequisites: [],
    minRealm: 21,
    maxRealm: 44,
    repeatable: true,
    repeatCycle: "daily",
  },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const all = [...SIDE_QUESTS, ...DAILY_QUESTS];

  console.log(`支线 ${SIDE_QUESTS.length} 条，日常 ${DAILY_QUESTS.length} 条，共 ${all.length} 条`);
  console.log(apply ? "模式：写入数据库" : "模式：预览（加 --apply 才写入）");

  if (!apply) {
    for (const quest of all) {
      console.log(`  [${quest.repeatCycle === "daily" ? "日课" : "支线"}] ${quest.name}  (${quest.minRealm}-${quest.maxRealm ?? "∞"})`);
    }
    return;
  }

  for (const quest of all) {
    await db.insert(quests).values(quest)
      .onConflictDoUpdate({ target: quests.id, set: quest })
      .run();
  }
  console.log("写入完成");
}

void main();

import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import {
  playerWorldEventOffers,
  playerWorldProfiles,
  players,
  playerWorldIncidents,
  worldDistrictStates,
  worldFactions,
  worldMapInstances,
  worldNpcProfiles,
  worldNpcRuntime,
  worldStorylineParticipants,
  worldStorylines,
} from "@/db/schema";
import { listOpenWorldDistricts, resolveOpenWorldDistrictName } from "@/modules/world/services/world-district-service";
import {
  generateOpenWorldDistrictStateFlavor,
  generateOpenWorldFactionTone,
  generateOpenWorldStorylineFlavor,
} from "@/modules/world/services/world-ai-generation";
import {
  listOpenWorldObjectivePoints,
  pickOpenWorldObjectivePoint,
  type OpenWorldObjectivePointType,
} from "@/modules/world/services/world-objective-points";
import { ensureOpenWorldBootstrap } from "@/modules/world/services/world-map-service";
import { ensureOpenWorldSchema } from "@/modules/world/services/world-schema";

type FactionCategory = "orthodox" | "lawful" | "gray" | "demonic" | "rogue";
type StorylineType = "gray_infiltration" | "lawful_purge" | "demonic_expansion";

type FactionSeed = {
  id: string;
  name: string;
  category: FactionCategory;
  tone: string;
  description: string;
  surfaceLabel: string;
  aiPromptHint: string;
  influenceRulesJson: Record<string, number>;
};

type StorylineTemplate = {
  storylineType: StorylineType;
  label: string;
  sourceFactionId: string;
  actionLabel: string;
  supportHint: string;
  objectivePointTypes: OpenWorldObjectivePointType[];
  stages: Array<{
    stageKey: string;
    title: string;
    summary: string;
  }>;
};

function resolveFactionCategoryLabel(category: FactionCategory) {
  if (category === "orthodox") {
    return "正派宗门";
  }
  if (category === "lawful") {
    return "城镇守序";
  }
  if (category === "gray") {
    return "灰线商会";
  }
  if (category === "demonic") {
    return "魔修旁门";
  }
  return "地头散修";
}

type StorylineAdvanceCheck = {
  canAdvance: boolean;
  actionLabel: string;
  hint: string;
  tags: string[];
};

type FactionStandingEntry = {
  favor: number;
  hostility: number;
  summary?: string;
  lastTouchedAt?: string;
  lastIncidentType?: string;
};

type FactionStandingMap = Record<string, FactionStandingEntry>;

type DistrictStateHooks = {
  hotspotTitles?: string[];
  rumorHints?: string[];
  nextHooks?: string[];
  lastIncidentTypes?: string[];
};

const DISTRICT_STATE_SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;
const OPEN_WORLD_FACTION_BOOTSTRAP_CACHE_TTL_MS = 30_000;

type OpenWorldFactionBootstrapGlobalStore = typeof globalThis & {
  __immortalityOpenWorldFactionBootstrapPromise?: Promise<boolean>;
  __immortalityOpenWorldFactionBootstrapReadyUntil?: number;
};

const FACTION_SEEDS: readonly FactionSeed[] = [
  {
    id: "faction_orthodox_sect",
    name: "正派宗门",
    category: "orthodox",
    tone: "门规森严，讲究体面与因果。",
    description: "宗门一系不急着明面抢地，却会通过门人、据点与清剿名义悄悄伸手。",
    surfaceLabel: "宗门气",
    aiPromptHint: "清峻、持重、讲门规，也会藏私心。",
    influenceRulesJson: { lawfulBase: 62, grayBase: 18, demonicBase: 6, localControlBase: 42 },
  },
  {
    id: "faction_town_watch",
    name: "城镇守序",
    category: "lawful",
    tone: "嘴上讲规矩，暗里看风向。",
    description: "城镇里的巡坊、守备与差役不一定清白，但最在乎秩序和面子。",
    surfaceLabel: "官面风",
    aiPromptHint: "守序、讲手续、带点市井精明。",
    influenceRulesJson: { lawfulBase: 70, grayBase: 10, demonicBase: 4, localControlBase: 58 },
  },
  {
    id: "faction_shadow_trade",
    name: "灰线商会",
    category: "gray",
    tone: "认风声，不认来路。",
    description: "商会、掮客、夜路人和黑市小摊之间，最擅长靠利益把人慢慢拖进灰线。",
    surfaceLabel: "灰线气",
    aiPromptHint: "逐利、含蓄、笑里藏刀。",
    influenceRulesJson: { lawfulBase: 16, grayBase: 72, demonicBase: 18, localControlBase: 46 },
  },
  {
    id: "faction_demonic_path",
    name: "魔修旁门",
    category: "demonic",
    tone: "偏爱捷径与弱点，最会引人失足。",
    description: "旁门和魔修不会急着亮旗，却会先拿欲念、血债和利益试人。",
    surfaceLabel: "魔息",
    aiPromptHint: "阴冷、诱惑、不是纯疯子，而是会算账。",
    influenceRulesJson: { lawfulBase: 4, grayBase: 24, demonicBase: 80, localControlBase: 34 },
  },
  {
    id: "faction_local_rogues",
    name: "地头散修",
    category: "rogue",
    tone: "认地盘，认熟脸，也认谁更能打。",
    description: "散修、街坊、地痞与守摊人未必成帮成派，但最容易被局势裹挟。",
    surfaceLabel: "地头气",
    aiPromptHint: "接地气、现实、会趋利避害。",
    influenceRulesJson: { lawfulBase: 28, grayBase: 34, demonicBase: 16, localControlBase: 72 },
  },
] as const;

const STORYLINE_TEMPLATES: readonly StorylineTemplate[] = [
  {
    storylineType: "gray_infiltration",
    label: "灰线渗透链",
    sourceFactionId: "faction_shadow_trade",
    actionLabel: "递线推进",
    supportHint: "更适合有灰活、黑市、接头痕迹的人插手。",
    objectivePointTypes: ["shadow_contact", "black_market_stall", "hidden_shrine"],
    stages: [
      { stageKey: "handshake", title: "递信试水", summary: "灰线先用暗语试你的口风，看你值不值得接下一步买卖。" },
      { stageKey: "stash", title: "藏货落点", summary: "第一批货已经进街，灰巷里开始有人试着藏匿与转手。" },
      { stageKey: "surveil", title: "监听换口", summary: "接头人不再露面，只留下几句要你盯人的风声。" },
      { stageKey: "negotiate", title: "指定交涉", summary: "灰线推你去和关键人物谈条件，成了便能吃进整段门路。" },
      { stageKey: "cleanup", title: "灭口收尾", summary: "当线索开始外泄，灰线会让最了解情况的人亲自收尾。" },
    ],
  },
  {
    storylineType: "lawful_purge",
    label: "守序清剿链",
    sourceFactionId: "faction_town_watch",
    actionLabel: "协查风声",
    supportHint: "更适合风声还不算太脏、愿意借官方口子行事的人。",
    objectivePointTypes: ["rumor_stela", "smuggling_gate", "shadow_contact"],
    stages: [
      { stageKey: "survey", title: "盘查风声", summary: "守序一侧开始在街口盘问，先试图摸清谁在暗地串线。" },
      { stageKey: "layout", title: "布点搜线", summary: "差役和巡坊开始在节点布眼，等人自己撞上来。" },
      { stageKey: "lock", title: "锁定目标", summary: "几条暗线终于连成一股，守序势力准备当街拿人。" },
      { stageKey: "net", title: "收网清剿", summary: "几方人手一同动身，想把整个街区的灰痕撕开。" },
      { stageKey: "tablet", title: "立碑震慑", summary: "清剿之后，谁被留下做样子、谁被放走，都会改变这片地的脸色。" },
    ],
  },
  {
    storylineType: "demonic_expansion",
    label: "魔修扩张链",
    sourceFactionId: "faction_demonic_path",
    actionLabel: "接下邪引",
    supportHint: "更适合接过魔念试探、危险偏好或采补余波的人靠近。",
    objectivePointTypes: ["hidden_shrine", "smuggling_gate", "black_market_stall"],
    stages: [
      { stageKey: "tempt", title: "旁门渗语", summary: "有人先从欲念和秘术下手，不急着亮身份，只想先勾住人心。" },
      { stageKey: "bait", title: "魔息引诱", summary: "街角开始出现带着甜头的偏门路数，引得人悄悄回头。" },
      { stageKey: "blood", title: "血契试炼", summary: "旁门要试谁敢见血、谁敢欠债，一旦应下就很难抽身。" },
      { stageKey: "expand", title: "扩张据点", summary: "旧据点开始向外蔓延，周边黑市和灰线都在被迫选边。" },
      { stageKey: "engulf", title: "吞并街角", summary: "如果没人拦住，整片街区都会习惯于用旁门规矩说话。" },
    ],
  },
] as const;

function clampNumber(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function createDistrictStateId(mapId: string, districtName: string) {
  return `${mapId}:district:${districtName}`;
}

function createStorylineId(mapId: string, districtName: string, storylineType: StorylineType) {
  return `${mapId}:storyline:${districtName}:${storylineType}`;
}

function getFactionSeedById(factionId: string | null | undefined) {
  return FACTION_SEEDS.find((entry) => entry.id === factionId) || null;
}

function getStorylineTemplate(type: string | null | undefined) {
  return STORYLINE_TEMPLATES.find((entry) => entry.storylineType === type) || STORYLINE_TEMPLATES[0];
}

export type OpenWorldStorylineBinding = {
  storylineId: string;
  storylineType: StorylineType;
  storylineTypeLabel: string;
  mapId: string;
  districtName: string;
  stageIndex: number;
  stageLabel: string;
  sourceFactionId: string | null;
  sourceFactionName: string;
  sourceFactionLabel: string;
  objectivePointId: string | null;
  objectivePointLabel: string | null;
  objectiveMapId: string | null;
  objectivePositionX: number | null;
  objectivePositionY: number | null;
};

function getFactionCategoryLabel(category: FactionCategory) {
  switch (category) {
    case "orthodox":
      return "正派宗门";
    case "lawful":
      return "城镇守序";
    case "gray":
      return "灰线商会";
    case "demonic":
      return "魔修旁门";
    default:
      return "地头散修";
  }
}

function getStorylineLabel(type: StorylineType) {
  return getStorylineTemplate(type).label;
}

function resolveStorylineTypeForOfferType(offerType: string | null | undefined): StorylineType | null {
  switch (String(offerType || "").trim()) {
    case "black_market_trade":
    case "shadow_intel":
    case "cultivator_hunt":
    case "gift_lingyu":
    case "treasure_invite":
    case "broker_relief":
      return "gray_infiltration";
    case "demonic_temptation":
      return "demonic_expansion";
    default:
      return null;
  }
}

function resolveStorylineTypeForIncidentType(incidentType: string | null | undefined): StorylineType | null {
  switch (String(incidentType || "").trim()) {
    case "district_storyline_gray":
      return "gray_infiltration";
    case "district_storyline_lawful":
      return "lawful_purge";
    case "district_storyline_demonic":
      return "demonic_expansion";
    case "black_market_trade":
    case "shadow_intel":
    case "cultivator_hunt":
    case "gift_lingyu":
    case "treasure_invite":
    case "broker_relief":
    case "shadow_trade":
    case "offer_accepted":
    case "offer_accept":
      return "gray_infiltration";
    case "demonic_temptation":
    case "dangerous_preference":
    case "essence_drain":
      return "demonic_expansion";
    case "kill_and_loot":
    case "kill_loot":
    case "witnessed":
    case "escaped":
    case "escape":
    case "assassination":
    case "assassinated":
    case "adult_report":
      return "lawful_purge";
    default:
      return null;
  }
}

export function guessOpenWorldFactionIdByName(sourceFactionName: string | null | undefined) {
  const normalized = String(sourceFactionName || "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("魔") || normalized.includes("旁门") || normalized.includes("血煞")) {
    return "faction_demonic_path";
  }
  if (normalized.includes("守") || normalized.includes("官") || normalized.includes("巡") || normalized.includes("城镇")) {
    return "faction_town_watch";
  }
  if (normalized.includes("宗门") || normalized.includes("正派")) {
    return "faction_orthodox_sect";
  }
  if (normalized.includes("散修") || normalized.includes("地头")) {
    return "faction_local_rogues";
  }
  if (
    normalized.includes("灰")
    || normalized.includes("黑市")
    || normalized.includes("暗线")
    || normalized.includes("夜渡")
    || normalized.includes("灰营")
  ) {
    return "faction_shadow_trade";
  }
  return null;
}

function normalizeStandingMap(flagsJson: Record<string, unknown> | null | undefined) {
  const raw = flagsJson && typeof flagsJson === "object" ? flagsJson.openWorldFactionStanding : null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {} as FactionStandingMap;
  }
  const map: FactionStandingMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    map[key] = {
      favor: clampNumber(Number((value as Record<string, unknown>).favor || 0), 0, 999),
      hostility: clampNumber(Number((value as Record<string, unknown>).hostility || 0), 0, 999),
      summary: String((value as Record<string, unknown>).summary || "").trim() || undefined,
      lastTouchedAt: String((value as Record<string, unknown>).lastTouchedAt || "").trim() || undefined,
      lastIncidentType: String((value as Record<string, unknown>).lastIncidentType || "").trim() || undefined,
    };
  }
  return map;
}

function buildStandingSummary(factionName: string, entry: FactionStandingEntry) {
  if (entry.favor >= entry.hostility + 14) {
    return `${factionName}开始把你当作可利用的人。`;
  }
  if (entry.hostility >= entry.favor + 14) {
    return `${factionName}已经记住你的坏名声。`;
  }
  return `${factionName}对你仍处在试探与观望之间。`;
}

function pickPreferredStoryline(params: {
  storylineRows: Array<typeof worldStorylines.$inferSelect>;
  preferredStorylineType?: StorylineType | null;
  preferredFactionId?: string | null;
}) {
  if (params.storylineRows.length <= 0) {
    return null;
  }
  if (params.preferredFactionId) {
    const exactFaction = params.storylineRows.find((row) => row.sourceFactionId === params.preferredFactionId);
    if (exactFaction) {
      return exactFaction;
    }
  }
  if (params.preferredStorylineType) {
    const exactType = params.storylineRows.find((row) => row.storylineType === params.preferredStorylineType);
    if (exactType) {
      return exactType;
    }
  }
  return params.storylineRows
    .slice()
    .sort((left, right) => {
      const rightStage = Number(right.stageIndex || 1);
      const leftStage = Number(left.stageIndex || 1);
      if (rightStage !== leftStage) {
        return rightStage - leftStage;
      }
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    })[0] || null;
}

function pickDistrictStorylineType(districtIndex: number): StorylineType {
  if (districtIndex % 3 === 0) {
    return "gray_infiltration";
  }
  if (districtIndex % 3 === 1) {
    return "lawful_purge";
  }
  return "demonic_expansion";
}

function buildBaseInfluenceForStoryline(type: StorylineType) {
  if (type === "gray_infiltration") {
    return {
      lawfulInfluence: 24,
      grayInfluence: 68,
      demonicInfluence: 18,
      localControl: 56,
      tensionLevel: 34,
      dominantFactionId: "faction_shadow_trade",
      tensionTag: "灰线暗涌",
    };
  }
  if (type === "lawful_purge") {
    return {
      lawfulInfluence: 72,
      grayInfluence: 20,
      demonicInfluence: 10,
      localControl: 64,
      tensionLevel: 38,
      dominantFactionId: "faction_town_watch",
      tensionTag: "守序盘查",
    };
  }
  return {
    lawfulInfluence: 14,
    grayInfluence: 26,
    demonicInfluence: 74,
    localControl: 40,
    tensionLevel: 52,
    dominantFactionId: "faction_demonic_path",
    tensionTag: "魔息潜涨",
  };
}

function resolveDominantFactionId(influence: {
  lawfulInfluence: number;
  grayInfluence: number;
  demonicInfluence: number;
  localControl: number;
}) {
  const options = [
    { factionId: "faction_town_watch", value: influence.lawfulInfluence },
    { factionId: "faction_shadow_trade", value: influence.grayInfluence },
    { factionId: "faction_demonic_path", value: influence.demonicInfluence },
    { factionId: "faction_local_rogues", value: influence.localControl },
  ];
  options.sort((left, right) => right.value - left.value);
  return options[0]?.factionId || "faction_local_rogues";
}

function resolveDangerLabel(level: number) {
  if (level >= 72) {
    return "杀机四伏";
  }
  if (level >= 46) {
    return "暗潮翻涌";
  }
  return "风声未裂";
}

function resolveDistrictTensionTag(params: {
  lawfulInfluence: number;
  grayInfluence: number;
  demonicInfluence: number;
  tensionLevel: number;
}) {
  if (params.tensionLevel >= 72 || params.demonicInfluence >= 70) {
    return "魔修侵街";
  }
  if (params.grayInfluence >= params.lawfulInfluence + 12) {
    return "灰线压街";
  }
  if (params.lawfulInfluence >= params.grayInfluence + 16) {
    return "守序收网";
  }
  if (params.tensionLevel >= 42) {
    return "多方角力";
  }
  return "风平未定";
}

function resolveIncidentFactionAdjustments(incidentType: string) {
  if (["black_market_trade", "shadow_intel", "offer_accepted", "offer_accept", "shadow_trade"].includes(incidentType)) {
    return {
      standings: [
        { factionId: "faction_shadow_trade", favor: 9, hostility: 0 },
        { factionId: "faction_town_watch", favor: 0, hostility: 5 },
      ],
      districtDelta: { lawfulInfluence: -4, grayInfluence: 8, demonicInfluence: 0, localControl: -2, tensionLevel: 5 },
    };
  }
  if (["demonic_temptation", "dangerous_preference", "essence_drain"].includes(incidentType)) {
    return {
      standings: [
        { factionId: "faction_demonic_path", favor: 10, hostility: 0 },
        { factionId: "faction_town_watch", favor: 0, hostility: 6 },
      ],
      districtDelta: { lawfulInfluence: -5, grayInfluence: 2, demonicInfluence: 10, localControl: -3, tensionLevel: 8 },
    };
  }
  if (["kill_and_loot", "kill_loot", "witnessed", "escaped", "escape", "assassination", "assassinated"].includes(incidentType)) {
    return {
      standings: [
        { factionId: "faction_town_watch", favor: 0, hostility: 9 },
        { factionId: "faction_local_rogues", favor: 3, hostility: 0 },
      ],
      districtDelta: { lawfulInfluence: -2, grayInfluence: 3, demonicInfluence: 4, localControl: -5, tensionLevel: 10 },
    };
  }
  if (incidentType === "adult_affair") {
    return {
      standings: [],
      districtDelta: { lawfulInfluence: 0, grayInfluence: 0, demonicInfluence: 0, localControl: 0, tensionLevel: 0 },
    };
  }
  if (incidentType === "adult_report") {
    return {
      standings: [
        { factionId: "faction_shadow_trade", favor: 3, hostility: 0 },
      ],
      districtDelta: { lawfulInfluence: -1, grayInfluence: 3, demonicInfluence: 1, localControl: 0, tensionLevel: 3 },
    };
  }
  if (incidentType === "district_chain_rumor") {
    return {
      standings: [],
      districtDelta: { lawfulInfluence: 0, grayInfluence: 2, demonicInfluence: 2, localControl: -1, tensionLevel: 4 },
    };
  }
  if (incidentType === "district_storyline_gray") {
    return {
      standings: [
        { factionId: "faction_shadow_trade", favor: 11, hostility: 0 },
      ],
      districtDelta: { lawfulInfluence: -5, grayInfluence: 12, demonicInfluence: 0, localControl: -2, tensionLevel: 6 },
    };
  }
  if (incidentType === "district_storyline_lawful") {
    return {
      standings: [
        { factionId: "faction_town_watch", favor: 11, hostility: 0 },
        { factionId: "faction_shadow_trade", favor: 0, hostility: 6 },
      ],
      districtDelta: { lawfulInfluence: 11, grayInfluence: -6, demonicInfluence: -3, localControl: 5, tensionLevel: 5 },
    };
  }
  if (incidentType === "district_storyline_demonic") {
    return {
      standings: [
        { factionId: "faction_demonic_path", favor: 12, hostility: 0 },
      ],
      districtDelta: { lawfulInfluence: -6, grayInfluence: 2, demonicInfluence: 13, localControl: -4, tensionLevel: 9 },
    };
  }
  return {
    standings: [],
    districtDelta: { lawfulInfluence: 0, grayInfluence: 0, demonicInfluence: 0, localControl: 0, tensionLevel: 0 },
  };
}

async function ensureFactionSeeds() {
  const rows = await db.select().from(worldFactions).all();
  const existingIds = new Set(rows.map((row) => row.id));
  for (const seed of FACTION_SEEDS) {
    if (existingIds.has(seed.id)) {
      continue;
    }
    await db.insert(worldFactions).values({
      id: seed.id,
      name: seed.name,
      category: seed.category,
      tone: seed.tone,
      description: seed.description,
      surfaceLabel: seed.surfaceLabel,
      aiPromptHint: seed.aiPromptHint,
      isEnabled: true,
      influenceRulesJson: seed.influenceRulesJson,
      payloadJson: {
        builtin: true,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();
  }
}

export async function ensureOpenWorldFactionStoryBootstrap() {
  const globalStore = globalThis as OpenWorldFactionBootstrapGlobalStore;
  const readyUntil = globalStore.__immortalityOpenWorldFactionBootstrapReadyUntil || 0;
  if (readyUntil > Date.now()) {
    return true;
  }
  if (globalStore.__immortalityOpenWorldFactionBootstrapPromise) {
    return globalStore.__immortalityOpenWorldFactionBootstrapPromise;
  }

  if (!(await ensureOpenWorldSchema())) {
    return false;
  }
  if (!(await ensureOpenWorldBootstrap())) {
    return false;
  }

  globalStore.__immortalityOpenWorldFactionBootstrapPromise = (async () => {
    await ensureFactionSeeds();

    const maps = await db.select({
      id: worldMapInstances.id,
      name: worldMapInstances.name,
      archetype: worldMapInstances.archetype,
    }).from(worldMapInstances).all();
    const npcRows = await db.select({
      id: worldNpcProfiles.id,
      faction: worldNpcProfiles.faction,
      currentMapId: worldNpcRuntime.currentMapId,
      positionX: worldNpcRuntime.positionX,
      positionY: worldNpcRuntime.positionY,
    }).from(worldNpcProfiles)
      .innerJoin(worldNpcRuntime, eq(worldNpcRuntime.npcId, worldNpcProfiles.id))
      .where(eq(worldNpcProfiles.status, "active"))
      .all();

    const existingDistrictRows = await db.select().from(worldDistrictStates).all();
    const existingStorylineRows = await db.select().from(worldStorylines).all();
    const districtIdSet = new Set(existingDistrictRows.map((row) => row.id));
    const storylineIdSet = new Set(existingStorylineRows.map((row) => row.id));

    for (const mapRow of maps) {
      const districts = listOpenWorldDistricts(mapRow.id);
      for (let index = 0; index < districts.length; index += 1) {
        const district = districts[index];
        const storylineType = pickDistrictStorylineType(index);
        const template = getStorylineTemplate(storylineType);
        const baseInfluence = buildBaseInfluenceForStoryline(storylineType);
        const districtStateId = createDistrictStateId(mapRow.id, district.name);
        const objectivePoint = pickOpenWorldObjectivePoint({
          mapId: mapRow.id,
          pointTypes: template.objectivePointTypes,
          districtName: district.name,
        });
        const keyNpcIds = npcRows
          .filter((npc) => npc.currentMapId === mapRow.id && resolveOpenWorldDistrictName({
            mapId: mapRow.id,
            positionX: npc.positionX,
            positionY: npc.positionY,
          }) === district.name)
          .slice(0, 2)
          .map((npc) => npc.id);

        if (!districtIdSet.has(districtStateId)) {
          await db.insert(worldDistrictStates).values({
            id: districtStateId,
            mapId: mapRow.id,
            districtName: district.name,
            districtIndex: index,
            dominantFactionId: baseInfluence.dominantFactionId,
            lawfulInfluence: baseInfluence.lawfulInfluence,
            grayInfluence: baseInfluence.grayInfluence,
            demonicInfluence: baseInfluence.demonicInfluence,
            localControl: baseInfluence.localControl,
            tensionLevel: baseInfluence.tensionLevel,
            tensionTag: baseInfluence.tensionTag,
            hotspotSummary: `${district.name}最近正被${template.label}牵出暗流。`,
            activeHooksJson: {
              hotspotTitles: [template.stages[0].title],
              nextHooks: [template.stages[0].summary],
            },
            payloadJson: {
              baseInfluence,
              archetype: mapRow.archetype,
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }).run();
        }

        const storylineId = createStorylineId(mapRow.id, district.name, storylineType);
        if (!storylineIdSet.has(storylineId)) {
          await db.insert(worldStorylines).values({
            id: storylineId,
            mapId: mapRow.id,
            districtStateId,
            districtName: district.name,
            storylineType,
            status: "active",
            sourceFactionId: template.sourceFactionId,
            stageIndex: 1,
            stageKey: template.stages[0].stageKey,
            stageTitle: template.stages[0].title,
            summary: template.stages[0].summary,
            objectivePointId: objectivePoint?.id || null,
            keyNpcIdsJson: keyNpcIds,
            payloadJson: {
              storylineType,
              stageList: template.stages.map((stage) => stage.title),
              stageSummaryList: template.stages.map((stage) => stage.summary),
              currentObjectivePointId: objectivePoint?.id || null,
              currentObjectivePointLabel: objectivePoint?.label || null,
              currentObjectiveDistrictName: objectivePoint?.districtName || district.name,
              currentObjectiveMapId: objectivePoint?.mapId || mapRow.id,
              tags: [template.label, mapRow.name],
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }).run();
        }
      }
    }

    globalStore.__immortalityOpenWorldFactionBootstrapReadyUntil = Date.now() + OPEN_WORLD_FACTION_BOOTSTRAP_CACHE_TTL_MS;
    return true;
  })().catch((error) => {
    globalStore.__immortalityOpenWorldFactionBootstrapReadyUntil = 0;
    throw error;
  }).finally(() => {
    globalStore.__immortalityOpenWorldFactionBootstrapPromise = undefined;
  });

  return globalStore.__immortalityOpenWorldFactionBootstrapPromise;
}

async function syncWorldDistrictStates(mapId: string) {
  if (!(await ensureOpenWorldFactionStoryBootstrap())) {
    return [];
  }

  const sinceIso = new Date(Date.now() - DISTRICT_STATE_SYNC_WINDOW_MS).toISOString();
  const [districtRows, storylineRows, incidentRows] = await Promise.all([
    db.select().from(worldDistrictStates).where(eq(worldDistrictStates.mapId, mapId)).all(),
    db.select().from(worldStorylines).where(and(eq(worldStorylines.mapId, mapId), eq(worldStorylines.status, "active"))).all(),
    db.select().from(playerWorldIncidents).where(and(
      eq(playerWorldIncidents.mapId, mapId),
      gt(playerWorldIncidents.createdAt, sinceIso),
    )).all(),
  ]);

  for (const districtRow of districtRows) {
    const payloadJson = (districtRow.payloadJson || {}) as Record<string, unknown>;
    const baseInfluence = (payloadJson.baseInfluence || {}) as Record<string, unknown>;
    const districtIncidents = incidentRows.filter((incident) => incident.districtName === districtRow.districtName);
    const districtStorylines = storylineRows.filter((row) => row.districtName === districtRow.districtName);
    let lawfulInfluence = Number(baseInfluence.lawfulInfluence || districtRow.lawfulInfluence || 0);
    let grayInfluence = Number(baseInfluence.grayInfluence || districtRow.grayInfluence || 0);
    let demonicInfluence = Number(baseInfluence.demonicInfluence || districtRow.demonicInfluence || 0);
    let localControl = Number(baseInfluence.localControl || districtRow.localControl || 0);
    let tensionLevel = Number(baseInfluence.tensionLevel || districtRow.tensionLevel || 0);

    for (const incident of districtIncidents) {
      const resolved = resolveIncidentFactionAdjustments(incident.incidentType);
      lawfulInfluence += resolved.districtDelta.lawfulInfluence;
      grayInfluence += resolved.districtDelta.grayInfluence;
      demonicInfluence += resolved.districtDelta.demonicInfluence;
      localControl += resolved.districtDelta.localControl;
      tensionLevel += resolved.districtDelta.tensionLevel;
    }

    for (const storyline of districtStorylines) {
      const template = getStorylineTemplate(storyline.storylineType);
      const stagePush = Math.max(0, Number(storyline.stageIndex || 1) - 1) * 4;
      if (template.storylineType === "gray_infiltration") {
        grayInfluence += 8 + stagePush;
        lawfulInfluence -= Math.floor(stagePush / 2);
      } else if (template.storylineType === "lawful_purge") {
        lawfulInfluence += 8 + stagePush;
        grayInfluence -= Math.floor(stagePush / 2);
        demonicInfluence -= Math.floor(stagePush / 3);
      } else {
        demonicInfluence += 9 + stagePush;
        grayInfluence += Math.floor(stagePush / 3);
        lawfulInfluence -= Math.floor(stagePush / 2);
      }
      tensionLevel += 4 + Math.floor(stagePush / 2);
    }

    const nextValues = {
      lawfulInfluence: clampNumber(lawfulInfluence),
      grayInfluence: clampNumber(grayInfluence),
      demonicInfluence: clampNumber(demonicInfluence),
      localControl: clampNumber(localControl),
      tensionLevel: clampNumber(tensionLevel),
    };
    const dominantFactionId = resolveDominantFactionId(nextValues);
    const hotspotSummary = districtStorylines[0]
      ? `${districtRow.districtName}如今主看${districtStorylines[0].stageTitle}这条线，街面已经明显偏向${getStorylineLabel(districtStorylines[0].storylineType as StorylineType)}。`
      : `${districtRow.districtName}暂无特别突出的势力动向。`;
    const tensionTag = resolveDistrictTensionTag(nextValues);
    const activeHooksJson: DistrictStateHooks = {
      hotspotTitles: districtStorylines.slice(0, 2).map((item) => item.stageTitle),
      nextHooks: districtStorylines.slice(0, 2).map((item) => item.summary),
      lastIncidentTypes: districtIncidents.slice(0, 4).map((item) => item.incidentType),
      rumorHints: districtIncidents.slice(0, 2).map((item) => item.summary),
    };

    await db.update(worldDistrictStates).set({
      dominantFactionId,
      lawfulInfluence: nextValues.lawfulInfluence,
      grayInfluence: nextValues.grayInfluence,
      demonicInfluence: nextValues.demonicInfluence,
      localControl: nextValues.localControl,
      tensionLevel: nextValues.tensionLevel,
      tensionTag,
      hotspotSummary,
      activeHooksJson,
      updatedAt: new Date().toISOString(),
    }).where(eq(worldDistrictStates.id, districtRow.id)).run();
  }

  return await db.select().from(worldDistrictStates).where(eq(worldDistrictStates.mapId, mapId)).all();
}

export async function settleOpenWorldFactionAfterIncident(params: {
  playerId: string;
  incidentType: string;
  mapId?: string | null;
  districtName?: string | null;
  summary: string;
}) {
  if (!(await ensureOpenWorldFactionStoryBootstrap())) {
    return null;
  }

  const profileRow = await db.select().from(playerWorldProfiles).where(eq(playerWorldProfiles.playerId, params.playerId)).get();
  if (!profileRow) {
    return null;
  }

  const adjustments = resolveIncidentFactionAdjustments(params.incidentType);
  const flagsJson = profileRow.flagsJson && typeof profileRow.flagsJson === "object"
    ? { ...(profileRow.flagsJson as Record<string, unknown>) }
    : {};
  const standings = normalizeStandingMap(flagsJson);
  const nowIso = new Date().toISOString();

  adjustments.standings.forEach((item) => {
    const factionSeed = getFactionSeedById(item.factionId);
    const current = standings[item.factionId] || { favor: 0, hostility: 0 };
    const nextEntry: FactionStandingEntry = {
      favor: clampNumber((current.favor || 0) + item.favor, 0, 999),
      hostility: clampNumber((current.hostility || 0) + item.hostility, 0, 999),
      lastTouchedAt: nowIso,
      lastIncidentType: params.incidentType,
      summary: buildStandingSummary(factionSeed?.name || item.factionId, {
        favor: clampNumber((current.favor || 0) + item.favor, 0, 999),
        hostility: clampNumber((current.hostility || 0) + item.hostility, 0, 999),
      }),
    };
    standings[item.factionId] = nextEntry;
  });

  flagsJson.openWorldFactionStanding = standings;
  await db.update(playerWorldProfiles).set({
    flagsJson,
    updatedAt: nowIso,
  }).where(eq(playerWorldProfiles.playerId, params.playerId)).run();

  if (params.mapId && params.districtName) {
    const districtStateId = createDistrictStateId(params.mapId, params.districtName);
    const districtRow = await db.select().from(worldDistrictStates).where(eq(worldDistrictStates.id, districtStateId)).get();
    if (districtRow) {
      await db.update(worldDistrictStates).set({
        lawfulInfluence: clampNumber(districtRow.lawfulInfluence + adjustments.districtDelta.lawfulInfluence),
        grayInfluence: clampNumber(districtRow.grayInfluence + adjustments.districtDelta.grayInfluence),
        demonicInfluence: clampNumber(districtRow.demonicInfluence + adjustments.districtDelta.demonicInfluence),
        localControl: clampNumber(districtRow.localControl + adjustments.districtDelta.localControl),
        tensionLevel: clampNumber(districtRow.tensionLevel + adjustments.districtDelta.tensionLevel),
        updatedAt: nowIso,
      }).where(eq(worldDistrictStates.id, districtStateId)).run();
      await syncWorldDistrictStates(params.mapId);
    }
  }

  return standings;
}

export async function findOpenWorldStorylineBinding(params: {
  mapId?: string | null;
  districtName?: string | null;
  offerType?: string | null;
  incidentType?: string | null;
  sourceFactionId?: string | null;
  sourceFactionName?: string | null;
}) {
  const mapId = String(params.mapId || "").trim();
  if (!mapId) {
    return null;
  }
  if (!(await ensureOpenWorldFactionStoryBootstrap())) {
    return null;
  }

  await syncWorldDistrictStates(mapId);

  const districtName = String(params.districtName || "").trim() || null;
  const storylineRows = await db.select().from(worldStorylines).where(and(
    eq(worldStorylines.mapId, mapId),
    eq(worldStorylines.status, "active"),
  )).all();
  const scopedRows = districtName
    ? storylineRows.filter((row) => row.districtName === districtName)
    : storylineRows;
  if (scopedRows.length <= 0) {
    return null;
  }

  const preferredFactionId = String(params.sourceFactionId || "").trim()
    || guessOpenWorldFactionIdByName(params.sourceFactionName)
    || null;
  const preferredStorylineType = resolveStorylineTypeForOfferType(params.offerType)
    || resolveStorylineTypeForIncidentType(params.incidentType);
  const matched = pickPreferredStoryline({
    storylineRows: scopedRows,
    preferredFactionId,
    preferredStorylineType,
  });
  if (!matched) {
    return null;
  }

  const [factionRow] = matched.sourceFactionId
    ? await db.select().from(worldFactions).where(eq(worldFactions.id, matched.sourceFactionId)).limit(1)
    : [null];
  const payloadJson = (matched.payloadJson || {}) as Record<string, unknown>;
  const objectivePoint = matched.objectivePointId
    ? listOpenWorldObjectivePoints(matched.mapId).find((point) => point.id === matched.objectivePointId) || null
    : null;
  const template = getStorylineTemplate(matched.storylineType);

  return {
    storylineId: matched.id,
    storylineType: matched.storylineType as StorylineType,
    storylineTypeLabel: template.label,
    mapId: matched.mapId,
    districtName: matched.districtName,
    stageIndex: Number(matched.stageIndex || 1),
    stageLabel: matched.stageTitle,
    sourceFactionId: matched.sourceFactionId || null,
    sourceFactionName: factionRow?.name || template.label,
    sourceFactionLabel: factionRow?.surfaceLabel || factionRow?.name || template.label,
    objectivePointId: matched.objectivePointId || null,
    objectivePointLabel: objectivePoint?.label || String(payloadJson.currentObjectivePointLabel || "").trim() || null,
    objectiveMapId: objectivePoint?.mapId || String(payloadJson.currentObjectiveMapId || "").trim() || null,
    objectivePositionX: objectivePoint?.positionX ?? null,
    objectivePositionY: objectivePoint?.positionY ?? null,
  } satisfies OpenWorldStorylineBinding;
}

export async function upsertOpenWorldStorylineParticipant(params: {
  storylineId: string;
  participantType: "player" | "world_npc";
  participantId: string;
  factionId?: string | null;
  roleLabel?: string | null;
  status?: string | null;
  metaJson?: Record<string, unknown>;
}) {
  if (!(await ensureOpenWorldFactionStoryBootstrap())) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const roleLabel = String(params.roleLabel || "").trim() || null;
  const status = String(params.status || "").trim() || "active";
  const metaJson = params.metaJson && typeof params.metaJson === "object"
    ? params.metaJson
    : {};

  await db.insert(worldStorylineParticipants).values({
    storylineId: params.storylineId,
    participantType: params.participantType,
    participantId: params.participantId,
    factionId: params.factionId || null,
    roleLabel,
    status,
    metaJson,
    createdAt: nowIso,
    updatedAt: nowIso,
  }).onConflictDoUpdate({
    target: [
      worldStorylineParticipants.storylineId,
      worldStorylineParticipants.participantType,
      worldStorylineParticipants.participantId,
    ],
    set: {
      factionId: params.factionId || null,
      roleLabel,
      status,
      metaJson,
      updatedAt: nowIso,
    },
  }).run();

  return {
    storylineId: params.storylineId,
    participantType: params.participantType,
    participantId: params.participantId,
    status,
  };
}

export async function listOpenWorldFactionsForPlayer(playerId?: string | null) {
  if (!(await ensureOpenWorldFactionStoryBootstrap())) {
    return [];
  }

  const [factionRows, profileRow] = await Promise.all([
    db.select().from(worldFactions).where(eq(worldFactions.isEnabled, true)).all(),
    playerId
      ? db.select().from(playerWorldProfiles).where(eq(playerWorldProfiles.playerId, playerId)).get()
      : Promise.resolve(null),
  ]);
  const standingMap = normalizeStandingMap(profileRow?.flagsJson as Record<string, unknown> | undefined);

  return factionRows.map((row) => {
    const standing = standingMap[row.id] || { favor: 0, hostility: 0 };
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      categoryLabel: getFactionCategoryLabel(row.category as FactionCategory),
      tone: row.tone,
      description: row.description,
      surfaceLabel: row.surfaceLabel || row.name,
      aiPromptHint: row.aiPromptHint || "",
      standing,
      standingSummary: buildStandingSummary(row.name, standing),
      updatedAt: row.updatedAt,
    };
  });
}

export async function listOpenWorldDistrictStates(params: {
  mapId: string;
  playerId?: string | null;
}) {
  const districtRows = await syncWorldDistrictStates(params.mapId);
  const factionRows = await db.select().from(worldFactions).all();
  const factionMap = new Map(factionRows.map((row) => [row.id, row]));
  const storylines = await db.select().from(worldStorylines)
    .where(and(eq(worldStorylines.mapId, params.mapId), eq(worldStorylines.status, "active")))
    .all();

  return districtRows.map((row) => {
    const dominantFaction = factionMap.get(row.dominantFactionId || "");
    const objectivePoints = listOpenWorldObjectivePoints(params.mapId)
      .filter((point) => point.districtName === row.districtName)
      .slice(0, 2)
      .map((point) => ({
        id: point.id,
        label: point.label,
        pointTypeLabel: point.pointTypeLabel,
      }));
    const relatedStorylines = storylines.filter((item) => item.districtName === row.districtName);
    return {
      id: row.id,
      mapId: row.mapId,
      districtName: row.districtName,
      districtIndex: row.districtIndex,
      dominantFactionId: row.dominantFactionId,
      dominantFactionName: dominantFaction?.name || "地头散修",
      dominantFactionCategory: dominantFaction?.category || "rogue",
      dominantFactionLabel: dominantFaction?.surfaceLabel || dominantFaction?.name || "地头散修",
      tensionTag: row.tensionTag || resolveDistrictTensionTag(row),
      hotspotSummary: row.hotspotSummary || `${row.districtName}暂无更多风声。`,
      dangerLevel: row.tensionLevel,
      dangerLabel: resolveDangerLabel(row.tensionLevel),
      influenceBreakdown: {
        lawful: row.lawfulInfluence,
        gray: row.grayInfluence,
        demonic: row.demonicInfluence,
        localControl: row.localControl,
      },
      objectivePoints,
      activeStorylineCount: relatedStorylines.length,
      activeHooks: (row.activeHooksJson || {}) as DistrictStateHooks,
      updatedAt: row.updatedAt,
    };
  });
}

async function evaluatePlayerStorylineOpportunity(params: {
  playerId: string;
  storyline: typeof worldStorylines.$inferSelect;
}) {
  const [playerRow, profileRow, contractRows] = await Promise.all([
    db.select({
      id: players.id,
      currentMapId: players.currentMapId,
      positionX: players.positionX,
      positionY: players.positionY,
    }).from(players).where(eq(players.id, params.playerId)).get(),
    db.select().from(playerWorldProfiles).where(eq(playerWorldProfiles.playerId, params.playerId)).get(),
    db.select().from(playerWorldEventOffers).where(and(
      eq(playerWorldEventOffers.playerId, params.playerId),
      eq(playerWorldEventOffers.status, "accepted"),
    )).all(),
  ]);

  const template = getStorylineTemplate(params.storyline.storylineType);
  if (!playerRow || !profileRow) {
    return {
      canAdvance: false,
      actionLabel: template.actionLabel,
      hint: "你尚未踏入此局。",
      tags: [],
    } satisfies StorylineAdvanceCheck;
  }

  const currentDistrictName = playerRow.currentMapId
    ? resolveOpenWorldDistrictName({
      mapId: playerRow.currentMapId,
      positionX: playerRow.positionX,
      positionY: playerRow.positionY,
    })
    : null;
  const sameMap = playerRow.currentMapId === params.storyline.mapId;
  const sameDistrict = currentDistrictName === params.storyline.districtName;
  const relevantContract = contractRows.find((row) => (
    String((row.payloadJson as Record<string, unknown>)?.targetDistrictName || "").trim() === params.storyline.districtName
    || String((row.payloadJson as Record<string, unknown>)?.currentObjectiveDistrictName || "").trim() === params.storyline.districtName
  ));
  const standing = normalizeStandingMap(profileRow.flagsJson as Record<string, unknown> | undefined);
  const sourceStanding = standing[template.sourceFactionId] || { favor: 0, hostility: 0 };
  const tags: string[] = [];
  if (sameMap) {
    tags.push("同图");
  }
  if (sameDistrict) {
    tags.push("同街区");
  }
  if (relevantContract) {
    tags.push("已有灰活牵线");
  }

  if (!sameMap) {
    return {
      canAdvance: false,
      actionLabel: template.actionLabel,
      hint: "你人不在这张开放世界地图，先过去再说。",
      tags,
    } satisfies StorylineAdvanceCheck;
  }

  if (template.storylineType === "gray_infiltration") {
    return {
      canAdvance: Boolean(sameDistrict && (relevantContract || profileRow.shadowFavor >= 18 || sourceStanding.favor >= 10)),
      actionLabel: template.actionLabel,
      hint: sameDistrict
        ? (relevantContract ? "你手里正好有一桩能接上线头的灰活。" : template.supportHint)
        : "得先进到对应街区，灰线才会认你这张脸。",
      tags,
    } satisfies StorylineAdvanceCheck;
  }
  if (template.storylineType === "lawful_purge") {
    return {
      canAdvance: Boolean(sameDistrict && profileRow.bountyHeat < 68 && sourceStanding.hostility <= 20),
      actionLabel: template.actionLabel,
      hint: sameDistrict
        ? (profileRow.bountyHeat < 68 ? "你暂时还没臭到让守序势力直接翻脸。" : "你名声太脏，守序一侧不会轻易让你插手。")
        : "先进街区，守序那边才会让你听下一步风声。",
      tags,
    } satisfies StorylineAdvanceCheck;
  }
  return {
    canAdvance: Boolean(sameDistrict && (profileRow.shadowFavor >= 20 || sourceStanding.favor >= 8 || relevantContract)),
    actionLabel: template.actionLabel,
    hint: sameDistrict ? template.supportHint : "魔修和旁门从不隔空亮牌，先站到那条街上再说。",
    tags,
  } satisfies StorylineAdvanceCheck;
}

export async function listOpenWorldStorylines(params: {
  mapId: string;
  playerId?: string | null;
}) {
  if (!(await ensureOpenWorldFactionStoryBootstrap())) {
    return [];
  }

  await syncWorldDistrictStates(params.mapId);
  const [storylineRows, factionRows, npcRows] = await Promise.all([
    db.select().from(worldStorylines)
      .where(and(eq(worldStorylines.mapId, params.mapId), eq(worldStorylines.status, "active")))
      .orderBy(desc(worldStorylines.updatedAt))
      .all(),
    db.select().from(worldFactions).all(),
    db.select({
      id: worldNpcProfiles.id,
      name: worldNpcProfiles.name,
    }).from(worldNpcProfiles).all(),
  ]);

  const factionMap = new Map(factionRows.map((row) => [row.id, row]));
  const npcMap = new Map(npcRows.map((row) => [row.id, row.name]));
  const result = [];

  for (const row of storylineRows) {
    const template = getStorylineTemplate(row.storylineType);
    const factionRow = factionMap.get(row.sourceFactionId || "");
    const payloadJson = (row.payloadJson || {}) as Record<string, unknown>;
    const objectivePointId = String(row.objectivePointId || payloadJson.currentObjectivePointId || "").trim() || null;
    const objectivePoint = objectivePointId
      ? listOpenWorldObjectivePoints(params.mapId).find((point) => point.id === objectivePointId) || null
      : null;
    const opportunity = params.playerId
      ? await evaluatePlayerStorylineOpportunity({
        playerId: params.playerId,
        storyline: row,
      })
      : {
        canAdvance: false,
        actionLabel: template.actionLabel,
        hint: template.supportHint,
        tags: [],
      };
    result.push({
      id: row.id,
      mapId: row.mapId,
      districtName: row.districtName,
      storylineType: row.storylineType,
      storylineTypeLabel: template.label,
      stageIndex: row.stageIndex,
      stageLabel: row.stageTitle,
      title: row.stageTitle,
      summary: row.summary,
      status: row.status,
      sourceFactionId: row.sourceFactionId,
      sourceFactionName: factionRow?.name || template.label,
      sourceFactionLabel: factionRow?.surfaceLabel || factionRow?.name || template.label,
      objectivePointId,
      objectivePointLabel: objectivePoint?.label || String(payloadJson.currentObjectivePointLabel || "").trim() || null,
      objectiveDistrictName: objectivePoint?.districtName || String(payloadJson.currentObjectiveDistrictName || "").trim() || row.districtName,
      objectiveMapId: objectivePoint?.mapId || String(payloadJson.currentObjectiveMapId || "").trim() || row.mapId,
      objectivePositionX: objectivePoint?.positionX ?? null,
      objectivePositionY: objectivePoint?.positionY ?? null,
      linkedNpcIds: Array.isArray(row.keyNpcIdsJson) ? row.keyNpcIdsJson : [],
      linkedNpcNames: Array.isArray(row.keyNpcIdsJson) ? row.keyNpcIdsJson.map((id) => npcMap.get(id) || "无名人") : [],
      canAdvance: opportunity.canAdvance,
      availableActionLabel: opportunity.actionLabel,
      advanceHint: opportunity.hint,
      playerMomentumTags: opportunity.tags,
      updatedAt: row.updatedAt,
    });
  }
  return result;
}

export async function advanceOpenWorldStoryline(params: {
  playerId: string;
  storylineId: string;
}) {
  if (!(await ensureOpenWorldFactionStoryBootstrap())) {
    throw new Error("开放世界势力底座尚未就绪");
  }

  const storylineRow = await db.select().from(worldStorylines).where(eq(worldStorylines.id, params.storylineId)).get();
  if (!storylineRow) {
    throw new Error("街区故事链不存在");
  }
  if (storylineRow.status !== "active") {
    throw new Error("这条街区故事链已经收束");
  }

  const opportunity = await evaluatePlayerStorylineOpportunity({
    playerId: params.playerId,
    storyline: storylineRow,
  });
  if (!opportunity.canAdvance) {
    throw new Error(opportunity.hint);
  }

  const template = getStorylineTemplate(storylineRow.storylineType);
  const nextStageIndex = Math.min(template.stages.length, Number(storylineRow.stageIndex || 1) + 1);
  const nextStage = template.stages[nextStageIndex - 1];
  const isCompleted = nextStageIndex >= template.stages.length;
  const nowIso = new Date().toISOString();

  await db.update(worldStorylines).set({
    stageIndex: nextStageIndex,
    stageKey: nextStage.stageKey,
    stageTitle: nextStage.title,
    summary: nextStage.summary,
    status: isCompleted ? "completed" : "active",
    completedAt: isCompleted ? nowIso : null,
    updatedAt: nowIso,
  }).where(eq(worldStorylines.id, storylineRow.id)).run();

  await db.insert(worldStorylineParticipants).values({
    storylineId: storylineRow.id,
    participantType: "player",
    participantId: params.playerId,
    factionId: storylineRow.sourceFactionId,
    roleLabel: "插手之人",
    status: isCompleted ? "completed" : "active",
    metaJson: {
      stageIndex: nextStageIndex,
      districtName: storylineRow.districtName,
    },
    createdAt: nowIso,
    updatedAt: nowIso,
  }).onConflictDoUpdate({
    target: [
      worldStorylineParticipants.storylineId,
      worldStorylineParticipants.participantType,
      worldStorylineParticipants.participantId,
    ],
    set: {
      factionId: storylineRow.sourceFactionId,
      roleLabel: "插手之人",
      status: isCompleted ? "completed" : "active",
      metaJson: {
        stageIndex: nextStageIndex,
        districtName: storylineRow.districtName,
      },
      updatedAt: nowIso,
    },
  }).run();

  const incidentType = template.storylineType === "gray_infiltration"
    ? "district_storyline_gray"
    : template.storylineType === "lawful_purge"
      ? "district_storyline_lawful"
      : "district_storyline_demonic";
  const { applyPlayerWorldIncident } = await import("@/modules/world/services/player-world-pressure-service");
  await applyPlayerWorldIncident({
    playerId: params.playerId,
    incidentType: incidentType as Parameters<typeof applyPlayerWorldIncident>[0]["incidentType"],
    sourceType: "world_storyline",
    sourceId: storylineRow.id,
    mapId: storylineRow.mapId,
    districtName: storylineRow.districtName,
    severity: isCompleted ? 4 : 2,
    summary: isCompleted
      ? `你把${storylineRow.districtName}的${template.label}推到了收尾阶段，整片街区都会记住这一次站队。`
      : `你插手了${storylineRow.districtName}的${template.label}，街面局势因此又向前滑了一步。`,
    payloadJson: {
      storylineId: storylineRow.id,
      storylineType: storylineRow.storylineType,
      nextStageTitle: nextStage.title,
      sourceFactionId: storylineRow.sourceFactionId,
    },
  });

  await syncWorldDistrictStates(storylineRow.mapId);

  return {
    storylineId: storylineRow.id,
    stageIndex: nextStageIndex,
    stageTitle: nextStage.title,
    summary: nextStage.summary,
    completed: isCompleted,
  };
}

export async function getOpenWorldFactionPressureHints(params: {
  playerId: string;
  mapId: string;
}) {
  if (!(await ensureOpenWorldFactionStoryBootstrap())) {
    return [];
  }
  const profileRow = await db.select().from(playerWorldProfiles).where(eq(playerWorldProfiles.playerId, params.playerId)).get();
  const districtStates = await listOpenWorldDistrictStates({
    mapId: params.mapId,
    playerId: params.playerId,
  });
  const standingMap = normalizeStandingMap(profileRow?.flagsJson as Record<string, unknown> | undefined);
  return districtStates.slice(0, 3).map((district) => {
    const standing = district.dominantFactionId ? standingMap[district.dominantFactionId] : undefined;
    if (standing && standing.hostility >= standing.favor + 10) {
      return `${district.dominantFactionName}在${district.districtName}已经听过你的坏名声。`;
    }
    if (standing && standing.favor >= standing.hostility + 10) {
      return `${district.dominantFactionName}在${district.districtName}更愿意放你进局。`;
    }
    return `${district.districtName}当前由${district.dominantFactionName}压着场面，${district.tensionTag}。`;
  });
}

export async function getWorldNpcFactionHints(params: {
  npcId: string;
  playerId?: string | null;
}) {
  if (!(await ensureOpenWorldFactionStoryBootstrap())) {
    return null;
  }

  const npcRow = await db.select({
    id: worldNpcProfiles.id,
    faction: worldNpcProfiles.faction,
    currentMapId: worldNpcRuntime.currentMapId,
    positionX: worldNpcRuntime.positionX,
    positionY: worldNpcRuntime.positionY,
    realmName: worldNpcProfiles.realmName,
  }).from(worldNpcProfiles)
    .innerJoin(worldNpcRuntime, eq(worldNpcRuntime.npcId, worldNpcProfiles.id))
    .where(eq(worldNpcProfiles.id, params.npcId))
    .get();
  if (!npcRow) {
    return null;
  }

  const districtName = resolveOpenWorldDistrictName({
    mapId: npcRow.currentMapId,
    positionX: npcRow.positionX,
    positionY: npcRow.positionY,
  }) || "无名街区";
  const districtRows = await listOpenWorldDistrictStates({
    mapId: npcRow.currentMapId,
    playerId: params.playerId,
  });
  const districtState = districtRows.find((row) => row.districtName === districtName) || null;
  const visibleFaction = String(npcRow.faction || "").trim() || districtState?.dominantFactionName || "无门散人";

  return {
    surfaceFaction: visibleFaction,
    stanceLabel: districtState?.dominantFactionName ? `带着${districtState.dominantFactionName}的场子气` : "气机未明",
    hazeLabel: npcRow.realmName.includes("七重") || npcRow.realmName.includes("八重") || npcRow.realmName.includes("九重")
      ? "此人戒心深，真实站队仍有遮掩。"
      : "此人站队不算太深，多少能从外在看出一些路数。",
    hints: [
      `观其外气，更像是${visibleFaction}那一路的人。`,
      districtState ? `此人所在的${districtState.districtName}当前是“${districtState.tensionTag}”。` : null,
      districtState ? `${districtState.dominantFactionName}正在这片街区里放大自己的手。` : null,
    ].filter(Boolean),
  };
}

export async function listWorldNpcInvolvedStorylines(npcId: string) {
  if (!(await ensureOpenWorldFactionStoryBootstrap())) {
    return [];
  }
  const [participantRows, hintedStorylines] = await Promise.all([
    db.select().from(worldStorylineParticipants)
      .where(and(
        eq(worldStorylineParticipants.participantType, "world_npc"),
        eq(worldStorylineParticipants.participantId, npcId),
      ))
      .all(),
    db.select().from(worldStorylines).all(),
  ]);
  const storylineIds = Array.from(new Set([
    ...participantRows.map((row) => row.storylineId),
    ...hintedStorylines
      .filter((row) => Array.isArray(row.keyNpcIdsJson) && row.keyNpcIdsJson.includes(npcId))
      .map((row) => row.id),
  ]));
  if (storylineIds.length <= 0) {
    return [];
  }
  const storylineRows = hintedStorylines.filter((row) => storylineIds.includes(row.id));
  const factionRows = await db.select().from(worldFactions).all();
  const factionMap = new Map(factionRows.map((row) => [row.id, row.name]));
  return storylineRows.map((row) => ({
    id: row.id,
    districtName: row.districtName,
    storylineType: row.storylineType,
    storylineTypeLabel: getStorylineLabel(row.storylineType as StorylineType),
    stageLabel: row.stageTitle,
    summary: row.summary,
    status: row.status,
    sourceFactionName: factionMap.get(row.sourceFactionId || "") || "无名势力",
  }));
}

export async function getOpenWorldFactionAdminOverview() {
  if (!(await ensureOpenWorldFactionStoryBootstrap())) {
    return {
      factions: [],
      districtStates: [],
      storylines: [],
    };
  }
  const [factions, districtStates, storylines] = await Promise.all([
    listOpenWorldFactionsForPlayer(),
    db.select().from(worldDistrictStates).orderBy(desc(worldDistrictStates.updatedAt)).all(),
    db.select().from(worldStorylines).orderBy(desc(worldStorylines.updatedAt)).all(),
  ]);
  const factionNameMap = new Map(factions.map((row) => [row.id, row.name]));
  return {
    factions,
    districtStates: districtStates.map((row) => ({
      ...row,
      dominantFactionName: factionNameMap.get(row.dominantFactionId || "") || "地头散修",
    })),
    storylines: storylines.map((row) => ({
      ...row,
      sourceFactionName: factionNameMap.get(row.sourceFactionId || "") || "无名势力",
    })),
  };
}

export async function refreshOpenWorldFactionStoryFlavor() {
  if (!(await ensureOpenWorldFactionStoryBootstrap())) {
    return {
      refreshedFactionCount: 0,
      refreshedDistrictCount: 0,
      refreshedStorylineCount: 0,
    };
  }

  const [factionRows, districtRows, storylineRows] = await Promise.all([
    db.select().from(worldFactions).all(),
    db.select().from(worldDistrictStates).all(),
    db.select().from(worldStorylines).all(),
  ]);

  const factionById = new Map(factionRows.map((row) => [row.id, row]));
  let refreshedFactionCount = 0;
  let refreshedDistrictCount = 0;
  let refreshedStorylineCount = 0;

  for (const factionRow of factionRows) {
    const generated = await generateOpenWorldFactionTone({
      factionName: factionRow.name,
      categoryLabel: resolveFactionCategoryLabel(factionRow.category as FactionCategory),
      standingSummary: factionRow.description,
    });
    await db.update(worldFactions).set({
      tone: generated.title,
      description: generated.summary,
      surfaceLabel: generated.hints[0] || factionRow.surfaceLabel,
      updatedAt: new Date().toISOString(),
    }).where(eq(worldFactions.id, factionRow.id)).run();
    refreshedFactionCount += 1;
  }

  for (const districtRow of districtRows) {
    const dominantFactionName = factionById.get(districtRow.dominantFactionId || "")?.name || "无名势力";
    const generated = await generateOpenWorldDistrictStateFlavor({
      districtName: districtRow.districtName,
      dominantFactionName,
      tensionTag: districtRow.tensionTag || "暗潮起伏",
      hotspotSummary: districtRow.hotspotSummary || "",
    });
    await db.update(worldDistrictStates).set({
      hotspotSummary: generated.summary,
      activeHooksJson: {
        ...districtRow.activeHooksJson,
        hotspotTitles: [generated.title],
        nextHooks: generated.hooks,
      },
      updatedAt: new Date().toISOString(),
    }).where(eq(worldDistrictStates.id, districtRow.id)).run();
    refreshedDistrictCount += 1;
  }

  for (const storylineRow of storylineRows) {
    const sourceFactionName = factionById.get(storylineRow.sourceFactionId || "")?.name || "无名势力";
    const generated = await generateOpenWorldStorylineFlavor({
      districtName: storylineRow.districtName,
      storylineTypeLabel: getStorylineLabel(storylineRow.storylineType as StorylineType),
      sourceFactionName,
      stageLabel: storylineRow.stageTitle,
      summary: storylineRow.summary,
    });
    await db.update(worldStorylines).set({
      stageTitle: generated.title,
      summary: generated.summary,
      payloadJson: {
        ...storylineRow.payloadJson,
        aiNextMove: generated.nextMove,
      },
      updatedAt: new Date().toISOString(),
    }).where(eq(worldStorylines.id, storylineRow.id)).run();
    refreshedStorylineCount += 1;
  }

  return {
    refreshedFactionCount,
    refreshedDistrictCount,
    refreshedStorylineCount,
  };
}

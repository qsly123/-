import { and, count, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  npcs,
  playerAdultProfiles,
  playerMails,
  playerWorldEventOffers,
  playerWorldIncidents,
  playerWorldProfiles,
  players,
  worldMapInstances,
  worldNpcProfiles,
  worldNpcRuntime,
} from "@/db/schema";
import {
  generateOpenWorldForcedConsequence,
  generateOpenWorldPressureReliefOffer,
  generateOpenWorldShadowEvent,
} from "@/modules/world/services/world-ai-generation";
import {
  getOpenWorldForcedRuleSnapshot,
  getOpenWorldPressureReliefRule,
  type OpenWorldForcedAction,
  type OpenWorldPressureReliefOfferType,
  type OpenWorldPressureTarget,
} from "@/modules/world/services/world-config";
import { resolveOpenWorldDistrictName } from "@/modules/world/services/world-district-service";
import {
  getOpenWorldObjectivePointById,
  isNearOpenWorldObjectivePoint,
  pickOpenWorldObjectivePoint,
  type OpenWorldObjectivePoint,
  type OpenWorldObjectivePointType,
} from "@/modules/world/services/world-objective-points";
import {
  findOpenWorldStorylineBinding,
  settleOpenWorldFactionAfterIncident,
  upsertOpenWorldStorylineParticipant,
} from "@/modules/world/services/world-faction-storyline-service";
import { createTiandaoNearbyChatMessage } from "@/modules/world/services/world-nearby-chat";
import { ensureOpenWorldSchema } from "@/modules/world/services/world-schema";
import { settleWorldNpcDoubleCultivationLinkage } from "@/modules/world/services/double-cultivation-linkage";

const WORLD_PRESSURE_MAX_SCORE = 100;
const WORLD_PRESSURE_DECAY_WINDOW_MS = 60 * 60 * 1000;
const WORLD_OFFER_TTL_MS = 6 * 60 * 60 * 1000;
const WORLD_OFFER_REGEN_COOLDOWN_MS = 30 * 60 * 1000;
const WORLD_INCIDENT_FETCH_LIMIT = 10;
const WORLD_DISTRICT_CHAIN_WINDOW_MS = 60 * 60 * 1000;

async function tryAcquirePlayerWorldLock(
  tx: { execute: typeof db.execute },
  lockKey: string,
) {
  const result = await tx.execute(
    sql`select pg_try_advisory_xact_lock(hashtext(${lockKey})) as locked`,
  ) as Array<{ locked?: boolean | null }> | { rows?: Array<{ locked?: boolean | null }> };
  if (Array.isArray(result)) {
    return result[0]?.locked === true;
  }
  return Array.isArray(result?.rows) && result.rows[0]?.locked === true;
}

export type PlayerWorldAlertTier = "observe" | "rumor" | "stalk" | "bounty" | "ambush";
export type PlayerWorldOfferType =
  | "black_market_trade"
  | "shadow_intel"
  | "cultivator_hunt"
  | "demonic_temptation"
  | "pressure_cleanse"
  | "rumor_silence"
  | "lawful_mediation"
  | "consensual_dual_cultivation"
  | "gift_lingyu"
  | "treasure_invite"
  | "broker_relief";
export type PlayerWorldOfferStatus = "pending" | "accepted" | "rejected" | "expired";
export type PlayerWorldContractType =
  | "meet_contact"
  | "hunt_target"
  | "dead_drop_delivery"
  | "surveil_target"
  | "escort_cargo"
  | "treasure_probe";
export type PlayerWorldContractStatus = "active" | "completed" | "failed";
export type PlayerWorldIncidentType =
  | "kill_and_loot"
  | "kill_loot"
  | "witnessed"
  | "tracking_notice"
  | "escaped"
  | "escape"
  | "assassination"
  | "assassinated"
  | "shadow_trade"
  | "offer_accepted"
  | "offer_accept"
  | "offer_rejected"
  | "offer_reject"
  | "black_market_trade"
  | "shadow_intel"
  | "cultivator_hunt"
  | "demonic_temptation"
  | "adult_affair"
  | "adult_report"
  | "dangerous_preference"
  | "essence_drain"
  | "pressure_cleanse"
  | "rumor_silence"
  | "lawful_mediation"
  | "consensual_dual_cultivation"
  | "gift_lingyu"
  | "treasure_invite"
  | "broker_relief"
  | "coercive_failure"
  | "forced_consequence"
  | "district_chain_rumor"
  | "district_storyline_gray"
  | "district_storyline_lawful"
  | "district_storyline_demonic";

type PlayerWorldProfileRow = typeof playerWorldProfiles.$inferSelect;
type PlayerWorldEventOfferRow = typeof playerWorldEventOffers.$inferSelect;

type IncidentScoreDelta = {
  notorietyScore: number;
  bountyHeat: number;
  shadowFavor: number;
  lawfulPressure: number;
};

export type PlayerWorldPressureSummary = {
  playerId: string;
  notorietyScore: number;
  bountyHeat: number;
  shadowFavor: number;
  lawfulPressure: number;
  activeAlertTier: PlayerWorldAlertTier;
  activeAlertLabel: string;
  tierLabel: string;
  activeAlertDescription: string;
  tierDescription: string;
  activeWatcherCount: number;
  summary: string;
  lawfulSummary: string;
  shadowSummary: string;
  nextEscalationRisk: string;
  nextRiskLabel: string;
  marketFeeExtraPercent: number;
  lawfulMood: "neutral" | "cold" | "guarded";
  shadowMood: "distant" | "curious" | "welcoming";
  flags: Record<string, unknown>;
  updatedAt: string;
};

export type PlayerWorldTrackingSignal = {
  id: string;
  type: "incident" | "offer" | "tier";
  stage: PlayerWorldAlertTier;
  stageLabel: string;
  title: string;
  content: string;
  summary: string;
  severity: "low" | "medium" | "high";
  incidentType: string | null;
  sourceType: string | null;
  mapId: string | null;
  districtName: string | null;
  createdAt: string;
};

export type PlayerWorldPenaltySummary = {
  baseFeePercent: number;
  extraFeePercent: number;
  effectiveFeePercent: number;
  finalFeePercent: number;
  level: "none" | "mild" | "medium" | "high";
  title: string;
  summary: string;
  hints: string[];
};

export type PlayerWorldPressureSnapshot = {
  pressure: PlayerWorldPressureSummary;
  reputation: PlayerWorldReputationSummary;
  trackingSignals: PlayerWorldTrackingSignal[];
  worldDangerCount: number;
  worldBountyActive: boolean;
  worldRumorUnread: number;
};

export type PlayerWorldEventOfferItem = {
  id: string;
  offerType: PlayerWorldOfferType;
  offerTypeLabel: string;
  sourceFaction: string;
  sourceNpcId: string | null;
  sourceNpcName: string | null;
  storylineId: string | null;
  storylineTypeLabel: string | null;
  storylineStageLabel: string | null;
  storylineDistrictName: string | null;
  status: PlayerWorldOfferStatus;
  summary: string;
  detail: string;
  riskLabel: string;
  reliefValue: number;
  pressureTargets: OpenWorldPressureTarget[];
  requiresKeywords: string[];
  keywordRuleSummary: string;
  consentRequired: boolean;
  consentSummary: string;
  coerciveFlavorLevel: "low" | "medium" | "high";
  forcedRisk: boolean;
  forcedActions: OpenWorldForcedAction[];
  aiScenarioType: string | null;
  aiSceneTags: string[];
  guideTargetLabel: string | null;
  guideLocationLabel: string | null;
  guideActionLabel: string | null;
  guideSummary: string | null;
  guideRoute: string | null;
  guideMapId: string | null;
  guidePositionX: number | null;
  guidePositionY: number | null;
  guideRequiresAccept: boolean;
  payloadJson: Record<string, unknown>;
  expiresAt: string;
  createdAt: string;
};

export type PlayerWorldContractItem = {
  offerId: string;
  offerType: PlayerWorldOfferType;
  offerTypeLabel: string;
  sourceFaction: string | null;
  storylineId: string | null;
  contractType: PlayerWorldContractType;
  contractStatus: PlayerWorldContractStatus;
  title: string;
  summary: string;
  detail: string;
  progressLabel: string;
  actionLabel: string | null;
  targetNpcId: string | null;
  targetNpcName: string | null;
  targetMapId: string | null;
  targetMapName: string | null;
  targetDistrictName: string | null;
  targetPositionX: number | null;
  targetPositionY: number | null;
  rewardGold: number;
  rewardLingYu: number;
  canAdvanceByTalking: boolean;
  canAdvanceByObjective: boolean;
  currentObjectivePointId: string | null;
  currentObjectivePointLabel: string | null;
  currentObjectivePointType: OpenWorldObjectivePointType | null;
  currentObjectiveMapId: string | null;
  currentObjectiveMapName: string | null;
  currentObjectiveDistrictName: string | null;
  currentObjectivePositionX: number | null;
  currentObjectivePositionY: number | null;
  currentObjectiveActionLabel: string | null;
  currentObjectiveHint: string | null;
  objectiveStepStatus: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type PlayerWorldNpcAttitude = {
  stance: "neutral" | "cold" | "guarded" | "shadow_friendly";
  level: "neutral" | "cold" | "guarded" | "shadow_friendly";
  label: string;
  description: string;
  summary: string;
  hints: string[];
  worldReactionHints: string[];
  willIgnorePlayer: boolean;
  needsBrokerRelief: boolean;
  repairHints: string[];
  interactionBiases: string[];
  reputationLabel: string;
  reputationSummary: string;
};

type PlayerWorldAdultSurface = {
  corruptionValue: number;
  allureValue: number;
  shameValue: number;
  stageLabel: string;
};

export type PlayerWorldReputationSummary = {
  playerId: string;
  overallLabel: string;
  overallSummary: string;
  socialFlavorLabel: string;
  adultStageLabel: string;
  notorietyLabel: string;
  shadowLabel: string;
  sensualLabel: string;
  willIgnorePlayer: boolean;
  needsBrokerRelief: boolean;
  canInitiateConversation: boolean;
  canInviteTreasureHunt: boolean;
  canGiftLingShi: boolean;
  canInviteDualCultivation: boolean;
  forcedAdultRisk: boolean;
  repairHint: string;
  repairActions: string[];
  reactionHints: string[];
  worldBehaviorHints: string[];
  corruptionValue: number;
  allureValue: number;
  shameValue: number;
  updatedAt: string;
};

type OfferTemplate = {
  offerType: PlayerWorldOfferType;
  sourceFaction: string;
  severity: number;
  summary: string;
  payloadJson: Record<string, unknown>;
};

type WorldNpcDoubleCultivationRouteResult = {
  settled: boolean;
  log?: {
    id?: number | null;
    targetKind?: string | null;
    targetMonsterId?: string | null;
    targetNameSnapshot?: string | null;
  } | null;
  player?: {
    gain?: number | null;
    percent?: number | null;
  } | null;
  intimacy?: {
    scoreDelta?: number | null;
    currentLevel?: number | null;
  } | null;
  pregnancyStatus?: {
    stageKey?: string | null;
  } | null;
  fertilizationDisplayStatus?: {
    statusKey?: string | null;
    stageKey?: string | null;
  } | null;
  statusEffectsApplied?: string[] | null;
};

class PlayerWorldError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function clampScore(value: number) {
  return Math.max(0, Math.min(WORLD_PRESSURE_MAX_SCORE, Math.round(value)));
}

function parseTimestamp(value: string | null | undefined) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function chebyshevDistance(ax: number, ay: number, bx: number, by: number) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function computeDecayHours(lastDecayAt: string | null | undefined, nowMs = Date.now()) {
  const lastDecayMs = parseTimestamp(lastDecayAt);
  if (lastDecayMs === null || lastDecayMs >= nowMs) {
    return 0;
  }
  return Math.floor((nowMs - lastDecayMs) / WORLD_PRESSURE_DECAY_WINDOW_MS);
}

function getTierOrder(tier: PlayerWorldAlertTier) {
  return ({
    observe: 0,
    rumor: 1,
    stalk: 2,
    bounty: 3,
    ambush: 4,
  } satisfies Record<PlayerWorldAlertTier, number>)[tier];
}

function resolveAlertTier(scores: IncidentScoreDelta): PlayerWorldAlertTier {
  const riskScore = Math.max(
    scores.notorietyScore + Math.round(scores.bountyHeat * 0.7),
    scores.lawfulPressure + Math.round(scores.bountyHeat * 0.8),
    Math.round(scores.shadowFavor * 0.55) + Math.round(scores.notorietyScore * 0.45),
  );
  if (riskScore >= 88 || scores.bountyHeat >= 82) {
    return "ambush";
  }
  if (riskScore >= 64 || scores.bountyHeat >= 58) {
    return "bounty";
  }
  if (riskScore >= 42 || scores.notorietyScore >= 38) {
    return "stalk";
  }
  if (riskScore >= 18 || scores.notorietyScore >= 16) {
    return "rumor";
  }
  return "observe";
}

function resolveWatcherCount(scores: IncidentScoreDelta, tier: PlayerWorldAlertTier) {
  const base = tier === "ambush"
    ? 5
    : tier === "bounty"
      ? 4
      : tier === "stalk"
        ? 3
        : tier === "rumor"
          ? 2
          : 1;
  return Math.max(base, Math.min(9, base + Math.floor(scores.bountyHeat / 26) + Math.floor(scores.notorietyScore / 34)));
}

function resolveAlertPresentation(tier: PlayerWorldAlertTier) {
  switch (tier) {
    case "ambush":
      return {
        label: "杀机压顶",
        description: "你的恶名与追缉已经在几处势力间串联，在线时只要不在宗门或临时秘境里，都可能被顺着风声追到眼前。",
        nextEscalationRisk: "下一步多半不是风声，而是实打实的伏击。",
      };
    case "bounty":
      return {
        label: "悬赏已热",
        description: "你的气机已经够资格被人拿去换赏，守序一侧会更警惕，灰线也会主动试探。",
        nextEscalationRisk: "若再闹出命案或公开冲突，极易升级成在线伏杀。",
      };
    case "stalk":
      return {
        label: "有人盯上你",
        description: "街巷与坊市里已经有人在串联你的踪迹，虽然未必立刻动手，但追踪链正在成形。",
        nextEscalationRisk: "再被人目击或遁逃，很快就会变成公开悬赏。",
      };
    case "rumor":
      return {
        label: "风声渐起",
        description: "你的名字开始在附近流传，尚未彻底惊动各方，但口风已经变得不那么善意。",
        nextEscalationRisk: "若继续惹事，风声会转为明确追缉。",
      };
    default:
      return {
        label: "风平浪静",
        description: "你的世界压力还不算高，多数人只把你当作寻常修士看待。",
        nextEscalationRisk: "目前多半只是零散观察，还没形成明确风声。",
      };
  }
}

function resolveLawfulSummary(mood: PlayerWorldPressureSummary["lawfulMood"]) {
  if (mood === "guarded") {
    return "正派与守序势力已经把你视作高风险人物。";
  }
  if (mood === "cold") {
    return "守序一侧开始有意和你拉开距离。";
  }
  return "正派与守序势力暂未对你显出明显敌意。";
}

function resolveShadowSummary(mood: PlayerWorldPressureSummary["shadowMood"]) {
  if (mood === "welcoming") {
    return "灰市、黑线与旁门已经把你当成可继续拉拢的人。";
  }
  if (mood === "curious") {
    return "灰色势力已经开始试探你，但尚未完全放开手脚。";
  }
  return "灰色势力暂时仍在远处观望。";
}

function resolvePressureSummaryText(params: {
  tier: PlayerWorldAlertTier;
  watcherCount: number;
}) {
  if (params.tier === "observe") {
    return "天地仍算平静，你的名声尚未在尘世里掀起大浪。";
  }
  return `风声已起，约有 ${params.watcherCount} 道视线在暗中衡量你的来路。`;
}

function resolveIncidentStage(params: {
  incidentType: string;
  severity: number;
}): PlayerWorldAlertTier {
  if (params.incidentType === "kill_and_loot" || params.incidentType === "kill_loot") {
    return params.severity >= 3 ? "bounty" : "stalk";
  }
  if (params.incidentType === "assassination" || params.incidentType === "assassinated") {
    return params.severity >= 2 ? "stalk" : "rumor";
  }
  if (params.incidentType === "black_market_trade" || params.incidentType === "demonic_temptation") {
    return params.severity >= 2 ? "stalk" : "rumor";
  }
  if (params.incidentType === "cultivator_hunt") {
    return params.severity >= 2 ? "bounty" : "stalk";
  }
  if (params.incidentType === "shadow_intel") {
    return "rumor";
  }
  if (params.incidentType === "gift_lingyu" || params.incidentType === "broker_relief") {
    return "observe";
  }
  if (params.incidentType === "treasure_invite") {
    return params.severity >= 2 ? "stalk" : "rumor";
  }
  if (params.incidentType === "adult_report") {
    return params.severity >= 2 ? "stalk" : "rumor";
  }
  if (params.incidentType === "dangerous_preference" || params.incidentType === "essence_drain") {
    return params.severity >= 3 ? "bounty" : "stalk";
  }
  if (params.incidentType === "adult_affair") {
    return "rumor";
  }
  if (params.incidentType === "district_chain_rumor") {
    return params.severity >= 3 ? "stalk" : "rumor";
  }
  if (params.incidentType === "district_storyline_gray") {
    return params.severity >= 3 ? "stalk" : "rumor";
  }
  if (params.incidentType === "district_storyline_lawful") {
    return params.severity >= 3 ? "stalk" : "rumor";
  }
  if (params.incidentType === "district_storyline_demonic") {
    return params.severity >= 3 ? "bounty" : "stalk";
  }
  return params.severity >= 3 ? "stalk" : "rumor";
}

function resolveOfferTypeLabel(offerType: PlayerWorldOfferType) {
  switch (offerType) {
    case "black_market_trade":
      return "黑市邀约";
    case "shadow_intel":
      return "暗线卖讯";
    case "cultivator_hunt":
      return "猎修委托";
    case "pressure_cleanse":
      return "洗痕交易";
    case "rumor_silence":
      return "压风声";
    case "lawful_mediation":
      return "守序调解";
    case "consensual_dual_cultivation":
      return "合意双修";
    case "gift_lingyu":
      return "主动赠灵石";
    case "treasure_invite":
      return "主动邀探宝";
    case "broker_relief":
      return "牙子转话";
    default:
      return "魔念试探";
  }
}

function resolveOfferDefaultSummary(params: {
  offerType: PlayerWorldOfferType;
  sourceFaction: string;
}) {
  if (params.offerType === "black_market_trade") {
    return `${params.sourceFaction}愿意为你开一条只认风声、不问来路的暗市门路。`;
  }
  if (params.offerType === "shadow_intel") {
    return `${params.sourceFaction}放出风声，愿意卖你一条追缉链上的暗线情报。`;
  }
  if (params.offerType === "cultivator_hunt") {
    return `${params.sourceFaction}丢来一份见不得光的猎修委托，想借你去处理麻烦人物。`;
  }
  if (params.offerType === "pressure_cleanse") {
    return `${params.sourceFaction}愿意替你洗去几分明面痕迹，但会把一笔灰账记到你身上。`;
  }
  if (params.offerType === "rumor_silence") {
    return `${params.sourceFaction}愿意替你压一阵风声，不过暗线从来不会白替人收尾。`;
  }
  if (params.offerType === "lawful_mediation") {
    return `${params.sourceFaction}愿意给你一条赔礼说项的路，但你得自己把姿态放低。`;
  }
  if (params.offerType === "consensual_dual_cultivation") {
    return `${params.sourceFaction}递来一条合意双修洗痕的门路，说这能最快散掉你眼前的余波。`;
  }
  if (params.offerType === "gift_lingyu") {
    return `${params.sourceFaction}先递来一袋灵石，只说愿意看看你还接不接这份善意。`;
  }
  if (params.offerType === "treasure_invite") {
    return `${params.sourceFaction}递来一封探宝帖子，邀你去查一处刚浮出水面的机缘线索。`;
  }
  if (params.offerType === "broker_relief") {
    return `${params.sourceFaction}愿替你转话说项，先把旁人不肯搭理你的那层冷意压下去。`;
  }
  return `${params.sourceFaction}递来一道带着血腥气的试探，想把你拖进更深的灰影里。`;
}

function resolveOfferRiskLabel(params: {
  offerType: PlayerWorldOfferType;
  severity: number;
}) {
  if (params.offerType === "demonic_temptation") {
    return "魔念较深，代价与痕迹都会更重。";
  }
  if (params.offerType === "cultivator_hunt") {
    return params.severity >= 2 ? "这类脏活极易把你推向公开追缉。" : "逐利委托见血后，恶名会明显升温。";
  }
  if (params.offerType === "pressure_cleanse") {
    return "你能洗去几分痕迹，但会欠下一笔更深的人情。";
  }
  if (params.offerType === "rumor_silence") {
    return "压风声见效很快，可一旦谈崩，暗线也会反过来拿你做筹码。";
  }
  if (params.offerType === "lawful_mediation") {
    return "调解能缓和守序压力，但你得按规矩办事，回报也更慢。";
  }
  if (params.offerType === "consensual_dual_cultivation") {
    return "这是最强力的洗痕捷径，但仍必须双方明确同意。";
  }
  if (params.offerType === "gift_lingyu") {
    return "这更像试探口风的人情，收下见礼后，对方多半会记住你的态度。";
  }
  if (params.offerType === "treasure_invite") {
    return "探宝有利可图，可一旦踩进灰线埋下的局，也会顺带背上他们的人情。";
  }
  if (params.offerType === "broker_relief") {
    return "牙子能替你说项，但往后多半会把这份人情讨回去。";
  }
  if (params.offerType === "shadow_intel") {
    return "情报能暂解眼前困局，但会让你欠下灰线人情。";
  }
  return "暗市门路来钱更快，也更容易留下灰色痕迹。";
}

function resolveOfferStaticDetail(params: {
  offerType: PlayerWorldOfferType;
  sourceFaction: string;
}) {
  if (params.offerType === "black_market_trade") {
    return `${params.sourceFaction}愿意给你一条不见光的门路，报酬不低，代价是风声更浑。`;
  }
  if (params.offerType === "shadow_intel") {
    return `${params.sourceFaction}愿意售你一角追缉情报，但这份情报会把你拖得更深。`;
  }
  if (params.offerType === "cultivator_hunt") {
    return `${params.sourceFaction}想借你的名声去办一桩脏活，做成了有利可图，做坏了也难洗干净。`;
  }
  if (params.offerType === "pressure_cleanse") {
    return `${params.sourceFaction}愿替你洗去一段明面痕迹，但这份人情往后多半要连本带利讨回。`;
  }
  if (params.offerType === "rumor_silence") {
    return `${params.sourceFaction}愿替你压下一阵风声，可一旦交出把柄，往后就难说是谁在牵着谁走。`;
  }
  if (params.offerType === "lawful_mediation") {
    return `${params.sourceFaction}愿给你一条守序调解的路，前提是你肯先按他们的规矩低头赔礼。`;
  }
  if (params.offerType === "consensual_dual_cultivation") {
    return `${params.sourceFaction}递来一条合意双修洗痕的门路，声称能最快散去你眼前那点惹眼余波。`;
  }
  if (params.offerType === "gift_lingyu") {
    return `${params.sourceFaction}先递来一袋灵石做见面礼，像是在试你愿不愿意接这一层人情。`;
  }
  if (params.offerType === "treasure_invite") {
    return `${params.sourceFaction}丢来一封探宝帖子，要你顺着一截灰色风声去摸一处刚露头的机缘。`;
  }
  if (params.offerType === "broker_relief") {
    return `${params.sourceFaction}愿替你去和街面上的人递话说项，先把不肯搭理你的冷脸缓下来。`;
  }
  return `${params.sourceFaction}递来的不是普通机会，而是一道会在你身上留下灰痕的捷径。`;
}

function sanitizePlayerFacingOfferText(text: string | null | undefined, fallback: string) {
  const trimmedFallback = String(fallback || "").trim() || "暗线里有人正试探你的风声。";
  let normalized = String(text || "").trim();
  if (!normalized) {
    return trimmedFallback;
  }

  normalized = normalized
    .replace(/【[^】]{1,16}】/g, "")
    .replace(/\bobserve\b/gi, "观察")
    .replace(/\brumor\b/gi, "风声")
    .replace(/\bstalk\b/gi, "尾随")
    .replace(/\bbounty\b/gi, "悬赏")
    .replace(/\bambush\b/gi, "伏杀")
    .replace(/当前处于[^，。；]*阶段[，、]*/g, "")
    .replace(/围绕[^，。；]*生成一则灰色邀约摘要[。！!]?/g, "")
    .replace(/生成一则灰色邀约摘要[。！!]?/g, "")
    .replace(/请输出[^。！!]*[。！!]?/g, "")
    .replace(/不要[^。！!]*现代[^。！!]*[。！!]?/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[，。、；：:!！?？\-\s]+|[，。、；：:!！?？\-\s]+$/g, "")
    .trim();

  if (!normalized || normalized.length < 6) {
    return trimmedFallback;
  }
  return normalized;
}

function resolveOfferDetail(params: {
  offerType: PlayerWorldOfferType;
  sourceFaction: string;
  payloadJson: Record<string, unknown>;
}) {
  const fallbackDetail = typeof params.payloadJson.fallbackDetail === "string"
    ? params.payloadJson.fallbackDetail
    : "";
  return sanitizePlayerFacingOfferText(
    fallbackDetail,
    resolveOfferStaticDetail({
      offerType: params.offerType,
      sourceFaction: params.sourceFaction,
    }),
  );
}

function resolveOfferPressureTargets(payloadJson: Record<string, unknown>) {
  const value = payloadJson.pressureTargets;
  if (!Array.isArray(value)) {
    return [] as OpenWorldPressureTarget[];
  }
  return value
    .map((entry) => String(entry || "").trim())
    .filter((entry): entry is OpenWorldPressureTarget => (
      entry === "notorietyScore"
      || entry === "bountyHeat"
      || entry === "shadowFavor"
      || entry === "lawfulPressure"
    ));
}

function resolveOfferForcedActions(payloadJson: Record<string, unknown>) {
  const value = payloadJson.forcedActions;
  if (!Array.isArray(value)) {
    return [] as OpenWorldForcedAction[];
  }
  return value
    .map((entry) => String(entry || "").trim())
    .filter((entry): entry is OpenWorldForcedAction => (
      entry === "rob_lingyu"
      || entry === "forced_teleport"
      || entry === "forced_dual_cultivation"
    ));
}

function buildKeywordRuleSummary(payloadJson: Record<string, unknown>) {
  const requiresKeywords = Array.isArray(payloadJson.requiresKeywords)
    ? payloadJson.requiresKeywords.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  if (requiresKeywords.length <= 0) {
    return "无额外关键词限制。";
  }
  return `关键词要求：${requiresKeywords.join("、")}。`;
}

function normalizeOfferGender(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "male" || normalized === "man" || normalized === "男") {
    return "male" as const;
  }
  if (normalized === "female" || normalized === "woman" || normalized === "女") {
    return "female" as const;
  }
  return null;
}

function resolveOppositeOfferGender(value: unknown) {
  const normalized = normalizeOfferGender(value);
  if (normalized === "male") {
    return "female" as const;
  }
  if (normalized === "female") {
    return "male" as const;
  }
  return "female" as const;
}

function resolveOfferKeywordCheckPassed(params: {
  offer: Pick<PlayerWorldEventOfferRow, "summary" | "sourceFaction">;
  payloadJson: Record<string, unknown>;
}) {
  const requiresKeywords = Array.isArray(params.payloadJson.requiresKeywords)
    ? params.payloadJson.requiresKeywords.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  if (requiresKeywords.length <= 0) {
    return true;
  }
  const haystack = [
    params.offer.summary,
    params.offer.sourceFaction,
    params.payloadJson.keywordRuleSummary,
    ...(Array.isArray(params.payloadJson.aiSceneTags) ? params.payloadJson.aiSceneTags : []),
    ...(Array.isArray(params.payloadJson.requiresKeywords) ? params.payloadJson.requiresKeywords : []),
  ]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .join(" ");
  return requiresKeywords.every((keyword) => haystack.includes(keyword));
}

function buildPressureReliefDelta(params: {
  currentRow: PlayerWorldProfileRow;
  incidentType: PlayerWorldIncidentType;
  severity: number;
  reliefValue: number;
  pressureTargets: OpenWorldPressureTarget[];
}) {
  const fallbackDelta = resolveIncidentDelta(params.incidentType, params.severity);
  const delta: IncidentScoreDelta = {
    ...fallbackDelta,
  };
  const reliefApplied: Partial<Record<OpenWorldPressureTarget, number>> = {};
  params.pressureTargets.forEach((target) => {
    const currentValue = Math.max(0, Number(params.currentRow[target] || 0));
    const applied = Math.min(currentValue, Math.max(0, params.reliefValue));
    reliefApplied[target] = applied;
    delta[target] = -applied;
  });
  return {
    delta,
    reliefApplied,
  };
}

function buildAppliedScoreDelta(params: {
  currentRow: PlayerWorldProfileRow;
  nextScores: IncidentScoreDelta;
}) {
  return {
    notorietyScore: params.nextScores.notorietyScore - params.currentRow.notorietyScore,
    bountyHeat: params.nextScores.bountyHeat - params.currentRow.bountyHeat,
    shadowFavor: params.nextScores.shadowFavor - params.currentRow.shadowFavor,
    lawfulPressure: params.nextScores.lawfulPressure - params.currentRow.lawfulPressure,
  } satisfies IncidentScoreDelta;
}

function buildOfferDoubleCultivationSummary(params: {
  sourceFaction: string;
  linkage: WorldNpcDoubleCultivationRouteResult | null;
}) {
  if (!params.linkage?.settled) {
    return `${params.sourceFaction}递来的合意双修门路已经落定，但双修核心账本未能返回完整摘要。`;
  }
  const hints = [
    params.linkage.log?.id ? "已同步计入双修记录。" : null,
    typeof params.linkage.player?.gain === "number"
      ? `双修修为${params.linkage.player.gain >= 0 ? "+" : ""}${Math.floor(params.linkage.player.gain)}。`
      : null,
    typeof params.linkage.intimacy?.scoreDelta === "number" && params.linkage.intimacy.scoreDelta > 0
      ? `淫乱度 +${Math.floor(params.linkage.intimacy.scoreDelta)}。`
      : null,
    params.linkage.pregnancyStatus?.stageKey
      ? `孕育阶段：${params.linkage.pregnancyStatus.stageKey}。`
      : null,
  ].filter((entry): entry is string => Boolean(entry));
  return hints.length > 0
    ? hints.join(" ")
    : `${params.sourceFaction}替你把这场合意双修记入了双修核心账本。`;
}

function pickOfferForcedAction(forcedActions: readonly OpenWorldForcedAction[]) {
  if (forcedActions.includes("forced_dual_cultivation")) {
    return "forced_dual_cultivation" as const;
  }
  if (forcedActions.includes("forced_teleport")) {
    return "forced_teleport" as const;
  }
  return forcedActions[0] || null;
}

async function settleOfferDoubleCultivationLinkage(params: {
  playerId: string;
  playerRow: Pick<
    typeof players.$inferSelect,
    "name" | "gender" | "realmName" | "currentMapId" | "positionX" | "positionY" | "isAlive"
  >;
  offerId: string;
  sourceFaction: string;
  payloadJson: Record<string, unknown>;
  actionType: string;
  summaryMode?: "consensual" | "forced";
}) {
  const targetNpcId = String(
    params.payloadJson.sourceTargetId
    || params.payloadJson.sourceNpcId
    || `world-offer:${params.offerId}`,
  ).trim();
  const targetNpcName = String(
    params.payloadJson.sourceTargetName
    || `${params.sourceFaction || "灰线"}使者`,
  ).trim();
  const targetNpcGender = String(
    params.payloadJson.targetNpcGender
    || resolveOppositeOfferGender(params.playerRow.gender),
  ).trim();
  const targetNpcRealmName = String(
    params.payloadJson.targetNpcRealmName
    || params.playerRow.realmName
    || "练气期一重",
  ).trim();
  let linkage: WorldNpcDoubleCultivationRouteResult | null = null;
  try {
    linkage = await settleWorldNpcDoubleCultivationLinkage({
      playerId: params.playerId,
      targetNpcId,
      targetNpcName,
      targetNpcGender,
      targetNpcRealmName,
      actionType: params.actionType,
      sourceRef: `world-offer:${params.offerId}`,
      sourceTargetId: params.offerId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      linked: false,
      linkage: null,
      summary: params.summaryMode === "forced"
        ? (message || `${params.sourceFaction}压下来的强制双修已经落在你身上，但双修核心账本没有返回完整结果。`)
        : (message || "合意双修已落定，但双修核心账本未返回完整结果。"),
    };
  }

  if (linkage?.settled) {
    return {
      linked: true,
      linkage,
      summary: buildOfferDoubleCultivationSummary({
        sourceFaction: params.sourceFaction,
        linkage,
      }),
    };
  }

  return {
    linked: false,
    linkage: null,
    summary: params.summaryMode === "forced"
      ? `${params.sourceFaction}压下来的强制双修已经落在你身上，但双修核心账本没有返回完整结果。`
      : "合意双修已落定，但双修核心账本未返回完整结果。",
  };
}

function resolveWorldContractTypeLabel(contractType: PlayerWorldContractType) {
  switch (contractType) {
    case "meet_contact":
      return "暗线接头";
    case "hunt_target":
      return "猎修追杀";
    case "dead_drop_delivery":
      return "送货藏物";
    case "surveil_target":
      return "尾随监听";
    case "treasure_probe":
      return "探宝寻机";
    default:
      return "护送黑货";
  }
}

function resolveWorldContractMapName(mapName: string | null | undefined, mapId: string | null | undefined) {
  const normalizedMapName = String(mapName || "").trim();
  if (normalizedMapName) {
    return normalizedMapName;
  }
  const normalizedMapId = String(mapId || "").trim();
  if (!normalizedMapId) {
    return "无名地界";
  }
  if (normalizedMapId === "world_open_1") {
    return "尘世暗流";
  }
  return normalizedMapId.replace(/^world_open_/i, "天道界域·");
}

function normalizeOfferPayloadJson(payloadJson: Record<string, unknown> | null | undefined) {
  return payloadJson && typeof payloadJson === "object" && !Array.isArray(payloadJson)
    ? { ...payloadJson }
    : {};
}

function parseContractType(value: unknown): PlayerWorldContractType | null {
  return value === "meet_contact"
    || value === "hunt_target"
    || value === "dead_drop_delivery"
    || value === "surveil_target"
    || value === "escort_cargo"
    || value === "treasure_probe"
    ? value
    : null;
}

function parseContractStatus(value: unknown): PlayerWorldContractStatus | null {
  return value === "active" || value === "completed" || value === "failed" ? value : null;
}

function resolveOfferReward(payloadJson: Record<string, unknown>) {
  return {
    rewardGold: Math.max(0, Number(payloadJson.rewardGold || payloadJson.contractRewardGold || 0)),
    rewardLingYu: Math.max(0, Number(payloadJson.rewardLingYu || payloadJson.contractRewardLingYu || 0)),
  };
}

function buildContractProgressLabel(payloadJson: Record<string, unknown>, contractType: PlayerWorldContractType) {
  const explicit = String(payloadJson.contractProgressLabel || "").trim();
  if (explicit) {
    return explicit;
  }
  const targetNpcName = String(payloadJson.targetNpcName || "").trim() || "目标";
  const targetMapName = String(payloadJson.targetMapName || "").trim();
  const targetDistrictName = String(payloadJson.targetDistrictName || "").trim();
  if (contractType === "meet_contact") {
    if (targetDistrictName) {
      return `前往 ${targetDistrictName} 与 ${targetNpcName} 递话。`;
    }
    if (targetMapName) {
      return `前往 ${targetMapName} 与 ${targetNpcName} 接头。`;
    }
    return `找到 ${targetNpcName}，把暗语递过去。`;
  }
  if (contractType === "hunt_target" && targetDistrictName) {
    return `在 ${targetDistrictName} 除掉 ${targetNpcName}。`;
  }
  if (contractType === "hunt_target" && targetMapName) {
    return `去 ${targetMapName} 追杀 ${targetNpcName}。`;
  }
  const objectiveLabel = String(payloadJson.currentObjectivePointLabel || payloadJson.targetObjectivePointLabel || "").trim() || "指定地点";
  const objectiveMapName = String(payloadJson.currentObjectiveMapName || payloadJson.targetMapName || "").trim();
  const objectiveDistrictName = String(payloadJson.currentObjectiveDistrictName || payloadJson.targetDistrictName || "").trim();
  if (contractType === "dead_drop_delivery") {
    return `把货匣藏进${objectiveDistrictName || objectiveMapName || "指定地界"}的${objectiveLabel}。`;
  }
  if (contractType === "surveil_target") {
    return `去${objectiveDistrictName || objectiveMapName || "指定地界"}的${objectiveLabel}听完一轮口风。`;
  }
  if (contractType === "treasure_probe") {
    return `去${objectiveDistrictName || objectiveMapName || "指定地界"}的${objectiveLabel}探一段机缘线索。`;
  }
  const sourceLabel = String(payloadJson.sourceObjectivePointLabel || "").trim() || "起货点";
  if (String(payloadJson.contractStepStatus || "").trim() === "to_destination") {
    return `黑货已到手，护送去${objectiveDistrictName || objectiveMapName || "指定地界"}的${objectiveLabel}交接。`;
  }
  return `先去${sourceLabel}接走黑货，再转运去${objectiveDistrictName || objectiveMapName || "目的地"}。`;
}

type ContractObjectiveStage = {
  pointId: string | null;
  pointLabel: string | null;
  pointType: OpenWorldObjectivePointType | null;
  mapId: string | null;
  mapName: string | null;
  districtName: string | null;
  actionLabel: string | null;
  hint: string | null;
  stepStatus: string | null;
};

function resolveContractObjectiveStage(
  payloadJson: Record<string, unknown>,
  contractType: PlayerWorldContractType,
  contractStatus: PlayerWorldContractStatus,
): ContractObjectiveStage {
  if (contractStatus !== "active") {
    return {
      pointId: null,
      pointLabel: null,
      pointType: null,
      mapId: null,
      mapName: null,
      districtName: null,
      actionLabel: null,
      hint: null,
      stepStatus: String(payloadJson.contractStepStatus || "").trim() || null,
    };
  }

  if (contractType === "dead_drop_delivery" || contractType === "surveil_target" || contractType === "treasure_probe") {
    return {
      pointId: String(payloadJson.targetObjectivePointId || "").trim() || null,
      pointLabel: String(payloadJson.targetObjectivePointLabel || "").trim() || null,
      pointType: (String(payloadJson.targetObjectivePointType || "").trim() || null) as OpenWorldObjectivePointType | null,
      mapId: String(payloadJson.targetMapId || "").trim() || null,
      mapName: String(payloadJson.targetMapName || "").trim() || null,
      districtName: String(payloadJson.targetDistrictName || "").trim() || null,
      actionLabel: String(payloadJson.objectiveActionLabel || "").trim() || null,
      hint: String(payloadJson.objectiveActionHint || "").trim() || null,
      stepStatus: String(payloadJson.contractStepStatus || "").trim() || "active",
    };
  }

  if (contractType === "escort_cargo") {
    const stepStatus = String(payloadJson.contractStepStatus || "").trim() || "to_source";
    const useDestination = stepStatus === "to_destination";
    return {
      pointId: String(useDestination ? (payloadJson.targetObjectivePointId || "") : (payloadJson.sourceObjectivePointId || "")).trim() || null,
      pointLabel: String(useDestination ? (payloadJson.targetObjectivePointLabel || "") : (payloadJson.sourceObjectivePointLabel || "")).trim() || null,
      pointType: (String(useDestination ? (payloadJson.targetObjectivePointType || "") : (payloadJson.sourceObjectivePointType || "")).trim() || null) as OpenWorldObjectivePointType | null,
      mapId: String(useDestination ? (payloadJson.targetMapId || "") : (payloadJson.sourceMapId || "")).trim() || null,
      mapName: String(useDestination ? (payloadJson.targetMapName || "") : (payloadJson.sourceMapName || "")).trim() || null,
      districtName: String(useDestination ? (payloadJson.targetDistrictName || "") : (payloadJson.sourceDistrictName || "")).trim() || null,
      actionLabel: String(
        useDestination
          ? (payloadJson.targetObjectiveActionLabel || payloadJson.objectiveActionLabel)
          : (payloadJson.sourceObjectiveActionLabel || "接走黑货"),
      ).trim() || null,
      hint: String(
        useDestination
          ? (payloadJson.targetObjectiveHint || payloadJson.objectiveActionHint)
          : payloadJson.sourceObjectiveHint,
      ).trim() || null,
      stepStatus,
    };
  }

  return {
    pointId: null,
    pointLabel: null,
    pointType: null,
    mapId: null,
    mapName: null,
    districtName: null,
    actionLabel: null,
    hint: null,
    stepStatus: String(payloadJson.contractStepStatus || "").trim() || null,
  };
}

function mapPlayerWorldContractRow(row: PlayerWorldEventOfferRow): PlayerWorldContractItem | null {
  const payloadJson = normalizeOfferPayloadJson(row.payloadJson);
  const contractType = parseContractType(payloadJson.contractType);
  const contractStatus = parseContractStatus(payloadJson.contractStatus);
  if (!contractType || !contractStatus) {
    return null;
  }

  const reward = resolveOfferReward(payloadJson);
  const targetNpcId = String(payloadJson.targetNpcId || "").trim() || null;
  const targetNpcName = String(payloadJson.targetNpcName || "").trim() || null;
  const targetMapId = String(payloadJson.targetMapId || "").trim() || null;
  const targetMapName = String(payloadJson.targetMapName || "").trim() || null;
  const targetDistrictName = String(payloadJson.targetDistrictName || "").trim() || null;
  const targetPositionX = parseOptionalPosition(payloadJson.targetPositionX);
  const targetPositionY = parseOptionalPosition(payloadJson.targetPositionY);
  const title = String(payloadJson.contractTitle || "").trim()
    || `${resolveOfferTypeLabel(row.offerType as PlayerWorldOfferType)} · ${resolveWorldContractTypeLabel(contractType)}`;
  const summary = String(payloadJson.contractSummary || "").trim()
    || buildContractProgressLabel(payloadJson, contractType);
  const detail = String(payloadJson.contractDetail || "").trim()
    || resolveOfferDetail({
      offerType: row.offerType as PlayerWorldOfferType,
      sourceFaction: row.sourceFaction || "暗线",
      payloadJson,
    });
  const progressLabel = buildContractProgressLabel(payloadJson, contractType);
  const actionLabel = contractStatus === "active" && contractType === "meet_contact"
    ? String(payloadJson.contractActionLabel || "").trim() || "递上暗语"
    : null;
  const objectiveStage = resolveContractObjectiveStage(payloadJson, contractType, contractStatus);

  return {
    offerId: row.id,
    offerType: row.offerType as PlayerWorldOfferType,
    offerTypeLabel: resolveOfferTypeLabel(row.offerType as PlayerWorldOfferType),
    sourceFaction: row.sourceFaction || null,
    storylineId: String(payloadJson.storylineId || "").trim() || null,
    contractType,
    contractStatus,
    title,
    summary,
    detail,
    progressLabel,
    actionLabel,
    targetNpcId,
    targetNpcName,
    targetMapId,
    targetMapName,
    targetDistrictName,
    targetPositionX,
    targetPositionY,
    rewardGold: reward.rewardGold,
    rewardLingYu: reward.rewardLingYu,
    canAdvanceByTalking: contractType === "meet_contact" && contractStatus === "active" && Boolean(targetNpcId),
    canAdvanceByObjective: (
      contractStatus === "active"
      && (contractType === "dead_drop_delivery" || contractType === "surveil_target" || contractType === "escort_cargo" || contractType === "treasure_probe")
      && Boolean(objectiveStage.pointId)
    ),
    currentObjectivePointId: objectiveStage.pointId,
    currentObjectivePointLabel: objectiveStage.pointLabel,
    currentObjectivePointType: objectiveStage.pointType,
    currentObjectiveMapId: objectiveStage.mapId,
    currentObjectiveMapName: objectiveStage.mapName,
    currentObjectiveDistrictName: objectiveStage.districtName,
    currentObjectivePositionX: parseOptionalPosition(
      payloadJson.currentObjectivePositionX || payloadJson.targetObjectivePositionX,
    ),
    currentObjectivePositionY: parseOptionalPosition(
      payloadJson.currentObjectivePositionY || payloadJson.targetObjectivePositionY,
    ),
    currentObjectiveActionLabel: objectiveStage.actionLabel,
    currentObjectiveHint: objectiveStage.hint,
    objectiveStepStatus: objectiveStage.stepStatus,
    completedAt: String(payloadJson.contractCompletedAt || "").trim() || null,
    updatedAt: row.updatedAt,
  };
}

type WorldContractTarget = {
  npcId: string;
  npcName: string;
  mapId: string;
  mapName: string;
  districtName: string | null;
  positionX: number;
  positionY: number;
};

type WorldContractObjectiveTarget = {
  pointId: string;
  pointLabel: string;
  pointType: OpenWorldObjectivePointType;
  pointTypeLabel: string;
  mapId: string;
  mapName: string;
  districtName: string | null;
  positionX: number;
  positionY: number;
  description: string;
  interactionHint: string;
};

function mapObjectivePointToTarget(point: OpenWorldObjectivePoint): WorldContractObjectiveTarget {
  return {
    pointId: point.id,
    pointLabel: point.label,
    pointType: point.pointType,
    pointTypeLabel: point.pointTypeLabel,
    mapId: point.mapId,
    mapName: resolveWorldContractMapName(null, point.mapId),
    districtName: point.districtName,
    positionX: point.positionX,
    positionY: point.positionY,
    description: point.description,
    interactionHint: point.interactionHint,
  };
}

function buildObjectivePointTarget(
  point: OpenWorldObjectivePoint | null | undefined,
  mapName?: string | null,
): WorldContractObjectiveTarget | null {
  if (!point) {
    return null;
  }
  return {
    ...mapObjectivePointToTarget(point),
    mapName: resolveWorldContractMapName(mapName || point.mapId, point.mapId),
  };
}

function pickContractObjectivePoint(params: {
  mapId: string;
  mapName?: string | null;
  pointTypes?: OpenWorldObjectivePointType[];
  districtName?: string | null;
}) {
  return buildObjectivePointTarget(
    pickOpenWorldObjectivePoint({
      mapId: params.mapId,
      pointTypes: params.pointTypes,
      districtName: params.districtName,
    }),
    params.mapName,
  );
}

async function pickWorldContractTarget(params: {
  offerType: PlayerWorldOfferType;
  preferredMapId?: string | null;
}) {
  const conditions = [eq(worldNpcProfiles.status, "active")];
  if (params.offerType === "cultivator_hunt") {
    conditions.push(eq(worldNpcProfiles.isKillable, true));
  }

  const rows = await db.select({
    npcId: worldNpcProfiles.id,
    npcName: worldNpcProfiles.name,
    mapId: worldNpcRuntime.currentMapId,
    mapName: worldMapInstances.name,
    positionX: worldNpcRuntime.positionX,
    positionY: worldNpcRuntime.positionY,
  }).from(worldNpcProfiles)
    .innerJoin(worldNpcRuntime, eq(worldNpcRuntime.npcId, worldNpcProfiles.id))
    .leftJoin(worldMapInstances, eq(worldMapInstances.id, worldNpcRuntime.currentMapId))
    .where(and(...conditions))
    .limit(32)
    .all();

  const preferredMapId = String(params.preferredMapId || "").trim();
  const rankedRows = rows
    .map((row) => {
      let score = 0;
      if (preferredMapId && row.mapId === preferredMapId) {
        score += 100;
      }
      if (params.offerType === "shadow_intel") {
        score += 12;
      }
      if (params.offerType === "cultivator_hunt") {
        score += 24;
      }
      return {
        ...row,
        score,
      };
    })
    .sort((left, right) => right.score - left.score);

  const picked = rankedRows[0];
  if (!picked) {
    return null;
  }

  return {
    npcId: picked.npcId,
    npcName: picked.npcName,
    mapId: picked.mapId,
    mapName: resolveWorldContractMapName(picked.mapName, picked.mapId),
    districtName: resolveOpenWorldDistrictName({
      mapId: picked.mapId,
      positionX: picked.positionX,
      positionY: picked.positionY,
    }),
    positionX: picked.positionX,
    positionY: picked.positionY,
  } satisfies WorldContractTarget;
}

function pickEscortSourceAndTarget(params: {
  preferredMapId?: string | null;
}) {
  const preferredMapId = String(params.preferredMapId || "").trim();
  const sourcePoint = preferredMapId
    ? pickContractObjectivePoint({
      mapId: preferredMapId,
      pointTypes: ["black_market_stall", "smuggling_gate"],
    })
    : null;

  const fallbackMapIds = Array.from({ length: 5 }, (_, index) => `world_open_${index + 1}`);
  const source = sourcePoint || fallbackMapIds
    .map((mapId) => pickContractObjectivePoint({
      mapId,
      pointTypes: ["black_market_stall", "smuggling_gate"],
    }))
    .find(Boolean) || null;

  if (!source) {
    return null;
  }

  const destinationMapId = source.mapId === "world_open_5"
    ? "world_open_1"
    : source.mapId.replace(/(\d+)$/, (_, rawIndex) => String(Number(rawIndex) + 1));
  const destination = pickContractObjectivePoint({
    mapId: destinationMapId,
    pointTypes: ["shadow_contact", "hidden_shrine"],
  }) || pickContractObjectivePoint({
    mapId: source.mapId,
    pointTypes: ["hidden_shrine", "shadow_contact"],
  });

  if (!destination) {
    return null;
  }

  return {
    source,
    destination,
  };
}

function pickTreasureInviteObjective(params: {
  preferredMapId?: string | null;
}) {
  const preferredMapId = String(params.preferredMapId || "").trim();
  const preferredPoint = preferredMapId
    ? pickContractObjectivePoint({
      mapId: preferredMapId,
      pointTypes: ["rumor_stela", "hidden_shrine", "black_market_stall"],
    })
    : null;

  if (preferredPoint) {
    return preferredPoint;
  }

  const fallbackMapIds = Array.from({ length: 16 }, (_, index) => `world_open_${index + 1}`);
  for (const mapId of fallbackMapIds) {
    const point = pickContractObjectivePoint({
      mapId,
      pointTypes: ["rumor_stela", "hidden_shrine", "black_market_stall"],
    });
    if (point) {
      return point;
    }
  }

  return null;
}

function offerRequiresWorldContract(offerType: PlayerWorldOfferType) {
  return offerType === "shadow_intel"
    || offerType === "cultivator_hunt"
    || offerType === "black_market_trade"
    || offerType === "treasure_invite"
    || offerType === "broker_relief"
    || offerType === "demonic_temptation";
}

function offerUsesNpcContractTarget(offerType: PlayerWorldOfferType) {
  return offerType === "shadow_intel"
    || offerType === "cultivator_hunt"
    || offerType === "broker_relief";
}

function buildContractPayload(params: {
  offerType: PlayerWorldOfferType;
  sourceFaction: string;
  target?: WorldContractTarget | null;
  reward: {
    rewardGold: number;
    rewardLingYu: number;
  };
  basePayloadJson: Record<string, unknown>;
  preferredMapId?: string | null;
}): Record<string, unknown> {
  if (params.offerType === "shadow_intel" && params.target) {
    const districtLabel = params.target.districtName || params.target.mapName;
    const targetPoint = pickContractObjectivePoint({
      mapId: params.target.mapId,
      mapName: params.target.mapName,
      pointTypes: ["rumor_stela", "shadow_contact"],
      districtName: params.target.districtName,
    });
    const useSurveil = Boolean(targetPoint) && (
      params.target.npcId.endsWith("2")
      || params.target.npcId.endsWith("4")
      || params.target.npcId.endsWith("6")
      || params.target.npcId.endsWith("8")
    );

    if (useSurveil && targetPoint) {
      return {
        ...params.basePayloadJson,
        contractType: "surveil_target",
        contractStatus: "active",
        contractStepStatus: "active",
        contractTitle: "贴影听风",
        contractSummary: `${params.sourceFaction}要你去 ${targetPoint.districtName || targetPoint.mapName} 的 ${targetPoint.pointLabel} 盯住 ${params.target.npcName} 的尾巴，听完一轮口风再回来。`,
        contractDetail: `${params.target.npcName}近来会在 ${targetPoint.pointLabel} 一带露面。你不必动手，只要把那里的灰话听全。`,
        contractProgressLabel: buildContractProgressLabel({
          targetNpcName: params.target.npcName,
          targetMapName: targetPoint.mapName,
          targetDistrictName: targetPoint.districtName,
          targetObjectivePointLabel: targetPoint.pointLabel,
          currentObjectivePointLabel: targetPoint.pointLabel,
          objectiveActionLabel: "伏听口风",
        }, "surveil_target"),
        contractActionLabel: null,
        targetNpcId: params.target.npcId,
        targetNpcName: params.target.npcName,
        targetMapId: targetPoint.mapId,
        targetMapName: targetPoint.mapName,
        targetDistrictName: targetPoint.districtName,
        targetPositionX: params.target.positionX,
        targetPositionY: params.target.positionY,
        targetObjectivePointId: targetPoint.pointId,
        targetObjectivePointLabel: targetPoint.pointLabel,
        targetObjectivePointType: targetPoint.pointType,
        targetObjectivePositionX: targetPoint.positionX,
        targetObjectivePositionY: targetPoint.positionY,
        currentObjectivePositionX: targetPoint.positionX,
        currentObjectivePositionY: targetPoint.positionY,
        objectiveActionLabel: "伏听口风",
        objectiveActionHint: targetPoint.interactionHint,
        contractRewardGold: params.reward.rewardGold,
        contractRewardLingYu: params.reward.rewardLingYu,
        rewardGold: 0,
        rewardLingYu: 0,
        contractCompletedAt: null,
      } satisfies Record<string, unknown>;
    }

    return {
      ...params.basePayloadJson,
      contractType: "meet_contact",
      contractStatus: "active",
      contractTitle: "夜渡暗语",
      contractSummary: `${params.sourceFaction}让你先去 ${districtLabel} 与 ${params.target.npcName} 接头，再换那张见不得光的帖子。`,
      contractDetail: `${params.sourceFaction}不肯直接把情报交给你，得先由 ${params.target.npcName} 验明风声与来路。`,
      contractProgressLabel: buildContractProgressLabel({
        targetNpcName: params.target.npcName,
        targetMapName: params.target.mapName,
        targetDistrictName: params.target.districtName,
      }, "meet_contact"),
      contractActionLabel: "递上暗语",
      targetNpcId: params.target.npcId,
      targetNpcName: params.target.npcName,
      targetMapId: params.target.mapId,
      targetMapName: params.target.mapName,
      targetDistrictName: params.target.districtName,
      targetPositionX: params.target.positionX,
      targetPositionY: params.target.positionY,
      contractRewardGold: params.reward.rewardGold,
      contractRewardLingYu: params.reward.rewardLingYu,
      rewardGold: 0,
      rewardLingYu: 0,
      contractCompletedAt: null,
    } satisfies Record<string, unknown>;
  }

  if (params.offerType === "broker_relief" && params.target) {
    const districtLabel = params.target.districtName || params.target.mapName;
    return {
      ...params.basePayloadJson,
      contractType: "meet_contact",
      contractStatus: "active",
      contractTitle: "牙子递话",
      contractSummary: `${params.sourceFaction}让你去 ${districtLabel} 找 ${params.target.npcName} 递话说项，把那层僵冷的人情先缓下来。`,
      contractDetail: `${params.sourceFaction}已经愿意替你出面，但仍要你当面递上一句准话，街面上那些不肯搭理你的冷脸才会真正松口。`,
      contractProgressLabel: buildContractProgressLabel({
        targetNpcName: params.target.npcName,
        targetMapName: params.target.mapName,
        targetDistrictName: params.target.districtName,
      }, "meet_contact"),
      contractActionLabel: "递上转话帖",
      targetNpcId: params.target.npcId,
      targetNpcName: params.target.npcName,
      targetMapId: params.target.mapId,
      targetMapName: params.target.mapName,
      targetDistrictName: params.target.districtName,
      targetPositionX: params.target.positionX,
      targetPositionY: params.target.positionY,
      contractRewardGold: params.reward.rewardGold,
      contractRewardLingYu: params.reward.rewardLingYu,
      rewardGold: 0,
      rewardLingYu: 0,
      contractCompletedAt: null,
    } satisfies Record<string, unknown>;
  }

  if (params.offerType === "cultivator_hunt" && params.target) {
    const districtLabel = params.target.districtName || params.target.mapName;
    return {
      ...params.basePayloadJson,
      contractType: "hunt_target",
      contractStatus: "active",
      contractTitle: "灰营追猎",
      contractSummary: `${params.sourceFaction}要你去 ${districtLabel} 料理掉 ${params.target.npcName}，做成之后再领尾款。`,
      contractDetail: `${params.target.npcName}已被挂进灰线名单。你若动手，酬劳与恶名都会一起到手。`,
      contractProgressLabel: buildContractProgressLabel({
        targetNpcName: params.target.npcName,
        targetMapName: params.target.mapName,
        targetDistrictName: params.target.districtName,
      }, "hunt_target"),
      contractActionLabel: null,
      targetNpcId: params.target.npcId,
      targetNpcName: params.target.npcName,
      targetMapId: params.target.mapId,
      targetMapName: params.target.mapName,
      targetDistrictName: params.target.districtName,
      targetPositionX: params.target.positionX,
      targetPositionY: params.target.positionY,
      contractRewardGold: params.reward.rewardGold,
      contractRewardLingYu: params.reward.rewardLingYu,
      rewardGold: 0,
      rewardLingYu: 0,
      contractCompletedAt: null,
    } satisfies Record<string, unknown>;
  }

  if (params.offerType === "black_market_trade") {
    const targetPoint = pickContractObjectivePoint({
      mapId: String(params.preferredMapId || "").trim() || "world_open_1",
      pointTypes: ["hidden_shrine", "shadow_contact"],
    }) || pickContractObjectivePoint({
      mapId: "world_open_1",
      pointTypes: ["hidden_shrine", "shadow_contact"],
    });
    if (targetPoint) {
      return {
        ...params.basePayloadJson,
        contractType: "dead_drop_delivery",
        contractStatus: "active",
        contractStepStatus: "active",
        contractTitle: "灰仓藏匣",
        contractSummary: `${params.sourceFaction}让你把一只货匣带去 ${targetPoint.districtName || targetPoint.mapName} 的 ${targetPoint.pointLabel} 藏好，尾款稍后再结。`,
        contractDetail: `这单不需要多问来路，只要把东西稳稳塞进 ${targetPoint.pointLabel}，别让旁人看出手脚。`,
        contractProgressLabel: buildContractProgressLabel({
          targetMapName: targetPoint.mapName,
          targetDistrictName: targetPoint.districtName,
          targetObjectivePointLabel: targetPoint.pointLabel,
          currentObjectivePointLabel: targetPoint.pointLabel,
        }, "dead_drop_delivery"),
        targetMapId: targetPoint.mapId,
        targetMapName: targetPoint.mapName,
        targetDistrictName: targetPoint.districtName,
        targetObjectivePointId: targetPoint.pointId,
        targetObjectivePointLabel: targetPoint.pointLabel,
        targetObjectivePointType: targetPoint.pointType,
        targetObjectivePositionX: targetPoint.positionX,
        targetObjectivePositionY: targetPoint.positionY,
        currentObjectivePositionX: targetPoint.positionX,
        currentObjectivePositionY: targetPoint.positionY,
        objectiveActionLabel: "藏下货匣",
        objectiveActionHint: targetPoint.interactionHint,
        contractRewardGold: params.reward.rewardGold,
        contractRewardLingYu: params.reward.rewardLingYu,
        rewardGold: 0,
        rewardLingYu: 0,
        contractCompletedAt: null,
      } satisfies Record<string, unknown>;
    }
  }

  if (params.offerType === "treasure_invite") {
    const targetPoint = pickTreasureInviteObjective({
      preferredMapId: params.preferredMapId,
    });
    if (targetPoint) {
      return {
        ...params.basePayloadJson,
        contractType: "treasure_probe",
        contractStatus: "active",
        contractStepStatus: "active",
        contractTitle: "探宝邀约",
        contractSummary: `${params.sourceFaction}邀你去 ${targetPoint.districtName || targetPoint.mapName} 的 ${targetPoint.pointLabel} 探一段刚露头的机缘风声，摸清后再结尾款。`,
        contractDetail: `这更像一场试探。你只要去 ${targetPoint.pointLabel} 走一遭，把那里的异动摸清，后续门路和尾款都会落下来。`,
        contractProgressLabel: buildContractProgressLabel({
          targetMapName: targetPoint.mapName,
          targetDistrictName: targetPoint.districtName,
          targetObjectivePointLabel: targetPoint.pointLabel,
          currentObjectivePointLabel: targetPoint.pointLabel,
          objectiveActionLabel: "探查异动",
        }, "treasure_probe"),
        targetMapId: targetPoint.mapId,
        targetMapName: targetPoint.mapName,
        targetDistrictName: targetPoint.districtName,
        targetObjectivePointId: targetPoint.pointId,
        targetObjectivePointLabel: targetPoint.pointLabel,
        targetObjectivePointType: targetPoint.pointType,
        targetObjectivePositionX: targetPoint.positionX,
        targetObjectivePositionY: targetPoint.positionY,
        currentObjectivePositionX: targetPoint.positionX,
        currentObjectivePositionY: targetPoint.positionY,
        objectiveActionLabel: "探查异动",
        objectiveActionHint: targetPoint.interactionHint,
        contractRewardGold: params.reward.rewardGold,
        contractRewardLingYu: params.reward.rewardLingYu,
        rewardGold: 0,
        rewardLingYu: 0,
        contractCompletedAt: null,
      } satisfies Record<string, unknown>;
    }
  }

  if (params.offerType === "demonic_temptation") {
    const escortPoints = pickEscortSourceAndTarget({
      preferredMapId: params.preferredMapId,
    });
    if (escortPoints) {
      return {
        ...params.basePayloadJson,
        contractType: "escort_cargo",
        contractStatus: "active",
        contractStepStatus: "to_source",
        contractTitle: "夜路转货",
        contractSummary: `${params.sourceFaction}要你先去 ${escortPoints.source.pointLabel} 接走黑货，再护送去 ${escortPoints.destination.districtName || escortPoints.destination.mapName} 的 ${escortPoints.destination.pointLabel}。`,
        contractDetail: `这批东西带着几分不正的气息，途中若露了行迹，灰账就会记到你头上。`,
        contractProgressLabel: buildContractProgressLabel({
          sourceObjectivePointLabel: escortPoints.source.pointLabel,
          targetMapName: escortPoints.destination.mapName,
          targetDistrictName: escortPoints.destination.districtName,
          targetObjectivePointLabel: escortPoints.destination.pointLabel,
          currentObjectivePointLabel: escortPoints.source.pointLabel,
          contractStepStatus: "to_source",
        }, "escort_cargo"),
        sourceMapId: escortPoints.source.mapId,
        sourceMapName: escortPoints.source.mapName,
        sourceDistrictName: escortPoints.source.districtName,
        sourceObjectivePointId: escortPoints.source.pointId,
        sourceObjectivePointLabel: escortPoints.source.pointLabel,
        sourceObjectivePointType: escortPoints.source.pointType,
        sourceObjectivePositionX: escortPoints.source.positionX,
        sourceObjectivePositionY: escortPoints.source.positionY,
        sourceObjectiveActionLabel: "接走黑货",
        sourceObjectiveHint: escortPoints.source.interactionHint,
        targetMapId: escortPoints.destination.mapId,
        targetMapName: escortPoints.destination.mapName,
        targetDistrictName: escortPoints.destination.districtName,
        targetObjectivePointId: escortPoints.destination.pointId,
        targetObjectivePointLabel: escortPoints.destination.pointLabel,
        targetObjectivePointType: escortPoints.destination.pointType,
        targetObjectivePositionX: escortPoints.destination.positionX,
        targetObjectivePositionY: escortPoints.destination.positionY,
        targetObjectiveActionLabel: "护送交货",
        targetObjectiveHint: escortPoints.destination.interactionHint,
        objectiveActionLabel: "护送交货",
        objectiveActionHint: escortPoints.destination.interactionHint,
        currentObjectivePositionX: escortPoints.source.positionX,
        currentObjectivePositionY: escortPoints.source.positionY,
        contractRewardGold: params.reward.rewardGold,
        contractRewardLingYu: params.reward.rewardLingYu,
        rewardGold: 0,
        rewardLingYu: 0,
        contractCompletedAt: null,
      } satisfies Record<string, unknown>;
    }
  }

  return params.basePayloadJson;
}

function resolveIncidentDelta(incidentType: PlayerWorldIncidentType, severity: number): IncidentScoreDelta {
  const scale = Math.max(1, severity);
  switch (incidentType) {
    case "kill_and_loot":
    case "kill_loot":
      return {
        notorietyScore: 10 * scale,
        bountyHeat: 12 * scale,
        shadowFavor: 4 * scale,
        lawfulPressure: 9 * scale,
      };
    case "witnessed":
      return {
        notorietyScore: 4 * scale,
        bountyHeat: 6 * scale,
        shadowFavor: scale,
        lawfulPressure: 5 * scale,
      };
    case "tracking_notice":
      return {
        notorietyScore: scale,
        bountyHeat: 4 * scale,
        shadowFavor: 0,
        lawfulPressure: 2 * scale,
      };
    case "escaped":
    case "escape":
      return {
        notorietyScore: 3 * scale,
        bountyHeat: 8 * scale,
        shadowFavor: 2 * scale,
        lawfulPressure: 4 * scale,
      };
    case "assassination":
    case "assassinated":
      return {
        notorietyScore: 2 * scale,
        bountyHeat: 5 * scale,
        shadowFavor: 2 * scale,
        lawfulPressure: 2 * scale,
      };
    case "shadow_trade":
    case "black_market_trade":
      return {
        notorietyScore: 2 * scale,
        bountyHeat: 3 * scale,
        shadowFavor: 10 * scale,
        lawfulPressure: 2 * scale,
      };
    case "shadow_intel":
      return {
        notorietyScore: 3 * scale,
        bountyHeat: 5 * scale,
        shadowFavor: 8 * scale,
        lawfulPressure: scale,
      };
    case "cultivator_hunt":
      return {
        notorietyScore: 7 * scale,
        bountyHeat: 9 * scale,
        shadowFavor: 5 * scale,
        lawfulPressure: 5 * scale,
      };
    case "demonic_temptation":
      return {
        notorietyScore: 5 * scale,
        bountyHeat: 4 * scale,
        shadowFavor: 12 * scale,
        lawfulPressure: 3 * scale,
      };
    case "pressure_cleanse":
      return {
        notorietyScore: -6 * scale,
        bountyHeat: -2 * scale,
        shadowFavor: 4 * scale,
        lawfulPressure: -7 * scale,
      };
    case "rumor_silence":
      return {
        notorietyScore: -2 * scale,
        bountyHeat: -8 * scale,
        shadowFavor: 5 * scale,
        lawfulPressure: -4 * scale,
      };
    case "lawful_mediation":
      return {
        notorietyScore: -4 * scale,
        bountyHeat: -2 * scale,
        shadowFavor: -2 * scale,
        lawfulPressure: -8 * scale,
      };
    case "consensual_dual_cultivation":
      return {
        notorietyScore: -6 * scale,
        bountyHeat: -10 * scale,
        shadowFavor: 3 * scale,
        lawfulPressure: -8 * scale,
      };
    case "gift_lingyu":
      return {
        notorietyScore: 0,
        bountyHeat: 0,
        shadowFavor: 6 * scale,
        lawfulPressure: -1 * scale,
      };
    case "treasure_invite":
      return {
        notorietyScore: scale,
        bountyHeat: scale,
        shadowFavor: 8 * scale,
        lawfulPressure: 0,
      };
    case "broker_relief":
      return {
        notorietyScore: -3 * scale,
        bountyHeat: -4 * scale,
        shadowFavor: 4 * scale,
        lawfulPressure: -5 * scale,
      };
    case "adult_affair":
      return {
        notorietyScore: 0,
        bountyHeat: 0,
        shadowFavor: 0,
        lawfulPressure: 0,
      };
    case "adult_report":
      return {
        notorietyScore: 3 * scale,
        bountyHeat: 4 * scale,
        shadowFavor: scale,
        lawfulPressure: 7 * scale,
      };
    case "dangerous_preference":
      return {
        notorietyScore: 4 * scale,
        bountyHeat: 3 * scale,
        shadowFavor: 8 * scale,
        lawfulPressure: 4 * scale,
      };
    case "essence_drain":
      return {
        notorietyScore: 5 * scale,
        bountyHeat: 4 * scale,
        shadowFavor: 7 * scale,
        lawfulPressure: 3 * scale,
      };
    case "coercive_failure":
      return {
        notorietyScore: 3 * scale,
        bountyHeat: 4 * scale,
        shadowFavor: 2 * scale,
        lawfulPressure: 4 * scale,
      };
    case "forced_consequence":
      return {
        notorietyScore: 4 * scale,
        bountyHeat: 6 * scale,
        shadowFavor: 3 * scale,
        lawfulPressure: 4 * scale,
      };
    case "district_chain_rumor":
      return {
        notorietyScore: 0,
        bountyHeat: 0,
        shadowFavor: 0,
        lawfulPressure: 0,
      };
    case "district_storyline_gray":
      return {
        notorietyScore: scale,
        bountyHeat: 2 * scale,
        shadowFavor: 6 * scale,
        lawfulPressure: scale,
      };
    case "district_storyline_lawful":
      return {
        notorietyScore: 0,
        bountyHeat: scale,
        shadowFavor: -1 * scale,
        lawfulPressure: -2 * scale,
      };
    case "district_storyline_demonic":
      return {
        notorietyScore: 4 * scale,
        bountyHeat: 3 * scale,
        shadowFavor: 7 * scale,
        lawfulPressure: 3 * scale,
      };
    case "offer_accepted":
    case "offer_accept":
      return {
        notorietyScore: scale,
        bountyHeat: 2 * scale,
        shadowFavor: 6 * scale,
        lawfulPressure: scale,
      };
    case "offer_rejected":
    case "offer_reject":
      return {
        notorietyScore: 0,
        bountyHeat: 0,
        shadowFavor: -2 * scale,
        lawfulPressure: -1 * scale,
      };
    default:
      return {
        notorietyScore: 2 * scale,
        bountyHeat: 2 * scale,
        shadowFavor: scale,
        lawfulPressure: scale,
      };
  }
}

function normalizeFlags(flagsJson: Record<string, unknown> | null | undefined) {
  return flagsJson && typeof flagsJson === "object" && !Array.isArray(flagsJson)
    ? { ...flagsJson }
    : {};
}

function buildNeutralPlayerWorldPressureSummary(playerId: string): PlayerWorldPressureSummary {
  const presentation = resolveAlertPresentation("observe");
  return {
    playerId,
    notorietyScore: 0,
    bountyHeat: 0,
    shadowFavor: 0,
    lawfulPressure: 0,
    activeAlertTier: "observe",
    activeAlertLabel: presentation.label,
    tierLabel: presentation.label,
    activeAlertDescription: presentation.description,
    tierDescription: presentation.description,
    activeWatcherCount: 1,
    summary: resolvePressureSummaryText({
      tier: "observe",
      watcherCount: 1,
    }),
    lawfulSummary: resolveLawfulSummary("neutral"),
    shadowSummary: resolveShadowSummary("distant"),
    nextEscalationRisk: presentation.nextEscalationRisk,
    nextRiskLabel: presentation.nextEscalationRisk,
    marketFeeExtraPercent: 0,
    lawfulMood: "neutral",
    shadowMood: "distant",
    flags: {},
    updatedAt: new Date().toISOString(),
  };
}

function buildNeutralPlayerWorldPressureSnapshot(playerId: string): PlayerWorldPressureSnapshot {
  const pressure = buildNeutralPlayerWorldPressureSummary(playerId);
  return {
    pressure,
    reputation: buildPlayerWorldReputationSummary({
      playerId,
      pressure,
      adultSurface: buildNeutralPlayerWorldAdultSurface(),
    }),
    trackingSignals: [],
    worldDangerCount: 0,
    worldBountyActive: false,
    worldRumorUnread: 0,
  };
}

function buildNeutralPlayerWorldNpcAttitude(): PlayerWorldNpcAttitude {
  return {
    stance: "neutral",
    level: "neutral",
    label: "平常相看",
    description: "对方还没从你的风声里嗅到太多东西。",
    summary: "对方还没从你的风声里嗅到太多东西。",
    hints: ["暂时没有明显的世界压力反馈。"],
    worldReactionHints: ["暂时没有明显的世界压力反馈。"],
    willIgnorePlayer: false,
    needsBrokerRelief: false,
    repairHints: [],
    interactionBiases: ["talk"],
    reputationLabel: "名声未显",
    reputationSummary: "眼下还只是寻常来客，大多数人不会额外多想。",
  };
}

function logPlayerWorldFallback(scope: string, error: unknown) {
  console.error(`[player-world] ${scope} fallback:`, error);
}

function summarizeProfile(row: PlayerWorldProfileRow): PlayerWorldPressureSummary {
  const alertPresentation = resolveAlertPresentation(row.activeAlertTier as PlayerWorldAlertTier);
  const lawfulMood = row.lawfulPressure >= 70 ? "guarded" : row.lawfulPressure >= 34 ? "cold" : "neutral";
  const shadowMood = row.shadowFavor >= 66 ? "welcoming" : row.shadowFavor >= 28 ? "curious" : "distant";
  return {
    playerId: row.playerId,
    notorietyScore: row.notorietyScore,
    bountyHeat: row.bountyHeat,
    shadowFavor: row.shadowFavor,
    lawfulPressure: row.lawfulPressure,
    activeAlertTier: row.activeAlertTier as PlayerWorldAlertTier,
    activeAlertLabel: alertPresentation.label,
    tierLabel: alertPresentation.label,
    activeAlertDescription: alertPresentation.description,
    tierDescription: alertPresentation.description,
    activeWatcherCount: row.activeWatcherCount,
    summary: resolvePressureSummaryText({
      tier: row.activeAlertTier as PlayerWorldAlertTier,
      watcherCount: row.activeWatcherCount,
    }),
    lawfulSummary: resolveLawfulSummary(lawfulMood),
    shadowSummary: resolveShadowSummary(shadowMood),
    nextEscalationRisk: alertPresentation.nextEscalationRisk,
    nextRiskLabel: alertPresentation.nextEscalationRisk,
    marketFeeExtraPercent: Math.max(0, Math.min(8, Math.floor(row.lawfulPressure / 18) + (getTierOrder(row.activeAlertTier as PlayerWorldAlertTier) >= 3 ? 1 : 0))),
    lawfulMood,
    shadowMood,
    flags: normalizeFlags(row.flagsJson),
    updatedAt: row.updatedAt,
  };
}

function resolvePlayerAdultStageLabel(params: {
  corruptionValue: number;
  allureValue: number;
  shameValue: number;
}) {
  if (params.corruptionValue >= 82) {
    return "欲名远扬";
  }
  if (params.corruptionValue >= 68 || params.allureValue >= 78) {
    return "情名外露";
  }
  if (params.corruptionValue >= 52 || params.allureValue >= 62) {
    return "暧昧缠身";
  }
  if (params.corruptionValue >= 34 || params.allureValue >= 46 || params.shameValue <= 42) {
    return "心念浮动";
  }
  return "仍守边界";
}

function buildNeutralPlayerWorldAdultSurface(): PlayerWorldAdultSurface {
  return {
    corruptionValue: 0,
    allureValue: 0,
    shameValue: 0,
    stageLabel: "仍守边界",
  };
}

async function getPlayerWorldAdultSurface(playerId: string): Promise<PlayerWorldAdultSurface> {
  const row = await db.select({
    corruptionValue: playerAdultProfiles.corruptionValue,
    allureValue: playerAdultProfiles.allureValue,
    shameValue: playerAdultProfiles.shameValue,
  }).from(playerAdultProfiles)
    .where(eq(playerAdultProfiles.playerId, playerId))
    .get();
  const corruptionValue = Number(row?.corruptionValue || 0);
  const allureValue = Number(row?.allureValue || 0);
  const shameValue = Number(row?.shameValue || 0);
  return {
    corruptionValue,
    allureValue,
    shameValue,
    stageLabel: resolvePlayerAdultStageLabel({
      corruptionValue,
      allureValue,
      shameValue,
    }),
  };
}

export function buildPlayerWorldReputationSummary(params: {
  playerId: string;
  pressure: PlayerWorldPressureSummary;
  adultSurface: PlayerWorldAdultSurface;
}): PlayerWorldReputationSummary {
  const { pressure, adultSurface } = params;
  const willIgnorePlayer = pressure.lawfulPressure >= 72
    || pressure.bountyHeat >= 58
    || pressure.notorietyScore >= 78
    || getTierOrder(pressure.activeAlertTier) >= 3;
  const needsBrokerRelief = willIgnorePlayer
    || pressure.lawfulPressure >= 58
    || pressure.bountyHeat >= 40;
  const canInviteDualCultivation = adultSurface.corruptionValue >= 65 || adultSurface.allureValue >= 60;
  const canInviteTreasureHunt = pressure.shadowFavor >= 48 && !willIgnorePlayer;
  const canGiftLingShi = pressure.shadowFavor >= 64
    && pressure.lawfulPressure < 58
    && pressure.bountyHeat < 48
    && !willIgnorePlayer;
  const canInitiateConversation = !willIgnorePlayer;
  const forcedAdultRisk = adultSurface.corruptionValue >= 75;

  const notorietyLabel = willIgnorePlayer
    ? "臭名压身"
    : getTierOrder(pressure.activeAlertTier) >= 2 || pressure.notorietyScore >= 46
      ? "风声在外"
      : pressure.notorietyScore >= 22
        ? "已有闲议"
        : "名声未显";
  const shadowLabel = pressure.shadowFavor >= 72
    ? "灰线熟面"
    : pressure.shadowFavor >= 45
      ? "有人试探"
      : "路数未显";
  const sensualLabel = adultSurface.corruptionValue >= 75 || adultSurface.allureValue >= 72
    ? "艳名外露"
    : adultSurface.corruptionValue >= 55 || adultSurface.allureValue >= 58
      ? "暧昧易起"
      : adultSurface.corruptionValue >= 32 || adultSurface.allureValue >= 40
        ? "偶有试探"
        : "情名未起";

  const repairActions = [
    needsBrokerRelief ? "找灰巷牙子或卖讯修士转话" : "",
    needsBrokerRelief ? "递上灵石赔礼，先把场面缓下来" : "",
    needsBrokerRelief ? "接压风声、洗痕或调解类邀约" : "",
    canInviteDualCultivation ? "用合意双修快速洗掉一段臭名" : "",
  ]
    .map((entry) => entry.trim())
    .filter(Boolean);

  const reactionHints = [
    willIgnorePlayer ? "寻常 NPC 会减少搭话，名声更臭时甚至会直接不理你。" : "",
    canInviteTreasureHunt ? "灰线修士和散修更容易邀你探宝、递口信或谈见不得光的门路。" : "",
    canGiftLingShi ? "有人会先拿灵石、消息或一点小好处试探你的口风。" : "",
    canInviteDualCultivation ? "淫乱度与堕落偏高时，附近 NPC 更可能主动递来双修试探。" : "",
    forcedAdultRisk ? "高堕落下若拒绝某些高压迫邀约，可能接出强制后果。" : "",
  ]
    .map((entry) => entry.trim())
    .filter(Boolean);

  const worldBehaviorHints = [
    willIgnorePlayer
      ? "你现在更像麻烦人物，若想让人重新搭理，往往得先请中人转话。"
      : "多数人仍肯与你搭话，但会先看你身上的风声再决定深浅。",
    canInviteTreasureHunt ? "灰线与散修侧更可能把探宝、传话、递货这类事先找上你。" : "",
    canGiftLingShi ? "熟门路的人有时会先拿一点灵石或情报做见面礼，再决定要不要继续合作。" : "",
    canInviteDualCultivation ? "你的情欲名声已经开始外露，某些 NPC 会主动把话题试到更暧昧的地方。" : "",
  ]
    .map((entry) => entry.trim())
    .filter(Boolean);

  const overallLabel = willIgnorePlayer
    ? "臭名压身"
    : canInviteTreasureHunt && canInviteDualCultivation
      ? "灰香并起"
      : canInviteDualCultivation
        ? "艳名在外"
        : canInviteTreasureHunt || canGiftLingShi
          ? "灰线熟面"
          : pressure.notorietyScore >= 22 || getTierOrder(pressure.activeAlertTier) >= 1
            ? "已有风声"
            : "名声未显";
  const overallSummary = willIgnorePlayer
    ? "你的坏名声已经压过寻常交情，多数人会先躲着你走；若想把关系拉回来，最好先找牙子、中人或压风声门路。"
    : canInviteTreasureHunt && canInviteDualCultivation
      ? "你在灰线和暧昧场里都已有辨识度，别人更愿意拿探宝、私话和双修试探你。"
      : canInviteDualCultivation
        ? "你的情欲风评已经开始外露，一些 NPC 会更主动地把关系往私密处试。"
        : canInviteTreasureHunt || canGiftLingShi
          ? "你的路数在灰巷里已经有些脸熟，别人更愿意用探宝、递讯和小好处试探你。"
          : "你的名声还没真正压到街面上，多数人仍把你当作普通修士来往。";
  const socialFlavorLabel = willIgnorePlayer
    ? "多数人只想绕开你"
    : canGiftLingShi
      ? "有人愿先递好处再开口"
      : canInviteTreasureHunt
        ? "更容易被拉去探宝办灰活"
        : "仍能正常搭话";
  const repairHint = needsBrokerRelief
    ? "若想让人重新搭理你，可去找灰巷牙子、中人或卖讯修士，通过压风声、递灵石赔礼，或合意双修把这段臭名压下去。"
    : "你眼下还不必专门洗风声，维持正常来往即可。";

  return {
    playerId: params.playerId,
    overallLabel,
    overallSummary,
    socialFlavorLabel,
    adultStageLabel: adultSurface.stageLabel,
    notorietyLabel,
    shadowLabel,
    sensualLabel,
    willIgnorePlayer,
    needsBrokerRelief,
    canInitiateConversation,
    canInviteTreasureHunt,
    canGiftLingShi,
    canInviteDualCultivation,
    forcedAdultRisk,
    repairHint,
    repairActions,
    reactionHints,
    worldBehaviorHints,
    corruptionValue: adultSurface.corruptionValue,
    allureValue: adultSurface.allureValue,
    shameValue: adultSurface.shameValue,
    updatedAt: pressure.updatedAt,
  };
}

export function buildPlayerWorldNpcAttitude(params: {
  npcName: string;
  pressure: PlayerWorldPressureSummary;
  reputation: PlayerWorldReputationSummary;
  bountyEnabled?: boolean;
  shadowFriendlyEligible?: boolean;
}): PlayerWorldNpcAttitude {
  const hints = [
    params.pressure.lawfulMood !== "neutral" ? `${params.npcName}对你的来路明显更谨慎。` : "",
    params.bountyEnabled && (params.pressure.bountyHeat >= 40 || getTierOrder(params.pressure.activeAlertTier) >= 3)
      ? "对方像是已经认出你身上的悬赏风声。"
      : "",
    params.reputation.canInviteTreasureHunt && !params.bountyEnabled
      ? "若你肯接灰线门路，对方并不排斥先拿探宝或传话来试你。"
      : "",
    params.reputation.canGiftLingShi && !params.bountyEnabled
      ? "对方像是更愿意先用一点灵石或消息探你口风。"
      : "",
    params.reputation.canInviteDualCultivation && !params.bountyEnabled
      ? "对方能从你的情欲风评里嗅到一点可试探的余地。"
      : "",
  ]
    .map((entry) => entry.trim())
    .filter(Boolean);
  const reactionHints = Array.from(new Set([...hints, ...params.reputation.reactionHints]));
  const interactionBiases = [
    params.reputation.willIgnorePlayer ? "ignore" : "talk",
    params.reputation.canInviteTreasureHunt ? "treasure" : "",
    params.reputation.canGiftLingShi ? "gift_lingyu" : "",
    params.reputation.canInviteDualCultivation ? "invite_dual_cultivation" : "",
    params.reputation.needsBrokerRelief ? "broker_relief" : "",
  ]
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (params.reputation.willIgnorePlayer) {
    return {
      stance: "guarded",
      level: "guarded",
      label: "避而不理",
      description: `${params.npcName}已经把你归到麻烦人物里，言语会明显收着，严重时干脆懒得接你的话。`,
      summary: `${params.npcName}已经把你归到麻烦人物里，言语会明显收着，严重时干脆懒得接你的话。`,
      hints: reactionHints.length > 0 ? reactionHints : ["你得先洗掉一点风声，对方才更可能松口。"],
      worldReactionHints: reactionHints.length > 0 ? reactionHints : ["你得先洗掉一点风声，对方才更可能松口。"],
      willIgnorePlayer: true,
      needsBrokerRelief: true,
      repairHints: params.reputation.repairActions,
      interactionBiases,
      reputationLabel: params.reputation.overallLabel,
      reputationSummary: params.reputation.overallSummary,
    };
  }

  if (
    params.shadowFriendlyEligible
    && params.pressure.lawfulMood === "neutral"
    && !params.bountyEnabled
    && (
      params.pressure.shadowMood === "welcoming"
      || params.reputation.canInviteTreasureHunt
      || params.reputation.canGiftLingShi
      || params.reputation.canInviteDualCultivation
    )
  ) {
    return {
      stance: "shadow_friendly",
      level: "shadow_friendly",
      label: "愿意试探",
      description: `${params.npcName}觉得你不是全无来路的人，探宝、私话、灵石试探，甚至更暧昧的邀约，都更容易先落到你身上。`,
      summary: `${params.npcName}觉得你不是全无来路的人，探宝、私话、灵石试探，甚至更暧昧的邀约，都更容易先落到你身上。`,
      hints: reactionHints.length > 0 ? reactionHints : ["对方更愿意拿灰线与私下门路先试你的反应。"],
      worldReactionHints: reactionHints.length > 0 ? reactionHints : ["对方更愿意拿灰线与私下门路先试你的反应。"],
      willIgnorePlayer: false,
      needsBrokerRelief: params.reputation.needsBrokerRelief,
      repairHints: params.reputation.repairActions,
      interactionBiases,
      reputationLabel: params.reputation.overallLabel,
      reputationSummary: params.reputation.overallSummary,
    };
  }

  if (params.pressure.lawfulMood === "guarded" || (params.bountyEnabled && params.pressure.bountyHeat >= 55)) {
    return {
      stance: "guarded",
      level: "guarded",
      label: "认出你的风声",
      description: `${params.npcName}已经对你起了明显提防，不会轻易把门路与委托交给你。`,
      summary: `${params.npcName}已经对你起了明显提防，不会轻易把门路与委托交给你。`,
      hints: reactionHints.length > 0 ? reactionHints : ["部分支线或悬赏可能会因此被拒绝。"],
      worldReactionHints: reactionHints.length > 0 ? reactionHints : ["部分支线或悬赏可能会因此被拒绝。"],
      willIgnorePlayer: false,
      needsBrokerRelief: params.reputation.needsBrokerRelief,
      repairHints: params.reputation.repairActions,
      interactionBiases,
      reputationLabel: params.reputation.overallLabel,
      reputationSummary: params.reputation.overallSummary,
    };
  }

  if (params.pressure.lawfulMood === "cold") {
    return {
      stance: "cold",
      level: "cold",
      label: "态度转冷",
      description: `${params.npcName}说话会更克制，像是不想和你的风声扯上太深关系。`,
      summary: `${params.npcName}说话会更克制，像是不想和你的风声扯上太深关系。`,
      hints: reactionHints.length > 0 ? reactionHints : ["此人的任务态度会比平时冷一些。"],
      worldReactionHints: reactionHints.length > 0 ? reactionHints : ["此人的任务态度会比平时冷一些。"],
      willIgnorePlayer: false,
      needsBrokerRelief: params.reputation.needsBrokerRelief,
      repairHints: params.reputation.repairActions,
      interactionBiases,
      reputationLabel: params.reputation.overallLabel,
      reputationSummary: params.reputation.overallSummary,
    };
  }

  return {
    stance: "neutral",
    level: "neutral",
    label: "平常相看",
    description: `${params.npcName}暂时只把你当作寻常来客。`,
    summary: `${params.npcName}暂时只把你当作寻常来客。`,
    hints: reactionHints.length > 0 ? reactionHints : ["当前没有明显的额外态度修正。"],
    worldReactionHints: reactionHints.length > 0 ? reactionHints : ["当前没有明显的额外态度修正。"],
    willIgnorePlayer: false,
    needsBrokerRelief: params.reputation.needsBrokerRelief,
    repairHints: params.reputation.repairActions,
    interactionBiases,
    reputationLabel: params.reputation.overallLabel,
    reputationSummary: params.reputation.overallSummary,
  };
}

function applyLazyDecay(row: PlayerWorldProfileRow, now = new Date()): PlayerWorldProfileRow {
  const hours = computeDecayHours(row.lastDecayAt, now.getTime());
  if (hours <= 0) {
    return row;
  }

  const nextScores: IncidentScoreDelta = {
    notorietyScore: clampScore(row.notorietyScore - hours * 2),
    bountyHeat: clampScore(row.bountyHeat - hours * 3),
    shadowFavor: clampScore(row.shadowFavor - hours),
    lawfulPressure: clampScore(row.lawfulPressure - hours * 2),
  };
  const nextTier = resolveAlertTier(nextScores);
  return {
    ...row,
    ...nextScores,
    activeAlertTier: nextTier,
    activeWatcherCount: resolveWatcherCount(nextScores, nextTier),
    lastDecayAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

async function upsertProfileRow(playerId: string) {
  await db.insert(playerWorldProfiles).values({
    playerId,
    notorietyScore: 0,
    bountyHeat: 0,
    shadowFavor: 0,
    lawfulPressure: 0,
    activeAlertTier: "observe",
    activeWatcherCount: 1,
    lastDecayAt: new Date().toISOString(),
    flagsJson: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).onConflictDoNothing({
    target: playerWorldProfiles.playerId,
  }).run();

  return await db.select().from(playerWorldProfiles).where(eq(playerWorldProfiles.playerId, playerId)).get();
}

async function persistProfileRow(row: PlayerWorldProfileRow) {
  await db.update(playerWorldProfiles).set({
    notorietyScore: row.notorietyScore,
    bountyHeat: row.bountyHeat,
    shadowFavor: row.shadowFavor,
    lawfulPressure: row.lawfulPressure,
    activeAlertTier: row.activeAlertTier,
    activeWatcherCount: row.activeWatcherCount,
    lastDecayAt: row.lastDecayAt,
    flagsJson: row.flagsJson,
    updatedAt: row.updatedAt,
  }).where(eq(playerWorldProfiles.playerId, row.playerId)).run();
}

async function sendAlertTierMailIfNeeded(params: {
  previousTier: PlayerWorldAlertTier;
  nextRow: PlayerWorldProfileRow;
}) {
  const previousOrder = getTierOrder(params.previousTier);
  const nextTier = params.nextRow.activeAlertTier as PlayerWorldAlertTier;
  const nextOrder = getTierOrder(nextTier);
  if (nextOrder < 3 || nextOrder <= previousOrder) {
    return;
  }

  const flags = normalizeFlags(params.nextRow.flagsJson);
  if (flags.lastAlertMailTier === nextTier) {
    return;
  }

  const presentation = resolveAlertPresentation(nextTier);
  await db.insert(playerMails).values({
    playerId: params.nextRow.playerId,
    title: `天道风声：${presentation.label}`,
    content: `${presentation.description}\n${presentation.nextEscalationRisk}`,
    createdAt: new Date().toISOString(),
  }).run();

  await db.update(playerWorldProfiles).set({
    flagsJson: {
      ...flags,
      lastAlertMailTier: nextTier,
      lastAlertMailAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  }).where(eq(playerWorldProfiles.playerId, params.nextRow.playerId)).run();
}

type DistrictChainCategory = "loot" | "shadow" | "adult";

function resolveDistrictChainCategory(incidentType: PlayerWorldIncidentType) {
  if (incidentType === "kill_and_loot" || incidentType === "kill_loot") {
    return "loot" as const;
  }
  if (
    incidentType === "black_market_trade"
    || incidentType === "shadow_intel"
    || incidentType === "cultivator_hunt"
    || incidentType === "demonic_temptation"
  ) {
    return "shadow" as const;
  }
  if (
    incidentType === "adult_affair"
    || incidentType === "adult_report"
    || incidentType === "dangerous_preference"
    || incidentType === "essence_drain"
  ) {
    return "adult" as const;
  }
  return null;
}

function buildDistrictChainNarrative(params: {
  districtName: string;
  categories: DistrictChainCategory[];
}) {
  const categories = Array.from(new Set(params.categories));
  if (categories.length >= 3) {
    return {
      summary: `${params.districtName}已经把你的夺宝血账、灰线买卖与暧昧余波串成一股恶名，熟客噤声，黑摊抬价。`,
      nearby: `${params.districtName}风声忽紧：你的血账、灰活与私欲余波被并成一线，街面上已没人敢当众多话。`,
      severity: 3,
      signature: "adult|loot|shadow",
    };
  }
  if (categories.includes("loot") && categories.includes("shadow")) {
    return {
      summary: `${params.districtName}里已经有人把你的夺宝之举和灰线买卖串到了一起，许多摊口都开始闭声避谈。`,
      nearby: `${params.districtName}有人低声道：这人前脚夺宝，后脚又去碰灰线，最好少与他沾边。`,
      severity: 2,
      signature: "loot|shadow",
    };
  }
  if (categories.includes("loot") && categories.includes("adult")) {
    return {
      summary: `${params.districtName}把你的血气和暧昧余波一起记了下来，街坊已经有人刻意躲着你走。`,
      nearby: `${params.districtName}的风声变得古怪起来：有人说你身上既带杀气，也带着不干净的暧昧余波。`,
      severity: 2,
      signature: "adult|loot",
    };
  }
  return {
    summary: `${params.districtName}里已有修士把你的灰线门路和私密余波并在一处议论，暗巷里开始有人盯你的行止。`,
    nearby: `${params.districtName}暗巷有人低声提醒：这位近来既沾灰线，也惹出暧昧余波，最好别轻易招惹。`,
    severity: 2,
    signature: "adult|shadow",
  };
}

async function maybeEmitDistrictChainRumor(params: {
  playerId: string;
  incidentType: PlayerWorldIncidentType;
  sourceType: string;
  sourceId?: string | null;
  mapId?: string | null;
  districtName?: string | null;
}) {
  const mapId = String(params.mapId || "").trim();
  const districtName = String(params.districtName || "").trim();
  if (!mapId || !districtName || params.incidentType === "district_chain_rumor") {
    return;
  }

  const currentCategory = resolveDistrictChainCategory(params.incidentType);
  if (!currentCategory) {
    return;
  }

  const nowMs = Date.now();
  const recentRows = await db.select().from(playerWorldIncidents)
    .where(and(
      eq(playerWorldIncidents.playerId, params.playerId),
      eq(playerWorldIncidents.mapId, mapId),
      eq(playerWorldIncidents.districtName, districtName),
    ))
    .orderBy(desc(playerWorldIncidents.createdAt), desc(playerWorldIncidents.id))
    .limit(16)
    .all();

  const recentIncidents = recentRows.filter((row) => {
    const createdAtMs = parseTimestamp(row.createdAt);
    return createdAtMs !== null && (nowMs - createdAtMs) <= WORLD_DISTRICT_CHAIN_WINDOW_MS;
  });
  const categories = recentIncidents
    .map((row) => resolveDistrictChainCategory(row.incidentType as PlayerWorldIncidentType))
    .filter((entry): entry is DistrictChainCategory => Boolean(entry));
  const distinctCategories = Array.from(new Set([...categories, currentCategory])).sort();
  if (distinctCategories.length < 2) {
    return;
  }

  const narrative = buildDistrictChainNarrative({
    districtName,
    categories: distinctCategories,
  });
  const existingChain = recentIncidents.find((row) => (
    row.incidentType === "district_chain_rumor"
    && String((row.payloadJson as Record<string, unknown> | null | undefined)?.chainSignature || "").trim() === narrative.signature
  ));
  if (existingChain) {
    return;
  }

  await applyPlayerWorldIncident({
    playerId: params.playerId,
    incidentType: "district_chain_rumor",
    sourceType: params.sourceType,
    sourceId: params.sourceId || null,
    mapId,
    districtName,
    severity: narrative.severity,
    summary: narrative.summary,
    payloadJson: {
      chainSignature: narrative.signature,
      categories: distinctCategories,
      triggerIncidentType: params.incidentType,
    },
    deltas: {
      notorietyScore: 0,
      bountyHeat: 0,
      shadowFavor: 0,
      lawfulPressure: 0,
    },
  });

  await createTiandaoNearbyChatMessage({
    mapId,
    districtName,
    content: narrative.nearby,
  }).catch(() => null);
}

async function buildOfferSummaryByAi(input: {
  offerType: PlayerWorldOfferType;
  sourceFaction: string;
  playerName: string;
  playerTier: PlayerWorldAlertTier;
  pressureSummary: string;
  hook: string;
  keywordRuleSummary?: string;
  consentSummary?: string;
}) {
  const fallback = sanitizePlayerFacingOfferText(
    input.hook,
    resolveOfferDefaultSummary({
      offerType: input.offerType,
      sourceFaction: input.sourceFaction,
    }),
  );

  try {
    const result = input.offerType === "pressure_cleanse"
      || input.offerType === "rumor_silence"
      || input.offerType === "lawful_mediation"
      || input.offerType === "consensual_dual_cultivation"
      || input.offerType === "broker_relief"
      ? await generateOpenWorldPressureReliefOffer({
        offerType: input.offerType,
        mapName: "尘世暗流",
        sourceFaction: input.sourceFaction,
        playerTitle: `${input.playerName}·${resolveAlertPresentation(input.playerTier).label}`,
        pressureSummary: input.pressureSummary,
        hook: fallback,
        keywordRuleSummary: input.keywordRuleSummary,
        consentSummary: input.consentSummary,
      })
      : await generateOpenWorldShadowEvent({
        offerType: input.offerType,
        mapName: "尘世暗流",
        sourceFaction: input.sourceFaction,
        playerTitle: `${input.playerName}·${resolveAlertPresentation(input.playerTier).label}`,
        pressureSummary: input.pressureSummary,
        hook: fallback,
      });
    return sanitizePlayerFacingOfferText(result.summary, fallback);
  } catch {
    return fallback;
  }
}

function buildOfferTemplates(
  summary: PlayerWorldPressureSummary,
  reputation: PlayerWorldReputationSummary,
): OfferTemplate[] {
  const templates: OfferTemplate[] = [];
  if (reputation.canGiftLingShi && !reputation.needsBrokerRelief) {
    templates.push({
      offerType: "gift_lingyu",
      sourceFaction: "熟路散修",
      severity: Math.max(1, Math.floor(summary.shadowFavor / 28)),
      summary: "熟路散修先递来一袋灵石，只说愿意看看你还接不接这份善意。",
      payloadJson: {
        rewardGold: 0,
        rewardLingYu: 12 + Math.floor(summary.shadowFavor / 5),
        aiScenarioType: "gift_lingyu",
        aiSceneTags: ["见礼", "灵石", reputation.shadowLabel, reputation.socialFlavorLabel].filter(Boolean).slice(0, 8),
      },
    });
  }
  if (reputation.canInviteTreasureHunt && !reputation.willIgnorePlayer) {
    templates.push({
      offerType: "treasure_invite",
      sourceFaction: "探碑散盟",
      severity: Math.max(1, Math.floor(summary.shadowFavor / 24)),
      summary: "探碑散盟递来一封探宝帖子，邀你顺着一截新浮出的风声去摸机缘。",
      payloadJson: {
        rewardGold: 160 + summary.shadowFavor * 2,
        rewardLingYu: 8 + Math.floor(summary.shadowFavor / 10),
        aiScenarioType: "treasure_invite",
        aiSceneTags: ["探宝", "机缘", "灰线", reputation.shadowLabel].filter(Boolean).slice(0, 8),
      },
    });
  }
  if (reputation.needsBrokerRelief) {
    templates.push({
      offerType: "broker_relief",
      sourceFaction: "灰巷牙子",
      severity: Math.max(1, Math.floor(Math.max(summary.lawfulPressure, summary.bountyHeat, summary.notorietyScore) / 18)),
      summary: "灰巷牙子愿替你递话说项，先把旁人不肯搭理你的那层冷意缓下来。",
      payloadJson: {
        reliefValue: Math.max(6, Math.min(18, Math.floor((summary.lawfulPressure + summary.bountyHeat + summary.notorietyScore) / 12))),
        pressureTargets: ["lawfulPressure", "bountyHeat", "notorietyScore"],
        requiresKeywords: [],
        consentRequired: false,
        coerciveFlavorLevel: "low",
        forcedRisk: false,
        forcedActions: [],
        keywordRuleSummary: "无额外关键词限制。",
        consentSummary: "点头后，牙子才会替你出面转话。",
        aiScenarioType: "broker_relief",
        aiSceneTags: ["牙子", "说项", "修关系", reputation.overallLabel, reputation.socialFlavorLabel].filter(Boolean).slice(0, 8),
      },
    });
  }
  if (summary.shadowFavor >= 24) {
    templates.push({
      offerType: "black_market_trade",
      sourceFaction: "黑市暗线",
      severity: Math.max(1, Math.floor(summary.shadowFavor / 24)),
      summary: "黑市暗线愿意为你开一条只认风声不问来路的暗市门路。",
      payloadJson: {
        rewardGold: 120 + summary.shadowFavor * 2,
        rewardLingYu: 0,
      },
    });
  }
  if (summary.bountyHeat >= 22) {
    templates.push({
      offerType: "shadow_intel",
      sourceFaction: "夜渡会",
      severity: Math.max(1, Math.floor(summary.bountyHeat / 22)),
      summary: "有人愿意卖给你一条关于追缉链的暗线情报，但这情报会让你欠下一笔灰账。",
      payloadJson: {
        rewardGold: 80 + summary.bountyHeat,
        rewardLingYu: 0,
      },
    });
  }
  if (summary.notorietyScore >= 28 || summary.activeAlertTier === "bounty" || summary.activeAlertTier === "ambush") {
    templates.push({
      offerType: "cultivator_hunt",
      sourceFaction: "灰营客",
      severity: Math.max(1, Math.floor(summary.notorietyScore / 20)),
      summary: "灰营客扔来一份猎修委托，想借你去处理一个麻烦人物，酬劳不低，代价也不干净。",
      payloadJson: {
        rewardGold: 150 + summary.notorietyScore,
        rewardLingYu: 0,
      },
    });
  }
  if (summary.shadowFavor >= 48 || summary.lawfulPressure >= 40) {
    templates.push({
      offerType: "demonic_temptation",
      sourceFaction: "血煞旁门",
      severity: Math.max(1, Math.floor(Math.max(summary.shadowFavor, summary.lawfulPressure) / 28)),
      summary: "血煞旁门递来一口带血味的诱饵，承诺捷径，却明显想在你身上留下更深痕迹。",
      payloadJson: {
        rewardGold: 0,
        rewardLingYu: 12 + Math.floor(summary.shadowFavor / 6),
      },
    });
  }
  const reliefRuleTypes: OpenWorldPressureReliefOfferType[] = [
    "pressure_cleanse",
    "rumor_silence",
    "lawful_mediation",
    "consensual_dual_cultivation",
  ];
  reliefRuleTypes.forEach((offerType) => {
    const rule = getOpenWorldPressureReliefRule(offerType);
    if (!rule?.enabled) {
      return;
    }
    const relevantScore = Math.max(...rule.pressureTargets.map((target) => Number(summary[target] || 0)));
    const shouldOffer = relevantScore >= Math.max(12, rule.baseReliefValue - 4)
      || (offerType === "consensual_dual_cultivation" && summary.activeAlertTier !== "observe");
    if (!shouldOffer) {
      return;
    }
    templates.push({
      offerType,
      sourceFaction: rule.sourceFaction,
      severity: Math.max(1, Math.floor(relevantScore / Math.max(10, rule.baseReliefValue))),
      summary: rule.summaryHint,
      payloadJson: {
        reliefValue: rule.baseReliefValue,
        pressureTargets: rule.pressureTargets,
        requiresKeywords: rule.requiresKeywords,
        consentRequired: rule.consentRequired,
        coerciveFlavorLevel: rule.coerciveFlavorLevel,
        forcedRisk: rule.coerciveFlavorLevel === "high" && rule.forcedActions.length > 0,
        forcedActions: rule.forcedActions,
        keywordRuleSummary: rule.requiresKeywords.length > 0 ? `关键词要求：${rule.requiresKeywords.join("、")}。` : "无额外关键词限制。",
        consentSummary: rule.consentRequired ? "必须明确接受后才会继续。": "此类邀约无需额外确认。",
        aiScenarioType: offerType,
        aiSceneTags: [rule.label, ...rule.pressureTargets, ...rule.requiresKeywords].slice(0, 8),
      },
    });
  });
  return templates;
}

function scoreOfferTemplate(
  template: OfferTemplate,
  summary: PlayerWorldPressureSummary,
  reputation: PlayerWorldReputationSummary,
) {
  let score = template.severity * 100;
  if (template.offerType === "shadow_intel") {
    score += 55 + summary.bountyHeat;
    if (summary.activeAlertTier === "ambush") {
      score += 30;
    }
  } else if (template.offerType === "pressure_cleanse") {
    score += 65 + summary.notorietyScore + summary.lawfulPressure;
  } else if (template.offerType === "rumor_silence") {
    score += 70 + summary.bountyHeat + summary.lawfulPressure;
  } else if (template.offerType === "lawful_mediation") {
    score += 48 + summary.lawfulPressure;
  } else if (template.offerType === "consensual_dual_cultivation") {
    score += 80 + summary.bountyHeat + summary.lawfulPressure;
  } else if (template.offerType === "gift_lingyu") {
    score += 88 + summary.shadowFavor - Math.floor(summary.lawfulPressure / 2);
  } else if (template.offerType === "treasure_invite") {
    score += 96 + summary.shadowFavor + (reputation.canInviteDualCultivation ? 6 : 0);
  } else if (template.offerType === "broker_relief") {
    score += 120 + summary.lawfulPressure + summary.bountyHeat + summary.notorietyScore;
    if (reputation.willIgnorePlayer) {
      score += 40;
    }
  } else if (template.offerType === "cultivator_hunt") {
    score += 45 + summary.notorietyScore;
    if (summary.activeAlertTier === "bounty" || summary.activeAlertTier === "ambush") {
      score += 20;
    }
  } else if (template.offerType === "demonic_temptation") {
    score += 35 + Math.max(summary.shadowFavor, summary.lawfulPressure);
  } else {
    score += 20 + summary.shadowFavor;
  }
  return score;
}

function pickPrimaryOfferTemplate(
  summary: PlayerWorldPressureSummary,
  reputation: PlayerWorldReputationSummary,
) {
  const templates = buildOfferTemplates(summary, reputation);
  if (templates.length <= 0) {
    return null;
  }
  return templates
    .slice()
    .sort((left, right) => scoreOfferTemplate(right, summary, reputation) - scoreOfferTemplate(left, summary, reputation))[0] || null;
}

function resolveWorldOfferCooldownUntil(flags: Record<string, unknown>) {
  const value = typeof flags.worldOfferCooldownUntil === "string" ? flags.worldOfferCooldownUntil : null;
  return parseTimestamp(value);
}

async function generateOfferRows(playerId: string, summary: PlayerWorldPressureSummary) {
  const flags = normalizeFlags(summary.flags);
  const cooldownUntil = resolveWorldOfferCooldownUntil(flags);
  if (cooldownUntil !== null && cooldownUntil > Date.now()) {
    return [] as PlayerWorldEventOfferRow[];
  }

  const [playerRow, adultSurface] = await Promise.all([
    db.select({
      name: players.name,
      currentMapId: players.currentMapId,
      positionX: players.positionX,
      positionY: players.positionY,
    }).from(players).where(eq(players.id, playerId)).get(),
    getPlayerWorldAdultSurface(playerId),
  ]);
  const reputation = buildPlayerWorldReputationSummary({
    playerId,
    pressure: summary,
    adultSurface,
  });
  const template = pickPrimaryOfferTemplate(summary, reputation);
  if (!template) {
    return [] as PlayerWorldEventOfferRow[];
  }
  const playerDistrictName = playerRow?.currentMapId
    ? resolveOpenWorldDistrictName({
      mapId: playerRow.currentMapId,
      positionX: playerRow.positionX,
      positionY: playerRow.positionY,
    })
    : null;
  const storylineBinding = await findOpenWorldStorylineBinding({
    mapId: playerRow?.currentMapId || null,
    districtName: playerDistrictName,
    offerType: template.offerType,
    sourceFactionName: template.sourceFaction,
  });
  const summaryText = await buildOfferSummaryByAi({
    offerType: template.offerType,
    sourceFaction: template.sourceFaction,
    playerName: playerRow?.name || "无名修士",
    playerTier: summary.activeAlertTier,
    pressureSummary: summary.summary,
    hook: template.summary,
    keywordRuleSummary: typeof template.payloadJson.keywordRuleSummary === "string"
      ? template.payloadJson.keywordRuleSummary
      : undefined,
    consentSummary: typeof template.payloadJson.consentSummary === "string"
      ? template.payloadJson.consentSummary
      : undefined,
  });

  return await db.transaction(async (tx) => {
    if (!(await tryAcquirePlayerWorldLock(tx, `player-world-offers:${playerId}`))) {
      return [] as PlayerWorldEventOfferRow[];
    }
    const nowIso = new Date().toISOString();

    const existingPendingRows = await tx.select().from(playerWorldEventOffers)
      .where(and(
        eq(playerWorldEventOffers.playerId, playerId),
        eq(playerWorldEventOffers.status, "pending"),
        gt(playerWorldEventOffers.expiresAt, nowIso),
      ))
      .orderBy(desc(playerWorldEventOffers.createdAt))
      .all();
    if (existingPendingRows.length > 0) {
      if (existingPendingRows.length > 1) {
        const duplicateIds = existingPendingRows.slice(1).map((row) => row.id);
        if (duplicateIds.length > 0) {
          await tx.update(playerWorldEventOffers).set({
            status: "expired",
            respondedAt: nowIso,
            updatedAt: nowIso,
          }).where(inArray(playerWorldEventOffers.id, duplicateIds)).run();
        }
      }
      return existingPendingRows.slice(0, 1);
    }

    const createdAt = new Date().toISOString();
    await tx.insert(playerWorldEventOffers).values({
      playerId,
      offerType: template.offerType,
      sourceFaction: template.sourceFaction,
      sourceNpcId: null,
      status: "pending",
      summary: summaryText || template.summary,
      payloadJson: {
        ...template.payloadJson,
        severity: template.severity,
        fallbackSummary: template.summary,
        storylineId: storylineBinding?.storylineId || null,
        storylineType: storylineBinding?.storylineType || null,
        storylineTypeLabel: storylineBinding?.storylineTypeLabel || null,
        storylineStageLabel: storylineBinding?.stageLabel || null,
        storylineDistrictName: storylineBinding?.districtName || playerDistrictName || null,
        sourceFactionId: storylineBinding?.sourceFactionId || null,
        sourceFactionLabel: storylineBinding?.sourceFactionLabel || null,
        fallbackDetail: resolveOfferStaticDetail({
          offerType: template.offerType,
          sourceFaction: template.sourceFaction,
        }),
      },
      expiresAt: new Date(Date.now() + WORLD_OFFER_TTL_MS).toISOString(),
      createdAt,
      updatedAt: createdAt,
    }).run();

    return await tx.select().from(playerWorldEventOffers)
      .where(and(
        eq(playerWorldEventOffers.playerId, playerId),
        eq(playerWorldEventOffers.status, "pending"),
        gt(playerWorldEventOffers.expiresAt, new Date().toISOString()),
      ))
      .orderBy(desc(playerWorldEventOffers.createdAt))
      .limit(1)
      .all();
  });
}

async function expireOutdatedOffers(playerId: string) {
  const nowIso = new Date().toISOString();
  await db.update(playerWorldEventOffers).set({
    status: "expired",
    respondedAt: nowIso,
    updatedAt: nowIso,
  }).where(and(
    eq(playerWorldEventOffers.playerId, playerId),
    eq(playerWorldEventOffers.status, "pending"),
    lt(playerWorldEventOffers.expiresAt, nowIso),
  )).run();
}

async function listPendingPlayerWorldEventOfferRows(playerId: string) {
  await expireOutdatedOffers(playerId);
  const rows = await db.select().from(playerWorldEventOffers)
    .where(and(
      eq(playerWorldEventOffers.playerId, playerId),
      eq(playerWorldEventOffers.status, "pending"),
      gt(playerWorldEventOffers.expiresAt, new Date().toISOString()),
    ))
    .orderBy(desc(playerWorldEventOffers.createdAt))
    .all();
  if (rows.length > 1) {
    const duplicateIds = rows.slice(1).map((row) => row.id);
    if (duplicateIds.length > 0) {
      const nowIso = new Date().toISOString();
      await db.update(playerWorldEventOffers).set({
        status: "expired",
        respondedAt: nowIso,
        updatedAt: nowIso,
      }).where(inArray(playerWorldEventOffers.id, duplicateIds)).run();
    }
  }
  return rows.slice(0, 1);
}

function parseOptionalPosition(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function resolveWorldOfferNpcRoute(npcId: string | null | undefined) {
  const normalizedNpcId = String(npcId || "").trim();
  if (!normalizedNpcId) {
    return null;
  }
  return normalizedNpcId.includes(":")
    ? `/game/world/npc/${encodeURIComponent(normalizedNpcId)}`
    : `/game/npc/${encodeURIComponent(normalizedNpcId)}`;
}

async function buildPendingOfferPreviewPayload(params: {
  row: PlayerWorldEventOfferRow;
  preferredMapId?: string | null;
}) {
  const offerType = params.row.offerType as PlayerWorldOfferType;
  const payloadJson = normalizeOfferPayloadJson(params.row.payloadJson);
  if (!offerRequiresWorldContract(offerType) || parseContractType(payloadJson.contractType)) {
    return payloadJson;
  }

  const target = offerUsesNpcContractTarget(offerType)
    ? await pickWorldContractTarget({
      offerType,
      preferredMapId: params.preferredMapId,
    })
    : null;

  return buildContractPayload({
    offerType,
    sourceFaction: params.row.sourceFaction || "暗线",
    target,
    reward: resolveOfferReward(payloadJson),
    basePayloadJson: payloadJson,
    preferredMapId: params.preferredMapId,
  });
}

async function loadWorldOfferGuideNpc(params: {
  preferredNpcId?: string | null;
  fallbackNpcId?: string | null;
}) {
  const npcId = String(params.preferredNpcId || params.fallbackNpcId || "").trim();
  if (!npcId) {
    return null;
  }
  const npcRow = await db.select({
    id: worldNpcProfiles.id,
    name: worldNpcProfiles.name,
    mapId: worldNpcRuntime.currentMapId,
    mapName: worldMapInstances.name,
    positionX: worldNpcRuntime.positionX,
    positionY: worldNpcRuntime.positionY,
  }).from(worldNpcProfiles)
    .leftJoin(worldNpcRuntime, eq(worldNpcRuntime.npcId, worldNpcProfiles.id))
    .leftJoin(worldMapInstances, eq(worldMapInstances.id, worldNpcRuntime.currentMapId))
    .where(eq(worldNpcProfiles.id, npcId))
    .get();
  if (!npcRow) {
    return null;
  }
  return {
    id: npcRow.id,
    name: npcRow.name,
    mapId: npcRow.mapId || null,
    mapName: resolveWorldContractMapName(npcRow.mapName, npcRow.mapId),
    districtName: npcRow.mapId
      ? resolveOpenWorldDistrictName({
        mapId: npcRow.mapId,
        positionX: Number(npcRow.positionX || 0),
        positionY: Number(npcRow.positionY || 0),
      })
      : null,
    positionX: typeof npcRow.positionX === "number" ? npcRow.positionX : null,
    positionY: typeof npcRow.positionY === "number" ? npcRow.positionY : null,
  };
}

async function buildWorldEventOfferGuide(params: {
  row: PlayerWorldEventOfferRow;
  payloadJson: Record<string, unknown>;
}) {
  const offerType = params.row.offerType as PlayerWorldOfferType;
  const contractType = parseContractType(params.payloadJson.contractType);
  const targetNpcId = String(params.payloadJson.targetNpcId || "").trim() || null;
  const sourceNpcId = String(params.row.sourceNpcId || params.payloadJson.sourceNpcId || "").trim() || null;
  const npcGuide = await loadWorldOfferGuideNpc({
    preferredNpcId: targetNpcId,
    fallbackNpcId: sourceNpcId,
  });
  const sourceNpcName = npcGuide?.id === sourceNpcId
    ? npcGuide.name
    : String(
      params.payloadJson.sourceNpcName
      || params.payloadJson.sourceTargetName
      || "",
    ).trim() || null;
  const objectiveStage = contractType
    ? resolveContractObjectiveStage(params.payloadJson, contractType, "active")
    : null;
  const objectivePoint = objectiveStage?.pointId && objectiveStage?.mapId
    ? getOpenWorldObjectivePointById(objectiveStage.mapId, objectiveStage.pointId)
    : null;
  const targetDistrictName = String(
    params.payloadJson.targetDistrictName
    || objectiveStage?.districtName
    || npcGuide?.districtName
    || "",
  ).trim() || null;
  const targetMapId = String(
    params.payloadJson.targetMapId
    || objectiveStage?.mapId
    || npcGuide?.mapId
    || "",
  ).trim() || null;
  const targetMapName = String(
    params.payloadJson.targetMapName
    || objectiveStage?.mapName
    || npcGuide?.mapName
    || "",
  ).trim() || null;
  const objectivePointLabel = objectiveStage?.pointLabel || objectivePoint?.label || null;
  const objectivePositionX = parseOptionalPosition(
    params.payloadJson.currentObjectivePositionX
    || params.payloadJson.targetObjectivePositionX
    || objectivePoint?.positionX,
  );
  const objectivePositionY = parseOptionalPosition(
    params.payloadJson.currentObjectivePositionY
    || params.payloadJson.targetObjectivePositionY
    || objectivePoint?.positionY,
  );
  const targetPositionX = objectivePositionX ?? parseOptionalPosition(params.payloadJson.targetPositionX) ?? npcGuide?.positionX ?? null;
  const targetPositionY = objectivePositionY ?? parseOptionalPosition(params.payloadJson.targetPositionY) ?? npcGuide?.positionY ?? null;
  const targetNpcName = String(
    params.payloadJson.targetNpcName
    || (targetNpcId && npcGuide?.id === targetNpcId ? npcGuide.name : "")
    || "",
  ).trim() || null;
  const guideTargetLabel = objectivePointLabel || targetNpcName || sourceNpcName;
  const guideLocationLabel = [
    targetDistrictName,
    !targetDistrictName ? targetMapName : null,
  ].filter(Boolean).join(" · ") || null;
  const guideActionLabel = String(
    objectiveStage?.actionLabel
    || params.payloadJson.contractActionLabel
    || params.payloadJson.objectiveActionLabel
    || "",
  ).trim() || null;
  const guideRoute = resolveWorldOfferNpcRoute(targetNpcId || sourceNpcId);

  if (contractType === "meet_contact") {
    return {
      sourceNpcName,
      guideTargetLabel,
      guideLocationLabel,
      guideActionLabel: guideActionLabel || "递上暗语",
      guideSummary: `先接受这封来信，再去${guideLocationLabel || "指定地界"}找${targetNpcName || sourceNpcName || "接头人"}${guideActionLabel || "递话"}。`,
      guideRoute,
      guideMapId: targetMapId,
      guidePositionX: targetPositionX,
      guidePositionY: targetPositionY,
      guideRequiresAccept: true,
    };
  }

  if (contractType === "hunt_target") {
    return {
      sourceNpcName,
      guideTargetLabel,
      guideLocationLabel,
      guideActionLabel: guideActionLabel || "前去追杀",
      guideSummary: `先接受这封来信，再去${guideLocationLabel || "指定地界"}找${targetNpcName || "目标修士"}动手。`,
      guideRoute,
      guideMapId: targetMapId,
      guidePositionX: targetPositionX,
      guidePositionY: targetPositionY,
      guideRequiresAccept: true,
    };
  }

  if (contractType) {
    return {
      sourceNpcName,
      guideTargetLabel,
      guideLocationLabel,
      guideActionLabel: guideActionLabel || "推进目标",
      guideSummary: `先接受这封来信，再去${guideLocationLabel || "指定地界"}的${objectivePointLabel || "目标点"}${guideActionLabel || "推进这条线"}。`,
      guideRoute,
      guideMapId: targetMapId || objectiveStage?.mapId || null,
      guidePositionX: targetPositionX,
      guidePositionY: targetPositionY,
      guideRequiresAccept: true,
    };
  }

  const directSettleSummary = offerType === "consensual_dual_cultivation"
    ? "这封来信不需要你跑图，直接在这里接受或拒绝即可；若接受，会立刻结算双修与洗影响结果。"
    : offerType === "pressure_cleanse"
      ? "这封来信不需要跑图，直接接受即可结算洗痕交易；拒绝则维持现状。"
      : offerType === "rumor_silence"
        ? "这封来信不需要跑图，直接接受即可压下一阵风声；拒绝则这层门路不会替你出手。"
        : offerType === "lawful_mediation"
          ? "这封来信不需要跑图，直接接受即可触发守序调解；拒绝则这层说项不会生效。"
          : offerType === "gift_lingyu"
            ? "这封来信不需要跑图，直接接受即可收下这份缓和关系的灵石门路。"
            : "先点这条来信的接受或拒绝，系统会按你的回信立刻结算后果。";

  return {
    sourceNpcName,
    guideTargetLabel,
    guideLocationLabel,
    guideActionLabel: guideActionLabel || "直接回信",
    guideSummary: directSettleSummary,
    guideRoute,
    guideMapId: targetMapId,
    guidePositionX: targetPositionX,
    guidePositionY: targetPositionY,
    guideRequiresAccept: false,
  };
}

async function mapPlayerWorldEventOfferRow(
  row: PlayerWorldEventOfferRow,
  options?: {
    preferredMapId?: string | null;
  },
): Promise<PlayerWorldEventOfferItem> {
  const offerType = row.offerType as PlayerWorldOfferType;
  const payloadJson = await buildPendingOfferPreviewPayload({
    row,
    preferredMapId: options?.preferredMapId,
  });
  const guide = await buildWorldEventOfferGuide({
    row,
    payloadJson,
  });
  const severity = Math.max(1, Number(payloadJson.severity || 1));
  const reliefValue = Math.max(0, Number(payloadJson.reliefValue || 0));
  const pressureTargets = resolveOfferPressureTargets(payloadJson);
  const requiresKeywords = Array.isArray(payloadJson.requiresKeywords)
    ? payloadJson.requiresKeywords.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const keywordRuleSummary = buildKeywordRuleSummary(payloadJson);
  const consentRequired = Boolean(payloadJson.consentRequired);
  const consentSummary = typeof payloadJson.consentSummary === "string" && payloadJson.consentSummary.trim()
    ? payloadJson.consentSummary.trim()
    : (consentRequired ? "需要确认相关代价与后果。" : "无需额外确认。");
  const coerciveFlavorLevel = payloadJson.coerciveFlavorLevel === "high" || payloadJson.coerciveFlavorLevel === "medium"
    ? payloadJson.coerciveFlavorLevel
    : "low";
  const forcedRisk = Boolean(payloadJson.forcedRisk);
  const forcedActions = resolveOfferForcedActions(payloadJson);
  const aiScenarioType = typeof payloadJson.aiScenarioType === "string" && payloadJson.aiScenarioType.trim()
    ? payloadJson.aiScenarioType.trim()
    : null;
  const aiSceneTags = Array.isArray(payloadJson.aiSceneTags)
    ? payloadJson.aiSceneTags.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const fallbackSummary = typeof payloadJson.fallbackSummary === "string"
    ? payloadJson.fallbackSummary
    : resolveOfferDefaultSummary({
      offerType,
      sourceFaction: row.sourceFaction || "暗线",
    });
  return {
    id: row.id,
    offerType,
    offerTypeLabel: resolveOfferTypeLabel(offerType),
    sourceFaction: row.sourceFaction || "暗线",
    sourceNpcId: row.sourceNpcId || null,
    sourceNpcName: guide.sourceNpcName,
    storylineId: String(payloadJson.storylineId || "").trim() || null,
    storylineTypeLabel: String(payloadJson.storylineTypeLabel || "").trim() || null,
    storylineStageLabel: String(payloadJson.storylineStageLabel || "").trim() || null,
    storylineDistrictName: String(payloadJson.storylineDistrictName || payloadJson.districtName || "").trim() || null,
    status: row.status as PlayerWorldOfferStatus,
    summary: sanitizePlayerFacingOfferText(row.summary, fallbackSummary),
    detail: resolveOfferDetail({
      offerType,
      sourceFaction: row.sourceFaction || "暗线",
      payloadJson,
    }),
    riskLabel: resolveOfferRiskLabel({
      offerType,
      severity,
    }),
    reliefValue,
    pressureTargets,
    requiresKeywords,
    keywordRuleSummary,
    consentRequired,
    consentSummary,
    coerciveFlavorLevel,
    forcedRisk,
    forcedActions,
    aiScenarioType,
    aiSceneTags,
    guideTargetLabel: guide.guideTargetLabel,
    guideLocationLabel: guide.guideLocationLabel,
    guideActionLabel: guide.guideActionLabel,
    guideSummary: guide.guideSummary,
    guideRoute: guide.guideRoute,
    guideMapId: guide.guideMapId,
    guidePositionX: guide.guidePositionX,
    guidePositionY: guide.guidePositionY,
    guideRequiresAccept: guide.guideRequiresAccept,
    payloadJson,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  } satisfies PlayerWorldEventOfferItem;
}

async function listPlayerTrackingSignalsWithSummary(params: {
  playerId: string;
  summary: PlayerWorldPressureSummary;
  incidentRows?: Awaited<ReturnType<typeof listPlayerWorldIncidents>>;
  offerRows?: PlayerWorldEventOfferRow[];
}) {
  const [incidentRows, offerRows] = await Promise.all([
    params.incidentRows ? Promise.resolve(params.incidentRows) : listPlayerWorldIncidents(params.playerId, 6),
    params.offerRows ? Promise.resolve(params.offerRows) : listPendingPlayerWorldEventOfferRows(params.playerId),
  ]);

  const summary = params.summary;
  const signals: PlayerWorldTrackingSignal[] = incidentRows.map((row) => ({
    stage: resolveIncidentStage({
      incidentType: row.incidentType,
      severity: row.severity,
    }),
    stageLabel: resolveAlertPresentation(resolveIncidentStage({
      incidentType: row.incidentType,
      severity: row.severity,
    })).label,
    id: `incident:${row.id}`,
    type: "incident",
    title: row.incidentType === "kill_and_loot"
      ? "杀人夺宝已传开"
      : row.incidentType === "escaped"
        ? "有人记住了你的遁走气机"
      : row.incidentType === "witnessed"
          ? "街巷里有人目睹了你"
        : row.incidentType === "district_chain_rumor"
          ? "街区风声串成一线"
          : "世界风声有变",
    content: row.summary,
    summary: row.summary,
    severity: row.severity >= 3 ? "high" : row.severity >= 2 ? "medium" : "low",
    incidentType: row.incidentType,
    sourceType: row.sourceType,
    mapId: row.mapId || null,
    districtName: row.districtName || null,
    createdAt: row.createdAt,
  }));

  signals.unshift({
    id: `tier:${summary.activeAlertTier}`,
    type: "tier",
    stage: summary.activeAlertTier,
    stageLabel: summary.tierLabel,
    title: summary.activeAlertLabel,
    content: `${summary.activeAlertDescription} 当前盯着你的人约有 ${summary.activeWatcherCount} 个方向。`,
    summary: summary.summary,
    severity: summary.activeAlertTier === "ambush" || summary.activeAlertTier === "bounty"
      ? "high"
      : summary.activeAlertTier === "stalk"
        ? "medium"
        : "low",
    incidentType: null,
    sourceType: null,
    mapId: null,
    districtName: null,
    createdAt: summary.updatedAt,
  });

  for (const offer of offerRows.slice(0, 1)) {
    const offerType = offer.offerType as PlayerWorldOfferType;
    const stage = resolveIncidentStage({
      incidentType: offerType,
      severity: Math.max(1, Number(offer.payloadJson?.severity || 1)),
    });
    signals.push({
      id: `offer:${offer.id}`,
      type: "offer",
      stage,
      stageLabel: resolveAlertPresentation(stage).label,
      title: resolveOfferTypeLabel(offerType),
      content: offer.summary,
      summary: offer.summary,
      severity: offer.offerType === "demonic_temptation" || summary.activeAlertTier === "ambush" ? "high" : "medium",
      incidentType: offer.offerType,
      sourceType: "event_offer",
      mapId: null,
      districtName: null,
      createdAt: offer.createdAt,
    });
  }

  return signals.slice(0, 8);
}

export async function ensurePlayerWorldProfile(playerId: string) {
  if (!(await ensureOpenWorldSchema())) {
    throw new PlayerWorldError("开放世界表结构尚未就绪", 503);
  }
  const rawRow = await upsertProfileRow(playerId);
  if (!rawRow) {
    throw new PlayerWorldError("玩家世界画像初始化失败", 500);
  }

  const previousTier = rawRow.activeAlertTier as PlayerWorldAlertTier;
  const decayedRow = applyLazyDecay(rawRow);
  if (
    decayedRow.notorietyScore !== rawRow.notorietyScore
    || decayedRow.bountyHeat !== rawRow.bountyHeat
    || decayedRow.shadowFavor !== rawRow.shadowFavor
    || decayedRow.lawfulPressure !== rawRow.lawfulPressure
    || decayedRow.activeAlertTier !== rawRow.activeAlertTier
    || decayedRow.activeWatcherCount !== rawRow.activeWatcherCount
    || decayedRow.lastDecayAt !== rawRow.lastDecayAt
  ) {
    await persistProfileRow(decayedRow);
    await sendAlertTierMailIfNeeded({
      previousTier,
      nextRow: decayedRow,
    });
  }

  return summarizeProfile(decayedRow);
}

export async function applyPlayerWorldIncident(params: {
  playerId: string;
  incidentType: PlayerWorldIncidentType;
  sourceType: string;
  sourceId?: string | null;
  mapId?: string | null;
  districtName?: string | null;
  severity?: number;
  summary: string;
  payloadJson?: Record<string, unknown>;
  deltas?: Partial<IncidentScoreDelta>;
  sendMail?: boolean;
}) {
  if (!(await ensureOpenWorldSchema())) {
    throw new PlayerWorldError("开放世界表结构尚未就绪", 503);
  }
  const severity = Math.max(1, Number(params.severity || 1));
  const currentSummary = await ensurePlayerWorldProfile(params.playerId);
  const currentRow = await db.select().from(playerWorldProfiles).where(eq(playerWorldProfiles.playerId, params.playerId)).get();
  if (!currentRow) {
    throw new PlayerWorldError("玩家世界画像不存在", 404);
  }

  const fallbackDelta = resolveIncidentDelta(params.incidentType, severity);
  const delta: IncidentScoreDelta = {
    notorietyScore: Number(params.deltas?.notorietyScore ?? fallbackDelta.notorietyScore),
    bountyHeat: Number(params.deltas?.bountyHeat ?? fallbackDelta.bountyHeat),
    shadowFavor: Number(params.deltas?.shadowFavor ?? fallbackDelta.shadowFavor),
    lawfulPressure: Number(params.deltas?.lawfulPressure ?? fallbackDelta.lawfulPressure),
  };
  const nextScores: IncidentScoreDelta = {
    notorietyScore: clampScore(currentRow.notorietyScore + delta.notorietyScore),
    bountyHeat: clampScore(currentRow.bountyHeat + delta.bountyHeat),
    shadowFavor: clampScore(currentRow.shadowFavor + delta.shadowFavor),
    lawfulPressure: clampScore(currentRow.lawfulPressure + delta.lawfulPressure),
  };
  const nextTier = resolveAlertTier(nextScores);
  const nextRow: PlayerWorldProfileRow = {
    ...currentRow,
    ...nextScores,
    activeAlertTier: nextTier,
    activeWatcherCount: resolveWatcherCount(nextScores, nextTier),
    lastDecayAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await db.insert(playerWorldIncidents).values({
    playerId: params.playerId,
    incidentType: params.incidentType,
    sourceType: params.sourceType,
    sourceId: params.sourceId || null,
    mapId: params.mapId || null,
    districtName: params.districtName || null,
    severity,
    summary: params.summary,
    payloadJson: params.payloadJson || {},
    createdAt: new Date().toISOString(),
  }).run();
  await persistProfileRow(nextRow);
  await sendAlertTierMailIfNeeded({
    previousTier: currentSummary.activeAlertTier,
    nextRow,
  });

  try {
    await settleOpenWorldFactionAfterIncident({
      playerId: params.playerId,
      incidentType: params.incidentType,
      mapId: params.mapId || null,
      districtName: params.districtName || null,
      summary: params.summary,
    });
  } catch (error) {
    logPlayerWorldFallback("faction-settle-incident", error);
  }

  if (params.sendMail) {
    await db.insert(playerMails).values({
      playerId: params.playerId,
      title: "天道风闻",
      content: params.summary,
      createdAt: new Date().toISOString(),
    }).run();
  }

  await maybeEmitDistrictChainRumor({
    playerId: params.playerId,
    incidentType: params.incidentType,
    sourceType: params.sourceType,
    sourceId: params.sourceId || null,
    mapId: params.mapId || null,
    districtName: params.districtName || null,
  });

  return summarizeProfile(nextRow);
}

export async function listPlayerWorldIncidents(playerId: string, limit = WORLD_INCIDENT_FETCH_LIMIT) {
  await ensurePlayerWorldProfile(playerId);
  return await db.select().from(playerWorldIncidents)
    .where(eq(playerWorldIncidents.playerId, playerId))
    .orderBy(desc(playerWorldIncidents.createdAt), desc(playerWorldIncidents.id))
    .limit(limit)
    .all();
}

export async function listPlayerTrackingSignals(playerId: string) {
  const summary = await ensurePlayerWorldProfile(playerId);
  return await listPlayerTrackingSignalsWithSummary({
    playerId,
    summary,
  });
}

export async function getPlayerWorldPressure(playerId: string) {
  const summary = await ensurePlayerWorldProfile(playerId);
  const trackingSignals = await listPlayerTrackingSignalsWithSummary({
    playerId,
    summary,
  });
  return {
    summary,
    trackingSignals,
  };
}

export async function getPlayerWorldReputationSummary(playerId: string): Promise<PlayerWorldReputationSummary> {
  const [pressure, adultSurface] = await Promise.all([
    ensurePlayerWorldProfile(playerId),
    getPlayerWorldAdultSurface(playerId),
  ]);
  return buildPlayerWorldReputationSummary({
    playerId,
    pressure,
    adultSurface,
  });
}

export async function getSafePlayerWorldReputationSummary(playerId: string): Promise<PlayerWorldReputationSummary> {
  try {
    return await getPlayerWorldReputationSummary(playerId);
  } catch (error) {
    logPlayerWorldFallback("reputation-summary", error);
    const pressure = buildNeutralPlayerWorldPressureSummary(playerId);
    return buildPlayerWorldReputationSummary({
      playerId,
      pressure,
      adultSurface: buildNeutralPlayerWorldAdultSurface(),
    });
  }
}

export async function getPlayerWorldPressureSnapshot(playerId: string): Promise<PlayerWorldPressureSnapshot> {
  const summary = await ensurePlayerWorldProfile(playerId);
  const [adultSurface, incidentRows, pendingOfferRows, rumorCountRow] = await Promise.all([
    getPlayerWorldAdultSurface(playerId),
    listPlayerWorldIncidents(playerId, 6),
    listPendingPlayerWorldEventOfferRows(playerId),
    db.select({ total: count() }).from(playerWorldIncidents)
      .where(and(
        eq(playerWorldIncidents.playerId, playerId),
        gt(playerWorldIncidents.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      ))
      .get(),
  ]);
  const trackingSignals = await listPlayerTrackingSignalsWithSummary({
    playerId,
    summary,
    incidentRows,
    offerRows: pendingOfferRows,
  });
  return {
    pressure: summary,
    reputation: buildPlayerWorldReputationSummary({
      playerId,
      pressure: summary,
      adultSurface,
    }),
    trackingSignals,
    worldDangerCount: getTierOrder(summary.activeAlertTier) >= 2 ? summary.activeWatcherCount : 0,
    worldBountyActive: getTierOrder(summary.activeAlertTier) >= 3 || summary.bountyHeat >= 45,
    worldRumorUnread: Number(rumorCountRow?.total || 0),
  };
}

export async function getSafePlayerWorldPressureSnapshot(playerId: string): Promise<PlayerWorldPressureSnapshot> {
  try {
    return await getPlayerWorldPressureSnapshot(playerId);
  } catch (error) {
    logPlayerWorldFallback("pressure-snapshot", error);
    return buildNeutralPlayerWorldPressureSnapshot(playerId);
  }
}

export async function listPlayerWorldEventOffers(playerId: string) {
  const summary = await ensurePlayerWorldProfile(playerId);
  let rows = await listPendingPlayerWorldEventOfferRows(playerId);
  if (rows.length <= 0) {
    const cooldownUntil = resolveWorldOfferCooldownUntil(normalizeFlags(summary.flags));
    if (cooldownUntil !== null && cooldownUntil > Date.now()) {
      return [];
    }
    rows = await generateOfferRows(playerId, summary);
  }

  const playerRow = await db.select({
    currentMapId: players.currentMapId,
  }).from(players).where(eq(players.id, playerId)).get();

  return await Promise.all(rows.map((row) => mapPlayerWorldEventOfferRow(row, {
    preferredMapId: playerRow?.currentMapId || null,
  })));
}

export async function listPlayerWorldContracts(playerId: string) {
  if (!(await ensureOpenWorldSchema())) {
    throw new PlayerWorldError("开放世界表结构尚未就绪", 503);
  }
  await ensurePlayerWorldProfile(playerId);
  let rows = await db.select().from(playerWorldEventOffers)
    .where(and(
      eq(playerWorldEventOffers.playerId, playerId),
      eq(playerWorldEventOffers.status, "accepted"),
    ))
    .orderBy(desc(playerWorldEventOffers.updatedAt), desc(playerWorldEventOffers.createdAt))
    .limit(8)
    .all();

  const hiddenContractRows = rows.filter((row) => {
    const offerType = row.offerType as PlayerWorldOfferType;
    return offerRequiresWorldContract(offerType) && !mapPlayerWorldContractRow(row);
  });

  if (hiddenContractRows.length > 0) {
    const playerRow = await db.select({
      currentMapId: players.currentMapId,
    }).from(players).where(eq(players.id, playerId)).get();
    const preferredMapId = playerRow?.currentMapId || null;
    const nowIso = new Date().toISOString();

    for (const row of hiddenContractRows) {
      const offerType = row.offerType as PlayerWorldOfferType;
      const payloadJson = normalizeOfferPayloadJson(row.payloadJson);
      const repairedPayloadJson = buildContractPayload({
        offerType,
        sourceFaction: row.sourceFaction || "暗线",
        target: offerUsesNpcContractTarget(offerType)
          ? await pickWorldContractTarget({
            offerType,
            preferredMapId,
          })
          : null,
        reward: resolveOfferReward(payloadJson),
        basePayloadJson: payloadJson,
        preferredMapId,
      });
      if (!mapPlayerWorldContractRow({
        ...row,
        payloadJson: repairedPayloadJson,
      } satisfies PlayerWorldEventOfferRow)) {
        continue;
      }
      await db.update(playerWorldEventOffers).set({
        payloadJson: repairedPayloadJson,
        updatedAt: nowIso,
      }).where(eq(playerWorldEventOffers.id, row.id)).run();
    }

    rows = await db.select().from(playerWorldEventOffers)
      .where(and(
        eq(playerWorldEventOffers.playerId, playerId),
        eq(playerWorldEventOffers.status, "accepted"),
      ))
      .orderBy(desc(playerWorldEventOffers.updatedAt), desc(playerWorldEventOffers.createdAt))
      .limit(8)
      .all();
  }

  return rows
    .map(mapPlayerWorldContractRow)
    .filter((row): row is PlayerWorldContractItem => Boolean(row))
    .sort((left, right) => {
      if (left.contractStatus === right.contractStatus) {
        return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      }
      return left.contractStatus === "active" ? -1 : 1;
    });
}

export async function listPlayerWorldContractsByNpc(params: {
  playerId: string;
  npcId: string;
}) {
  const rows = await listPlayerWorldContracts(params.playerId);
  return rows.filter((row) => row.targetNpcId === params.npcId);
}

function buildContractCompletionNarrative(contract: PlayerWorldContractItem) {
  if (contract.contractType === "meet_contact") {
    if (contract.offerType === "broker_relief") {
      return `${contract.targetNpcName || "接头人"}收下了你递去的转话帖，原本僵着的人情终于松动，这桩说项也算办成了。`;
    }
    return `${contract.targetNpcName || "接头人"}收下暗语后，把你要的风声与门路一并递了出来，这桩暗线买卖算是结清了。`;
  }
  if (contract.contractType === "hunt_target") {
    return `${contract.targetNpcName || "目标修士"}已被你从灰线名单上抹去，尾款随之划到了你的手里。`;
  }
  if (contract.contractType === "dead_drop_delivery") {
    return `${contract.currentObjectivePointLabel || "藏货点"}已经吞下那只灰匣，这笔黑市买卖也跟着结清了。`;
  }
  if (contract.contractType === "surveil_target") {
    return `你在${contract.currentObjectivePointLabel || "风闻点"}听全了要紧口风，灰线那边认了这份工钱。`;
  }
  if (contract.contractType === "treasure_probe") {
    return `你在${contract.currentObjectivePointLabel || "异动点"}摸到了那截机缘线索，帖子背后的试探也因此转成了实打实的人情。`;
  }
  return `黑货已经护送到${contract.currentObjectivePointLabel || "交货点"}，接头人照旧不露脸，只把尾款静静划了过来。`;
}

async function settleCompletedWorldContract(params: {
  playerId: string;
  offerRow: PlayerWorldEventOfferRow;
  contract: PlayerWorldContractItem;
  summary: string;
  mapId?: string | null;
  districtName?: string | null;
}) {
  const settled = await db.transaction(async (tx) => {
    if (!(await tryAcquirePlayerWorldLock(tx, `player-world-contract:${params.offerRow.id}`))) {
      throw new PlayerWorldError("这桩暗线委托正在结算中，请稍候再试", 409);
    }

    const latestOfferRow = await tx.select().from(playerWorldEventOffers)
      .where(eq(playerWorldEventOffers.id, params.offerRow.id))
      .get();
    if (!latestOfferRow) {
      throw new PlayerWorldError("暗线委托不存在", 404);
    }

    const latestContract = mapPlayerWorldContractRow(latestOfferRow);
    if (!latestContract || latestContract.contractStatus !== "active") {
      throw new PlayerWorldError("这桩暗线委托已经结清", 409);
    }

    const playerRow = await tx.select({
      gold: players.gold,
      lingYu: players.lingYu,
    }).from(players).where(eq(players.id, params.playerId)).get();
    if (!playerRow) {
      throw new PlayerWorldError("玩家不存在", 404);
    }

    const nowIso = new Date().toISOString();
    const nextPayloadJson = {
      ...normalizeOfferPayloadJson(latestOfferRow.payloadJson),
      contractStatus: "completed",
      contractCompletedAt: nowIso,
      contractProgressLabel: latestContract.contractType === "meet_contact"
        ? "这条暗线已经接上，情报已入手。"
        : latestContract.contractType === "hunt_target"
          ? "追猎已了，尾款已结。"
          : latestContract.contractType === "dead_drop_delivery"
            ? "灰匣已经藏妥，尾款已结。"
            : latestContract.contractType === "surveil_target"
              ? "口风已经听全，尾款已结。"
              : "黑货已经转运出去，尾款已结。",
    } satisfies Record<string, unknown>;

    await tx.update(playerWorldEventOffers).set({
      payloadJson: nextPayloadJson,
      updatedAt: nowIso,
    }).where(eq(playerWorldEventOffers.id, latestOfferRow.id)).run();

    if (latestContract.rewardGold > 0 || latestContract.rewardLingYu > 0) {
      await tx.update(players).set({
        gold: playerRow.gold + latestContract.rewardGold,
        lingYu: playerRow.lingYu + latestContract.rewardLingYu,
      }).where(eq(players.id, params.playerId)).run();
    }

    await tx.insert(playerWorldIncidents).values({
      playerId: params.playerId,
      incidentType: params.offerRow.offerType as PlayerWorldIncidentType,
      sourceType: "world_contract",
      sourceId: latestOfferRow.id,
      mapId: params.mapId || latestContract.targetMapId || null,
      districtName: params.districtName || latestContract.targetDistrictName || null,
      severity: latestContract.contractType === "hunt_target" ? 2 : 1,
      summary: params.summary,
      payloadJson: {
        contractType: latestContract.contractType,
        targetNpcId: latestContract.targetNpcId,
        targetNpcName: latestContract.targetNpcName,
        rewardGold: latestContract.rewardGold,
        rewardLingYu: latestContract.rewardLingYu,
      },
      createdAt: nowIso,
    }).run();

    await tx.insert(playerMails).values({
      playerId: params.playerId,
      title: `灰线回执：${latestContract.title}`,
      content: `${params.summary}\n尾款：金${latestContract.rewardGold} / 灵玉${latestContract.rewardLingYu}`,
      createdAt: nowIso,
    }).run();

    return {
      offerId: latestOfferRow.id,
      summary: params.summary,
      reward: {
        rewardGold: latestContract.rewardGold,
        rewardLingYu: latestContract.rewardLingYu,
      },
      mapId: params.mapId || latestContract.targetMapId || latestContract.currentObjectiveMapId || null,
      districtName: params.districtName || latestContract.targetDistrictName || latestContract.currentObjectiveDistrictName || null,
      contract: mapPlayerWorldContractRow({
        ...latestOfferRow,
        payloadJson: nextPayloadJson,
        updatedAt: nowIso,
      } satisfies PlayerWorldEventOfferRow),
    };
  });

  await maybeEmitDistrictChainRumor({
    playerId: params.playerId,
    incidentType: params.offerRow.offerType as PlayerWorldIncidentType,
    sourceType: "world_contract",
    sourceId: settled.offerId,
    mapId: settled.mapId,
    districtName: settled.districtName,
  });

  try {
    await settleOpenWorldFactionAfterIncident({
      playerId: params.playerId,
      incidentType: params.offerRow.offerType as PlayerWorldIncidentType,
      mapId: settled.mapId,
      districtName: settled.districtName,
      summary: settled.summary,
    });
  } catch (error) {
    logPlayerWorldFallback("faction-settle-contract", error);
  }

  try {
    await syncStorylineParticipantsForContract({
      playerId: params.playerId,
      contract: settled.contract,
      status: "completed",
      source: "contract_complete",
      sourceId: settled.offerId,
    });
  } catch (error) {
    logPlayerWorldFallback("storyline-contract-complete", error);
  }

  return {
    offerId: settled.offerId,
    summary: settled.summary,
    reward: settled.reward,
    contract: settled.contract,
  };
}

export async function advancePlayerWorldNpcContract(params: {
  playerId: string;
  npcId: string;
  offerId?: string | null;
}) {
  if (!(await ensureOpenWorldSchema())) {
    throw new PlayerWorldError("开放世界表结构尚未就绪", 503);
  }

  const rows = await db.select().from(playerWorldEventOffers)
    .where(and(
      eq(playerWorldEventOffers.playerId, params.playerId),
      eq(playerWorldEventOffers.status, "accepted"),
    ))
    .orderBy(desc(playerWorldEventOffers.updatedAt), desc(playerWorldEventOffers.createdAt))
    .limit(8)
    .all();

  const matchedRow = rows.find((row) => {
    if (params.offerId && row.id !== params.offerId) {
      return false;
    }
    const contract = mapPlayerWorldContractRow(row);
    return contract?.contractType === "meet_contact"
      && contract.contractStatus === "active"
      && contract.targetNpcId === params.npcId;
  });

  if (!matchedRow) {
    throw new PlayerWorldError("此人身上没有待推进的暗线委托", 404);
  }

  const contract = mapPlayerWorldContractRow(matchedRow);
  if (!contract) {
    throw new PlayerWorldError("暗线委托状态异常", 409);
  }

  const [playerRow, npcRuntimeRow] = await Promise.all([
    db.select({
      currentMapId: players.currentMapId,
      positionX: players.positionX,
      positionY: players.positionY,
    }).from(players).where(eq(players.id, params.playerId)).get(),
    db.select({
      currentMapId: worldNpcRuntime.currentMapId,
      positionX: worldNpcRuntime.positionX,
      positionY: worldNpcRuntime.positionY,
      status: worldNpcProfiles.status,
    }).from(worldNpcRuntime)
      .innerJoin(worldNpcProfiles, eq(worldNpcProfiles.id, worldNpcRuntime.npcId))
      .where(eq(worldNpcRuntime.npcId, params.npcId))
      .get(),
  ]);

  if (!playerRow) {
    throw new PlayerWorldError("玩家不存在", 404);
  }
  if (!npcRuntimeRow || npcRuntimeRow.status !== "active") {
    throw new PlayerWorldError("接头已经断线，此人不再出面", 410);
  }
  if (!playerRow.currentMapId || playerRow.currentMapId !== npcRuntimeRow.currentMapId) {
    throw new PlayerWorldError("不在同一张地图，无法当面递话", 400);
  }
  if (chebyshevDistance(playerRow.positionX, playerRow.positionY, npcRuntimeRow.positionX, npcRuntimeRow.positionY) > 1) {
    throw new PlayerWorldError("你离接头人还不够近，先靠过去再说", 400);
  }

  const summary = buildContractCompletionNarrative(contract);
  return await settleCompletedWorldContract({
    playerId: params.playerId,
    offerRow: matchedRow,
    contract,
    summary,
    mapId: contract.targetMapId,
    districtName: contract.targetDistrictName,
  });
}

export async function advancePlayerWorldObjectiveContract(params: {
  playerId: string;
  offerId: string;
}) {
  if (!(await ensureOpenWorldSchema())) {
    throw new PlayerWorldError("开放世界表结构尚未就绪", 503);
  }

  const offerRow = await db.select().from(playerWorldEventOffers)
    .where(and(
      eq(playerWorldEventOffers.playerId, params.playerId),
      eq(playerWorldEventOffers.id, params.offerId),
      eq(playerWorldEventOffers.status, "accepted"),
    ))
    .get();

  if (!offerRow) {
    throw new PlayerWorldError("这桩暗线委托不存在", 404);
  }

  const contract = mapPlayerWorldContractRow(offerRow);
  if (!contract || !contract.canAdvanceByObjective || !contract.currentObjectivePointId || !contract.currentObjectiveMapId) {
    throw new PlayerWorldError("这桩暗线委托不能在地图目标点推进", 409);
  }

  const point = getOpenWorldObjectivePointById(contract.currentObjectiveMapId, contract.currentObjectivePointId);
  if (!point) {
    throw new PlayerWorldError("委托目标点已经失效，请稍后再试", 409);
  }

  const playerRow = await db.select({
    currentMapId: players.currentMapId,
    positionX: players.positionX,
    positionY: players.positionY,
  }).from(players).where(eq(players.id, params.playerId)).get();
  if (!playerRow) {
    throw new PlayerWorldError("玩家不存在", 404);
  }
  if (playerRow.currentMapId !== contract.currentObjectiveMapId) {
    throw new PlayerWorldError(`需先前往 ${contract.currentObjectiveMapName || "指定地界"} 的 ${contract.currentObjectivePointLabel || "目标点"}`, 400);
  }
  if (!isNearOpenWorldObjectivePoint({
    point,
    positionX: playerRow.positionX,
    positionY: playerRow.positionY,
    maxDistance: 1,
  })) {
    throw new PlayerWorldError(`需靠近 ${contract.currentObjectivePointLabel || "目标点"} 才能继续`, 400);
  }

  if (contract.contractType === "escort_cargo" && contract.objectiveStepStatus !== "to_destination") {
    const nowIso = new Date().toISOString();
    const nextPayloadJson = {
      ...normalizeOfferPayloadJson(offerRow.payloadJson),
      contractStepStatus: "to_destination",
      contractProgressLabel: buildContractProgressLabel({
        ...normalizeOfferPayloadJson(offerRow.payloadJson),
        contractStepStatus: "to_destination",
        currentObjectivePointLabel: String(offerRow.payloadJson?.targetObjectivePointLabel || "").trim(),
        currentObjectiveMapName: String(offerRow.payloadJson?.targetMapName || "").trim(),
        currentObjectiveDistrictName: String(offerRow.payloadJson?.targetDistrictName || "").trim(),
      }, "escort_cargo"),
      currentObjectivePointLabel: String(offerRow.payloadJson?.targetObjectivePointLabel || "").trim(),
      currentObjectiveMapName: String(offerRow.payloadJson?.targetMapName || "").trim(),
      currentObjectiveDistrictName: String(offerRow.payloadJson?.targetDistrictName || "").trim(),
    } satisfies Record<string, unknown>;
    await db.update(playerWorldEventOffers).set({
      payloadJson: nextPayloadJson,
      updatedAt: nowIso,
    }).where(eq(playerWorldEventOffers.id, offerRow.id)).run();

    return {
      offerId: offerRow.id,
      completed: false,
      summary: `你在${contract.currentObjectivePointLabel || "起货点"}接走了黑货，接下来要尽快送去 ${String(offerRow.payloadJson?.targetObjectivePointLabel || "").trim() || "交货点"}。`,
      contract: mapPlayerWorldContractRow({
        ...offerRow,
        payloadJson: nextPayloadJson,
        updatedAt: nowIso,
      } satisfies PlayerWorldEventOfferRow),
    };
  }

  const summary = buildContractCompletionNarrative(contract);
  const settled = await settleCompletedWorldContract({
    playerId: params.playerId,
    offerRow,
    contract,
    summary,
    mapId: contract.currentObjectiveMapId,
    districtName: contract.currentObjectiveDistrictName,
  });

  return {
    offerId: settled.offerId,
    completed: true,
    summary: settled.summary,
    contract: settled.contract,
    reward: settled.reward,
  };
}

export async function completePlayerWorldNpcKillContracts(params: {
  playerId: string;
  npcId: string;
  npcName: string;
  mapId?: string | null;
  districtName?: string | null;
}) {
  if (!(await ensureOpenWorldSchema())) {
    return [];
  }

  const rows = await db.select().from(playerWorldEventOffers)
    .where(and(
      eq(playerWorldEventOffers.playerId, params.playerId),
      eq(playerWorldEventOffers.status, "accepted"),
    ))
    .orderBy(desc(playerWorldEventOffers.updatedAt), desc(playerWorldEventOffers.createdAt))
    .limit(8)
    .all();

  const matchedRows = rows.filter((row) => {
    const contract = mapPlayerWorldContractRow(row);
    return contract?.contractType === "hunt_target"
      && contract.contractStatus === "active"
      && contract.targetNpcId === params.npcId;
  });

  const results = [] as Array<Awaited<ReturnType<typeof settleCompletedWorldContract>>>;
  for (const row of matchedRows) {
    const contract = mapPlayerWorldContractRow(row);
    if (!contract) {
      continue;
    }
    results.push(await settleCompletedWorldContract({
      playerId: params.playerId,
      offerRow: row,
      contract,
      summary: `${params.npcName}已经死在你手里，灰线尾款随之结清。`,
      mapId: params.mapId || contract.targetMapId,
      districtName: params.districtName || contract.targetDistrictName,
    }));
  }

  return results;
}

function buildOfferResponseNarrative(params: {
  offerType: PlayerWorldOfferType;
  action: "accept" | "reject";
  sourceFaction: string;
}) {
  if (params.action === "reject") {
    if (params.offerType === "gift_lingyu") {
      return `${params.sourceFaction}见你没有收那袋灵石，便把见面礼收了回去，也暂时压下了继续试探的念头。`;
    }
    if (params.offerType === "treasure_invite") {
      return `${params.sourceFaction}见你没有接那封探宝帖子，便把刚露头的机缘线索转手递给了别人。`;
    }
    if (params.offerType === "broker_relief") {
      return `${params.sourceFaction}听你无意让他转话说项，也就不再替你去和街面上的人搭这层线。`;
    }
    if (params.offerType === "consensual_dual_cultivation") {
      return `${params.sourceFaction}见你没有点头，便把那条合意双修洗痕的门路收了回去，暂时不再追问。`;
    }
    if (params.offerType === "pressure_cleanse" || params.offerType === "rumor_silence" || params.offerType === "lawful_mediation") {
      return `${params.sourceFaction}记下了你的回绝，这次没有继续逼近，但这笔善后门路也就此断在了眼前。`;
    }
    return params.offerType === "demonic_temptation"
      ? `${params.sourceFaction}察觉你没有上钩，暂时收回了那股阴冷试探。`
      : `${params.sourceFaction}记下了你的回绝，没有继续追问，但也不会把你当成自己人。`;
  }

  if (params.offerType === "black_market_trade") {
    return `你收下了${params.sourceFaction}递来的暗市纸签，从今往后，某些不见光的买卖会更愿意找上你。`;
  }
  if (params.offerType === "shadow_intel") {
    return `你向${params.sourceFaction}买下了追缉链的一角情报，风声暂时更清楚了，但你也欠下了一笔灰账。`;
  }
  if (params.offerType === "cultivator_hunt") {
    return `你接下了${params.sourceFaction}抛来的脏活，这笔买卖会让你更像他们那边的人。`;
  }
  if (params.offerType === "pressure_cleanse") {
    return `你应下了${params.sourceFaction}递来的洗痕交易，对方会替你抹去一部分明面痕迹，但灰线人情也因此记在了你身上。`;
  }
  if (params.offerType === "rumor_silence") {
    return `你收下了${params.sourceFaction}压风声的门路，街面上的口风会先淡下几分，但暗线也会顺手把你记得更牢。`;
  }
  if (params.offerType === "lawful_mediation") {
    return `你接过了${params.sourceFaction}给的守序调解帖，这能替你缓和一部分明面压力，但你也得按他们的规矩低头行事。`;
  }
  if (params.offerType === "consensual_dual_cultivation") {
    return `你应下了${params.sourceFaction}递来的合意双修洗痕之约，这场交易只在双方明确点头后成立，也会真实写入双修核心账本。`;
  }
  if (params.offerType === "gift_lingyu") {
    return `你收下了${params.sourceFaction}递来的灵石见礼。对方暂时记下了你的态度，往后若再谈门路，也会更顺一点。`;
  }
  if (params.offerType === "treasure_invite") {
    return `你收下了${params.sourceFaction}递来的探宝帖子。接下来只要顺着那截机缘风声摸过去，就能把后续门路一并接稳。`;
  }
  if (params.offerType === "broker_relief") {
    return `你点头让${params.sourceFaction}替你出面递话。接下来一阵子，旁人对你的冷脸会先缓下来几分。`;
  }
  return `你没有拒绝${params.sourceFaction}递来的魔念诱饵，虽然得了好处，却也在自己身上留下了更深的灰痕。`;
}

function buildAcceptedContractNarrative(params: {
  contract: PlayerWorldContractItem;
  sourceFaction: string;
}) {
  const sourceFaction = params.sourceFaction || "灰线";
  const contract = params.contract;
  const targetArea = contract.currentObjectiveDistrictName
    || contract.targetDistrictName
    || contract.currentObjectiveMapName
    || contract.targetMapName
    || "指定地界";
  const objectiveLabel = contract.currentObjectivePointLabel || "指定地点";

  switch (contract.contractType) {
    case "meet_contact":
      if (contract.offerType === "broker_relief") {
        return `你点头接下了${sourceFaction}递来的说项门路。接下来要去${contract.targetDistrictName || contract.targetMapName || "指定地界"}找${contract.targetNpcName || "递话人"}递上转话帖，把那层冷脸先缓下来。`;
      }
      return `你收下了${sourceFaction}递来的帖子。接下来要去${contract.targetDistrictName || contract.targetMapName || "指定地界"}找${contract.targetNpcName || "接头人"}递上暗语，情报和尾款都会在那之后落定。`;
    case "hunt_target":
      return `你接下了${sourceFaction}抛来的猎修脏活。目标是${contract.targetDistrictName || contract.targetMapName || "指定地界"}的${contract.targetNpcName || "某个修士"}，只有办完这桩血账，尾款才会到账。`;
    case "dead_drop_delivery":
      return `你应下了${sourceFaction}交来的灰活，要把货匣送去${targetArea}的${objectiveLabel}藏好，尾款等东西落稳后再结。`;
    case "surveil_target":
      return `你接过了${sourceFaction}的贴影差事，得去${targetArea}的${objectiveLabel}伏听口风，把${contract.targetNpcName || "那人的"}动静摸清。`;
    case "treasure_probe":
      return `你收下了${sourceFaction}递来的探宝帖子。接下来要去${targetArea}的${objectiveLabel}探一遭，把那截刚冒头的机缘风声摸清。`;
    default:
      return `你收下了${sourceFaction}递来的黑货买卖，先去${contract.currentObjectivePointLabel || "起货点"}接走货，再护送去后手地点交割。`;
  }
}

async function syncStorylineParticipantsForContract(params: {
  playerId: string;
  contract: PlayerWorldContractItem | null | undefined;
  status: "active" | "completed";
  source: "offer_accept" | "contract_complete";
  sourceId: string;
}) {
  const storylineId = params.contract?.storylineId;
  if (!storylineId || !params.contract) {
    return;
  }

  await upsertOpenWorldStorylineParticipant({
    storylineId,
    participantType: "player",
    participantId: params.playerId,
    status: params.status,
    roleLabel: params.source === "offer_accept" ? "player_contract_actor" : "player_storyline_actor",
    metaJson: {
      source: params.source,
      sourceId: params.sourceId,
      contractType: params.contract.contractType,
      contractStatus: params.contract.contractStatus,
      districtName: params.contract.currentObjectiveDistrictName || params.contract.targetDistrictName || null,
    },
  });

  if (params.contract.targetNpcId) {
    await upsertOpenWorldStorylineParticipant({
      storylineId,
      participantType: "world_npc",
      participantId: params.contract.targetNpcId,
      status: params.status,
      roleLabel: params.contract.contractType === "hunt_target"
        ? "npc_contract_target"
        : "npc_storyline_contact",
      metaJson: {
        source: params.source,
        sourceId: params.sourceId,
        contractType: params.contract.contractType,
        contractStatus: params.contract.contractStatus,
      },
    });
  }
}

function resolveIncidentLocationFromPlayer(params: {
  currentMapId?: string | null;
  positionX?: number | null;
  positionY?: number | null;
}) {
  const mapId = String(params.currentMapId || "").trim() || null;
  if (!mapId) {
    return {
      mapId: null,
      districtName: null,
    };
  }

  return {
    mapId,
    districtName: resolveOpenWorldDistrictName({
      mapId,
      positionX: Number(params.positionX || 0),
      positionY: Number(params.positionY || 0),
    }) || null,
  };
}

export async function respondPlayerWorldEventOffer(params: {
  playerId: string;
  offerId: string;
  action: "accept" | "reject";
}) {
  if (!(await ensureOpenWorldSchema())) {
    throw new PlayerWorldError("开放世界表结构尚未就绪", 503);
  }

  const result = await db.transaction(async (tx) => {
    if (!(await tryAcquirePlayerWorldLock(tx, `player-world-offer:${params.offerId}`))) {
      throw new PlayerWorldError("这封来信正在处理中，请稍候再试", 409);
    }

    const nowIso = new Date().toISOString();
    await tx.update(playerWorldEventOffers).set({
      status: "expired",
      respondedAt: nowIso,
      updatedAt: nowIso,
    }).where(and(
      eq(playerWorldEventOffers.playerId, params.playerId),
      eq(playerWorldEventOffers.status, "pending"),
      lt(playerWorldEventOffers.expiresAt, nowIso),
    )).run();

    const offer = await tx.select().from(playerWorldEventOffers)
      .where(and(
        eq(playerWorldEventOffers.id, params.offerId),
        eq(playerWorldEventOffers.playerId, params.playerId),
      ))
      .get();
    if (!offer) {
      throw new PlayerWorldError("暗线来信不存在", 404);
    }
    if (offer.status !== "pending") {
      if (offer.status === "expired" || offer.expiresAt <= nowIso) {
        throw new PlayerWorldError("这封来信已经过期", 410);
      }
      throw new PlayerWorldError("这封来信已经处理过了", 409);
    }
    if (offer.expiresAt <= nowIso) {
      await tx.update(playerWorldEventOffers).set({
        status: "expired",
        respondedAt: nowIso,
        updatedAt: nowIso,
      }).where(eq(playerWorldEventOffers.id, offer.id)).run();
      throw new PlayerWorldError("这封来信已经过期", 410);
    }

    const currentRow = await tx.select().from(playerWorldProfiles)
      .where(eq(playerWorldProfiles.playerId, params.playerId))
      .get();
    if (!currentRow) {
      throw new PlayerWorldError("玩家世界画像不存在", 404);
    }

    const nextStatus = params.action === "accept" ? "accepted" : "rejected";
    const offerType = offer.offerType as PlayerWorldOfferType;
    const basePayloadJson = normalizeOfferPayloadJson(offer.payloadJson);
    const deferredReward = params.action === "accept"
      ? resolveOfferReward(basePayloadJson)
      : { rewardGold: 0, rewardLingYu: 0 };
    let immediateReward = { ...deferredReward };
    let nextPayloadJson = { ...basePayloadJson };
    let contract: PlayerWorldContractItem | null = null;
    let pressureDeltaApplied: IncidentScoreDelta | null = null;
    let reliefApplied: Partial<Record<OpenWorldPressureTarget, number>> | null = null;
    let keywordCheckPassed = true;
    let doubleCultivationLinked = false;
    let doubleCultivationSummary: string | null = null;
    let forcedConsequenceTriggered = false;
    let forcedConsequenceSummary: string | null = null;
    const partnerJealousyTriggered = false;
    const partnerJealousySummary: string | null = null;
    let incidentType = params.action === "accept"
      ? offer.offerType as PlayerWorldIncidentType
      : "offer_rejected" as const;
    let forcedActionUsed: OpenWorldForcedAction | null = null;

    const playerRow = params.action === "accept"
      ? await tx.select({
        name: players.name,
        gender: players.gender,
        realmName: players.realmName,
        gold: players.gold,
        lingYu: players.lingYu,
        currentMapId: players.currentMapId,
        positionX: players.positionX,
        positionY: players.positionY,
        isAlive: players.isAlive,
      }).from(players).where(eq(players.id, params.playerId)).get()
      : await tx.select({
        name: players.name,
        gender: players.gender,
        realmName: players.realmName,
        gold: players.gold,
        lingYu: players.lingYu,
        currentMapId: players.currentMapId,
        positionX: players.positionX,
        positionY: players.positionY,
        isAlive: players.isAlive,
      }).from(players).where(eq(players.id, params.playerId)).get();

    if (!playerRow) {
      throw new PlayerWorldError("玩家不存在", 404);
    }

    const adultProfileRow = await tx.select({
      corruptionValue: playerAdultProfiles.corruptionValue,
    }).from(playerAdultProfiles)
      .where(eq(playerAdultProfiles.playerId, params.playerId))
      .get();

    const incidentLocation = playerRow
      ? resolveIncidentLocationFromPlayer({
        currentMapId: playerRow.currentMapId,
        positionX: playerRow.positionX,
        positionY: playerRow.positionY,
      })
      : {
        mapId: null,
        districtName: null,
      };

    if (params.action === "accept") {
      const isPressureReliefOffer = offerType === "pressure_cleanse"
        || offerType === "rumor_silence"
        || offerType === "lawful_mediation"
        || offerType === "consensual_dual_cultivation"
        || offerType === "broker_relief";
      if (isPressureReliefOffer) {
        keywordCheckPassed = resolveOfferKeywordCheckPassed({
          offer,
          payloadJson: basePayloadJson,
        });
        if (!keywordCheckPassed) {
          throw new PlayerWorldError("当前邀约未满足你设定的关键词范围，无法继续。", 400);
        }
        const reliefValue = Math.max(0, Number(basePayloadJson.reliefValue || 0));
        const pressureTargets = resolveOfferPressureTargets(basePayloadJson);
        const reliefDelta = buildPressureReliefDelta({
          currentRow,
          incidentType: offerType as PlayerWorldIncidentType,
          severity: Math.max(1, Number(basePayloadJson.severity || 1)),
          reliefValue,
          pressureTargets,
        });
        reliefApplied = reliefDelta.reliefApplied;
        pressureDeltaApplied = reliefDelta.delta;
        immediateReward = { rewardGold: 0, rewardLingYu: 0 };
        nextPayloadJson = {
          ...nextPayloadJson,
          keywordCheckPassed,
          reliefApplied,
        };
      }

      const target = offerUsesNpcContractTarget(offerType)
        ? await pickWorldContractTarget({
          offerType,
          preferredMapId: playerRow?.currentMapId || null,
        })
        : null;
      nextPayloadJson = buildContractPayload({
        offerType,
        sourceFaction: offer.sourceFaction || "暗线",
        target,
        reward: deferredReward,
        basePayloadJson,
        preferredMapId: playerRow?.currentMapId || null,
      });
      contract = mapPlayerWorldContractRow({
        ...offer,
        status: nextStatus,
        payloadJson: nextPayloadJson,
        updatedAt: nowIso,
      } satisfies PlayerWorldEventOfferRow);
      if (offerRequiresWorldContract(offerType) && !contract) {
        throw new PlayerWorldError("这封委托尚未生成有效去向，请稍后再试。", 409);
      }
      if (contract) {
        immediateReward = { rewardGold: 0, rewardLingYu: 0 };
      }

      if (offerType === "consensual_dual_cultivation") {
        const linkage = await settleOfferDoubleCultivationLinkage({
          playerId: params.playerId,
          playerRow,
          offerId: offer.id,
          sourceFaction: offer.sourceFaction || "暗线",
          payloadJson: basePayloadJson,
          actionType: "dual_cultivation",
          summaryMode: "consensual",
        });
        if (linkage.linked && linkage.linkage) {
          doubleCultivationLinked = true;
          doubleCultivationSummary = linkage.summary;
          nextPayloadJson = {
            ...nextPayloadJson,
            doubleCultivationLinked: true,
            doubleCultivationSummary,
            doubleCultivation: {
              synced: true,
              logId: linkage.linkage.log?.id ?? null,
              playerGain: linkage.linkage.player?.gain ?? null,
              intimacyScoreDelta: linkage.linkage.intimacy?.scoreDelta ?? null,
              pregnancyStageKey: linkage.linkage.pregnancyStatus?.stageKey ?? null,
            },
          };
        } else {
          doubleCultivationSummary = linkage.summary;
          nextPayloadJson = {
            ...nextPayloadJson,
            doubleCultivationLinked: false,
            doubleCultivationSummary,
          };
        }
      }
    }

    if (params.action === "accept" && playerRow && (immediateReward.rewardGold > 0 || immediateReward.rewardLingYu > 0)) {
      await tx.update(players).set({
        gold: playerRow.gold + immediateReward.rewardGold,
        lingYu: playerRow.lingYu + immediateReward.rewardLingYu,
      }).where(eq(players.id, params.playerId)).run();
    }

    if (params.action === "reject") {
      const coerciveFlavorLevel = basePayloadJson.coerciveFlavorLevel === "high" || basePayloadJson.coerciveFlavorLevel === "medium"
        ? basePayloadJson.coerciveFlavorLevel
        : "low";
      const forcedActions = resolveOfferForcedActions(basePayloadJson);
      const reliefRules = getOpenWorldForcedRuleSnapshot();
      const playerCorruptionValue = Math.max(0, Number(adultProfileRow?.corruptionValue || 0));
      if (
        coerciveFlavorLevel === "high"
        && forcedActions.length > 0
        && playerCorruptionValue >= reliefRules.highCorruptionThreshold
      ) {
        incidentType = "coercive_failure";
        forcedActionUsed = pickOfferForcedAction(forcedActions);
        if (forcedActionUsed === "rob_lingyu") {
          const robbedLingYu = Math.min(
            playerRow.lingYu,
            Math.max(12, Math.floor(playerRow.lingYu * 0.18)),
          );
          if (robbedLingYu > 0) {
            await tx.update(players).set({
              lingYu: Math.max(0, playerRow.lingYu - robbedLingYu),
            }).where(eq(players.id, params.playerId)).run();
          }
        } else if (forcedActionUsed === "forced_teleport") {
          const targetMap = await tx.select({
            id: worldMapInstances.id,
            name: worldMapInstances.name,
          }).from(worldMapInstances)
            .where(playerRow.currentMapId ? ne(worldMapInstances.id, playerRow.currentMapId) : sql`true`)
            .orderBy(desc(worldMapInstances.dangerLevel), desc(worldMapInstances.heatScore))
            .limit(1)
            .get();
          if (targetMap) {
            await tx.update(players).set({
              currentMapId: targetMap.id,
              positionX: 15,
              positionY: 15,
            }).where(eq(players.id, params.playerId)).run();
          }
        } else if (forcedActionUsed === "forced_dual_cultivation") {
          const forcedLinkage = await settleOfferDoubleCultivationLinkage({
            playerId: params.playerId,
            playerRow,
            offerId: offer.id,
            sourceFaction: offer.sourceFaction || "暗线",
            payloadJson: basePayloadJson,
            actionType: "dual_cultivation",
            summaryMode: "forced",
          });
          doubleCultivationLinked = forcedLinkage.linked;
          doubleCultivationSummary = forcedLinkage.summary;
          nextPayloadJson = {
            ...nextPayloadJson,
            doubleCultivationLinked: forcedLinkage.linked,
            doubleCultivationSummary,
            doubleCultivation: forcedLinkage.linkage
              ? {
                synced: true,
                logId: forcedLinkage.linkage.log?.id ?? null,
                playerGain: forcedLinkage.linkage.player?.gain ?? null,
                intimacyScoreDelta: forcedLinkage.linkage.intimacy?.scoreDelta ?? null,
                pregnancyStageKey: forcedLinkage.linkage.pregnancyStatus?.stageKey ?? null,
                forced: true,
              }
              : {
                synced: false,
                forced: true,
              },
          };
        }

        const forcedNarrative = await generateOpenWorldForcedConsequence({
          npcName: offer.sourceFaction || "暗线使者",
          mapName: "尘世暗流",
          districtName: incidentLocation.districtName,
          actionType: offerType,
          atmosphereHint: String(basePayloadJson.fallbackSummary || offer.summary || "").trim(),
          forcedAction: forcedActionUsed || "rob_lingyu",
        });
        forcedConsequenceTriggered = true;
        forcedConsequenceSummary = [
          forcedNarrative.summary,
          forcedActionUsed === "forced_dual_cultivation" ? doubleCultivationSummary : null,
        ]
          .filter(Boolean)
          .join(" ")
          .trim();
        const coerciveDelta = resolveIncidentDelta("coercive_failure", Math.max(1, Number(basePayloadJson.severity || 1)));
        const forcedDelta = resolveIncidentDelta("forced_consequence", Math.max(1, Number(basePayloadJson.severity || 1)));
        pressureDeltaApplied = {
          notorietyScore: coerciveDelta.notorietyScore + forcedDelta.notorietyScore,
          bountyHeat: coerciveDelta.bountyHeat + forcedDelta.bountyHeat,
          shadowFavor: coerciveDelta.shadowFavor + forcedDelta.shadowFavor,
          lawfulPressure: coerciveDelta.lawfulPressure + forcedDelta.lawfulPressure,
        };
      }
    }

    const summary = contract
      ? buildAcceptedContractNarrative({
        contract,
        sourceFaction: offer.sourceFaction || "灰线",
      })
      : buildOfferResponseNarrative({
        offerType,
        action: params.action,
        sourceFaction: offer.sourceFaction || "暗线",
      });
    const severity = Math.max(1, Number(basePayloadJson.severity || 1));
    const fallbackDelta = pressureDeltaApplied || resolveIncidentDelta(incidentType, severity);
    const nextScores: IncidentScoreDelta = {
      notorietyScore: clampScore(currentRow.notorietyScore + fallbackDelta.notorietyScore),
      bountyHeat: clampScore(currentRow.bountyHeat + fallbackDelta.bountyHeat),
      shadowFavor: clampScore(currentRow.shadowFavor + fallbackDelta.shadowFavor),
      lawfulPressure: clampScore(currentRow.lawfulPressure + fallbackDelta.lawfulPressure),
    };
    const nextTier = resolveAlertTier(nextScores);
    const nextFlags = {
      ...normalizeFlags(currentRow.flagsJson),
      lastWorldOfferResolvedAt: nowIso,
      lastWorldOfferResolvedAction: params.action,
      lastWorldOfferType: offer.offerType,
      worldOfferCooldownUntil: new Date(Date.now() + WORLD_OFFER_REGEN_COOLDOWN_MS).toISOString(),
    };
    const nextRow: PlayerWorldProfileRow = {
      ...currentRow,
      ...nextScores,
      activeAlertTier: nextTier,
      activeWatcherCount: resolveWatcherCount(nextScores, nextTier),
      lastDecayAt: nowIso,
      flagsJson: nextFlags,
      updatedAt: nowIso,
    };
    const actualDelta = buildAppliedScoreDelta({
      currentRow,
      nextScores,
    });
    pressureDeltaApplied = actualDelta;
    const narrative = [summary, doubleCultivationSummary, forcedConsequenceSummary]
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .join(" ");

    await tx.update(playerWorldEventOffers).set({
      status: nextStatus,
      payloadJson: nextPayloadJson,
      respondedAt: nowIso,
      updatedAt: nowIso,
    }).where(eq(playerWorldEventOffers.id, offer.id)).run();

    await tx.insert(playerWorldIncidents).values({
      playerId: params.playerId,
      incidentType,
      sourceType: "event_offer",
      sourceId: offer.id,
      mapId: incidentLocation.mapId,
      districtName: incidentLocation.districtName,
      severity,
      summary: narrative,
      payloadJson: {
        offerType: offer.offerType,
        sourceFaction: offer.sourceFaction,
        action: params.action,
        reward: immediateReward,
        keywordCheckPassed,
        reliefApplied,
        pressureDeltaApplied,
        doubleCultivationLinked,
        doubleCultivationSummary,
        forcedConsequenceTriggered,
        forcedConsequenceSummary,
        forcedActionUsed,
        partnerJealousyTriggered,
        partnerJealousySummary,
        contract: contract ? {
          contractType: contract.contractType,
          contractStatus: contract.contractStatus,
          title: contract.title,
          targetNpcId: contract.targetNpcId,
          targetNpcName: contract.targetNpcName,
          targetMapId: contract.targetMapId,
          targetMapName: contract.targetMapName,
          targetDistrictName: contract.targetDistrictName,
        } : null,
      },
      createdAt: nowIso,
    }).run();

    if (forcedConsequenceTriggered && forcedConsequenceSummary) {
      await tx.insert(playerWorldIncidents).values({
        playerId: params.playerId,
        incidentType: "forced_consequence",
        sourceType: "event_offer",
        sourceId: offer.id,
        mapId: incidentLocation.mapId,
        districtName: incidentLocation.districtName,
        severity,
        summary: forcedConsequenceSummary,
        payloadJson: {
          offerType: offer.offerType,
          sourceFaction: offer.sourceFaction,
          action: params.action,
          forcedAction: forcedActionUsed,
        },
        createdAt: nowIso,
      }).run();
    }

    await tx.update(playerWorldProfiles).set({
      notorietyScore: nextRow.notorietyScore,
      bountyHeat: nextRow.bountyHeat,
      shadowFavor: nextRow.shadowFavor,
      lawfulPressure: nextRow.lawfulPressure,
      activeAlertTier: nextRow.activeAlertTier,
      activeWatcherCount: nextRow.activeWatcherCount,
      lastDecayAt: nextRow.lastDecayAt,
      flagsJson: nextRow.flagsJson,
      updatedAt: nextRow.updatedAt,
    }).where(eq(playerWorldProfiles.playerId, nextRow.playerId)).run();

    const previousTier = currentRow.activeAlertTier as PlayerWorldAlertTier;
    const previousOrder = getTierOrder(previousTier);
    const nextOrder = getTierOrder(nextTier);
    const flags = normalizeFlags(nextRow.flagsJson);
    if (nextOrder >= 3 && nextOrder > previousOrder && flags.lastAlertMailTier !== nextTier) {
      const presentation = resolveAlertPresentation(nextTier);
      await tx.insert(playerMails).values({
        playerId: params.playerId,
        title: `天道风声：${presentation.label}`,
        content: `${presentation.description}\n${presentation.nextEscalationRisk}`,
        createdAt: nowIso,
      }).run();
      await tx.update(playerWorldProfiles).set({
        flagsJson: {
          ...flags,
          lastAlertMailTier: nextTier,
          lastAlertMailAt: nowIso,
        },
        updatedAt: nowIso,
      }).where(eq(playerWorldProfiles.playerId, nextRow.playerId)).run();
      nextRow.flagsJson = {
        ...flags,
        lastAlertMailTier: nextTier,
        lastAlertMailAt: nowIso,
      };
    }

    return {
      offerId: offer.id,
      offerType: offer.offerType as PlayerWorldOfferType,
      status: nextStatus as PlayerWorldOfferStatus,
      narrative,
      reward: immediateReward,
      contract,
      worldPressure: summarizeProfile(nextRow),
      mapId: incidentLocation.mapId,
      districtName: incidentLocation.districtName,
      pressureDeltaApplied,
      reliefApplied,
      keywordCheckPassed,
      doubleCultivationLinked,
      doubleCultivationSummary,
      forcedConsequenceTriggered,
      forcedConsequenceSummary,
      partnerJealousyTriggered,
      partnerJealousySummary,
    };
  });

  await maybeEmitDistrictChainRumor({
    playerId: params.playerId,
    incidentType: params.action === "accept"
      ? result.offerType as PlayerWorldIncidentType
      : "offer_rejected",
    sourceType: "event_offer",
    sourceId: result.offerId,
    mapId: result.mapId,
    districtName: result.districtName,
  });

  try {
    await settleOpenWorldFactionAfterIncident({
      playerId: params.playerId,
      incidentType: params.action === "accept"
        ? result.offerType as PlayerWorldIncidentType
        : "offer_rejected",
      mapId: result.mapId,
      districtName: result.districtName,
      summary: result.narrative,
    });
  } catch (error) {
    logPlayerWorldFallback("faction-settle-offer", error);
  }

  if (params.action === "accept") {
    try {
      await syncStorylineParticipantsForContract({
        playerId: params.playerId,
        contract: result.contract,
        status: "active",
        source: "offer_accept",
        sourceId: result.offerId,
      });
    } catch (error) {
      logPlayerWorldFallback("storyline-offer-accept", error);
    }
  }

  return {
    offerId: result.offerId,
    offerType: result.offerType,
    status: result.status,
    narrative: result.narrative,
    reward: result.reward,
    contract: result.contract,
    worldPressure: result.worldPressure,
    pressureDeltaApplied: result.pressureDeltaApplied,
    reliefApplied: result.reliefApplied,
    keywordCheckPassed: result.keywordCheckPassed,
    doubleCultivationLinked: result.doubleCultivationLinked,
    doubleCultivationSummary: result.doubleCultivationSummary,
    forcedConsequenceTriggered: result.forcedConsequenceTriggered,
    forcedConsequenceSummary: result.forcedConsequenceSummary,
    partnerJealousyTriggered: result.partnerJealousyTriggered,
    partnerJealousySummary: result.partnerJealousySummary,
  };
}

export async function getPlayerWorldNotificationSummary(playerId: string) {
  const summary = await ensurePlayerWorldProfile(playerId);
  const [activeOfferRows, rumorCountRow] = await Promise.all([
    listPendingPlayerWorldEventOfferRows(playerId),
    db.select({ total: count() }).from(playerWorldIncidents)
      .where(and(
        eq(playerWorldIncidents.playerId, playerId),
        gt(playerWorldIncidents.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      ))
      .get(),
  ]);

  return {
    worldDangerCount: getTierOrder(summary.activeAlertTier) >= 2 ? summary.activeWatcherCount : 0,
    worldBountyActive: getTierOrder(summary.activeAlertTier) >= 3 || summary.bountyHeat >= 45,
    worldRumorUnread: Number(rumorCountRow?.total || 0),
    activeOfferCount: activeOfferRows.length,
  };
}

export function buildPlayerWorldPenaltySummary(summary: PlayerWorldPressureSummary, baseFeePercent: number): PlayerWorldPenaltySummary {
  const extraFeePercent = summary.marketFeeExtraPercent;
  const hints: string[] = [];
  if (summary.lawfulMood !== "neutral") {
    hints.push("守序势力已经开始记你的风声，明面交易会更不痛快。");
  }
  if (summary.shadowMood !== "distant") {
    hints.push("灰市和旁门更愿意试探你，暗线邀约会变多。");
  }
  if (getTierOrder(summary.activeAlertTier) >= 3) {
    hints.push("你的名声已经够热，公开交易会留下更多痕迹。");
  }

  return {
    baseFeePercent,
    extraFeePercent,
    effectiveFeePercent: baseFeePercent + extraFeePercent,
    finalFeePercent: baseFeePercent + extraFeePercent,
    level: extraFeePercent >= 6 ? "high" : extraFeePercent >= 4 ? "medium" : extraFeePercent >= 1 ? "mild" : "none",
    title: extraFeePercent > 0 ? "风声抬价" : "市面平静",
    summary: extraFeePercent > 0
      ? `你的风声已让市场额外加价 ${extraFeePercent}%。`
      : "你在这片地界的风声还不算重，市场暂未额外抬价。",
    hints: hints.length > 0 ? hints : ["你在这片地界的风声还不算重，市场暂未额外抬价。"],
  };
}

export async function getPlayerWorldPenaltySummary(playerId: string, baseFeePercent: number) {
  const summary = await ensurePlayerWorldProfile(playerId);
  return buildPlayerWorldPenaltySummary(summary, baseFeePercent);
}

export async function getPlayerWorldMarketPenaltySummary(playerId: string, baseFeePercent: number) {
  return await getPlayerWorldPenaltySummary(playerId, baseFeePercent);
}

export async function getSafePlayerWorldMarketPenaltySummary(playerId: string, baseFeePercent: number) {
  try {
    return await getPlayerWorldMarketPenaltySummary(playerId, baseFeePercent);
  } catch (error) {
    logPlayerWorldFallback("market-penalty", error);
    return buildPlayerWorldPenaltySummary(buildNeutralPlayerWorldPressureSummary(playerId), baseFeePercent);
  }
}

export async function getStaticNpcWorldAttitude(params: {
  playerId: string;
  npcId: string;
}) {
  const [summary, adultSurface, npcRow] = await Promise.all([
    ensurePlayerWorldProfile(params.playerId),
    getPlayerWorldAdultSurface(params.playerId),
    db.select({
      id: npcs.id,
      name: npcs.name,
      bountyEnabled: npcs.bountyEnabled,
    }).from(npcs).where(eq(npcs.id, params.npcId)).get(),
  ]);

  if (!npcRow) {
    return buildNeutralPlayerWorldNpcAttitude();
  }

  const reputation = buildPlayerWorldReputationSummary({
    playerId: params.playerId,
    pressure: summary,
    adultSurface,
  });
  return buildPlayerWorldNpcAttitude({
    npcName: npcRow.name,
    pressure: summary,
    reputation,
    bountyEnabled: Boolean(npcRow.bountyEnabled),
    shadowFriendlyEligible: !npcRow.bountyEnabled,
  });
}

export async function getSafeStaticNpcWorldAttitude(params: {
  playerId: string;
  npcId: string;
}) {
  try {
    return await getStaticNpcWorldAttitude(params);
  } catch (error) {
    logPlayerWorldFallback("npc-attitude", error);
    return buildNeutralPlayerWorldNpcAttitude();
  }
}

export async function resolveWorldQuestActionGate(params: {
  playerId: string;
  npcId: string;
  questCategory?: "main" | "side" | null;
  questType?: string | null;
}) {
  const [summary, npcRow] = await Promise.all([
    ensurePlayerWorldProfile(params.playerId),
    db.select({
      id: npcs.id,
      name: npcs.name,
    }).from(npcs).where(eq(npcs.id, params.npcId)).get(),
  ]);

  if (!npcRow || params.questCategory === "main") {
    return {
      allowed: true,
      summary,
      reason: null,
    };
  }

  if (params.questType === "bounty" && (summary.bountyHeat >= 60 || getTierOrder(summary.activeAlertTier) >= 3)) {
    return {
      allowed: false,
      summary,
      reason: `${npcRow.name}皱了皱眉，表示你身上的追缉风声太重，今日不想把新的悬赏交到你手里。`,
    };
  }

  if (params.questCategory === "side" && summary.lawfulPressure >= 72) {
    return {
      allowed: false,
      summary,
      reason: `${npcRow.name}顾忌你最近的名声，不愿把额外委托牵到自己身上。`,
    };
  }

  return {
    allowed: true,
    summary,
    reason: null,
  };
}

export async function getSafeWorldQuestActionGate(params: {
  playerId: string;
  npcId: string;
  questCategory?: "main" | "side" | null;
  questType?: string | null;
}) {
  try {
    return await resolveWorldQuestActionGate(params);
  } catch (error) {
    logPlayerWorldFallback("quest-gate", error);
    return {
      allowed: true,
      summary: buildNeutralPlayerWorldPressureSummary(params.playerId),
      reason: null,
    };
  }
}

export async function canHandleNpcQuestWithWorldPressure(params: {
  playerId: string;
  npcId: string;
  questCategory?: "main" | "side" | null;
  questType?: string | null;
}) {
  return await resolveWorldQuestActionGate(params);
}

export function isPlayerWorldError(error: unknown): error is PlayerWorldError {
  return error instanceof PlayerWorldError;
}

export async function attachWorldNpcSourceLabels<T extends { sourceNpcId?: string | null }>(offerRows: T[]) {
  const sourceNpcIds = offerRows
    .map((row) => String(row.sourceNpcId || "").trim())
    .filter(Boolean);
  if (sourceNpcIds.length <= 0) {
    return offerRows.map((row) => ({
      ...row,
      sourceNpcName: null,
    }));
  }

  const npcRows = await db.select({
    id: worldNpcProfiles.id,
    name: worldNpcProfiles.name,
  }).from(worldNpcProfiles).where(inArray(worldNpcProfiles.id, sourceNpcIds)).all();
  const npcNameMap = new Map(npcRows.map((row) => [row.id, row.name]));
  return offerRows.map((row) => ({
    ...row,
    sourceNpcName: row.sourceNpcId ? npcNameMap.get(row.sourceNpcId) || null : null,
  }));
}

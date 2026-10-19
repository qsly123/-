import type { BattleSceneSnapshot } from "@/modules/combat/services/battle-scene-state";

/* ============================
   灵墟·长生劫 - 游戏类型定义
   ============================ */

/** 灵根信息 */
export interface SpiritualRoot {
  name: string;
  element: string;
  variant?: string | null;
  description: string;
  bonuses: {
    hpPercent?: number;
    mpPercent?: number;
    atkPercent?: number;
    defPercent?: number;
    speedPercent?: number;
    luckPercent?: number;
    spiritualSensePercent?: number;
    armorPenetrationPercent?: number;
    blockPercent?: number;
    skillDamageBonusPercent?: number;
    skillDamageReductionPercent?: number;
    artifactDamageBonusPercent?: number;
    artifactDamageReductionPercent?: number;
    elementDamageBonus?: number;
  };
}

/** 角色属性增减 */
export interface AttributeDelta {
  hp?: number;
  maxHp?: number;
  mp?: number;
  maxMp?: number;
  attack?: number;
  defense?: number;
  speed?: number;
  luck?: number;
  spiritualSense?: number;
  armorPenetration?: number;
  block?: number;
  skillDamageBonus?: number;
  skillDamageReduction?: number;
  artifactDamageBonus?: number;
  artifactDamageReduction?: number;
}

export interface FortuneModifierObject {
  flat?: number | string;
  value?: number | string;
  amount?: number | string;
  percent?: number | string;
  rate?: number | string;
  pct?: number | string;
}

export type FortuneModifierValue = number | string | FortuneModifierObject;

export interface FortuneEventAttributeDelta {
  hp?: FortuneModifierValue;
  maxHp?: FortuneModifierValue;
  mp?: FortuneModifierValue;
  maxMp?: FortuneModifierValue;
  attack?: FortuneModifierValue;
  defense?: FortuneModifierValue;
  speed?: FortuneModifierValue;
  luck?: FortuneModifierValue;
  spiritualSense?: FortuneModifierValue;
  armorPenetration?: FortuneModifierValue;
  block?: FortuneModifierValue;
  skillDamageBonus?: FortuneModifierValue;
  skillDamageReduction?: FortuneModifierValue;
  artifactDamageBonus?: FortuneModifierValue;
  artifactDamageReduction?: FortuneModifierValue;
}

export type FortuneRateModifierValue = number | string | {
  value?: number | string;
  flat?: number | string;
  amount?: number | string;
  percent?: number | string;
  rate?: number | string;
  pct?: number | string;
};

/** 气运特殊倍率 */
export interface FortuneSpecialEffects {
  combatXpRate?: FortuneRateModifierValue;
  adventureXpRate?: FortuneRateModifierValue;
  questXpRate?: FortuneRateModifierValue;
  pillXpRate?: FortuneRateModifierValue;
  doubleCultivationXpRate?: FortuneRateModifierValue;
  breakthroughSuccessRate?: FortuneRateModifierValue;
  dongfuLingqiRate?: FortuneRateModifierValue;
  pregnancyChanceRate?: FortuneRateModifierValue;
  pregnancyProgressRate?: FortuneRateModifierValue;
  doubleCultivationFluidRate?: FortuneRateModifierValue;
  doubleCultivationRetentionRate?: FortuneRateModifierValue;
}

export interface PlayerStatusFlowEffects {
  dongfuLingqiRate?: number;
  breakthroughSuccessRate?: number;
  doubleCultivationXpRate?: number;
}

export interface PregnancyStatusPayload {
  absorbedMl?: number;
  effectiveAbsorbedMl?: number;
  uterusStorageMl?: number;
  uterusCapacityMl?: number;
  uterusFillRatio?: number;
  entryDisplayStage?: string;
  canTriggerExclusiveEvents?: boolean;
  sourceLogId?: number | string | null;
  sourceTargetKind?: "player" | "monster" | "world_npc" | null;
  sourceTargetId?: string | null;
  stage4EventId?: string | null;
  stage5EventId?: string | null;
  stage6EventId?: string | null;
  stage4EventProcessingAt?: string | null;
  stage4EventTriggeredAt?: string;
  stage5EventProcessingAt?: string | null;
  stage5EventTriggeredAt?: string;
  stage6EventProcessingAt?: string | null;
  stage6EventTriggeredAt?: string;
  stage7FortuneProcessingAt?: string | null;
  stage7FortuneHandledAt?: string;
  stage7FortuneGrantedAt?: string;
  stage7FortuneId?: string | null;
  stage7FortuneAction?: string | null;
  stage7FortuneReason?: string | null;
  completionRewardXp?: number;
  settlementTitle?: string;
  statusTitle?: string;
  stageTitle?: string;
}

export interface PlayerStatusView {
  id: string;
  playerId: string;
  statusKey: string;
  title: string;
  stageTitle?: string;
  stageKey: string;
  stageIndex: number;
  iconImageUrl?: string | null;
  sourceType?: string | null;
  sourcePluginId?: string | null;
  sourceRef?: string | null;
  startedAt: string;
  nextStageAt?: string | null;
  expiresAt?: string | null;
  attrEffects: AttributeDelta;
  flowEffects: PlayerStatusFlowEffects;
  payload?: Record<string, unknown> | null;
  remainingSeconds?: number | null;
  effectSummary?: string[];
}

export interface PregnancySystemConfigStage {
  key: string;
  title: string;
  durationHours: number;
  iconImageUrl: string;
  attrEffects: AttributeDelta;
  flowEffects: PlayerStatusFlowEffects;
}

export interface PregnancySystemConfig {
  enabled: boolean;
  statusKey: string;
  statusTitle: string;
  sourcePluginId: string;
  baseChanceRate: number;
  chanceCapRate: number;
  highAbsorbMlThreshold: number;
  highAbsorbBonusRate: number;
  fortuneBonusKeys: {
    femaleChanceKey: string;
    maleChanceKey: string;
    femaleProgressKey: string;
    femaleRetentionKey: string;
    maleFluidKey: string;
  };
  lowFluidStageRatio: number;
  highFluidStageRatio: number;
  exclusiveEventStageKey: string;
  stages: PregnancySystemConfigStage[];
  settlement: {
    title: string;
    rewardXpRatio: number;
    rewardXpMin: number;
    rewardXpMax: number;
  };
}

/** 气运事件加成 */
export interface FortuneEventEffects {
  killPlayer?: FortuneEventAttributeDelta;
  killMonster?: FortuneEventAttributeDelta;
  selfDeath?: FortuneEventAttributeDelta;
}

/** 技能状态效果 */
export interface SkillEffect {
  type: string;
  value: number;
  duration: number;
  chance: number;
}

export type SkillSourceType = "learned" | "artifact" | "monster" | "system";

/** 技能视觉特效 */
export interface CombatSkillVisualEffect {
  spriteUrl?: string;
  frameWidth?: number;
  frameHeight?: number;
  frameCount?: number;
  frameDurationMs?: number;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
}

/** 技能效果存档结构，兼容旧版 SkillEffect[] */
export interface SkillEffectsPayload {
  effects: SkillEffect[];
  visualEffect?: CombatSkillVisualEffect | null;
}

/** 掉落物 */
export interface DropItem {
  itemId: string;
  chance: number;
  minQuantity: number;
  maxQuantity: number;
}

/** 任务需求 */
export interface QuestRequirement {
  type: "talk" | "kill" | "collect" | "realm" | "power";
  targetId: string;
  targetName: string;
  quantity: number;
}

export type QuestCategory = "main" | "side";

export interface RandomEventRewardAction {
  type: string;
  targetVar?: string;
  monsterId?: string;
  mapId?: string;
  [key: string]: unknown;
}

export type RandomEventEncounterMode = "single" | "chain";

export interface MapEncounterChoiceView {
  id: string;
  label: string;
  tag?: string | null;
  tone?: string | null;
}

export interface MapEncounterStageView {
  sessionId: string;
  stageIndex: number;
  stageNumber: number;
  totalStages: number;
  title: string;
  narrative: string;
  imageUrl?: string | null;
  choices: MapEncounterChoiceView[];
  pathSummary?: string[];
  isFinalStage: boolean;
}

export interface MapEncounterSessionView {
  sessionId: string;
  eventId: string;
  eventName: string;
  eventType: string;
  status: "active" | "completed" | "expired";
  currentStageIndex: number;
  totalStages: number;
  expiresAt: string;
  selectedPath: Array<{
    stageIndex: number;
    choiceId: string;
    label: string;
    tag?: string | null;
  }>;
}

/** 任务奖励 */
export interface QuestReward {
  xp?: number;
  gold?: number;
  items?: { itemId: string; quantity: number }[];
  fortuneIds?: string[];
  removeFortuneIds?: string[];
  actions?: RandomEventRewardAction[];
}

/** 随机事件判定条件 */
export interface EventJudgeConditions {
  gender?: "男" | "女";
  fortuneConditions?: Array<{
    fortuneId: string;
    hasFortune: boolean;
  }>;
  pluginConditions?: Record<string, unknown>;
}

/** CDK奖励 */
export interface CdkReward {
  xp?: number;
  gold?: number;
  items?: { itemId: string; quantity: number }[];
}

/** CDK兑换返回 */
export interface CdkRedeemResponse {
  reward: CdkReward & {
    items?: { itemId: string; quantity: number; itemName: string; itemIconUrl?: string | null }[];
  };
}

/** 物品效果 */
export interface ItemEffect {
  type:
    | "heal_hp"
    | "heal_mp"
    | "heal_stamina"
    | "reduce_toxicity"
    | "boost_breakthrough"
    | "boost_atk"
    | "boost_def"
    | "boost_xp"
    | "boost_hp"
    | "boost_mp"
    | "boost_speed"
    | "boost_luck"
    | "boost_spiritual_sense"
    | "boost_armor_penetration"
    | "boost_block"
    | "boost_skill_damage_bonus"
    | "boost_skill_damage_reduction"
    | "boost_artifact_damage_bonus"
    | "boost_artifact_damage_reduction"
    | "learn_skill"
    | "bind_skill"
    | "unlock_avatar"
    | "unlock_avatar_frame";
  value: number;
  skillId?: string;
  avatarId?: string;
  avatarFrameId?: string;
  duration?: number;
}

export type RealmRewardAttr = "hp" | "mp" | "atk" | "def" | "speed" | "luck";

export interface RealmRewardRule {
  attr: RealmRewardAttr;
  probabilityMin: number;
  probabilityMax: number;
  valueMin: number;
  valueMax: number;
}

/** 地图格子数据 */
export interface TileData {
  x: number;
  y: number;
  type: string;
  walkable?: boolean;
  eventId?: string;
  description?: string;
  imageUrl?: string;
  portalId?: string;
  portalName?: string;
  portalTargetMapId?: string;
  portalTargetPortalId?: string;
  portalTargetName?: string;
  portalExtraTargets?: Array<{
    mapId: string;
    mapName?: string;
    portalId?: string;
    label?: string;
  }>;
}

export type SectRoleKey =
  | "leader"
  | "vice_leader"
  | "grand_elder"
  | "elder"
  | "inner_disciple"
  | "outer_disciple"
  | "handyman"
  | "handyman_disciple";

export type SectPermissionKey =
  | "review_join"
  | "review_visit"
  | "appoint_member"
  | "manage_storage"
  | "edit_map"
  | "expand_sect"
  | "manage_notice"
  | "manage_buildings";

export type SectState = "active" | "abandoned_public";
export type SectLevel = 1 | 2 | 3 | 4 | 5;
export type SectApplicationType = "join" | "visit";
export type SectApplicationStatus = "pending" | "approved" | "rejected" | "canceled" | "expired";
export type SectBuildingType = "portal" | "main_hall" | "storage" | "lingqi_peak";
export type SectResourceKey = "spirit_stone" | "wood" | "stone" | "sect_material";

export interface SectSummary {
  sectId: string;
  sectName: string;
  state: SectState;
  roleKey: SectRoleKey;
  roleLabel: string;
  isGovernor: boolean;
  sectLevel: SectLevel;
  sectMapSize: number;
  sectMemberCount: number;
  sectMemberLimit: number;
  dongfuBonusRate: number;
  mapSize: number;
  publicState: boolean;
  canReviewJoinApplications: boolean;
  canReviewVisitApplications: boolean;
}

export interface SectResourceSnapshot {
  spiritStone: number;
  wood: number;
  stone: number;
  sectMaterial: number;
  storageCapacity: number;
}

export interface SectBuildingSnapshot {
  buildingType: SectBuildingType;
  name: string;
  level: number;
  positionX: number;
  positionY: number;
  description?: string | null;
}

export interface SectApplicationView {
  id: string;
  type: SectApplicationType;
  status: SectApplicationStatus;
  applicantPlayerId: string;
  applicantPlayerName: string;
  note?: string | null;
  createdAt: string;
  respondedAt?: string | null;
}

export interface SectMemberView {
  playerId: string;
  playerName: string;
  realmName: string;
  roleKey: SectRoleKey;
  roleLabel: string;
  joinedAt: string;
  lastSeenAt?: string | null;
  isGovernor: boolean;
}

export type SecretRealmSpawnType = "global" | "personal";
export type SecretRealmSizeTier = "small" | "medium" | "large";
export type SecretRealmRarity = "common" | "rare" | "epic" | "legendary";
export type SecretRealmSpecialType = "wild_wolf_valley";
export type SecretRealmTemplateSource = "ai" | "fallback";
export type SecretRealmInstanceStatus = "active" | "settling" | "completed" | "expired" | "abandoned";
export type SecretRealmMonsterRole = "normal" | "elite" | "boss";
export type ItemRarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "hongmeng";
export type SecretRealmLootCategory = "existing_material" | "alchemy_material" | "smithing_material" | "herb_seed" | "equipment";
export type SecretRealmElement = "metal" | "wood" | "water" | "fire" | "earth";
export type SecretRealmAlchemyRoute = "cultivation" | "breakthrough" | "recovery" | "spirit";
export type SecretRealmSeedThemeTag = "forest" | "water" | "pill" | "growth" | "ore" | "ruins";
export type SecretRealmDropStageKey = "lianqi" | "zhuji" | "jiedan" | "yuanying" | "huashen";
export type SecretRealmEquipmentRoute =
  | "sword"
  | "blade"
  | "needle"
  | "robe"
  | "helmet"
  | "boots"
  | "talisman"
  | "shield"
  | "focus";

export interface SecretRealmRewardRoleConfig {
  slotMin: number;
  slotMax: number;
  categoryWeights: Partial<Record<SecretRealmLootCategory, number>>;
  rarityWeights?: Partial<Record<ItemRarity, number>>;
  guaranteedCategories?: SecretRealmLootCategory[];
}

export interface SecretRealmLootBlueprintEntry {
  slotId: string;
  category: SecretRealmLootCategory;
  categoryLabel: string;
  rarity: ItemRarity;
  quantityMin: number;
  quantityMax: number;
  chance: number;
  element?: SecretRealmElement;
  route?: SecretRealmAlchemyRoute | SecretRealmEquipmentRoute;
  dropStageKey?: SecretRealmDropStageKey;
  existingItemId?: string;
  themeTag?: string;
  usageLabel?: string;
  uniquePerPlayer: boolean;
}

export interface SecretRealmLootBlueprint {
  version: number;
  role: SecretRealmMonsterRole;
  theme: string;
  themeTags: string[];
  preferredElements: SecretRealmElement[];
  preferredCategories: SecretRealmLootCategory[];
  entries: SecretRealmLootBlueprintEntry[];
}

export interface SecretRealmPoint {
  x: number;
  y: number;
}

export interface SecretRealmMonsterPlan {
  role: SecretRealmMonsterRole;
  count: number;
  budgetWeight: number;
  labels?: string[];
}

export interface SecretRealmRewardPlan {
  budget: number;
  guaranteedItemIds?: string[];
  weightedItemIds?: string[];
  secretCurrencyAmount?: number;
  dropQualityTags?: string[];
  rarityWeights?: Partial<Record<ItemRarity, number>>;
  categoryWeights?: Partial<Record<SecretRealmLootCategory, number>>;
  roleRewardConfigs?: Partial<Record<SecretRealmMonsterRole, SecretRealmRewardRoleConfig>>;
  themeBiasTags?: string[];
  elementWeights?: Partial<Record<SecretRealmElement, number>>;
}

export interface SecretRealmBossGateStatus {
  isUnlocked: boolean;
  guardRequired: number;
  guardDefeated: number;
  totalNonBossMonsterCount?: number;
  clearRequired: number;
  clearDefeated: number;
  remainingGuardCount: number;
  remainingClearCount: number;
  guardMonsterIds?: string[];
  defeatedGuardMonsterIds?: string[];
  sealedDoorTiles?: TileData[];
  unlockedAt?: string | null;
}

export interface SecretRealmValidationReport {
  passed: boolean;
  source: SecretRealmTemplateSource;
  reasons: string[];
  blockedRatio: number;
  width: number;
  height: number;
}

export interface SecretRealmTemplateSnapshot {
  width: number;
  height: number;
  sizeTier: SecretRealmSizeTier;
  rarity: SecretRealmRarity;
  recommendedRealm: number;
  theme: string;
  introduction: string;
  announcement: string;
  bossBackground: string;
  entryPoint: SecretRealmPoint;
  returnPoint: SecretRealmPoint;
  bossPoint: SecretRealmPoint;
  blockedRatio: number;
  tilesData: TileData[];
  monsterPlan: SecretRealmMonsterPlan[];
  rewardPlan: SecretRealmRewardPlan;
  tags?: string[];
}

export interface SecretRealmRunSummary {
  coreRewardOwnerPlayerId?: string | null;
  participantPlayerIds?: string[];
  pityGrantedPlayerIds?: string[];
  bossMonsterId?: string | null;
  bossDefeatedAt?: string | null;
  defeatedMonsterIds?: string[];
  defeatedMonsterCount?: number;
  lastDefeatedMonsterAt?: string | null;
  monsterRewardClaims?: Record<string, SecretRealmRewardClaimSummary[]>;
  bossGate?: SecretRealmBossGateStatus | null;
}

export interface SecretRealmRewardClaim {
  playerId: string;
  status?: "claimed" | "no_reward";
  xp: number;
  gold: number;
  drops: CombatRewardDrop[];
  grantedItemIds?: string[];
  noRewardReason?: "stamina_empty" | "repeat_guard_blocked";
  recordedAt: string;
}

export interface SecretRealmRewardClaimSummary {
  playerId: string;
  status: "claimed" | "no_reward";
  xp: number;
  gold: number;
  itemCount: number;
  categories?: SecretRealmLootCategory[];
  noRewardReason?: "stamina_empty" | "repeat_guard_blocked";
  recordedAt: string;
}

export interface SecretRealmBossPitySnapshot {
  attempt: number;
  chance: number;
  targetRarity: ItemRarity;
  requiredLegendaryMaterial: boolean;
  triggered: boolean;
  grantedDropItemId?: string;
  grantedDropRarity?: string | null;
  counterAfterSettle: number;
  resetReason?: "legendary_material" | "no_reward" | "not_triggered";
}

export interface SecretRealmHongmengPitySnapshot {
  attempt: number;
  chance: number;
  triggered: boolean;
  grantedDropItemId?: string;
  grantedDropRarity?: string | null;
  counterAfterSettle: number;
  resetReason?: "hongmeng_material" | "legendary_material" | "no_reward" | "not_triggered";
}

export interface SecretRealmRewardSnapshot {
  xp: number;
  gold: number;
  drops: CombatRewardDrop[];
  grantedItemIds?: string[];
  noRewardReason?: "stamina_empty" | "repeat_guard_blocked";
  bossPity?: SecretRealmBossPitySnapshot;
  legendaryPity?: SecretRealmBossPitySnapshot;
  hongmengPity?: SecretRealmHongmengPitySnapshot;
  wildWolfValleyBottle?: {
    ownedBeforeRoll: boolean;
    role: SecretRealmMonsterRole;
    chance: number;
    counterBefore: number;
    counterAfter: number;
    granted: boolean;
    grantedItemId?: string;
  };
}

/** 战斗中的状态效果实例 */
export interface ActiveEffect {
  type: string;
  value: number;
  remainingTurns: number;
  sourceSkillId: string;
}

/** 战斗中的角色 */
export interface CombatUnit {
  id: string;
  name: string;
  isPlayer: boolean;
  realm?: number | null;
  avatarImageUrl?: string | null;
  avatarFrameImageUrl?: string | null;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  spiritualSense: number;
  armorPenetration: number;
  block: number;
  skillDamageBonus: number;
  skillDamageReduction: number;
  artifactDamageBonus: number;
  artifactDamageReduction: number;
  skills: string[];
  skillCooldowns: Record<string, number>;
  activeEffects: ActiveEffect[];
  isStunned: boolean;
  /** 装备词条带来的额外暴击率（0~1），不参与属性面板展示。 */
  critBonus?: number;
  /** 装备词条带来的额外格挡率（0~1）。 */
  blockBonus?: number;
}

/** 战斗行动 */
export interface CombatAction {
  actorId: string;
  type: "skill" | "item" | "flee";
  skillId?: string;
  itemId?: string;
  targetId?: string;
}

export interface ClientActionRequestMeta {
  actionId?: string;
  clientSentAt?: number;
  clientSequence?: number;
  clientSceneTick?: number;
}

/** 战斗日志条目 */
export interface CombatLogEntry {
  turn: number;
  actorName: string;
  action: string;
  entryType?: "skill" | "item" | "status" | "flee" | "system";
  actorId?: string;
  targetId?: string;
  skillId?: string;
  skillName?: string;
  damage?: number;
  heal?: number;
  resultType?: "miss" | "graze";
  resultLabel?: string;
  effects?: string[];
  visualEffect?: CombatSkillVisualEffect | null;
  actorCurrentHp?: number;
  actorCurrentMp?: number;
  targetCurrentHp?: number;
  targetCurrentMp?: number;
  actorActiveEffects?: ActiveEffect[];
  targetActiveEffects?: ActiveEffect[];
  message: string;
}

export interface CombatTurnState {
  turnOrder: string[];
  currentTurnPlayerId: string | null;
  turnIndex: number;
  turnDeadlineAt: string | null;
  eligibleMemberIds?: string[];
}

export type BattleMode = "solo" | "party" | "boss" | "pvp";

export type BattleRuntimeState = "preparing" | "active" | "settling" | "finished" | "closed";

export type BattleRealtimeEnvelopeType =
  | "connected"
  | "scene_snapshot"
  | "snapshot_full"
  | "snapshot_delta"
  | "snapshot_repair"
  | "event"
  | "settlement"
  | "runtime_closed"
  | "error";

export interface BattleParticipantSummary {
  id: string;
  name: string;
  role: "player" | "enemy" | "boss";
  slot?: number | null;
  currentHp?: number;
  maxHp?: number;
  currentMp?: number;
  maxMp?: number;
  avatarImageUrl?: string | null;
  avatarFrameImageUrl?: string | null;
  isCurrent?: boolean;
}

export interface BattleViewState {
  runtimeId: string;
  mode: BattleMode;
  runtimeState: BattleRuntimeState;
  title: string;
  subtitle?: string | null;
  statusText?: string | null;
  hero?: BattleParticipantSummary | null;
  target?: BattleParticipantSummary | null;
  participants: BattleParticipantSummary[];
  turnState?: CombatTurnState | null;
  sceneSnapshot?: BattleSceneSnapshot | null;
  modePayload?: Record<string, unknown> | null;
}

export type BattleCommandType =
  | "move"
  | "target"
  | "cast_skill"
  | "use_item"
  | "ready"
  | "timeoutAdvance"
  | "flee"
  | "surrender"
  | "ack_snapshot"
  | "request_repair";

export type BattleSettlementPolicy = "instant" | "claim_based" | "shared_reward" | "replay_only";

export interface BattleSpatialState {
  enabled: boolean;
  contactRangePercent: number;
  movementLocked?: boolean;
  lastResolvedAt?: string | null;
}

export interface BattleMovementCommand {
  directionX?: number;
  directionY?: number;
  distancePercent?: number;
  dash?: boolean;
}

export interface BattleHitWindow {
  windupMs: number;
  activeMs: number;
  recoverMs: number;
  movementLockMs?: number;
}

export interface BattleCollisionProfile {
  enabled: boolean;
  entityBlocking: boolean;
  mapBoundaryBlocking: boolean;
  separationPercent: number;
}

export interface BattleRuleset {
  mode: BattleMode;
  label: string;
  sharedTurn: boolean;
  supportsRealtime: boolean;
  allowedCommands: BattleCommandType[];
  spatialPolicy?: {
    enabled: boolean;
    supportsMovement: boolean;
    supportsContactRange: boolean;
    defaultContactRangePercent: number;
    defaultHitWindow: BattleHitWindow;
  };
  collisionPolicy?: BattleCollisionProfile;
  timeoutPolicy?: {
    turnTimeoutMs: number;
    repairOnReconnect: boolean;
    autoAdvanceOnTimeout: boolean;
  };
  settlementPolicy: BattleSettlementPolicy;
}

export interface BattleCommand {
  runtimeId: string;
  mode: BattleMode;
  type: BattleCommandType;
  actorId?: string | null;
  targetId?: string | null;
  payload?: Record<string, unknown> | null;
  actionId?: string | null;
  clientSentAt?: number;
  clientSequence?: number;
  clientSceneTick?: number;
}

export interface BattleRuntime {
  runtimeId: string;
  mode: BattleMode;
  state: BattleRuntimeState;
  sceneVersion: number;
  tick: number;
  ruleset: BattleRuleset;
  participants: BattleParticipantSummary[];
  battleView?: BattleViewState | null;
  turnState?: CombatTurnState | null;
  sceneSnapshot?: BattleSceneSnapshot | null;
  settlement?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
}

export interface BattleCommandResult {
  accepted: boolean;
  runtimeId: string;
  mode: BattleMode;
  command?: BattleCommand | null;
  battleRuntime?: BattleRuntime | null;
  battleView?: BattleViewState | null;
  acceptedClientSequence?: number;
  serverSceneTick?: number;
  errorCode?: string;
  message?: string;
  payload?: Record<string, unknown> | null;
}

export interface BattleRealtimeEnvelope<TPayload = Record<string, unknown>> {
  type: BattleRealtimeEnvelopeType;
  runtimeId: string;
  mode: BattleMode;
  codec?: "json" | "msgpack";
  codecFallbackReason?: string;
  sceneSnapshot?: BattleSceneSnapshot | null;
  turnState?: CombatTurnState | null;
  payload?: TPayload | null;
  errorCode?: string;
  message?: string;
}

export interface CombatRewardDrop {
  itemId: string;
  itemName: string;
  itemIconUrl?: string | null;
  quantity: number;
  itemRarity?: string | null;
  itemSourceType?: string | null;
  itemCategoryLabel?: string | null;
}

export interface CombatRewards {
  xp: number;
  gold: number;
  drops: CombatRewardDrop[];
}

export interface CombatSettleResultSnapshot {
  xp?: number;
  gold?: number;
  drops?: CombatRewardDrop[];
  stamina?: number;
  noRewardReason?: "stamina_empty" | "repeat_guard_blocked";
  antiRepeatGuard?: CombatRepeatGuardPayload | null;
  died?: boolean;
  fled?: boolean;
  newRealm?: number;
  message?: string;
}

export interface CombatRepeatGuardPayload {
  status: "probe_required" | "reward_blocked";
  patternType: "same_monster" | "alternating_pair";
  repeatCount: number;
  monsterIds: string[];
  message: string;
}

export interface PartyCombatRewardEntry {
  playerId: string;
  playerName: string;
  xp: number;
  gold: number;
  isLastHit: boolean;
  rewarded?: boolean;
  staminaCost?: number;
  staminaAfter?: number;
  noRewardReason?: "stamina_empty" | "repeat_guard_blocked";
  antiRepeatGuard?: CombatRepeatGuardPayload;
  drops?: CombatRewardDrop[];
}

/** 战斗状态 */
export interface CombatState {
  id: string;
  turn: number;
  player: CombatUnit;
  enemy: CombatUnit;
  mode?: BattleMode;
  participants?: CombatUnit[];
  currentTurnPlayerId?: string | null;
  turnOrder?: string[];
  turnIndex?: number;
  turnDeadlineAt?: string | null;
  eligibleMemberIds?: string[];
  log: CombatLogEntry[];
  status: "ongoing" | "player_win" | "enemy_win" | "fled";
  rewards?: CombatRewards | PartyCombatRewardEntry[];
  settledPlayerIds?: string[];
  settleResultsByPlayerId?: Record<string, CombatSettleResultSnapshot>;
}

/** Boss SSE 事件 */
export interface PvpReplayData {
  combatId: string;
  mapId: string;
  turns: number;
  result: "win" | "lose";
  winner: {
    id: string;
    name: string;
  };
  loser: {
    id: string;
    name: string;
  };
  playbackRate: number;
  initialState: {
    player: CombatUnit;
    enemy: CombatUnit;
  };
  state: CombatState;
}

export interface BossParticipant {
  playerId: string;
  playerName: string;
  slot: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  skillCooldowns?: Record<string, number>;
  avatarImageUrl?: string | null;
  avatarFrameImageUrl?: string | null;
  joinedAt?: string;
  activeEffects?: ActiveEffect[];
}

export interface BossEvent {
  type: "hp_update" | "boss_dead" | "boss_spawn" | "damage_dealt" | "participants_update";
  bossId: string;
  currentHp?: number;
  maxHp?: number;
  playerId?: string;
  lastHitPlayer?: string;
  playerDamage?: number;
  playerName?: string;
  actionType?: "skill" | "item";
  skillId?: string;
  skillName?: string;
  skillOutcome?: "damage" | "heal" | "utility";
  recoveredHp?: number;
  recoveredMp?: number;
  bossCounterDamage?: number;
  bossCounterSkillName?: string | null;
  bossCounterResults?: {
    playerId: string;
    playerName: string;
    slot?: number | null;
    damage: number;
    currentHp?: number;
    currentMp?: number;
    died?: boolean;
  }[];
  visualEffect?: CombatSkillVisualEffect | null;
  respawnRemainingSeconds?: number;
  participants?: BossParticipant[];
  turnState?: CombatTurnState | null;
  bossNextIntent?: {
    skillId?: string | null;
    skillName?: string | null;
    targetType?: "single" | "all_enemies";
  } | null;
  rewards?: PartyCombatRewardEntry[];
  sceneSnapshot?: BattleSceneSnapshot | null;
}

/** API 通用响应 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

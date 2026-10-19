import type {
  NotificationBadgeHookInput,
  PlayerProfileAction,
  PlayerProfileBottomContent,
  PlayerProfileExtendHookInput,
  PlayerStatsBonus,
  PlayerStatsBonusHookInput,
  RandomEventActionDefinition,
  RandomEventActionHookInput,
  RandomEventActionHookResult,
  RandomEventActionVariableOptionsHookInput,
  RandomEventActionVariableOptionsHookResult,
  RandomEventJudgeResult,
} from "@/modules/shared/types/legacy-plugin";

const EMPTY_PLAYER_STATS_BONUS: PlayerStatsBonus = {
  maxHp: 0,
  maxMp: 0,
  attack: 0,
  defense: 0,
  speed: 0,
  luck: 0,
  spiritualSense: 0,
  armorPenetration: 0,
  block: 0,
  skillDamageBonus: 0,
  skillDamageReduction: 0,
  artifactDamageBonus: 0,
  artifactDamageReduction: 0,
};

function cloneEmptyPlayerStatsBonus(): PlayerStatsBonus {
  return { ...EMPTY_PLAYER_STATS_BONUS };
}

export async function collectPlayerStatsBonusByPlugins(
  input: PlayerStatsBonusHookInput,
): Promise<PlayerStatsBonus> {
  void input;
  return cloneEmptyPlayerStatsBonus();
}

export async function collectPlayersStatsBonusMapByPlugins(
  playerIds: string[],
): Promise<Map<string, PlayerStatsBonus>> {
  void playerIds;
  return new Map();
}

export async function extendPlayerProfileByPlugins(
  input: PlayerProfileExtendHookInput,
): Promise<Record<string, unknown>> {
  void input;
  return {};
}

export async function collectPlayerProfileActionsByPlugins(
  input: PlayerProfileExtendHookInput,
): Promise<PlayerProfileAction[]> {
  void input;
  return [];
}

export async function collectPlayerProfileBottomContentsByPlugins(
  input: PlayerProfileExtendHookInput,
): Promise<PlayerProfileBottomContent[]> {
  void input;
  return [];
}

export async function collectNotificationBadgesByPlugins(
  input: NotificationBadgeHookInput,
): Promise<Record<string, number>> {
  void input;
  return {};
}

export async function collectRandomEventActionDefinitionsByPlugins(): Promise<RandomEventActionDefinition[]> {
  return [];
}

export async function collectRandomEventActionVariableOptionsByPlugins(
  input: RandomEventActionVariableOptionsHookInput,
): Promise<RandomEventActionVariableOptionsHookResult> {
  void input;
  return {
    variables: {},
    variableMeta: {},
  };
}

export async function executeRandomEventActionByPlugins(
  input: RandomEventActionHookInput,
): Promise<{
  pluginId: string;
  result: RandomEventActionHookResult;
} | null> {
  void input;
  return null;
}

export async function judgeRandomEventByPlugins(params: {
  playerId: string;
  eventId: string;
  eventType: string;
  pluginConditions: Record<string, unknown>;
}): Promise<RandomEventJudgeResult> {
  void params.playerId;
  void params.eventId;
  void params.eventType;

  const legacyConditionKeys = Object.keys(params.pluginConditions || {}).filter((key) => key.trim());
  if (legacyConditionKeys.length < 1) {
    return { passed: true };
  }

  return {
    passed: false,
    failedPluginId: legacyConditionKeys[0],
    reason: "插件判定 Hook 已退役，请将该奇遇条件迁入核心随机事件规则。",
  };
}

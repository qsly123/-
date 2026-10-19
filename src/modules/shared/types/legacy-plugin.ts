import type { RandomEventRewardAction } from "@/types/game";

export interface PlayerProfileExtendHookInput {
  viewerPlayerId: string;
  targetPlayerId: string;
  scope: "self" | "nearby" | "public";
}

export interface NotificationBadgeHookInput {
  playerId: string;
}

export interface PlayerStatsBonusHookInput {
  playerId: string;
}

export interface PlayerStatsBonus {
  maxHp: number;
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
}

export interface PlayerProfileAction {
  id: string;
  pluginId: string;
  label: string;
  content?: string;
  contentType?: "text" | "html" | "url";
  contentUrl?: string;
  color?: string;
  title?: string;
  modalWidth?: number;
  modalHeight?: number;
}

export interface PlayerProfileBottomContent {
  id: string;
  pluginId: string;
  title?: string;
  subtitle?: string;
  contentType?: "text" | "html" | "url";
  content?: string;
  contentUrl?: string;
  height?: number;
}

export interface ActivityPageBottomContent {
  id: string;
  pluginId: string;
  title?: string;
  subtitle?: string;
  contentType?: "text" | "html" | "url";
  content?: string;
  contentUrl?: string;
  height?: number;
}

export interface RandomEventActionHookInput {
  playerId: string;
  action: RandomEventRewardAction;
  aiVariables?: Record<string, string> | null;
}

export interface RandomEventActionHookResult {
  handled: boolean;
  view?: {
    type: string;
    label?: string;
    [key: string]: unknown;
  };
}

export interface RandomEventActionDefinition {
  type: string;
  label: string;
}

export interface RandomEventActionVariableOptionsHookInput {
  playerId: string;
  actions: RandomEventRewardAction[];
  variableKeys: string[];
}

export interface RandomEventActionVariableOptionMeta {
  targetKind?: "player" | "monster";
  promptHint?: string;
}

export interface RandomEventActionVariableOptionsHookResult {
  variables: Record<string, string[]>;
  variableMeta: Record<string, RandomEventActionVariableOptionMeta>;
}

export interface RandomEventJudgeResult {
  passed: boolean;
  failedPluginId?: string;
  reason?: string;
}

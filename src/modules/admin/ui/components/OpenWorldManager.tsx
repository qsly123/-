"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Col,
  Collapse,
  Divider,
  Input,
  InputNumber,
  Progress,
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import ScrollableContent from "@/modules/shared/ui/components/ScrollableContent";
import {
  OPEN_WORLD_LLM_CONFIG_KEYS,
  OPEN_WORLD_PROMPT_CONFIG_KEYS,
  OPEN_WORLD_RULE_CONFIG_KEYS,
  OPEN_WORLD_SYSTEM_CONFIG_KEYS,
  OPEN_WORLD_TEMPLATE_CONFIG_KEYS,
  OPEN_WORLD_WORLDBOOK_CONFIG_KEYS,
  SYSTEM_CONFIG_ITEMS,
  type SystemConfigItem,
} from "@/modules/system/services/system-config-keys";

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

const OPEN_WORLD_OPTIONAL_JSON_KEYS = new Set([
  "OPEN_WORLD_WORLDBOOK_JSON",
  "OPEN_WORLD_KEYWORD_POOL_JSON",
  "OPEN_WORLD_PRESSURE_RELIEF_RULES_JSON",
  "OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON",
]);

const OPEN_WORLD_LARGE_JSON_KEYS = new Set([
  "OPEN_WORLD_WORLDBOOK_JSON",
  "OPEN_WORLD_KEYWORD_POOL_JSON",
  "OPEN_WORLD_PRESSURE_RELIEF_RULES_JSON",
  "OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON",
]);

function resolveWorldBookPlaceholder(key: string) {
  if (key === "OPEN_WORLD_KEYWORD_POOL_JSON") {
    return "编辑开放世界关键词池 JSON";
  }
  if (key === "OPEN_WORLD_PRESSURE_RELIEF_RULES_JSON") {
    return "编辑压力消退与高堕落强制规则 JSON";
  }
  if (key === "OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON") {
    return "编辑自定义 NPC 库 JSON";
  }
  return "粘贴 SillyTavern 世界书 JSON";
}

type SystemConfigRow = {
  id: string;
  key: string;
  value: string;
  group: string;
  isSecret: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

type SystemConfigExportRow = {
  key: string;
  value: string;
  group: string;
  isSecret: boolean;
  description: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type SystemConfigItemsResponse = {
  success: boolean;
  data?: {
    items: SystemConfigItem[];
  };
  error?: string;
};

type SystemConfigMutationResponse = {
  success: boolean;
  error?: string;
};

type OpenWorldSchemaStatus = {
  ready: boolean;
  baseTableReady: boolean;
  nearbyDistrictColumnReady: boolean;
  bootstrapMode: "unknown" | "existing" | "bootstrapped" | "patched" | "failed";
  appliedFiles: string[];
  checkedAt: string | null;
  fallbackReason: string | null;
};

type OpenWorldDashboardSummary = {
  tiandaoStatus: string;
  worldTime: string;
  activeMapCount: number;
  activeNpcCount: number;
  aliveNpcCount: number;
  todayEventCount: number;
  aiHealth: string;
};

type OpenWorldStatusResponse = {
  success: boolean;
  data?: {
    schemaStatus: OpenWorldSchemaStatus;
    dashboardSummary: OpenWorldDashboardSummary;
  };
  error?: string;
};

type OpenWorldAiPreviewResponse = {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
};

type OpenWorldRebuildResponse = {
  success: boolean;
  data?: {
    jobId: string | null;
    status: "idle" | "running" | "completed" | "failed";
    startedAt: string | null;
    finishedAt: string | null;
    phase: string;
    phaseLabel: string;
    detail: string;
    current: number;
    total: number;
    progressPercent: number;
    summary: {
      rebuilt: boolean;
      mapCount: number;
      rumorRefreshCount: number;
      refreshedFactionCount: number;
      refreshedDistrictCount: number;
      refreshedStorylineCount: number;
      rebuiltAt: string;
    } | null;
    error: string | null;
    logs: Array<{
      at: string;
      phase: string;
      phaseLabel: string;
      detail: string;
    }>;
  };
  error?: string;
};

type OpenWorldFactionOverview = {
  factions: Array<{
    id: string;
    name: string;
    categoryLabel: string;
    standingSummary: string;
    updatedAt: string;
  }>;
  districtStates: Array<{
    id: string;
    districtName: string;
    dominantFactionName: string;
    tensionTag: string;
    updatedAt: string;
  }>;
  storylines: Array<{
    id: string;
    districtName: string;
    stageTitle: string;
    sourceFactionName: string;
    status: string;
    updatedAt: string;
  }>;
};

type OpenWorldFactionOverviewResponse = {
  success: boolean;
  data?: OpenWorldFactionOverview;
  error?: string;
};

type OpenWorldMapNetworkOverview = {
  summary: {
    totalMapCount: number;
    hotMapCount: number;
    warmMapCount: number;
    coldMapCount: number;
  };
  regionBands: Array<{
    regionBand: string;
    mapCount: number;
    hotCount: number;
    warmCount: number;
    coldCount: number;
    averageDangerLevel: number;
    averageMysteryLevel: number;
    anchorMaps: string[];
  }>;
  maps: Array<{
    id: string;
    name: string;
    regionBand: string;
    heatTier: "hot" | "warm" | "cold";
    heatTierLabel: string;
    heatScore: number;
    dangerLevel: number;
    mysteryLevel: number;
    travelConnections: Array<{
      role: "main" | "return" | "branch";
      targetMapId: string;
      targetMapName: string;
      travelType: "portal" | "road" | "rift";
      label: string;
      summary: string;
      heatTierHint: string;
    }>;
    rumorHookCount: number;
    encounterHookCount: number;
    secretRealmHookCount: number;
  }>;
  explorationDensity: {
    rumorHookCount: number;
    encounterHookCount: number;
    secretRealmHookCount: number;
  };
};

type OpenWorldMapNetworkOverviewResponse = {
  success: boolean;
  data?: OpenWorldMapNetworkOverview;
  error?: string;
};

type OpenWorldPromptPreviewType =
  | "worldbook_context"
  | "keyword_pool"
  | "custom_npc_library"
  | "map_meta"
  | "npc_dna"
  | "custom_npc"
  | "npc_bark"
  | "tiandao_event"
  | "district_rumor"
  | "faction_tone"
  | "district_state"
  | "storyline"
  | "npc_faction_hint"
  | "shadow_event"
  | "pressure_relief"
  | "adult_profile"
  | "adult_invite"
  | "adult_accept"
  | "adult_reject"
  | "adult_result"
  | "corruption_growth"
  | "adult_rumor"
  | "forced_consequence"
  | "partner_jealousy";

type OpenWorldPromptGroup = {
  id: string;
  title: string;
  description: string;
  keys: readonly string[];
};

const OPEN_WORLD_PROMPT_GROUPS: readonly OpenWorldPromptGroup[] = [
  {
    id: "style",
    title: "世界总文风",
    description: "统一开放世界整体气质、负面约束与灰度修仙界口风。",
    keys: ["OPEN_WORLD_STYLE_MASTER_PROMPT", "OPEN_WORLD_STYLE_NEGATIVE_PROMPT"],
  },
  {
    id: "map",
    title: "地图与街区",
    description: "地图主题、街区风闻与地图层面的世界口吻。",
    keys: [
      "OPEN_WORLD_MAP_PROMPT",
      "OPEN_WORLD_MAP_RULE",
      "OPEN_WORLD_MAP_TEMPLATE_JSON",
      "OPEN_WORLD_DISTRICT_RUMOR_PROMPT",
      "OPEN_WORLD_DISTRICT_RUMOR_RULE",
      "OPEN_WORLD_DISTRICT_RUMOR_TEMPLATE_JSON",
      "OPEN_WORLD_DYNAMIC_VISITOR_PROMPT",
    ],
  },
  {
    id: "faction",
    title: "势力与街区",
    description: "势力口风、街区局势、故事链推进与 NPC 势力气息。",
    keys: [
      "OPEN_WORLD_FACTION_TONE_PROMPT",
      "OPEN_WORLD_FACTION_TONE_RULE",
      "OPEN_WORLD_FACTION_TONE_TEMPLATE_JSON",
      "OPEN_WORLD_DISTRICT_STATE_PROMPT",
      "OPEN_WORLD_DISTRICT_STATE_RULE",
      "OPEN_WORLD_DISTRICT_STATE_TEMPLATE_JSON",
      "OPEN_WORLD_STORYLINE_PROMPT",
      "OPEN_WORLD_STORYLINE_RULE",
      "OPEN_WORLD_STORYLINE_TEMPLATE_JSON",
      "OPEN_WORLD_NPC_FACTION_HINT_PROMPT",
      "OPEN_WORLD_NPC_FACTION_HINT_RULE",
      "OPEN_WORLD_NPC_FACTION_HINT_TEMPLATE_JSON",
    ],
  },
  {
    id: "npc",
    title: "NPC 画像与人生",
    description: "NPC DNA、关系、人生日志与附近口风。",
    keys: [
      "OPEN_WORLD_NPC_DNA_PROMPT",
      "OPEN_WORLD_NPC_DNA_RULE",
      "OPEN_WORLD_NPC_NAME_RULE",
      "OPEN_WORLD_NPC_DNA_TEMPLATE_JSON",
      "OPEN_WORLD_KEYWORD_POOL_PROMPT",
      "OPEN_WORLD_KEYWORD_POOL_RULE",
      "OPEN_WORLD_KEYWORD_POOL_TEMPLATE_JSON",
      "OPEN_WORLD_CUSTOM_NPC_LIBRARY_PROMPT",
      "OPEN_WORLD_CUSTOM_NPC_LIBRARY_RULE",
      "OPEN_WORLD_CUSTOM_NPC_LIBRARY_TEMPLATE_JSON",
      "OPEN_WORLD_CUSTOM_NPC_PROMPT",
      "OPEN_WORLD_CUSTOM_NPC_PREVIEW_RULE",
      "OPEN_WORLD_CUSTOM_NPC_PREVIEW_TEMPLATE_JSON",
      "OPEN_WORLD_NPC_RELATION_PROMPT",
      "OPEN_WORLD_NPC_LIFE_LOG_PROMPT",
      "OPEN_WORLD_NPC_BARK_PROMPT",
      "OPEN_WORLD_NPC_BARK_RULE",
      "OPEN_WORLD_NPC_BARK_TEMPLATE_JSON",
    ],
  },
  {
    id: "tiandao",
    title: "天道与风闻",
    description: "天道播报、风声刷新与压力风味描述。",
    keys: [
      "OPEN_WORLD_TIANDAO_EVENT_PROMPT",
      "OPEN_WORLD_TIANDAO_EVENT_RULE",
      "OPEN_WORLD_TIANDAO_EVENT_TEMPLATE_JSON",
      "OPEN_WORLD_WORLD_PRESSURE_FLAVOR_PROMPT",
    ],
  },
  {
    id: "shadow",
    title: "灰色势力",
    description: "黑市、暗线、魔修与灰色修仙界邀约口风。",
    keys: [
      "OPEN_WORLD_SHADOW_EVENT_PROMPT",
      "OPEN_WORLD_SHADOW_EVENT_RULE",
      "OPEN_WORLD_SHADOW_EVENT_TEMPLATE_JSON",
      "OPEN_WORLD_PRESSURE_RELIEF_PROMPT",
      "OPEN_WORLD_PRESSURE_RELIEF_RULE",
      "OPEN_WORLD_PRESSURE_RELIEF_TEMPLATE_JSON",
      "OPEN_WORLD_RUMOR_SILENCE_PROMPT",
      "OPEN_WORLD_LAWFUL_MEDIATION_PROMPT",
    ],
  },
  {
    id: "adult",
    title: "成人互动",
    description: "成年人之间的试探、接受、拒绝、结果与相关短句。",
    keys: [
      "OPEN_WORLD_ADULT_PROFILE_PROMPT",
      "OPEN_WORLD_ADULT_PROFILE_RULE",
      "OPEN_WORLD_ADULT_PROFILE_TEMPLATE_JSON",
      "OPEN_WORLD_ADULT_INVITE_PROMPT",
      "OPEN_WORLD_ADULT_INVITE_RULE",
      "OPEN_WORLD_ADULT_INVITE_TEMPLATE_JSON",
      "OPEN_WORLD_ADULT_ACCEPT_PROMPT",
      "OPEN_WORLD_ADULT_REJECT_PROMPT",
      "OPEN_WORLD_ADULT_RESULT_PROMPT",
      "OPEN_WORLD_ADULT_RESULT_RULE",
      "OPEN_WORLD_ADULT_RESULT_TEMPLATE_JSON",
      "OPEN_WORLD_ADULT_BARK_PROMPT",
      "OPEN_WORLD_ADULT_BARK_RULE",
      "OPEN_WORLD_ADULT_BARK_TEMPLATE_JSON",
      "OPEN_WORLD_CONSENSUAL_DUAL_CULTIVATION_PROMPT",
      "OPEN_WORLD_FORCED_CONSEQUENCE_PROMPT",
      "OPEN_WORLD_FORCED_CONSEQUENCE_RULE",
      "OPEN_WORLD_FORCED_CONSEQUENCE_TEMPLATE_JSON",
      "OPEN_WORLD_PARTNER_JEALOUSY_PROMPT",
      "OPEN_WORLD_PARTNER_JEALOUSY_RULE",
      "OPEN_WORLD_PARTNER_JEALOUSY_TEMPLATE_JSON",
    ],
  },
  {
    id: "pregnancy",
    title: "采补与孕育",
    description: "采补、孕育命数与相关余波提示。",
    keys: [
      "OPEN_WORLD_ADULT_DRAIN_PROMPT",
      "OPEN_WORLD_ADULT_PREGNANCY_PROMPT",
      "OPEN_WORLD_ADULT_RUMOR_PROMPT",
      "OPEN_WORLD_ADULT_RUMOR_RULE",
      "OPEN_WORLD_ADULT_RUMOR_TEMPLATE_JSON",
    ],
  },
  {
    id: "corruption",
    title: "堕落与关系",
    description: "堕落成长、危险偏好与关系后的长期余波。",
    keys: [
      "OPEN_WORLD_CORRUPTION_GROWTH_PROMPT",
      "OPEN_WORLD_CORRUPTION_GROWTH_RULE",
      "OPEN_WORLD_CORRUPTION_GROWTH_TEMPLATE_JSON",
    ],
  },
];

const OPEN_WORLD_PROMPT_PREVIEW_BY_KEY: Record<string, OpenWorldPromptPreviewType> = {
  OPEN_WORLD_WORLDBOOK_ENABLED: "worldbook_context",
  OPEN_WORLD_WORLDBOOK_JSON: "worldbook_context",
  OPEN_WORLD_KEYWORD_POOL_PROMPT: "keyword_pool",
  OPEN_WORLD_CUSTOM_NPC_LIBRARY_PROMPT: "custom_npc_library",
  OPEN_WORLD_STYLE_MASTER_PROMPT: "adult_result",
  OPEN_WORLD_STYLE_NEGATIVE_PROMPT: "adult_result",
  OPEN_WORLD_MAP_PROMPT: "map_meta",
  OPEN_WORLD_MAP_RULE: "map_meta",
  OPEN_WORLD_MAP_TEMPLATE_JSON: "map_meta",
  OPEN_WORLD_NPC_DNA_PROMPT: "npc_dna",
  OPEN_WORLD_NPC_DNA_RULE: "npc_dna",
  OPEN_WORLD_NPC_NAME_RULE: "npc_dna",
  OPEN_WORLD_NPC_DNA_TEMPLATE_JSON: "npc_dna",
  OPEN_WORLD_CUSTOM_NPC_PROMPT: "custom_npc",
  OPEN_WORLD_CUSTOM_NPC_PREVIEW_RULE: "custom_npc",
  OPEN_WORLD_CUSTOM_NPC_PREVIEW_TEMPLATE_JSON: "custom_npc",
  OPEN_WORLD_DYNAMIC_VISITOR_PROMPT: "npc_bark",
  OPEN_WORLD_NPC_RELATION_PROMPT: "npc_dna",
  OPEN_WORLD_NPC_LIFE_LOG_PROMPT: "npc_dna",
  OPEN_WORLD_TIANDAO_EVENT_PROMPT: "tiandao_event",
  OPEN_WORLD_TIANDAO_EVENT_RULE: "tiandao_event",
  OPEN_WORLD_TIANDAO_EVENT_TEMPLATE_JSON: "tiandao_event",
  OPEN_WORLD_NPC_BARK_PROMPT: "npc_bark",
  OPEN_WORLD_NPC_BARK_RULE: "npc_bark",
  OPEN_WORLD_NPC_BARK_TEMPLATE_JSON: "npc_bark",
  OPEN_WORLD_DISTRICT_RUMOR_PROMPT: "district_rumor",
  OPEN_WORLD_DISTRICT_RUMOR_RULE: "district_rumor",
  OPEN_WORLD_DISTRICT_RUMOR_TEMPLATE_JSON: "district_rumor",
  OPEN_WORLD_FACTION_TONE_PROMPT: "faction_tone",
  OPEN_WORLD_FACTION_TONE_RULE: "faction_tone",
  OPEN_WORLD_FACTION_TONE_TEMPLATE_JSON: "faction_tone",
  OPEN_WORLD_DISTRICT_STATE_PROMPT: "district_state",
  OPEN_WORLD_DISTRICT_STATE_RULE: "district_state",
  OPEN_WORLD_DISTRICT_STATE_TEMPLATE_JSON: "district_state",
  OPEN_WORLD_STORYLINE_PROMPT: "storyline",
  OPEN_WORLD_STORYLINE_RULE: "storyline",
  OPEN_WORLD_STORYLINE_TEMPLATE_JSON: "storyline",
  OPEN_WORLD_NPC_FACTION_HINT_PROMPT: "npc_faction_hint",
  OPEN_WORLD_NPC_FACTION_HINT_RULE: "npc_faction_hint",
  OPEN_WORLD_NPC_FACTION_HINT_TEMPLATE_JSON: "npc_faction_hint",
  OPEN_WORLD_SHADOW_EVENT_PROMPT: "shadow_event",
  OPEN_WORLD_SHADOW_EVENT_RULE: "shadow_event",
  OPEN_WORLD_SHADOW_EVENT_TEMPLATE_JSON: "shadow_event",
  OPEN_WORLD_PRESSURE_RELIEF_PROMPT: "pressure_relief",
  OPEN_WORLD_PRESSURE_RELIEF_RULE: "pressure_relief",
  OPEN_WORLD_PRESSURE_RELIEF_TEMPLATE_JSON: "pressure_relief",
  OPEN_WORLD_RUMOR_SILENCE_PROMPT: "pressure_relief",
  OPEN_WORLD_LAWFUL_MEDIATION_PROMPT: "pressure_relief",
  OPEN_WORLD_ADULT_PROFILE_PROMPT: "adult_profile",
  OPEN_WORLD_ADULT_PROFILE_RULE: "adult_profile",
  OPEN_WORLD_ADULT_PROFILE_TEMPLATE_JSON: "adult_profile",
  OPEN_WORLD_ADULT_INVITE_PROMPT: "adult_invite",
  OPEN_WORLD_ADULT_INVITE_RULE: "adult_invite",
  OPEN_WORLD_ADULT_INVITE_TEMPLATE_JSON: "adult_invite",
  OPEN_WORLD_ADULT_ACCEPT_PROMPT: "adult_accept",
  OPEN_WORLD_ADULT_REJECT_PROMPT: "adult_reject",
  OPEN_WORLD_ADULT_RESULT_PROMPT: "adult_result",
  OPEN_WORLD_ADULT_RESULT_RULE: "adult_result",
  OPEN_WORLD_ADULT_RESULT_TEMPLATE_JSON: "adult_result",
  OPEN_WORLD_CONSENSUAL_DUAL_CULTIVATION_PROMPT: "pressure_relief",
  OPEN_WORLD_FORCED_CONSEQUENCE_PROMPT: "forced_consequence",
  OPEN_WORLD_FORCED_CONSEQUENCE_RULE: "forced_consequence",
  OPEN_WORLD_FORCED_CONSEQUENCE_TEMPLATE_JSON: "forced_consequence",
  OPEN_WORLD_PARTNER_JEALOUSY_PROMPT: "partner_jealousy",
  OPEN_WORLD_PARTNER_JEALOUSY_RULE: "partner_jealousy",
  OPEN_WORLD_PARTNER_JEALOUSY_TEMPLATE_JSON: "partner_jealousy",
  OPEN_WORLD_ADULT_DRAIN_PROMPT: "adult_result",
  OPEN_WORLD_ADULT_PREGNANCY_PROMPT: "adult_result",
  OPEN_WORLD_ADULT_RUMOR_PROMPT: "adult_rumor",
  OPEN_WORLD_ADULT_RUMOR_RULE: "adult_rumor",
  OPEN_WORLD_ADULT_RUMOR_TEMPLATE_JSON: "adult_rumor",
  OPEN_WORLD_ADULT_BARK_PROMPT: "adult_invite",
  OPEN_WORLD_ADULT_BARK_RULE: "adult_invite",
  OPEN_WORLD_ADULT_BARK_TEMPLATE_JSON: "adult_invite",
  OPEN_WORLD_CORRUPTION_GROWTH_PROMPT: "corruption_growth",
  OPEN_WORLD_CORRUPTION_GROWTH_RULE: "corruption_growth",
  OPEN_WORLD_CORRUPTION_GROWTH_TEMPLATE_JSON: "corruption_growth",
  OPEN_WORLD_WORLD_PRESSURE_FLAVOR_PROMPT: "shadow_event",
  OPEN_WORLD_KEYWORD_POOL_RULE: "keyword_pool",
  OPEN_WORLD_KEYWORD_POOL_TEMPLATE_JSON: "keyword_pool",
  OPEN_WORLD_CUSTOM_NPC_LIBRARY_RULE: "custom_npc_library",
  OPEN_WORLD_CUSTOM_NPC_LIBRARY_TEMPLATE_JSON: "custom_npc_library",
};

function formatDateTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function buildPreviewText(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) {
    return "未配置";
  }
  return clean.length > 88 ? `${clean.slice(0, 88)}...` : clean;
}

function formatTaskCounter(current: number, total: number) {
  if (!Number.isFinite(total) || total <= 0) {
    return "-";
  }
  return `${Math.max(0, current)}/${total}`;
}

function OpenWorldMetricCard({
  title,
  value,
  detail,
  tag,
}: {
  title: string;
  value: string;
  detail: string;
  tag?: { color: string; label: string };
}) {
  return (
    <Card size="small" style={{ height: "100%" }}>
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <Space wrap>
          <Text style={{ color: "#b7af9f" }}>{title}</Text>
          {tag ? <DarkTag color={tag.color}>{tag.label}</DarkTag> : null}
        </Space>
        <Title level={4} style={{ margin: 0, color: "#f5e6bf" }}>
          {value}
        </Title>
        <Text style={{ color: "#8d8578", fontSize: 12 }}>{detail}</Text>
      </Space>
    </Card>
  );
}

function OpenWorldPanel({
  title,
  tag,
  summary,
  items,
}: {
  title: string;
  tag: string;
  summary: string;
  items: string[];
}) {
  return (
    <Card
      size="small"
      title={(
        <Space wrap>
          <Text strong>{title}</Text>
          <DarkTag color="blue">{tag}</DarkTag>
        </Space>
      )}
      style={{ height: "100%" }}
    >
      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        <Text style={{ color: "#b7af9f" }}>{summary}</Text>
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          {items.map((item) => (
            <Text key={item} style={{ color: "#d7cfbf" }}>
              {`- ${item}`}
            </Text>
          ))}
        </Space>
      </Space>
    </Card>
  );
}

const previewScrollStyle = {
  minHeight: 88,
  maxHeight: "min(42vh, 320px)",
  paddingRight: 4,
} as const;

type KeywordPoolFieldKey =
  | "femaleNames"
  | "maleNames"
  | "npcOrigins"
  | "npcProfessions"
  | "npcFactions"
  | "npcTraits"
  | "npcPersonalityKeywords"
  | "npcLifeKeywords"
  | "npcSocialKeywords"
  | "relationshipKeywords"
  | "districtKeywords"
  | "resourceKeywords"
  | "rumorKeywords"
  | "marketBuyerTitles";

type KeywordPoolDraft = Record<KeywordPoolFieldKey, string[]>;

type PressureTargetDraft = "notorietyScore" | "bountyHeat" | "shadowFavor" | "lawfulPressure";
type CoerciveFlavorLevelDraft = "low" | "medium" | "high";
type ForcedActionDraft = "rob_lingyu" | "forced_teleport" | "forced_dual_cultivation";
type PressureReliefOfferTypeDraft =
  | "pressure_cleanse"
  | "rumor_silence"
  | "lawful_mediation"
  | "consensual_dual_cultivation";

type PressureReliefRuleDraft = {
  offerType: PressureReliefOfferTypeDraft;
  enabled: boolean;
  label: string;
  sourceFaction: string;
  baseReliefValue: number;
  pressureTargets: PressureTargetDraft[];
  requiresKeywords: string[];
  consentRequired: boolean;
  coerciveFlavorLevel: CoerciveFlavorLevelDraft;
  forcedActions: ForcedActionDraft[];
  summaryHint: string;
};

type PressureReliefRulesDraft = {
  highCorruptionThreshold: number;
  perMapCustomNpcLimit: number;
  rules: PressureReliefRuleDraft[];
};

type CustomNpcDraft = {
  id: string;
  name: string;
  gender: "male" | "female";
  originType: string;
  profession: string;
  faction: string;
  realmMinor: number;
  personalitySummary: string;
  traitTags: string[];
  worldBookKeywords: string[];
  adultTags: string[];
  grayTags: string[];
  preferredMapIds: string[];
  preferredMapTags: string[];
  writeToRandomPool: boolean;
  allowDynamicWorldSpawn: boolean;
  partnerIds: string[];
  primaryPartnerId: string;
  relationshipTags: string[];
};

type CustomNpcLibraryDraft = {
  npcs: CustomNpcDraft[];
};

const KEYWORD_POOL_FIELD_DEFS: Array<{
  key: KeywordPoolFieldKey;
  label: string;
  description: string;
}> = [
  { key: "femaleNames", label: "女性名池", description: "AI 常用女性名字。" },
  { key: "maleNames", label: "男性名池", description: "AI 常用男性名字。" },
  { key: "npcOrigins", label: "NPC 出身", description: "寒门、散修、边军遗孤等出身词。" },
  { key: "npcProfessions", label: "NPC 职业", description: "行脚商、药农、黑市牙人等职业词。" },
  { key: "npcFactions", label: "NPC 势力", description: "常见势力、散修圈层、黑市归属。" },
  { key: "npcTraits", label: "NPC 特性", description: "性格与处事倾向标签。" },
  { key: "npcPersonalityKeywords", label: "处事口风", description: "讲人情、识进退等行为关键词。" },
  { key: "npcLifeKeywords", label: "生计困局", description: "赶灵石、顾生计、旧债未清等动机。" },
  { key: "npcSocialKeywords", label: "社交动作", description: "传话、还礼、搭伙、递帖等。" },
  { key: "relationshipKeywords", label: "关系标签", description: "旧识、酒友、债主、照应人等。" },
  { key: "districtKeywords", label: "街区场景", description: "茶肆、渡口、夜摊、旧祠等。" },
  { key: "resourceKeywords", label: "资源主题", description: "灵草、矿屑、阵盘残片等。" },
  { key: "rumorKeywords", label: "风声关键词", description: "耳目、暗线、人情债等。" },
  { key: "marketBuyerTitles", label: "扫货商称谓", description: "市场低价收购 NPC 的称谓池。" },
];

const PRESSURE_TARGET_OPTIONS: Array<{ value: PressureTargetDraft; label: string }> = [
  { value: "notorietyScore", label: "恶名" },
  { value: "bountyHeat", label: "悬赏热度" },
  { value: "shadowFavor", label: "灰线青睐" },
  { value: "lawfulPressure", label: "守序压力" },
];

const FORCED_ACTION_OPTIONS: Array<{ value: ForcedActionDraft; label: string }> = [
  { value: "rob_lingyu", label: "抢夺灵玉" },
  { value: "forced_teleport", label: "强制传送" },
  { value: "forced_dual_cultivation", label: "强制双修" },
];

const PRESSURE_RULE_META: Array<{
  offerType: PressureReliefOfferTypeDraft;
  title: string;
  description: string;
}> = [
  { offerType: "pressure_cleanse", title: "洗痕交易", description: "替玩家抹去明面痕迹的人情交易。" },
  { offerType: "rumor_silence", title: "压风声", description: "压耳目、删口风、遮盖追缉链。" },
  { offerType: "lawful_mediation", title: "守序调解", description: "赔礼、递帖、借守序势力调停。" },
  { offerType: "consensual_dual_cultivation", title: "合意双修洗痕", description: "以双方同意为前提的快捷洗影响渠道。" },
];

const CUSTOM_NPC_LIST_FIELDS: Array<{
  key: keyof Pick<CustomNpcDraft, "traitTags" | "worldBookKeywords" | "adultTags" | "grayTags" | "preferredMapIds" | "preferredMapTags" | "partnerIds" | "relationshipTags">;
  label: string;
  description: string;
}> = [
  { key: "traitTags", label: "特性标签", description: "例如：机敏、圆滑、多疑。" },
  { key: "worldBookKeywords", label: "世界书关键词", description: "用于世界书和 AI 上下文联动。" },
  { key: "adultTags", label: "成人标签", description: "用于成人试探和双修倾向。" },
  { key: "grayTags", label: "灰线标签", description: "用于暗线、黑市、威逼利诱等事件链。" },
  { key: "preferredMapIds", label: "偏好地图 ID", description: "指定更偏好在哪些开放世界地图出现。" },
  { key: "preferredMapTags", label: "偏好地图标签", description: "例如：散修坊市带、边荒灰域带。" },
  { key: "partnerIds", label: "关联道侣 ID", description: "用于私怨和道侣联动。" },
  { key: "relationshipTags", label: "关系标签", description: "例如：卖讯、两头通吃、旧主顾。" },
];

const EMPTY_KEYWORD_POOL_DRAFT: KeywordPoolDraft = {
  femaleNames: [],
  maleNames: [],
  npcOrigins: [],
  npcProfessions: [],
  npcFactions: [],
  npcTraits: [],
  npcPersonalityKeywords: [],
  npcLifeKeywords: [],
  npcSocialKeywords: [],
  relationshipKeywords: [],
  districtKeywords: [],
  resourceKeywords: [],
  rumorKeywords: [],
  marketBuyerTitles: [],
};

const EMPTY_PRESSURE_RELIEF_RULE: PressureReliefRuleDraft = {
  offerType: "pressure_cleanse",
  enabled: true,
  label: "",
  sourceFaction: "",
  baseReliefValue: 10,
  pressureTargets: [],
  requiresKeywords: [],
  consentRequired: true,
  coerciveFlavorLevel: "medium",
  forcedActions: [],
  summaryHint: "",
};

const EMPTY_CUSTOM_NPC: CustomNpcDraft = {
  id: "",
  name: "",
  gender: "female",
  originType: "",
  profession: "",
  faction: "",
  realmMinor: 1,
  personalitySummary: "",
  traitTags: [],
  worldBookKeywords: [],
  adultTags: [],
  grayTags: [],
  preferredMapIds: [],
  preferredMapTags: [],
  writeToRandomPool: true,
  allowDynamicWorldSpawn: true,
  partnerIds: [],
  primaryPartnerId: "",
  relationshipTags: [],
};

function safeJsonParse<T>(value: string | undefined, fallback: T): T {
  if (!value || !value.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stringifyPrettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function normalizeTextList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(
    value
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
  ));
}

function parseTextAreaList(value: string) {
  return Array.from(new Set(
    String(value || "")
      .split(/\r?\n|,|，/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  ));
}

function formatTextAreaList(value: string[]) {
  return value.join("\n");
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return fallback;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function parseKeywordPoolDraft(value: string | undefined, fallbackValue: string | undefined): KeywordPoolDraft {
  const fallback = safeJsonParse<Partial<KeywordPoolDraft>>(fallbackValue, {});
  const current = safeJsonParse<Partial<KeywordPoolDraft>>(value, fallback);
  const merged = { ...fallback, ...current } as Partial<KeywordPoolDraft>;
  return KEYWORD_POOL_FIELD_DEFS.reduce((result, field) => {
    result[field.key] = normalizeTextList(merged[field.key]);
    return result;
  }, { ...EMPTY_KEYWORD_POOL_DRAFT });
}

function parsePressureReliefRulesDraft(value: string | undefined, fallbackValue: string | undefined): PressureReliefRulesDraft {
  const fallback = safeJsonParse<Partial<PressureReliefRulesDraft>>(fallbackValue, {});
  const current = safeJsonParse<Partial<PressureReliefRulesDraft>>(value, fallback);
  const merged = { ...fallback, ...current };
  const ruleMap = new Map<PressureReliefOfferTypeDraft, PressureReliefRuleDraft>();
  const fallbackRules = Array.isArray(fallback.rules) ? fallback.rules : [];
  const currentRules = Array.isArray(current.rules) ? current.rules : [];

  for (const rawRule of [...fallbackRules, ...currentRules]) {
    const offerType = String((rawRule as Partial<PressureReliefRuleDraft>)?.offerType || "").trim() as PressureReliefOfferTypeDraft;
    if (!PRESSURE_RULE_META.find((item) => item.offerType === offerType)) {
      continue;
    }
    const base = ruleMap.get(offerType) || { ...EMPTY_PRESSURE_RELIEF_RULE, offerType };
    ruleMap.set(offerType, {
      ...base,
      ...rawRule,
      offerType,
      enabled: normalizeBoolean((rawRule as Partial<PressureReliefRuleDraft>)?.enabled, base.enabled),
      label: String((rawRule as Partial<PressureReliefRuleDraft>)?.label || base.label || "").trim(),
      sourceFaction: String((rawRule as Partial<PressureReliefRuleDraft>)?.sourceFaction || base.sourceFaction || "").trim(),
      baseReliefValue: normalizeInteger((rawRule as Partial<PressureReliefRuleDraft>)?.baseReliefValue, base.baseReliefValue, 1, 60),
      pressureTargets: normalizeTextList((rawRule as Partial<PressureReliefRuleDraft>)?.pressureTargets)
        .filter((entry): entry is PressureTargetDraft => PRESSURE_TARGET_OPTIONS.some((item) => item.value === entry)),
      requiresKeywords: normalizeTextList((rawRule as Partial<PressureReliefRuleDraft>)?.requiresKeywords),
      consentRequired: normalizeBoolean((rawRule as Partial<PressureReliefRuleDraft>)?.consentRequired, base.consentRequired),
      coerciveFlavorLevel: ["low", "medium", "high"].includes(String((rawRule as Partial<PressureReliefRuleDraft>)?.coerciveFlavorLevel || ""))
        ? String((rawRule as Partial<PressureReliefRuleDraft>)?.coerciveFlavorLevel) as CoerciveFlavorLevelDraft
        : base.coerciveFlavorLevel,
      forcedActions: normalizeTextList((rawRule as Partial<PressureReliefRuleDraft>)?.forcedActions)
        .filter((entry): entry is ForcedActionDraft => FORCED_ACTION_OPTIONS.some((item) => item.value === entry)),
      summaryHint: String((rawRule as Partial<PressureReliefRuleDraft>)?.summaryHint || base.summaryHint || "").trim(),
    });
  }

  const rules = PRESSURE_RULE_META.map((item) => (
    ruleMap.get(item.offerType) || {
      ...EMPTY_PRESSURE_RELIEF_RULE,
      offerType: item.offerType,
      label: item.title,
    }
  ));

  return {
    highCorruptionThreshold: normalizeInteger(merged.highCorruptionThreshold, 75, 50, 100),
    perMapCustomNpcLimit: normalizeInteger(merged.perMapCustomNpcLimit, 4, 1, 4),
    rules,
  };
}

function parseCustomNpcLibraryDraft(value: string | undefined, fallbackValue: string | undefined): CustomNpcLibraryDraft {
  const fallback = safeJsonParse<Partial<CustomNpcLibraryDraft>>(fallbackValue, {});
  const current = safeJsonParse<Partial<CustomNpcLibraryDraft>>(value, fallback);
  const source = Array.isArray(current.npcs)
    ? current.npcs
    : Array.isArray(fallback.npcs)
      ? fallback.npcs
      : [];
  return {
    npcs: source.map((rawNpc) => ({
      ...EMPTY_CUSTOM_NPC,
      ...rawNpc,
      id: String(rawNpc?.id || "").trim(),
      name: String(rawNpc?.name || "").trim(),
      gender: String(rawNpc?.gender || "").trim().toLowerCase() === "male" ? "male" : "female",
      originType: String(rawNpc?.originType || "").trim(),
      profession: String(rawNpc?.profession || "").trim(),
      faction: String(rawNpc?.faction || "").trim(),
      realmMinor: normalizeInteger(rawNpc?.realmMinor, 1, 1, 99),
      personalitySummary: String(rawNpc?.personalitySummary || "").trim(),
      traitTags: normalizeTextList(rawNpc?.traitTags),
      worldBookKeywords: normalizeTextList(rawNpc?.worldBookKeywords),
      adultTags: normalizeTextList(rawNpc?.adultTags),
      grayTags: normalizeTextList(rawNpc?.grayTags),
      preferredMapIds: normalizeTextList(rawNpc?.preferredMapIds),
      preferredMapTags: normalizeTextList(rawNpc?.preferredMapTags),
      writeToRandomPool: normalizeBoolean(rawNpc?.writeToRandomPool, true),
      allowDynamicWorldSpawn: normalizeBoolean(rawNpc?.allowDynamicWorldSpawn, true),
      partnerIds: normalizeTextList(rawNpc?.partnerIds),
      primaryPartnerId: String(rawNpc?.primaryPartnerId || "").trim(),
      relationshipTags: normalizeTextList(rawNpc?.relationshipTags),
    })),
  };
}

export default function OpenWorldManager() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [configItems, setConfigItems] = useState<SystemConfigItem[]>([]);
  const [rowsByKey, setRowsByKey] = useState<Record<string, SystemConfigRow>>({});
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [schemaStatus, setSchemaStatus] = useState<OpenWorldSchemaStatus | null>(null);
  const [dashboardSummary, setDashboardSummary] = useState<OpenWorldDashboardSummary | null>(null);
  const [factionOverview, setFactionOverview] = useState<OpenWorldFactionOverview | null>(null);
  const [mapNetworkOverview, setMapNetworkOverview] = useState<OpenWorldMapNetworkOverview | null>(null);
  const [lastTestResult, setLastTestResult] = useState<string>("");
  const [lastTestedAt, setLastTestedAt] = useState<string>("");
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [previewByKey, setPreviewByKey] = useState<Record<string, { testedAt: string; content: string }>>({});
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildStatus, setRebuildStatus] = useState<OpenWorldRebuildResponse["data"] | null>(null);
  const [keywordPoolSeedInput, setKeywordPoolSeedInput] = useState("");
  const [keywordPoolStyleInput, setKeywordPoolStyleInput] = useState("");
  const [keywordPoolForbiddenInput, setKeywordPoolForbiddenInput] = useState("");
  const [keywordPoolWorldThemeInput, setKeywordPoolWorldThemeInput] = useState("");
  const [customNpcSeedInput, setCustomNpcSeedInput] = useState("");
  const [customNpcStyleInput, setCustomNpcStyleInput] = useState("");
  const [customNpcForbiddenInput, setCustomNpcForbiddenInput] = useState("");
  const [customNpcWorldThemeInput, setCustomNpcWorldThemeInput] = useState("");
  const [customNpcMapTagsInput, setCustomNpcMapTagsInput] = useState("");
  const [customNpcCountInput, setCustomNpcCountInput] = useState(4);
  const [activeAiTab, setActiveAiTab] = useState("llm");

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const loadConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const [itemRes, valueRes] = await Promise.all([
        fetch("/api/admin/system-config-items", { method: "GET", cache: "no-store" }),
        fetch("/api/admin/system-configs/export", { method: "GET", cache: "no-store" }),
      ]);

      const itemResult = await itemRes.json() as SystemConfigItemsResponse;
      const valueResult = await valueRes.json() as SystemConfigExportRow[] | { error?: string };

      if (!valueRes.ok || !Array.isArray(valueResult)) {
        const errorMessage = !Array.isArray(valueResult) && typeof valueResult?.error === "string"
          ? valueResult.error
          : "读取开放世界配置失败";
        throw new Error(errorMessage);
      }

      const itemSource = itemResult.success && Array.isArray(itemResult.data?.items)
        ? itemResult.data.items
        : [...SYSTEM_CONFIG_ITEMS];
      const itemMap = new Map(itemSource.map((item) => [item.key, item]));
      const nextItems = OPEN_WORLD_SYSTEM_CONFIG_KEYS
        .map((key) => itemMap.get(key))
        .filter((item): item is SystemConfigItem => Boolean(item));

      const nextRowsByKey: Record<string, SystemConfigRow> = {};
      for (const row of valueResult) {
        if (!OPEN_WORLD_SYSTEM_CONFIG_KEYS.includes(row.key as typeof OPEN_WORLD_SYSTEM_CONFIG_KEYS[number])) {
          continue;
        }
        nextRowsByKey[row.key] = {
          id: row.key,
          key: row.key,
          value: row.value,
          group: row.group,
          isSecret: row.isSecret,
          description: row.description,
          createdAt: row.createdAt || "",
          updatedAt: row.updatedAt || "",
        };
      }

      const nextDraftValues: Record<string, string> = {};
      for (const item of nextItems) {
        nextDraftValues[item.key] = nextRowsByKey[item.key]?.value ?? item.defaultValue ?? "";
      }

      const statusRes = await fetch("/api/internal/world/schema-status", {
        method: "GET",
        cache: "no-store",
      });
      const statusResult = await statusRes.json() as OpenWorldStatusResponse;
      const factionRes = await fetch("/api/admin/open-world/faction-overview", {
        method: "GET",
        cache: "no-store",
      });
      const factionResult = await factionRes.json() as OpenWorldFactionOverviewResponse;
      const mapNetworkRes = await fetch("/api/admin/open-world/map-network-overview", {
        method: "GET",
        cache: "no-store",
      });
      const mapNetworkResult = await mapNetworkRes.json() as OpenWorldMapNetworkOverviewResponse;

      setConfigItems(nextItems);
      setRowsByKey(nextRowsByKey);
      setDraftValues(nextDraftValues);
      if (statusRes.ok && statusResult.success && statusResult.data) {
        setSchemaStatus(statusResult.data.schemaStatus);
        setDashboardSummary(statusResult.data.dashboardSummary);
      }
      if (factionRes.ok && factionResult.success && factionResult.data) {
        setFactionOverview(factionResult.data);
      }
      if (mapNetworkRes.ok && mapNetworkResult.success && mapNetworkResult.data) {
        setMapNetworkOverview(mapNetworkResult.data);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "读取开放世界配置失败";
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  const llmItems = useMemo(() => {
    const map = new Map(configItems.map((item) => [item.key, item]));
    return OPEN_WORLD_LLM_CONFIG_KEYS
      .map((key) => map.get(key))
      .filter((item): item is SystemConfigItem => Boolean(item));
  }, [configItems]);

  const promptItems = useMemo(() => {
    const map = new Map(configItems.map((item) => [item.key, item]));
    return [...OPEN_WORLD_PROMPT_CONFIG_KEYS, ...OPEN_WORLD_RULE_CONFIG_KEYS, ...OPEN_WORLD_TEMPLATE_CONFIG_KEYS]
      .map((key) => map.get(key))
      .filter((item): item is SystemConfigItem => Boolean(item));
  }, [configItems]);

  const worldBookItems = useMemo(() => {
    const map = new Map(configItems.map((item) => [item.key, item]));
    return OPEN_WORLD_WORLDBOOK_CONFIG_KEYS
      .map((key) => map.get(key))
      .filter((item): item is SystemConfigItem => Boolean(item));
  }, [configItems]);

  const groupedPromptItems = useMemo(() => {
    const itemMap = new Map(promptItems.map((item) => [item.key, item]));
    return OPEN_WORLD_PROMPT_GROUPS.map((group) => ({
      ...group,
      items: group.keys
        .map((key) => itemMap.get(key))
        .filter((item): item is SystemConfigItem => Boolean(item)),
    })).filter((group) => group.items.length > 0);
  }, [promptItems]);

  const configItemsByKey = useMemo(() => (
    new Map(configItems.map((item) => [item.key, item]))
  ), [configItems]);

  const keywordPoolDraft = useMemo(() => (
    parseKeywordPoolDraft(
      draftValues.OPEN_WORLD_KEYWORD_POOL_JSON,
      configItemsByKey.get("OPEN_WORLD_KEYWORD_POOL_JSON")?.defaultValue,
    )
  ), [configItemsByKey, draftValues.OPEN_WORLD_KEYWORD_POOL_JSON]);

  const pressureReliefDraft = useMemo(() => (
    parsePressureReliefRulesDraft(
      draftValues.OPEN_WORLD_PRESSURE_RELIEF_RULES_JSON,
      configItemsByKey.get("OPEN_WORLD_PRESSURE_RELIEF_RULES_JSON")?.defaultValue,
    )
  ), [configItemsByKey, draftValues.OPEN_WORLD_PRESSURE_RELIEF_RULES_JSON]);

  const customNpcLibraryDraft = useMemo(() => (
    parseCustomNpcLibraryDraft(
      draftValues.OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON,
      configItemsByKey.get("OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON")?.defaultValue,
    )
  ), [configItemsByKey, draftValues.OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON]);

  const aiReady = useMemo(() => {
    const model = String(draftValues.OPEN_WORLD_LLM_MODEL || "").trim();
    const promptReady = OPEN_WORLD_PROMPT_CONFIG_KEYS.every((key) => String(draftValues[key] || "").trim().length > 0);
    if (model && promptReady) {
      return {
        label: "已就绪",
        color: "green",
        detail: "开放世界专属模型与提示词已可用",
      };
    }
    if (promptReady) {
      return {
        label: "待补模型",
        color: "gold",
        detail: "提示词完整，模型将回退到世界风味/通用配置",
      };
    }
    return {
      label: "待配置",
      color: "red",
      detail: "仍需补齐开放世界专属模型或提示词",
    };
  }, [draftValues]);

  const metricCards = useMemo(() => {
    const tiandaoValue = dashboardSummary?.tiandaoStatus || (aiReady.label === "已就绪" ? "推演待命" : "待校准");
    const worldTimeValue = dashboardSummary?.worldTime ? formatDateTime(dashboardSummary.worldTime) : formatDateTime(now);
    const mapCountValue = String(dashboardSummary?.activeMapCount ?? 0);
    const activeNpcCountValue = String(dashboardSummary?.aliveNpcCount ?? 0);
    const todayEventCountValue = String(dashboardSummary?.todayEventCount ?? 0);
    const schemaReady = Boolean(schemaStatus?.ready);
    const schemaTag = schemaReady
      ? { color: "green", label: schemaStatus?.bootstrapMode === "patched" ? "补丁完成" : "已就绪" }
      : { color: "red", label: schemaStatus?.bootstrapMode === "failed" ? "异常" : "待自举" };

    return [
      {
        title: "天道状态",
        value: tiandaoValue,
        detail: schemaReady
          ? `表结构模式：${schemaStatus?.bootstrapMode || "existing"}`
          : (schemaStatus?.fallbackReason || "开放世界表结构尚未完整就绪"),
        tag: schemaTag,
      },
      {
        title: "当前世界时间",
        value: worldTimeValue,
        detail: dashboardSummary?.worldTime
          ? "当前为服务端开放世界时间"
          : "暂以后台所在浏览器时间兜底展示",
      },
      {
        title: "活跃开放世界地图数",
        value: mapCountValue,
        detail: schemaReady ? "已按当前开放世界实际状态统计" : "表结构未完成时显示为 0",
        tag: { color: "blue", label: "V1 上限" },
      },
      {
        title: "活跃世界 NPC 数",
        value: activeNpcCountValue,
        detail: dashboardSummary
          ? `激活 ${dashboardSummary.activeNpcCount} / 存活 ${dashboardSummary.aliveNpcCount}`
          : "等待开放世界运行态接线",
        tag: { color: "purple", label: "世界 NPC" },
      },
      {
        title: "今日天道事件数",
        value: todayEventCountValue,
        detail: dashboardSummary ? "来自当前 world_npc_life_logs 统计" : "等待世界日志统计接线",
        tag: { color: "gold", label: "天道日志" },
      },
      {
        title: "AI 生成健康状态",
        value: aiReady.label,
        detail: schemaReady
          ? `${aiReady.detail}${schemaStatus?.checkedAt ? `，最近巡检 ${formatDateTime(schemaStatus.checkedAt)}` : ""}`
          : `${aiReady.detail}，当前仍有开放世界自举待完成`,
        tag: { color: aiReady.color, label: "开放世界 AI" },
      },
    ];
  }, [aiReady, dashboardSummary, now, schemaStatus]);

  const contentPanels = useMemo(() => {
    return [
      {
        title: "天道推演",
        tag: "时间线",
        summary: "负责开放世界时间推进、轮回补位和阶段事件节奏，首期先由后台明确规则与接线位置。",
        items: [
          "预留天道 tick 与事件播报入口",
          "支持按现实时间推进开放世界状态",
          "轮回补位与命格痕迹保留为后续接线位",
        ],
      },
      {
        title: "动态地图",
        tag: "128x128",
        summary: "开放世界地图按大图规格规划，AI 负责主题与关键词，服务端负责合法性校验。",
        items: [
          "地图模板支持凡人城镇 / 修士坊市 / 山野聚落 / 边荒据点 / 宗门聚落，在线仍保持 4 张",
          "迷雾、首包静态数据和附近同步是首期性能前提",
          "当前页先承载生成配置，不直接做地图编辑器改造",
        ],
      },
      {
        title: "建筑/传送阵",
        tag: "可视化",
        summary: "后台展示建筑物 ICON/图片块 与定向传送阵的设计位，方便后续和地图编辑器衔接。",
        items: [
          "建筑 tile 支持 ICON / 图片块资源表现",
          "定向传送阵按固定双向阵设计",
          "本页用说明卡承接规则，不抢占现有地图编辑功能",
        ],
      },
      {
        title: "世界 NPC",
        tag: "DNA",
        summary: "世界 NPC 采用轻量行为 + AI DNA 的组合，目标是有一生但不拖垮服务器。",
        items: [
          "每图 12 个 NPC，最多 6 个高精度激活态",
          "首期行为聚焦游走、采药、打怪、拾取、回城、摆摊",
          "玩家后续可查看人格摘要、背包摘要、境界与人生记录",
        ],
      },
      {
        title: "掉落与轮回",
        tag: "夺宝",
        summary: "杀人夺宝只面向开放世界 NPC，掉落取真实背包，死亡后由天道做轮回补位。",
        items: [
          "战斗将复用现有单体 combat 链路",
          "死亡后进入不可交互态，不做原地满血复活",
          "轮回个体保留轮回次数与少量命格痕迹",
        ],
      },
      {
        title: "势力与街区",
        tag: "第四阶段",
        summary: "把街区主导势力、局势标签与故事链推进做成可感知的活世界反应层。",
        items: [
          "街区按影响度而不是瞬时换旗推进",
          "故事链会持续改写街区风向与 NPC 立场",
          "后台先提供总览与运营观察位，再继续补配置细项",
        ],
      },
    ];
  }, []);

  const factionOverviewCards = useMemo(() => {
    const factions = factionOverview?.factions || [];
    const districtStates = factionOverview?.districtStates || [];
    const storylines = factionOverview?.storylines || [];
    const latestDistrict = districtStates[0];
    const latestStoryline = storylines[0];

    return [
      {
        title: "登记势力数",
        value: String(factions.length),
        detail: factions.length > 0 ? factions.slice(0, 3).map((item) => item.name).join("、") : "尚未完成势力播种",
      },
      {
        title: "街区态势数",
        value: String(districtStates.length),
        detail: latestDistrict
          ? `${latestDistrict.districtName} · ${latestDistrict.dominantFactionName} · ${latestDistrict.tensionTag}`
          : "街区态势尚未生成",
      },
      {
        title: "活跃故事链",
        value: String(storylines.filter((item) => item.status === "active").length),
        detail: latestStoryline
          ? `${latestStoryline.districtName} · ${latestStoryline.stageTitle}`
          : "当前还没有活跃故事链",
      },
    ];
  }, [factionOverview]);

  const mapNetworkCards = useMemo(() => {
    const summary = mapNetworkOverview?.summary;
    const explorationDensity = mapNetworkOverview?.explorationDensity;
    const firstRegion = mapNetworkOverview?.regionBands?.[0];
    const firstHotMap = mapNetworkOverview?.maps?.find((item) => item.heatTier === "hot") || mapNetworkOverview?.maps?.[0];
    return [
      {
        title: "地图池与冷热分层",
        value: summary ? `${summary.totalMapCount} 张` : "0 张",
        detail: summary
          ? `热 ${summary.hotMapCount} / 温 ${summary.warmMapCount} / 冷 ${summary.coldMapCount}`
          : "尚未生成第五阶段地图池",
      },
      {
        title: "界域路网",
        value: firstRegion ? `${mapNetworkOverview?.regionBands.length || 0} 带` : "0 带",
        detail: firstRegion
          ? `${firstRegion.regionBand} · ${firstRegion.anchorMaps.join("、")}`
          : "路网总览尚未生成",
      },
      {
        title: "奇闻/奇遇/秘境密度",
        value: explorationDensity
          ? `${explorationDensity.rumorHookCount + explorationDensity.encounterHookCount + explorationDensity.secretRealmHookCount}`
          : "0",
        detail: explorationDensity
          ? `奇闻 ${explorationDensity.rumorHookCount} / 奇遇 ${explorationDensity.encounterHookCount} / 秘境 ${explorationDensity.secretRealmHookCount}`
          : "探索内容尚未播种",
      },
      {
        title: "当前热图锚点",
        value: firstHotMap?.name || "暂无",
        detail: firstHotMap
          ? `${firstHotMap.regionBand} · ${firstHotMap.heatTierLabel} · 危险 ${firstHotMap.dangerLevel} / 神秘 ${firstHotMap.mysteryLevel}`
          : "等待地图池完成热图分层",
      },
    ];
  }, [mapNetworkOverview]);

  const handleDraftChange = useCallback((key: string, value: string) => {
    setDraftValues((previous) => ({
      ...previous,
      [key]: value,
    }));
  }, []);

  const handleKeywordPoolFieldChange = useCallback((field: KeywordPoolFieldKey, value: string) => {
    const nextDraft = {
      ...keywordPoolDraft,
      [field]: parseTextAreaList(value),
    };
    handleDraftChange("OPEN_WORLD_KEYWORD_POOL_JSON", stringifyPrettyJson(nextDraft));
  }, [handleDraftChange, keywordPoolDraft]);

  const handlePressureRulesRootChange = useCallback((
    field: keyof Pick<PressureReliefRulesDraft, "highCorruptionThreshold" | "perMapCustomNpcLimit">,
    value: number | null,
  ) => {
    const nextDraft = {
      ...pressureReliefDraft,
      [field]: normalizeInteger(
        value,
        pressureReliefDraft[field],
        field === "highCorruptionThreshold" ? 50 : 1,
        field === "highCorruptionThreshold" ? 100 : 4,
      ),
    };
    handleDraftChange("OPEN_WORLD_PRESSURE_RELIEF_RULES_JSON", stringifyPrettyJson(nextDraft));
  }, [handleDraftChange, pressureReliefDraft]);

  const handlePressureRuleChange = useCallback((
    offerType: PressureReliefOfferTypeDraft,
    patch: Partial<PressureReliefRuleDraft>,
  ) => {
    const nextDraft = {
      ...pressureReliefDraft,
      rules: pressureReliefDraft.rules.map((rule) => (
        rule.offerType === offerType
          ? {
            ...rule,
            ...patch,
          }
          : rule
      )),
    };
    handleDraftChange("OPEN_WORLD_PRESSURE_RELIEF_RULES_JSON", stringifyPrettyJson(nextDraft));
  }, [handleDraftChange, pressureReliefDraft]);

  const handlePressureRuleListChange = useCallback((
    offerType: PressureReliefOfferTypeDraft,
    field: "pressureTargets" | "forcedActions",
    values: string[],
  ) => {
    handlePressureRuleChange(offerType, {
      [field]: values,
    } as Partial<PressureReliefRuleDraft>);
  }, [handlePressureRuleChange]);

  const handlePressureRuleKeywordsChange = useCallback((offerType: PressureReliefOfferTypeDraft, value: string) => {
    handlePressureRuleChange(offerType, {
      requiresKeywords: parseTextAreaList(value),
    });
  }, [handlePressureRuleChange]);

  const handleCustomNpcFieldChange = useCallback((
    npcIndex: number,
    field: keyof CustomNpcDraft,
    value: string | number | boolean | string[],
  ) => {
    const nextDraft = {
      ...customNpcLibraryDraft,
      npcs: customNpcLibraryDraft.npcs.map((npc, index) => {
        if (index !== npcIndex) {
          return npc;
        }
        return {
          ...npc,
          [field]: value,
        };
      }),
    };
    handleDraftChange("OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON", stringifyPrettyJson(nextDraft));
  }, [customNpcLibraryDraft, handleDraftChange]);

  const handleCustomNpcListFieldChange = useCallback((
    npcIndex: number,
    field: keyof Pick<CustomNpcDraft, "traitTags" | "worldBookKeywords" | "adultTags" | "grayTags" | "preferredMapIds" | "preferredMapTags" | "partnerIds" | "relationshipTags">,
    value: string,
  ) => {
    handleCustomNpcFieldChange(npcIndex, field, parseTextAreaList(value));
  }, [handleCustomNpcFieldChange]);

  const handleAddCustomNpc = useCallback(() => {
    const nextDraft = {
      ...customNpcLibraryDraft,
      npcs: [
        ...customNpcLibraryDraft.npcs,
        {
          ...EMPTY_CUSTOM_NPC,
          id: `custom_npc_${Date.now()}`,
        },
      ],
    };
    handleDraftChange("OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON", stringifyPrettyJson(nextDraft));
  }, [customNpcLibraryDraft, handleDraftChange]);

  const handleRemoveCustomNpc = useCallback((npcIndex: number) => {
    const nextDraft = {
      ...customNpcLibraryDraft,
      npcs: customNpcLibraryDraft.npcs.filter((_, index) => index !== npcIndex),
    };
    handleDraftChange("OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON", stringifyPrettyJson(nextDraft));
  }, [customNpcLibraryDraft, handleDraftChange]);

  const handleGenerateKeywordPool = useCallback(async () => {
    setTesting(true);
    setTestingKey("OPEN_WORLD_KEYWORD_POOL_JSON");
    try {
      const response = await fetch("/api/admin/open-world/ai-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previewType: "keyword_pool",
          seedKeywords: parseTextAreaList(keywordPoolSeedInput),
          styleKeywords: parseTextAreaList(keywordPoolStyleInput),
          forbiddenKeywords: parseTextAreaList(keywordPoolForbiddenInput),
          worldTheme: keywordPoolWorldThemeInput.trim(),
        }),
      });
      const result = await response.json() as OpenWorldAiPreviewResponse;
      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.error || "自动生成关键词池失败");
      }

      const keywordPool = (
        result.data.keywordPool
        && typeof result.data.keywordPool === "object"
        && !Array.isArray(result.data.keywordPool)
      )
        ? result.data.keywordPool
        : null;
      if (!keywordPool) {
        throw new Error("AI 未返回可用的关键词池 JSON");
      }

      const generatedAt = typeof result.data.generatedAt === "string"
        ? result.data.generatedAt
        : new Date().toISOString();
      const fallbackReason = typeof result.data.fallbackReason === "string"
        ? result.data.fallbackReason.trim()
        : "";
      const previewContent = JSON.stringify({
        source: result.data.source || "fallback",
        summary: result.data.summary || "",
        fallbackReason,
        keywordPool,
      }, null, 2);

      handleDraftChange("OPEN_WORLD_KEYWORD_POOL_JSON", stringifyPrettyJson(keywordPool));
      setPreviewByKey((current) => ({
        ...current,
        OPEN_WORLD_KEYWORD_POOL_JSON: {
          testedAt: generatedAt,
          content: previewContent,
        },
      }));
      setLastTestResult(JSON.stringify({
        runtimeMode: String(draftValues.OPEN_WORLD_LLM_MODEL || "").trim() ? "open-world-dedicated" : "fallback-chain",
        baseUrl: String(draftValues.OPEN_WORLD_LLM_BASE_URL || "").trim() || "(回退到 WORLD_FLAVOR_LLM_BASE_URL / LLM_BASE_URL)",
        model: String(draftValues.OPEN_WORLD_LLM_MODEL || "").trim() || "(回退到 WORLD_FLAVOR_LLM_MODEL / LLM_MODEL)",
        promptPreview: {
          keywordPoolPrompt: buildPreviewText(String(draftValues.OPEN_WORLD_KEYWORD_POOL_PROMPT || "")),
        },
        previewResult: result.data,
      }, null, 2));
      setLastTestedAt(generatedAt);
      if (String(result.data.source || "") === "fallback") {
        message.warning(
          fallbackReason
            ? `本次没有拿到有效 AI 结果，已回退为当前关键词池。原因：${fallbackReason}`
            : "本次没有拿到有效 AI 结果，已回退为当前关键词池；请查看预览里的 source / summary。",
        );
      } else {
        const summary = String(result.data.summary || "").trim();
        message.success(summary ? `已根据关键词生成新词池：${summary}` : "已根据关键词自动生成并回填开放世界关键词池");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "自动生成关键词池失败";
      message.error(errorMessage);
    } finally {
      setTesting(false);
      setTestingKey(null);
    }
  }, [
    draftValues.OPEN_WORLD_KEYWORD_POOL_PROMPT,
    draftValues.OPEN_WORLD_LLM_BASE_URL,
    draftValues.OPEN_WORLD_LLM_MODEL,
    handleDraftChange,
    keywordPoolForbiddenInput,
    keywordPoolSeedInput,
    keywordPoolStyleInput,
    keywordPoolWorldThemeInput,
    message,
  ]);

  const handleGenerateCustomNpcLibrary = useCallback(async () => {
    setTesting(true);
    setTestingKey("OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON");
    try {
      const response = await fetch("/api/admin/open-world/ai-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previewType: "custom_npc_library",
          seedKeywords: parseTextAreaList(customNpcSeedInput),
          styleKeywords: parseTextAreaList(customNpcStyleInput),
          forbiddenKeywords: parseTextAreaList(customNpcForbiddenInput),
          worldTheme: customNpcWorldThemeInput.trim(),
          preferredMapTags: parseTextAreaList(customNpcMapTagsInput),
          npcCount: customNpcCountInput,
        }),
      });
      const result = await response.json() as OpenWorldAiPreviewResponse;
      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.error || "自动生成自定义 NPC 库失败");
      }

      const library = (
        result.data.library
        && typeof result.data.library === "object"
        && !Array.isArray(result.data.library)
      )
        ? result.data.library
        : null;
      if (!library) {
        throw new Error("AI 未返回可用的自定义 NPC 库 JSON");
      }

      const generatedAt = typeof result.data.generatedAt === "string"
        ? result.data.generatedAt
        : new Date().toISOString();
      const fallbackReason = typeof result.data.fallbackReason === "string"
        ? result.data.fallbackReason.trim()
        : "";
      const previewContent = JSON.stringify({
        source: result.data.source || "fallback",
        summary: result.data.summary || "",
        fallbackReason,
        library,
      }, null, 2);

      handleDraftChange("OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON", stringifyPrettyJson(library));
      setPreviewByKey((current) => ({
        ...current,
        OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON: {
          testedAt: generatedAt,
          content: previewContent,
        },
      }));
      setLastTestResult(JSON.stringify({
        runtimeMode: String(draftValues.OPEN_WORLD_LLM_MODEL || "").trim() ? "open-world-dedicated" : "fallback-chain",
        baseUrl: String(draftValues.OPEN_WORLD_LLM_BASE_URL || "").trim() || "(回退到 WORLD_FLAVOR_LLM_BASE_URL / LLM_BASE_URL)",
        model: String(draftValues.OPEN_WORLD_LLM_MODEL || "").trim() || "(回退到 WORLD_FLAVOR_LLM_MODEL / LLM_MODEL)",
        promptPreview: {
          customNpcLibraryPrompt: buildPreviewText(String(draftValues.OPEN_WORLD_CUSTOM_NPC_LIBRARY_PROMPT || "")),
        },
        previewResult: result.data,
      }, null, 2));
      setLastTestedAt(generatedAt);
      if (String(result.data.source || "") === "fallback") {
        message.warning(
          fallbackReason
            ? `本次没有拿到有效 AI 结果，已回退为当前自定义 NPC 库。原因：${fallbackReason}`
            : "本次没有拿到有效 AI 结果，已回退为当前自定义 NPC 库；请查看预览里的 source / summary。",
        );
      } else {
        const summary = String(result.data.summary || "").trim();
        message.success(summary ? `已自动生成新一批自定义 NPC：${summary}` : "已自动生成并回填自定义 NPC 库");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "自动生成自定义 NPC 库失败";
      message.error(errorMessage);
    } finally {
      setTesting(false);
      setTestingKey(null);
    }
  }, [
    customNpcCountInput,
    customNpcForbiddenInput,
    customNpcMapTagsInput,
    customNpcSeedInput,
    customNpcStyleInput,
    customNpcWorldThemeInput,
    draftValues.OPEN_WORLD_CUSTOM_NPC_LIBRARY_PROMPT,
    draftValues.OPEN_WORLD_LLM_BASE_URL,
    draftValues.OPEN_WORLD_LLM_MODEL,
    handleDraftChange,
    message,
  ]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const changedItems: Array<{
        key: string;
        value: string;
        group: string;
        isSecret: boolean;
        description: string | null;
      }> = [];

      for (const item of configItems) {
        const value = String(draftValues[item.key] ?? "");
        const allowEmpty = OPEN_WORLD_LLM_CONFIG_KEYS.includes(item.key as typeof OPEN_WORLD_LLM_CONFIG_KEYS[number])
          || OPEN_WORLD_OPTIONAL_JSON_KEYS.has(item.key);
        const existed = Boolean(rowsByKey[item.key]);

        if (!allowEmpty && !value.trim()) {
          throw new Error(`${item.key} 不能为空`);
        }

        if (allowEmpty && !value.trim() && !existed) {
          continue;
        }

        const previousRow = rowsByKey[item.key];
        if (
          previousRow
          && previousRow.value === value
          && previousRow.group === item.group
          && previousRow.isSecret === item.isSecret
          && (previousRow.description || null) === (item.description || null)
        ) {
          continue;
        }

        changedItems.push({
          key: item.key,
          value,
          group: item.group,
          isSecret: item.isSecret,
          description: item.description,
        });
      }

      if (changedItems.length <= 0) {
        message.success("开放世界配置无变更");
        return;
      }

      const response = await fetch("/api/admin/open-world/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: changedItems,
        }),
      });

      const result = await response.json() as SystemConfigMutationResponse & {
        data?: {
          savedCount?: number;
        };
      };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "开放世界配置保存失败");
      }

      message.success(`开放世界配置已保存${result.data?.savedCount ? `（${result.data.savedCount} 项）` : ""}`);
      await loadConfigs();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "开放世界配置保存失败";
      message.error(errorMessage);
    } finally {
      setSaving(false);
    }
  }, [configItems, draftValues, loadConfigs, message, rowsByKey]);

  const handleRebuild = useCallback(async () => {
    setRebuilding(true);
    try {
      const response = await fetch("/api/admin/open-world/reseed-map-pool", {
        method: "POST",
      });
      const result = await response.json() as OpenWorldRebuildResponse;
      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.error || "重制开放世界失败");
      }
      setRebuildStatus(result.data);
      message.info(result.data.status === "running"
        ? "开放世界重制任务已开始，后台正在刷新世界内容"
        : "开放世界重制状态已更新");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "重制开放世界失败";
      message.error(errorMessage);
    } finally {
      setRebuilding(false);
    }
  }, [message]);

  useEffect(() => {
    if (!rebuildStatus || rebuildStatus.status !== "running") {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/admin/open-world/rebuild", {
          method: "GET",
          cache: "no-store",
        });
        const result = await response.json() as OpenWorldRebuildResponse;
        if (cancelled || !response.ok || !result.success || !result.data) {
          return;
        }
        setRebuildStatus(result.data);
        if (result.data.status === "completed" && result.data.summary) {
          message.success(
            `开放世界已重制：${result.data.summary.mapCount} 张地图、${result.data.summary.rumorRefreshCount} 组风闻、${result.data.summary.refreshedStorylineCount} 条故事链已刷新`,
          );
          await loadConfigs();
          return;
        }
        if (result.data.status === "failed") {
          message.error(result.data.error || result.data.detail || "重制开放世界失败");
        }
      } catch {
        // 轮询失败时静默等待下一轮，避免后台任务已启动却被短暂网络抖动中断提示。
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadConfigs, message, rebuildStatus]);

  const handleTestGenerate = useCallback(async (options?: {
    key?: string;
    previewType?: OpenWorldPromptPreviewType;
  }) => {
    setTesting(true);
    setTestingKey(options?.key || null);
    try {
      const response = await fetch("/api/admin/open-world/ai-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options?.previewType ? {
          previewType: options.previewType,
        } : {}),
      });
      const result = await response.json() as OpenWorldAiPreviewResponse;
      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.error || "生成测试预览失败");
      }

      const preview = {
        runtimeMode: String(draftValues.OPEN_WORLD_LLM_MODEL || "").trim() ? "open-world-dedicated" : "fallback-chain",
        baseUrl: String(draftValues.OPEN_WORLD_LLM_BASE_URL || "").trim() || "(回退到 WORLD_FLAVOR_LLM_BASE_URL / LLM_BASE_URL)",
        model: String(draftValues.OPEN_WORLD_LLM_MODEL || "").trim() || "(回退到 WORLD_FLAVOR_LLM_MODEL / LLM_MODEL)",
        promptPreview: {
          map: buildPreviewText(String(draftValues.OPEN_WORLD_MAP_PROMPT || "")),
          npcDna: buildPreviewText(String(draftValues.OPEN_WORLD_NPC_DNA_PROMPT || "")),
          tiandaoEvent: buildPreviewText(String(draftValues.OPEN_WORLD_TIANDAO_EVENT_PROMPT || "")),
          npcBark: buildPreviewText(String(draftValues.OPEN_WORLD_NPC_BARK_PROMPT || "")),
        },
        previewResult: result.data,
      };

      const generatedAt = typeof result.data.generatedAt === "string"
        ? result.data.generatedAt
        : new Date().toISOString();
      setLastTestResult(JSON.stringify(preview, null, 2));
      setLastTestedAt(generatedAt);
      if (options?.key) {
        setPreviewByKey((current) => ({
          ...current,
          [options.key as string]: {
            testedAt: generatedAt,
            content: JSON.stringify(result.data, null, 2),
          },
        }));
      }
      message.success("已生成开放世界 AI 实时预览");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "生成测试预览失败";
      message.error(errorMessage);
    } finally {
      setTesting(false);
      setTestingKey(null);
    }
  }, [draftValues, message]);

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Card
        loading={loading && configItems.length === 0}
        title={(
          <Space wrap>
            <Title level={5} style={{ margin: 0 }}>开放世界</Title>
            <DarkTag color="gold">第五阶段</DarkTag>
            <DarkTag color="blue">界域扩容与秘境奇闻深化</DarkTag>
          </Space>
        )}
        extra={(
          <Space wrap>
            <Text style={{ color: "#b7af9f" }}>
              最近刷新：{formatDateTime(now)}
            </Text>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadConfigs()}>
              刷新
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
              保存开放世界配置
            </Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Text style={{ color: "#b7af9f" }}>
            这一页单独承接开放世界的福利栏位、世界内容概览与 AI 对接配置。底层仍复用 `system_configs`，
            但不把开放世界专属配置继续塞回通用系统配置页里。
          </Text>
        </Space>
      </Card>

      <Row gutter={[12, 12]}>
        {metricCards.map((card) => (
          <Col key={card.title} xs={24} sm={12} xl={8} xxl={4}>
            <OpenWorldMetricCard {...card} />
          </Col>
        ))}
      </Row>

      <Card
        title={(
          <Space wrap>
            <Text strong>世界内容</Text>
            <DarkTag color="blue">6 个子面板</DarkTag>
          </Space>
        )}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text style={{ color: "#b7af9f" }}>
            中部固定展示开放世界当前阶段的 6 个子系统承载区。当前优先把规则、容量预算和后台可视化入口立起来，
            避免一开始就把实时运算全压到服务器上。
          </Text>
          <Row gutter={[12, 12]}>
            {contentPanels.map((panel) => (
              <Col key={panel.title} xs={24} xl={12} xxl={8}>
                <OpenWorldPanel {...panel} />
              </Col>
            ))}
          </Row>
        </Space>
      </Card>

      <Card
        title={(
          <Space wrap>
            <Text strong>势力与街区</Text>
            <DarkTag color="purple">第四阶段</DarkTag>
          </Space>
        )}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text style={{ color: "#b7af9f" }}>
            这里先承接第四阶段的运营总览，重点看哪些街区在变天、哪些势力在压场、哪条故事链正在向前滑。
          </Text>
          <Row gutter={[12, 12]}>
            {factionOverviewCards.map((card) => (
              <Col key={card.title} xs={24} md={8}>
                <OpenWorldMetricCard
                  title={card.title}
                  value={card.value}
                  detail={card.detail}
                  tag={{ color: "purple", label: "势力态势" }}
                />
              </Col>
            ))}
          </Row>
          <Row gutter={[12, 12]}>
            <Col xs={24} xl={8}>
              <Card size="small" title="最近主导街区">
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {(factionOverview?.districtStates || []).slice(0, 4).map((item) => (
                    <div key={item.id}>
                      <Text strong>{item.districtName}</Text>
                      <br />
                      <Text style={{ color: "#d7cfbf" }}>{item.dominantFactionName} · {item.tensionTag}</Text>
                      <br />
                      <Text style={{ color: "#8d8578", fontSize: 12 }}>{formatDateTime(item.updatedAt)}</Text>
                    </div>
                  ))}
                  {(factionOverview?.districtStates || []).length <= 0 ? (
                    <Text style={{ color: "#8d8578" }}>街区态势尚未生成。</Text>
                  ) : null}
                </Space>
              </Card>
            </Col>
            <Col xs={24} xl={8}>
              <Card size="small" title="势力口风">
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {(factionOverview?.factions || []).slice(0, 4).map((item) => (
                    <div key={item.id}>
                      <Text strong>{item.name}</Text>
                      <br />
                      <Text style={{ color: "#d7cfbf" }}>{item.categoryLabel}</Text>
                      <br />
                      <Text style={{ color: "#8d8578", fontSize: 12 }}>{item.standingSummary}</Text>
                    </div>
                  ))}
                  {(factionOverview?.factions || []).length <= 0 ? (
                    <Text style={{ color: "#8d8578" }}>势力数据尚未播种。</Text>
                  ) : null}
                </Space>
              </Card>
            </Col>
            <Col xs={24} xl={8}>
              <Card size="small" title="故事链推进">
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {(factionOverview?.storylines || []).slice(0, 4).map((item) => (
                    <div key={item.id}>
                      <Text strong>{item.districtName}</Text>
                      <br />
                      <Text style={{ color: "#d7cfbf" }}>{item.sourceFactionName} · {item.stageTitle}</Text>
                      <br />
                      <Text style={{ color: "#8d8578", fontSize: 12 }}>
                        {item.status === "active" ? "推进中" : item.status === "completed" ? "已收束" : "已停滞"} · {formatDateTime(item.updatedAt)}
                      </Text>
                    </div>
                  ))}
                  {(factionOverview?.storylines || []).length <= 0 ? (
                    <Text style={{ color: "#8d8578" }}>故事链尚未生成。</Text>
                  ) : null}
                </Space>
              </Card>
            </Col>
          </Row>
        </Space>
      </Card>

      <Card
        title={(
          <Space wrap>
            <Text strong>第五阶段地图池</Text>
            <DarkTag color="blue">16 图冷热分层</DarkTag>
          </Space>
        )}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text style={{ color: "#b7af9f" }}>
            这里固定展示第五阶段的 16 图地图池、4 大界域路网以及奇闻/奇遇/秘境钩子密度，方便直接观察开放世界是否已经进入扩容态。
          </Text>
          <Row gutter={[12, 12]}>
            {mapNetworkCards.map((card) => (
              <Col key={card.title} xs={24} md={12} xl={6}>
                <OpenWorldMetricCard
                  title={card.title}
                  value={card.value}
                  detail={card.detail}
                  tag={{ color: "blue", label: "第五阶段" }}
                />
              </Col>
            ))}
          </Row>
          <Row gutter={[12, 12]}>
            <Col xs={24} xl={8}>
              <Card size="small" title="地图池与冷热分层">
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {(mapNetworkOverview?.maps || []).slice(0, 6).map((item) => (
                    <div key={item.id}>
                      <Text strong>{item.name}</Text>
                      <br />
                      <Text style={{ color: "#d7cfbf" }}>
                        {item.regionBand} · {item.heatTierLabel} · 热度 {item.heatScore}
                      </Text>
                      <br />
                      <Text style={{ color: "#8d8578", fontSize: 12 }}>
                        危险 {item.dangerLevel} / 神秘 {item.mysteryLevel}
                      </Text>
                    </div>
                  ))}
                  {(mapNetworkOverview?.maps || []).length <= 0 ? (
                    <Text style={{ color: "#8d8578" }}>第五阶段地图池尚未生成。</Text>
                  ) : null}
                </Space>
              </Card>
            </Col>
            <Col xs={24} xl={8}>
              <Card size="small" title="界域路网">
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {(mapNetworkOverview?.regionBands || []).map((item) => (
                    <div key={item.regionBand}>
                      <Text strong>{item.regionBand}</Text>
                      <br />
                      <Text style={{ color: "#d7cfbf" }}>
                        {item.mapCount} 图 · 热 {item.hotCount} / 温 {item.warmCount} / 冷 {item.coldCount}
                      </Text>
                      <br />
                      <Text style={{ color: "#8d8578", fontSize: 12 }}>
                        锚点：{item.anchorMaps.join("、")}
                      </Text>
                    </div>
                  ))}
                  {(mapNetworkOverview?.regionBands || []).length <= 0 ? (
                    <Text style={{ color: "#8d8578" }}>界域路网尚未播种。</Text>
                  ) : null}
                </Space>
              </Card>
            </Col>
            <Col xs={24} xl={8}>
              <Card size="small" title="奇闻/奇遇/秘境密度">
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <Text style={{ color: "#d7cfbf" }}>
                    奇闻钩子：{mapNetworkOverview?.explorationDensity.rumorHookCount || 0}
                  </Text>
                  <Text style={{ color: "#d7cfbf" }}>
                    奇遇钩子：{mapNetworkOverview?.explorationDensity.encounterHookCount || 0}
                  </Text>
                  <Text style={{ color: "#d7cfbf" }}>
                    秘境钩子：{mapNetworkOverview?.explorationDensity.secretRealmHookCount || 0}
                  </Text>
                  <Text style={{ color: "#8d8578", fontSize: 12 }}>
                    当前会把这些摘要直接透给地图页折叠面板，移动端先看得到，再逐步接更深的玩法推进。
                  </Text>
                </Space>
              </Card>
            </Col>
          </Row>
        </Space>
      </Card>

      <Card
        title={(
          <Space wrap>
            <RobotOutlined />
            <Text strong>AI 对接与生成配置</Text>
            <DarkTag color={aiReady.color}>{aiReady.label}</DarkTag>
          </Space>
        )}
        extra={(
          <Space wrap>
            <Button icon={<ThunderboltOutlined />} loading={testing} onClick={() => void handleTestGenerate()}>
              测试生成
            </Button>
            <Button loading={rebuilding || rebuildStatus?.status === "running"} onClick={() => void handleRebuild()}>
              {rebuildStatus?.status === "running" ? "重制进行中" : "重制开放世界"}
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
              保存
            </Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Paragraph style={{ margin: 0, color: "#b7af9f" }}>
            开放世界专用配置固定落在本页底部，分别承接世界书、地图主题、NPC DNA、天道事件和附近短句。
            若专用 LLM 留空，则按“开放世界模型 → 世界风味模型 → 通用模型”的顺序回退。
          </Paragraph>
          {rebuildStatus ? (
            <Card size="small" style={{ background: "rgba(9, 13, 22, 0.66)" }}>
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Space wrap>
                  <Text strong>重制任务状态</Text>
                  <DarkTag color={rebuildStatus.status === "completed" ? "green" : rebuildStatus.status === "failed" ? "red" : rebuildStatus.status === "running" ? "blue" : "gold"}>
                    {rebuildStatus.status === "completed"
                      ? "已完成"
                      : rebuildStatus.status === "failed"
                        ? "失败"
                        : rebuildStatus.status === "running"
                          ? "进行中"
                          : "未开始"}
                  </DarkTag>
                  {rebuildStatus.startedAt ? <Text style={{ color: "#8d8578", fontSize: 12 }}>开始于 {formatDateTime(rebuildStatus.startedAt)}</Text> : null}
                  {rebuildStatus.finishedAt ? <Text style={{ color: "#8d8578", fontSize: 12 }}>结束于 {formatDateTime(rebuildStatus.finishedAt)}</Text> : null}
                </Space>
                <Progress
                  percent={rebuildStatus.progressPercent}
                  size="small"
                  strokeColor={rebuildStatus.status === "failed" ? "#ff7875" : rebuildStatus.status === "completed" ? "#95de64" : "#5b8cff"}
                  trailColor="rgba(255,255,255,0.08)"
                  format={(percent) => `${percent || 0}%`}
                />
                <Space wrap>
                  <Text style={{ color: "#d7cfbf" }}>{`当前阶段：${rebuildStatus.phaseLabel}`}</Text>
                  <Text style={{ color: "#8d8578", fontSize: 12 }}>
                    {`进度计数：${formatTaskCounter(rebuildStatus.current, rebuildStatus.total)}`}
                  </Text>
                </Space>
                <Text style={{ color: "#d7cfbf" }}>{rebuildStatus.detail}</Text>
                {rebuildStatus.summary ? (
                  <Text style={{ color: "#8d8578", fontSize: 12 }}>
                    {`地图 ${rebuildStatus.summary.mapCount} / 风闻 ${rebuildStatus.summary.rumorRefreshCount} / 故事链 ${rebuildStatus.summary.refreshedStorylineCount}`}
                  </Text>
                ) : null}
                {(rebuildStatus.logs || []).length > 0 ? (
                  <Card
                    size="small"
                    title="最近执行日志"
                    style={{ background: "rgba(255,255,255,0.02)" }}
                  >
                    <ScrollableContent style={{ maxHeight: "min(36vh, 260px)", paddingRight: 4 }}>
                      <Space direction="vertical" size={8} style={{ width: "100%" }}>
                        {rebuildStatus.logs.slice(0, 6).map((log) => (
                          <div key={`${log.at}:${log.phase}:${log.detail}`}>
                            <Space wrap size={6}>
                              <DarkTag color="blue">{log.phaseLabel}</DarkTag>
                              <Text style={{ color: "#8d8578", fontSize: 12 }}>{formatDateTime(log.at)}</Text>
                            </Space>
                            <div>
                              <Text style={{ color: "#d7cfbf", fontSize: 12 }}>{log.detail}</Text>
                            </div>
                          </div>
                        ))}
                      </Space>
                    </ScrollableContent>
                  </Card>
                ) : null}
              </Space>
            </Card>
          ) : null}

          <Tabs
            activeKey={activeAiTab}
            onChange={setActiveAiTab}
            items={[
              {
                key: "llm",
                label: (
                  <Space size={6}>
                    <Text strong>模型接入</Text>
                    <DarkTag color="blue">{llmItems.length}</DarkTag>
                  </Space>
                ),
              },
              {
                key: "worldbook",
                label: (
                  <Space size={6}>
                    <Text strong>世界书</Text>
                    <DarkTag color="purple">
                      {worldBookItems.filter((item) => item.key !== "OPEN_WORLD_PRESSURE_RELIEF_RULES_JSON" && item.key !== "OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON").length}
                    </DarkTag>
                  </Space>
                ),
              },
              {
                key: "rules",
                label: (
                  <Space size={6}>
                    <Text strong>规则与约束</Text>
                    <DarkTag color="gold">1</DarkTag>
                  </Space>
                ),
              },
              {
                key: "custom-npc",
                label: (
                  <Space size={6}>
                    <Text strong>自定义 NPC</Text>
                    <DarkTag color="green">{customNpcLibraryDraft.npcs.length}</DarkTag>
                  </Space>
                ),
              },
              {
                key: "prompts",
                label: (
                  <Space size={6}>
                    <Text strong>提示词分组</Text>
                    <DarkTag color="blue">{groupedPromptItems.length}</DarkTag>
                  </Space>
                ),
              },
              {
                key: "preview",
                label: (
                  <Space size={6}>
                    <Text strong>预览与回退</Text>
                    <DarkTag color="cyan">{lastTestedAt ? "最近有结果" : "待测试"}</DarkTag>
                  </Space>
                ),
              },
            ]}
          />

          {activeAiTab === "llm" ? (
            <Card size="small" style={{ background: "rgba(255,255,255,0.02)" }}>
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Text style={{ color: "#8d8578" }}>
                  这里只放开放世界专用模型接入项，避免与世界书、规则、自定义 NPC 混在一起。模型留空时，运行时仍会按原有回退链继续兜底。
                </Text>
                <Row gutter={[12, 12]}>
                  {llmItems.map((item) => (
                    <Col key={item.key} xs={24} xl={8}>
                      <Card
                        size="small"
                        title={(
                          <Space wrap>
                            <Text code>{item.key}</Text>
                            <DarkTag color={rowsByKey[item.key] ? "green" : "gold"}>
                              {rowsByKey[item.key] ? "已保存" : "默认/待创建"}
                            </DarkTag>
                          </Space>
                        )}
                      >
                        <Space direction="vertical" size={8} style={{ width: "100%" }}>
                          <Text style={{ color: "#b7af9f" }}>{item.description}</Text>
                          {item.isSecret ? (
                            <Input.Password
                              value={draftValues[item.key] || ""}
                              placeholder={`请输入 ${item.key}`}
                              onChange={(event) => handleDraftChange(item.key, event.target.value)}
                            />
                          ) : (
                            <Input
                              value={draftValues[item.key] || ""}
                              placeholder={`请输入 ${item.key}`}
                              onChange={(event) => handleDraftChange(item.key, event.target.value)}
                            />
                          )}
                        </Space>
                      </Card>
                    </Col>
                  ))}
                </Row>
              </Space>
            </Card>
          ) : null}

          {(activeAiTab === "worldbook" || activeAiTab === "rules" || activeAiTab === "custom-npc") ? (
            <Card size="small" style={{ background: "rgba(255,255,255,0.02)" }}>
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Text style={{ color: "#8d8578" }}>
                  {activeAiTab === "worldbook"
                    ? "世界书、关键词池与原始世界书 JSON 被拆到同一组里，便于集中管理世界观上下文。"
                    : activeAiTab === "rules"
                      ? "这里专门集中管理洗影响、高堕落强制与触发约束，不再跟其他长表单混排。"
                      : "这里承接自定义 NPC 的 AI 生成、可视化微调与原始 JSON，对应运行时注入池。"}
                </Text>
                <Row gutter={[12, 12]}>
            {worldBookItems.map((item) => {
              const previewType = OPEN_WORLD_PROMPT_PREVIEW_BY_KEY[item.key];
              const preview = previewByKey[item.key] || null;
              const isBooleanField = item.key === "OPEN_WORLD_WORLDBOOK_ENABLED";
              const isKeywordPoolField = item.key === "OPEN_WORLD_KEYWORD_POOL_JSON";
              const isPressureReliefField = item.key === "OPEN_WORLD_PRESSURE_RELIEF_RULES_JSON";
              const isCustomNpcField = item.key === "OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON";
              const visibleInCurrentTab = activeAiTab === "worldbook"
                ? !isPressureReliefField && !isCustomNpcField
                : activeAiTab === "rules"
                  ? isPressureReliefField
                  : isCustomNpcField;

              if (!visibleInCurrentTab) {
                return null;
              }
              return (
                <Col
                  key={item.key}
                  xs={24}
                  xl={isCustomNpcField ? 24 : OPEN_WORLD_LARGE_JSON_KEYS.has(item.key) ? 16 : 8}
                >
                  <Card
                    size="small"
                    title={(
                      <Space wrap>
                        <Text code>{item.key}</Text>
                        <DarkTag color={rowsByKey[item.key] ? "green" : "gold"}>
                          {rowsByKey[item.key] ? "已保存" : "默认值"}
                        </DarkTag>
                      </Space>
                    )}
                    extra={previewType ? (
                      <Button
                        size="small"
                        icon={<ThunderboltOutlined />}
                        loading={testing && testingKey === item.key}
                        onClick={() => void handleTestGenerate({
                          key: item.key,
                          previewType,
                        })}
                      >
                        测试世界书
                      </Button>
                    ) : null}
                  >
                    <Space direction="vertical" size={8} style={{ width: "100%" }}>
                      <Text style={{ color: "#b7af9f" }}>{item.description}</Text>
                      {isBooleanField ? (
                        <Card size="small" style={{ background: "rgba(9, 13, 22, 0.66)" }}>
                          <Space direction="vertical" size={10} style={{ width: "100%" }}>
                            <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                              <Text strong>世界书总开关</Text>
                              <Switch
                                checked={String(draftValues[item.key] || "").trim().toLowerCase() === "true"}
                                checkedChildren="启用"
                                unCheckedChildren="停用"
                                onChange={(checked) => handleDraftChange(item.key, checked ? "true" : "false")}
                              />
                            </Space>
                            <Text style={{ color: "#8d8578", fontSize: 12 }}>
                              这里只控制开放世界是否把世界书上下文拼进 AI 生成链。底部仍保留原始值，方便直接核对。
                            </Text>
                            <Input
                              value={draftValues[item.key] || ""}
                              placeholder="true / false"
                              onChange={(event) => handleDraftChange(item.key, event.target.value)}
                            />
                          </Space>
                        </Card>
                      ) : isKeywordPoolField ? (
                        <Space direction="vertical" size={12} style={{ width: "100%" }}>
                          <Card size="small" style={{ background: "rgba(9, 13, 22, 0.66)" }}>
                            <Space direction="vertical" size={10} style={{ width: "100%" }}>
                              <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                                <Text strong>AI 自动扩写词池</Text>
                                <Button
                                  type="primary"
                                  icon={<RobotOutlined />}
                                  loading={testing && testingKey === "OPEN_WORLD_KEYWORD_POOL_JSON"}
                                  onClick={() => void handleGenerateKeywordPool()}
                                >
                                  一键识别生成
                                </Button>
                              </Space>
                              <Text style={{ color: "#8d8578", fontSize: 12 }}>
                                这里只需要给少量种子关键词、文风关键词或禁忌词，AI 会自动补齐完整 NPC 名字、性格、势力、风声与街区词池，并直接回填到底层 JSON。
                              </Text>
                              <Row gutter={[12, 12]}>
                                <Col xs={24} xl={12}>
                                  <Card size="small" title="种子关键词">
                                    <Space direction="vertical" size={6} style={{ width: "100%" }}>
                                      <Text style={{ color: "#8d8578", fontSize: 12 }}>
                                        写你想保留的核心词，例如门派、地界、气质、职业、人物关系。
                                      </Text>
                                      <TextArea
                                        autoSize={{ minRows: 4, maxRows: 7 }}
                                        value={keywordPoolSeedInput}
                                        placeholder="例如：边荒、灰巷、散修、卖讯、旧债、人情"
                                        onChange={(event) => setKeywordPoolSeedInput(event.target.value)}
                                      />
                                    </Space>
                                  </Card>
                                </Col>
                                <Col xs={24} xl={12}>
                                  <Card size="small" title="文风关键词">
                                    <Space direction="vertical" size={6} style={{ width: "100%" }}>
                                      <Text style={{ color: "#8d8578", fontSize: 12 }}>
                                        用来约束整体口风，例如偏灰暗、偏纯爱、偏江湖、偏冷峻。
                                      </Text>
                                      <TextArea
                                        autoSize={{ minRows: 4, maxRows: 7 }}
                                        value={keywordPoolStyleInput}
                                        placeholder="例如：灰色修仙界、尘世人情、冷峻、欲而不俗"
                                        onChange={(event) => setKeywordPoolStyleInput(event.target.value)}
                                      />
                                    </Space>
                                  </Card>
                                </Col>
                                <Col xs={24} xl={12}>
                                  <Card size="small" title="禁忌词">
                                    <Space direction="vertical" size={6} style={{ width: "100%" }}>
                                      <Text style={{ color: "#8d8578", fontSize: 12 }}>
                                        不希望 AI 写进去的现代词、违和词或你不想出现的设定。
                                      </Text>
                                      <TextArea
                                        autoSize={{ minRows: 4, maxRows: 7 }}
                                        value={keywordPoolForbiddenInput}
                                        placeholder="例如：总裁、警察、赛博、枪械"
                                        onChange={(event) => setKeywordPoolForbiddenInput(event.target.value)}
                                      />
                                    </Space>
                                  </Card>
                                </Col>
                                <Col xs={24} xl={12}>
                                  <Card size="small" title="世界主题">
                                    <Space direction="vertical" size={6} style={{ width: "100%" }}>
                                      <Text style={{ color: "#8d8578", fontSize: 12 }}>
                                        可选补一句总设定，留空时会回退到当前开放世界默认主题。
                                      </Text>
                                      <Input
                                        value={keywordPoolWorldThemeInput}
                                        placeholder="例如：成人向灰暗修仙界，街区任务链与流动 NPC 生态"
                                        onChange={(event) => setKeywordPoolWorldThemeInput(event.target.value)}
                                      />
                                    </Space>
                                  </Card>
                                </Col>
                              </Row>
                            </Space>
                          </Card>
                          <Card size="small" style={{ background: "rgba(9, 13, 22, 0.66)" }}>
                            <Space direction="vertical" size={8} style={{ width: "100%" }}>
                              <Text strong>关键词池可视化编辑</Text>
                              <Text style={{ color: "#8d8578", fontSize: 12 }}>
                                一行一个词，也支持逗号分隔。改这里会自动同步回底层 JSON。
                              </Text>
                              <Row gutter={[12, 12]}>
                                {KEYWORD_POOL_FIELD_DEFS.map((field) => (
                                  <Col key={field.key} xs={24} xl={12}>
                                    <Card size="small" title={field.label}>
                                      <Space direction="vertical" size={6} style={{ width: "100%" }}>
                                        <Text style={{ color: "#8d8578", fontSize: 12 }}>{field.description}</Text>
                                        <TextArea
                                          autoSize={{ minRows: 4, maxRows: 8 }}
                                          value={formatTextAreaList(keywordPoolDraft[field.key])}
                                          placeholder={`编辑${field.label}`}
                                          onChange={(event) => handleKeywordPoolFieldChange(field.key, event.target.value)}
                                        />
                                      </Space>
                                    </Card>
                                  </Col>
                                ))}
                              </Row>
                            </Space>
                          </Card>
                          <Collapse
                            items={[{
                              key: `${item.key}:raw`,
                              label: "查看原始 JSON",
                              children: (
                                <TextArea
                                  autoSize={{ minRows: 10, maxRows: 18 }}
                                  style={{ maxHeight: "min(48vh, 420px)", overflowY: "auto" }}
                                  value={draftValues[item.key] || ""}
                                  placeholder={resolveWorldBookPlaceholder(item.key)}
                                  onChange={(event) => handleDraftChange(item.key, event.target.value)}
                                />
                              ),
                            }]}
                          />
                        </Space>
                      ) : isPressureReliefField ? (
                        <Space direction="vertical" size={12} style={{ width: "100%" }}>
                          <Card size="small" style={{ background: "rgba(9, 13, 22, 0.66)" }}>
                            <Space direction="vertical" size={12} style={{ width: "100%" }}>
                              <Text strong>洗影响与高堕落规则</Text>
                              <Row gutter={[12, 12]}>
                                <Col xs={24} md={12}>
                                  <Card size="small" title="高堕落阈值">
                                    <InputNumber
                                      min={50}
                                      max={100}
                                      style={{ width: "100%" }}
                                      value={pressureReliefDraft.highCorruptionThreshold}
                                      onChange={(value) => handlePressureRulesRootChange("highCorruptionThreshold", value)}
                                    />
                                  </Card>
                                </Col>
                                <Col xs={24} md={12}>
                                  <Card size="small" title="每图自定义 NPC 上限">
                                    <InputNumber
                                      min={1}
                                      max={4}
                                      style={{ width: "100%" }}
                                      value={pressureReliefDraft.perMapCustomNpcLimit}
                                      onChange={(value) => handlePressureRulesRootChange("perMapCustomNpcLimit", value)}
                                    />
                                  </Card>
                                </Col>
                              </Row>
                              <Row gutter={[12, 12]}>
                                {PRESSURE_RULE_META.map((meta) => {
                                  const rule = pressureReliefDraft.rules.find((entry) => entry.offerType === meta.offerType);
                                  if (!rule) {
                                    return null;
                                  }
                                  return (
                                    <Col key={meta.offerType} xs={24} xl={12}>
                                      <Card
                                        size="small"
                                        title={meta.title}
                                        extra={(
                                          <Switch
                                            checked={rule.enabled}
                                            checkedChildren="启用"
                                            unCheckedChildren="关闭"
                                            onChange={(checked) => handlePressureRuleChange(meta.offerType, { enabled: checked })}
                                          />
                                        )}
                                      >
                                        <Space direction="vertical" size={8} style={{ width: "100%" }}>
                                          <Text style={{ color: "#8d8578", fontSize: 12 }}>{meta.description}</Text>
                                          <Input
                                            value={rule.label}
                                            placeholder="显示标题"
                                            onChange={(event) => handlePressureRuleChange(meta.offerType, { label: event.target.value })}
                                          />
                                          <Input
                                            value={rule.sourceFaction}
                                            placeholder="来源势力"
                                            onChange={(event) => handlePressureRuleChange(meta.offerType, { sourceFaction: event.target.value })}
                                          />
                                          <InputNumber
                                            min={1}
                                            max={60}
                                            style={{ width: "100%" }}
                                            value={rule.baseReliefValue}
                                            addonBefore="基础减压"
                                            onChange={(value) => handlePressureRuleChange(meta.offerType, {
                                              baseReliefValue: normalizeInteger(value, rule.baseReliefValue, 1, 60),
                                            })}
                                          />
                                          <Select
                                            mode="multiple"
                                            style={{ width: "100%" }}
                                            value={rule.pressureTargets}
                                            options={PRESSURE_TARGET_OPTIONS}
                                            placeholder="作用的世界压力字段"
                                            onChange={(values) => handlePressureRuleListChange(meta.offerType, "pressureTargets", values)}
                                          />
                                          <Select
                                            mode="multiple"
                                            style={{ width: "100%" }}
                                            value={rule.forcedActions}
                                            options={FORCED_ACTION_OPTIONS}
                                            placeholder="可触发的强制后果"
                                            onChange={(values) => handlePressureRuleListChange(meta.offerType, "forcedActions", values)}
                                          />
                                          <Select
                                            style={{ width: "100%" }}
                                            value={rule.coerciveFlavorLevel}
                                            options={[
                                              { value: "low", label: "低压" },
                                              { value: "medium", label: "中压" },
                                              { value: "high", label: "高压" },
                                            ]}
                                            onChange={(value) => handlePressureRuleChange(meta.offerType, { coerciveFlavorLevel: value })}
                                          />
                                          <Switch
                                            checked={rule.consentRequired}
                                            checkedChildren="需要同意"
                                            unCheckedChildren="不强制同意"
                                            onChange={(checked) => handlePressureRuleChange(meta.offerType, { consentRequired: checked })}
                                          />
                                          <TextArea
                                            autoSize={{ minRows: 3, maxRows: 6 }}
                                            value={formatTextAreaList(rule.requiresKeywords)}
                                            placeholder="关键词限制"
                                            onChange={(event) => handlePressureRuleKeywordsChange(meta.offerType, event.target.value)}
                                          />
                                          <TextArea
                                            autoSize={{ minRows: 3, maxRows: 6 }}
                                            value={rule.summaryHint}
                                            placeholder="玩家前台摘要"
                                            onChange={(event) => handlePressureRuleChange(meta.offerType, { summaryHint: event.target.value })}
                                          />
                                        </Space>
                                      </Card>
                                    </Col>
                                  );
                                })}
                              </Row>
                            </Space>
                          </Card>
                          <Collapse
                            items={[{
                              key: `${item.key}:raw`,
                              label: "查看原始 JSON",
                              children: (
                                <TextArea
                                  autoSize={{ minRows: 10, maxRows: 18 }}
                                  style={{ maxHeight: "min(48vh, 420px)", overflowY: "auto" }}
                                  value={draftValues[item.key] || ""}
                                  placeholder={resolveWorldBookPlaceholder(item.key)}
                                  onChange={(event) => handleDraftChange(item.key, event.target.value)}
                                />
                              ),
                            }]}
                          />
                        </Space>
                      ) : isCustomNpcField ? (
                        <Space direction="vertical" size={12} style={{ width: "100%" }}>
                          <Card size="small" style={{ background: "rgba(9, 13, 22, 0.66)" }}>
                            <Space direction="vertical" size={10} style={{ width: "100%" }}>
                              <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                                <Text strong>AI 自动生成自定义 NPC 库</Text>
                                <Button
                                  type="primary"
                                  icon={<RobotOutlined />}
                                  loading={testing && testingKey === "OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON"}
                                  onClick={() => void handleGenerateCustomNpcLibrary()}
                                >
                                  一键生成 NPC
                                </Button>
                              </Space>
                              <Text style={{ color: "#8d8578", fontSize: 12 }}>
                                这里默认就是全自动造人模式。你只要写关键词、世界主题、想要的人群气质和数量，AI 会直接生成整批可注入开放世界与普通世界动态层的自定义 NPC，并自动回填到 NPC 库。
                              </Text>
                              <Row gutter={[12, 12]}>
                                <Col xs={24} xl={12}>
                                  <Card size="small" title="人物关键词">
                                    <Space direction="vertical" size={6} style={{ width: "100%" }}>
                                      <Text style={{ color: "#8d8578", fontSize: 12 }}>
                                        例如势力、癖好、身份、旧债、关系链、常见职业、灰线路数。
                                      </Text>
                                      <TextArea
                                        autoSize={{ minRows: 4, maxRows: 7 }}
                                        value={customNpcSeedInput}
                                        placeholder="例如：黑市、夜渡会、卖讯、灰巷旧人、旧债、人情、纯爱、魔修"
                                        onChange={(event) => setCustomNpcSeedInput(event.target.value)}
                                      />
                                    </Space>
                                  </Card>
                                </Col>
                                <Col xs={24} xl={12}>
                                  <Card size="small" title="文风与群像气质">
                                    <Space direction="vertical" size={6} style={{ width: "100%" }}>
                                      <Text style={{ color: "#8d8578", fontSize: 12 }}>
                                        用来控制这一批 NPC 的整体口风，比如偏尘世、偏冷艳、偏狠厉、偏暧昧。
                                      </Text>
                                      <TextArea
                                        autoSize={{ minRows: 4, maxRows: 7 }}
                                        value={customNpcStyleInput}
                                        placeholder="例如：灰色修仙界、街巷烟火、危险试探、旧人情债、欲而不俗"
                                        onChange={(event) => setCustomNpcStyleInput(event.target.value)}
                                      />
                                    </Space>
                                  </Card>
                                </Col>
                                <Col xs={24} xl={8}>
                                  <Card size="small" title="禁忌词">
                                    <Space direction="vertical" size={6} style={{ width: "100%" }}>
                                      <Text style={{ color: "#8d8578", fontSize: 12 }}>
                                        不要让 AI 生成这些违和内容。
                                      </Text>
                                      <TextArea
                                        autoSize={{ minRows: 4, maxRows: 7 }}
                                        value={customNpcForbiddenInput}
                                        placeholder="例如：总裁、赛博、直播、枪械、警察"
                                        onChange={(event) => setCustomNpcForbiddenInput(event.target.value)}
                                      />
                                    </Space>
                                  </Card>
                                </Col>
                                <Col xs={24} xl={8}>
                                  <Card size="small" title="偏好界域标签">
                                    <Space direction="vertical" size={6} style={{ width: "100%" }}>
                                      <Text style={{ color: "#8d8578", fontSize: 12 }}>
                                        AI 会优先把这批 NPC 绑定到这些界域或地图气质。
                                      </Text>
                                      <TextArea
                                        autoSize={{ minRows: 4, maxRows: 7 }}
                                        value={customNpcMapTagsInput}
                                        placeholder="例如：散修坊市带、边荒灰域带、凡尘城镇带"
                                        onChange={(event) => setCustomNpcMapTagsInput(event.target.value)}
                                      />
                                    </Space>
                                  </Card>
                                </Col>
                                <Col xs={24} xl={8}>
                                  <Card size="small" title="世界主题与数量">
                                    <Space direction="vertical" size={8} style={{ width: "100%" }}>
                                      <Input
                                        value={customNpcWorldThemeInput}
                                        placeholder="例如：成人向灰暗修仙界中的流动修士生态"
                                        onChange={(event) => setCustomNpcWorldThemeInput(event.target.value)}
                                      />
                                      <InputNumber
                                        min={1}
                                        max={8}
                                        style={{ width: "100%" }}
                                        value={customNpcCountInput}
                                        addonBefore="生成数量"
                                        onChange={(value) => setCustomNpcCountInput(normalizeInteger(value, customNpcCountInput, 1, 8))}
                                      />
                                    </Space>
                                  </Card>
                                </Col>
                              </Row>
                            </Space>
                          </Card>
                          <Card
                            size="small"
                            style={{ background: "rgba(9, 13, 22, 0.66)" }}
                            extra={(
                              <Button icon={<PlusOutlined />} onClick={() => handleAddCustomNpc()}>
                                新增 NPC
                              </Button>
                            )}
                          >
                            <Space direction="vertical" size={10} style={{ width: "100%" }}>
                              <Text strong>自定义 NPC 可视化编辑</Text>
                              <Text style={{ color: "#8d8578", fontSize: 12 }}>
                                这里保留为 AI 生成后的微调区。正常使用建议先点上方按钮让 AI 生成，再在这里少量改动，而不是从零手填。
                              </Text>
                              {customNpcLibraryDraft.npcs.length > 0 ? customNpcLibraryDraft.npcs.map((npc, npcIndex) => (
                                <Card
                                  key={`${npc.id || "custom"}:${npcIndex}`}
                                  size="small"
                                  title={npc.name || `未命名 NPC #${npcIndex + 1}`}
                                  extra={(
                                    <Button
                                      danger
                                      size="small"
                                      icon={<DeleteOutlined />}
                                      onClick={() => handleRemoveCustomNpc(npcIndex)}
                                    >
                                      删除
                                    </Button>
                                  )}
                                >
                                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                                    <Row gutter={[12, 12]}>
                                      <Col xs={24} md={12} xl={6}>
                                        <Input
                                          value={npc.id}
                                          placeholder="唯一 ID"
                                          onChange={(event) => handleCustomNpcFieldChange(npcIndex, "id", event.target.value)}
                                        />
                                      </Col>
                                      <Col xs={24} md={12} xl={6}>
                                        <Input
                                          value={npc.name}
                                          placeholder="名字"
                                          onChange={(event) => handleCustomNpcFieldChange(npcIndex, "name", event.target.value)}
                                        />
                                      </Col>
                                      <Col xs={24} md={12} xl={4}>
                                        <Select
                                          style={{ width: "100%" }}
                                          value={npc.gender}
                                          options={[
                                            { value: "female", label: "女" },
                                            { value: "male", label: "男" },
                                          ]}
                                          onChange={(value) => handleCustomNpcFieldChange(npcIndex, "gender", value)}
                                        />
                                      </Col>
                                      <Col xs={24} md={12} xl={4}>
                                        <InputNumber
                                          min={1}
                                          max={99}
                                          style={{ width: "100%" }}
                                          value={npc.realmMinor}
                                          addonBefore="境界"
                                          onChange={(value) => handleCustomNpcFieldChange(npcIndex, "realmMinor", normalizeInteger(value, npc.realmMinor, 1, 99))}
                                        />
                                      </Col>
                                      <Col xs={24} xl={4}>
                                        <Space direction="vertical" size={4} style={{ width: "100%" }}>
                                          <Switch
                                            checked={npc.writeToRandomPool}
                                            checkedChildren="写随机池"
                                            unCheckedChildren="不写随机池"
                                            onChange={(checked) => handleCustomNpcFieldChange(npcIndex, "writeToRandomPool", checked)}
                                          />
                                          <Switch
                                            checked={npc.allowDynamicWorldSpawn}
                                            checkedChildren="允许动态刷新"
                                            unCheckedChildren="禁止动态刷新"
                                            onChange={(checked) => handleCustomNpcFieldChange(npcIndex, "allowDynamicWorldSpawn", checked)}
                                          />
                                        </Space>
                                      </Col>
                                    </Row>
                                    <Row gutter={[12, 12]}>
                                      <Col xs={24} md={8}>
                                        <Input
                                          value={npc.originType}
                                          placeholder="出身"
                                          onChange={(event) => handleCustomNpcFieldChange(npcIndex, "originType", event.target.value)}
                                        />
                                      </Col>
                                      <Col xs={24} md={8}>
                                        <Input
                                          value={npc.profession}
                                          placeholder="职业"
                                          onChange={(event) => handleCustomNpcFieldChange(npcIndex, "profession", event.target.value)}
                                        />
                                      </Col>
                                      <Col xs={24} md={8}>
                                        <Input
                                          value={npc.faction}
                                          placeholder="势力"
                                          onChange={(event) => handleCustomNpcFieldChange(npcIndex, "faction", event.target.value)}
                                        />
                                      </Col>
                                    </Row>
                                    <Input
                                      value={npc.primaryPartnerId}
                                      placeholder="主道侣 ID"
                                      onChange={(event) => handleCustomNpcFieldChange(npcIndex, "primaryPartnerId", event.target.value)}
                                    />
                                    <TextArea
                                      autoSize={{ minRows: 3, maxRows: 6 }}
                                      value={npc.personalitySummary}
                                      placeholder="人格摘要"
                                      onChange={(event) => handleCustomNpcFieldChange(npcIndex, "personalitySummary", event.target.value)}
                                    />
                                    <Divider style={{ margin: "4px 0 0" }} />
                                    <Row gutter={[12, 12]}>
                                      {CUSTOM_NPC_LIST_FIELDS.map((field) => (
                                        <Col key={field.key} xs={24} md={12} xl={6}>
                                          <Card size="small" title={field.label}>
                                            <Space direction="vertical" size={6} style={{ width: "100%" }}>
                                              <Text style={{ color: "#8d8578", fontSize: 12 }}>{field.description}</Text>
                                              <TextArea
                                                autoSize={{ minRows: 4, maxRows: 8 }}
                                                value={formatTextAreaList(npc[field.key])}
                                                placeholder={`编辑${field.label}`}
                                                onChange={(event) => handleCustomNpcListFieldChange(npcIndex, field.key, event.target.value)}
                                              />
                                            </Space>
                                          </Card>
                                        </Col>
                                      ))}
                                    </Row>
                                  </Space>
                                </Card>
                              )) : (
                                <Text style={{ color: "#8d8578" }}>当前还没有自定义 NPC，点击右上角可直接新增。</Text>
                              )}
                            </Space>
                          </Card>
                          <Collapse
                            items={[{
                              key: `${item.key}:raw`,
                              label: "查看原始 JSON",
                              children: (
                                <TextArea
                                  autoSize={{ minRows: 12, maxRows: 20 }}
                                  style={{ maxHeight: "min(56vh, 520px)", overflowY: "auto" }}
                                  value={draftValues[item.key] || ""}
                                  placeholder={resolveWorldBookPlaceholder(item.key)}
                                  onChange={(event) => handleDraftChange(item.key, event.target.value)}
                                />
                              ),
                            }]}
                          />
                        </Space>
                      ) : (
                        <TextArea
                          autoSize={{ minRows: 10, maxRows: 18 }}
                          style={{ maxHeight: "min(48vh, 420px)", overflowY: "auto" }}
                          value={draftValues[item.key] || ""}
                          placeholder={resolveWorldBookPlaceholder(item.key)}
                          onChange={(event) => handleDraftChange(item.key, event.target.value)}
                        />
                      )}
                      <Card
                        size="small"
                        style={{ background: "rgba(9, 13, 22, 0.66)" }}
                        title={(
                          <Space wrap>
                            <Text>最近一次世界书预览</Text>
                            {preview?.testedAt ? <DarkTag color="blue">{formatDateTime(preview.testedAt)}</DarkTag> : null}
                          </Space>
                        )}
                      >
                        <ScrollableContent style={previewScrollStyle}>
                          <pre
                            style={{
                              margin: 0,
                              whiteSpace: "pre-wrap",
                              color: "#d7cfbf",
                              fontSize: 12,
                              lineHeight: 1.6,
                              fontFamily: "Consolas, Monaco, monospace",
                            }}
                          >
                            {preview?.content || "这里会显示世界书命中的条目、插入位置和拼接后的上下文片段。"}
                          </pre>
                        </ScrollableContent>
                      </Card>
                    </Space>
                  </Card>
                </Col>
              );
            })}
                </Row>
              </Space>
            </Card>
          ) : null}

          {activeAiTab === "prompts" ? (
            <Card size="small" style={{ background: "rgba(255,255,255,0.02)" }}>
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Text style={{ color: "#8d8578" }}>
                  提示词继续按业务分组收纳，避免所有 prompt 直接平铺成长页。每组内部仍保留单项测试与最近一次预览。
                </Text>
                <Collapse
                  defaultActiveKey={["style", "adult"]}
                  items={groupedPromptItems.map((group) => ({
                    key: group.id,
                    label: (
                      <Space wrap>
                        <Text strong>{group.title}</Text>
                        <DarkTag color="blue">{group.items.length} 项</DarkTag>
                        <Text style={{ color: "#8d8578", fontSize: 12 }}>{group.description}</Text>
                      </Space>
                    ),
                    children: (
                      <Row gutter={[12, 12]}>
                        {group.items.map((item) => {
                          const preview = previewByKey[item.key] || null;
                          const previewType = OPEN_WORLD_PROMPT_PREVIEW_BY_KEY[item.key];
                          return (
                            <Col key={item.key} xs={24} xl={12}>
                              <Card
                                size="small"
                                title={(
                                  <Space wrap>
                                    <Text code>{item.key}</Text>
                                    <DarkTag color={rowsByKey[item.key] ? "green" : "gold"}>
                                      {rowsByKey[item.key] ? "已保存" : "默认值"}
                                    </DarkTag>
                                  </Space>
                                )}
                                extra={previewType ? (
                                  <Button
                                    size="small"
                                    icon={<ThunderboltOutlined />}
                                    loading={testing && testingKey === item.key}
                                    onClick={() => void handleTestGenerate({
                                      key: item.key,
                                      previewType,
                                    })}
                                  >
                                    测试此项
                                  </Button>
                                ) : null}
                              >
                                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                                  <Text style={{ color: "#b7af9f" }}>{item.description}</Text>
                                  <TextArea
                                    autoSize={{ minRows: 7, maxRows: 15 }}
                                    style={{ maxHeight: "min(46vh, 360px)", overflowY: "auto" }}
                                    value={draftValues[item.key] || ""}
                                    placeholder={`请输入 ${item.key}`}
                                    onChange={(event) => handleDraftChange(item.key, event.target.value)}
                                  />
                                  <Card
                                    size="small"
                                    style={{ background: "rgba(9, 13, 22, 0.66)" }}
                                    title={(
                                      <Space wrap>
                                        <Text>最近一次预览</Text>
                                        {preview?.testedAt ? <DarkTag color="blue">{formatDateTime(preview.testedAt)}</DarkTag> : null}
                                      </Space>
                                    )}
                                  >
                                    <ScrollableContent style={previewScrollStyle}>
                                      <pre
                                        style={{
                                          margin: 0,
                                          whiteSpace: "pre-wrap",
                                          color: "#d7cfbf",
                                          fontSize: 12,
                                          lineHeight: 1.6,
                                          fontFamily: "Consolas, Monaco, monospace",
                                        }}
                                      >
                                        {preview?.content || "点击“测试此项”后，这里会显示该提示词对应场景的实时预览。"}
                                      </pre>
                                    </ScrollableContent>
                                  </Card>
                                </Space>
                              </Card>
                            </Col>
                          );
                        })}
                      </Row>
                    ),
                  }))}
                />
              </Space>
            </Card>
          ) : null}

          {activeAiTab === "preview" ? (
            <Card size="small" style={{ background: "rgba(255,255,255,0.02)" }}>
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Text style={{ color: "#8d8578" }}>
                  这里单独汇总最近一次整体预览结果与回退说明，避免插在所有编辑框中间影响管理视线。
                </Text>
                <Row gutter={[12, 12]}>
            <Col xs={24} xl={14}>
              <Card
                size="small"
                title={(
                  <Space wrap>
                    <Text strong>最近一次生成结果预览</Text>
                    {lastTestedAt ? (
                      <DarkTag color="blue">{formatDateTime(lastTestedAt)}</DarkTag>
                    ) : null}
                  </Space>
                )}
              >
                <ScrollableContent
                  minHeight={240}
                  style={{ maxHeight: "min(48vh, 420px)", paddingRight: 4 }}
                >
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      color: "#d7cfbf",
                      fontSize: 12,
                      lineHeight: 1.6,
                      fontFamily: "Consolas, Monaco, monospace",
                    }}
                  >
                    {lastTestResult || "点击“测试生成”后，这里会显示一次真实的开放世界 AI 预览结果；若 AI 调用失败，也会显式看到 fallback 来源。"}
                  </pre>
                </ScrollableContent>
              </Card>
            </Col>
            <Col xs={24} xl={10}>
              <Card size="small" title="失败回退说明">
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <Text style={{ color: "#d7cfbf" }}>
                    - `OPEN_WORLD_LLM_*` 留空时，运行时应回退到 `WORLD_FLAVOR_LLM_*`，再回退到通用 `LLM_*`。
                  </Text>
                  <Text style={{ color: "#d7cfbf" }}>
                    - Prompt 建议保持非空；若后续服务端需要兜底，可继续使用这里的默认值。
                  </Text>
                  <Text style={{ color: "#d7cfbf" }}>
                    - “测试生成”现在会真实调用开放世界 AI 生成链路，但只做预览，不会写入世界地图或 NPC 数据。
                  </Text>
                  <Text style={{ color: "#d7cfbf" }}>
                    - 地图、NPC、天道事件与附近短句均已接到同一套运行时回退链，AI 异常时会退回规则模板。
                  </Text>
                </Space>
              </Card>
            </Col>
                </Row>
              </Space>
            </Card>
          ) : null}
        </Space>
      </Card>
    </Space>
  );
}

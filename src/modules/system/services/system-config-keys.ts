import { PREGNANCY_STAGE7_FORTUNE_CONFIG_KEY } from "@/modules/character/constants/pregnancy-system";

export type SystemConfigGroup = "llm" | "oauth" | "game" | "prompt" | "plugin";

export interface SystemConfigItem {
  key: string;
  group: SystemConfigGroup;
  isSecret: boolean;
  description: string;
  defaultValue?: string;
  jsonSchema?: unknown;
  pluginId?: string;
  pluginName?: string;
  hiddenInSystemConfigPage?: boolean;
}

export interface LlmConfigSection {
  id: string;
  title: string;
  description: string;
  keys: readonly string[];
  allowEmptyValues?: boolean;
}

export const CORE_LLM_CONFIG_KEYS = [
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
] as const;

export const SPIRITUAL_ROOT_LLM_CONFIG_KEYS = [
  "SPIRITUAL_ROOT_LLM_BASE_URL",
  "SPIRITUAL_ROOT_LLM_API_KEY",
  "SPIRITUAL_ROOT_LLM_MODEL",
] as const;

export const NPC_LLM_CONFIG_KEYS = [
  "NPC_LLM_BASE_URL",
  "NPC_LLM_API_KEY",
  "NPC_LLM_MODEL",
] as const;

export const EVENT_LLM_CONFIG_KEYS = [
  "EVENT_LLM_BASE_URL",
  "EVENT_LLM_API_KEY",
  "EVENT_LLM_MODEL",
] as const;

export const WORLD_FLAVOR_LLM_CONFIG_KEYS = [
  "WORLD_FLAVOR_LLM_BASE_URL",
  "WORLD_FLAVOR_LLM_API_KEY",
  "WORLD_FLAVOR_LLM_MODEL",
] as const;

export const OPEN_WORLD_LLM_CONFIG_KEYS = [
  "OPEN_WORLD_LLM_BASE_URL",
  "OPEN_WORLD_LLM_API_KEY",
  "OPEN_WORLD_LLM_MODEL",
] as const;

export const SMITHING_LLM_CONFIG_KEYS = [
  "SMITHING_LLM_BASE_URL",
  "SMITHING_LLM_API_KEY",
  "SMITHING_LLM_MODEL",
] as const;

export const ALCHEMY_LLM_CONFIG_KEYS = [
  "ALCHEMY_LLM_BASE_URL",
  "ALCHEMY_LLM_API_KEY",
  "ALCHEMY_LLM_MODEL",
] as const;

export const LLM_OPTIONAL_OVERRIDE_CONFIG_KEYS = [
  ...SPIRITUAL_ROOT_LLM_CONFIG_KEYS,
  ...NPC_LLM_CONFIG_KEYS,
  ...EVENT_LLM_CONFIG_KEYS,
  ...WORLD_FLAVOR_LLM_CONFIG_KEYS,
  ...OPEN_WORLD_LLM_CONFIG_KEYS,
  ...SMITHING_LLM_CONFIG_KEYS,
  ...ALCHEMY_LLM_CONFIG_KEYS,
] as const;

export const LLM_CONFIG_SECTIONS: readonly LlmConfigSection[] = [
  {
    id: "core",
    title: "通用模型（默认）",
    description: "玩家侧 AI 的默认模型配置。未设置场景覆盖时使用这里。",
    keys: CORE_LLM_CONFIG_KEYS,
  },
  {
    id: "spiritualRoot",
    title: "灵根生成模型（可选覆盖）",
    description: "留空即回退到通用模型。",
    keys: SPIRITUAL_ROOT_LLM_CONFIG_KEYS,
    allowEmptyValues: true,
  },
  {
    id: "npc",
    title: "NPC 对话模型（可选覆盖）",
    description: "用于 NPC 快捷语、任务意图、工具对话、历史摘要。留空即回退到通用模型。",
    keys: NPC_LLM_CONFIG_KEYS,
    allowEmptyValues: true,
  },
  {
    id: "event",
    title: "奇遇叙事模型（可选覆盖）",
    description: "用于地图随机事件叙事。留空即回退到通用模型。",
    keys: EVENT_LLM_CONFIG_KEYS,
    allowEmptyValues: true,
  },
  {
    id: "worldFlavor",
    title: "世界风味模型（可选覆盖）",
    description: "用于地图传闻、奇遇分镜、装备来历与 NPC 临场对白。留空即回退到通用模型。",
    keys: WORLD_FLAVOR_LLM_CONFIG_KEYS,
    allowEmptyValues: true,
  },
  {
    id: "openWorld",
    title: "开放世界模型（可选覆盖）",
    description: "用于开放世界地图主题、NPC DNA、天道事件与附近短句。留空即回退到世界风味模型，再回退到通用模型。",
    keys: OPEN_WORLD_LLM_CONFIG_KEYS,
    allowEmptyValues: true,
  },
  {
    id: "smithing",
    title: "AI 炼器模型（可选覆盖）",
    description: "用于 AI 炼器名字、来历与风味文案。留空即回退到世界风味模型，再回退到通用模型。",
    keys: SMITHING_LLM_CONFIG_KEYS,
    allowEmptyValues: true,
  },
  {
    id: "alchemy",
    title: "AI 炼丹模型（可选覆盖）",
    description: "用于 AI 炼丹名字、丹性、来历与药力描述。留空即回退到世界风味模型，再回退到通用模型。",
    keys: ALCHEMY_LLM_CONFIG_KEYS,
    allowEmptyValues: true,
  },
];

export const LINUXDO_OAUTH_CONFIG_KEYS = [
  "LINUXDO_CLIENT_ID",
  "LINUXDO_CLIENT_SECRET",
  "LINUXDO_AUTHORIZATION_ENDPOINT",
  "LINUXDO_TOKEN_ENDPOINT",
  "LINUXDO_USER_ENDPOINT",
  "LINUXDO_REDIRECT_URI",
  "LINUXDO_SCOPE",
] as const;

export const FEATURE_SWITCH_CONFIG_KEYS = [
  "LINUXDO_LOGIN_ENABLED",
  "LDC_RECHARGE_ENABLED",
  "GAME_MAINTENANCE_ENABLED",
] as const;

export const GAME_START_CONFIG_KEYS = [
  "GAME_START_MAP_ID",
  "GAME_START_POSITION_X",
  "GAME_START_POSITION_Y",
  "GAME_START_BASE_SKILL_ID",
  "GAME_START_INVENTORY_JSON",
] as const;

export const GAME_PUBLIC_CONFIG_KEYS = [
  "GAME_PUBLIC_ANNOUNCEMENT",
] as const;

export const PVP_CONFIG_KEYS = [
  "PVP_MAP_IDS_JSON",
  "PVP_MAP_TYPE_FLAGS_JSON",
] as const;

export const MARKET_CONFIG_KEYS = [
  "MARKET_FEE_PERCENT",
] as const;

export const STAMINA_CONFIG_KEYS = [
  "STAMINA_MAX",
  "STAMINA_RECOVER_INTERVAL_MINUTES",
  "STAMINA_RECOVER_PER_INTERVAL",
] as const;

export const DONGFU_CONFIG_KEYS = [
  "DONGFU_CAP_HOURS",
  "DONGFU_XP_RATIO_PER_HOUR",
  "DONGFU_MIN_XP_PER_HOUR",
] as const;

export const SECT_CONFIG_KEYS = [
  "SECT_CREATE_MIN_REALM",
  "SECT_INACTIVE_TRANSFER_DAYS",
] as const;

export const PLAYER_PREGNANCY_CONFIG_KEYS = [
  PREGNANCY_STAGE7_FORTUNE_CONFIG_KEY,
] as const;

export const SECRET_REALM_CONFIG_KEYS = [
  "SECRET_REALM_GLOBAL_SPAWN_INTERVAL_SECONDS",
  "SECRET_REALM_PERSONAL_SPAWN_INTERVAL_SECONDS",
  "SECRET_REALM_GLOBAL_EXPIRE_SECONDS",
  "SECRET_REALM_PERSONAL_EXPIRE_SECONDS",
  "SECRET_REALM_INSTANCE_EXPIRE_SECONDS",
  "SECRET_REALM_SETTLE_STAY_SECONDS",
  "SECRET_REALM_PERSONAL_PITY_THRESHOLD",
  "SECRET_REALM_AI_GENERATION_ENABLED",
] as const;

export const LD_CREDIT_CONFIG_KEYS = [
  "LINGXU_LD_CREDIT_PID",
  "LINGXU_LD_CREDIT_KEY",
] as const;

export const SPIRITUAL_ROOT_CONFIG_KEYS = [
  "SPIRITUAL_ROOT_PROMPT",
] as const;

export const NPC_PROMPT_CONFIG_KEYS = [
  "NPC_QUICK_REPLY_PROMPT",
  "NPC_QUEST_INTENT_PROMPT",
  "NPC_QUEST_REPLY_PROMPT",
  "NPC_TOOL_CHAT_PROMPT",
  "NPC_SUMMARY_PROMPT",
] as const;

export const WORLD_FLAVOR_PROMPT_CONFIG_KEYS = [
  "WORLD_FLAVOR_EQUIPMENT_PROMPT",
  "WORLD_FLAVOR_SMITHING_PROMPT",
  "WORLD_FLAVOR_ENCOUNTER_PROMPT",
  "WORLD_FLAVOR_ENCOUNTER_CHAIN_PROMPT",
  "WORLD_FLAVOR_NPC_BARK_PROMPT",
  "WORLD_FLAVOR_MAP_RUMOR_PROMPT",
] as const;

export const OPEN_WORLD_PROMPT_CONFIG_KEYS = [
  "OPEN_WORLD_STYLE_MASTER_PROMPT",
  "OPEN_WORLD_STYLE_NEGATIVE_PROMPT",
  "OPEN_WORLD_MAP_PROMPT",
  "OPEN_WORLD_NPC_DNA_PROMPT",
  "OPEN_WORLD_KEYWORD_POOL_PROMPT",
  "OPEN_WORLD_CUSTOM_NPC_LIBRARY_PROMPT",
  "OPEN_WORLD_CUSTOM_NPC_PROMPT",
  "OPEN_WORLD_DYNAMIC_VISITOR_PROMPT",
  "OPEN_WORLD_NPC_RELATION_PROMPT",
  "OPEN_WORLD_NPC_LIFE_LOG_PROMPT",
  "OPEN_WORLD_TIANDAO_EVENT_PROMPT",
  "OPEN_WORLD_NPC_BARK_PROMPT",
  "OPEN_WORLD_DISTRICT_RUMOR_PROMPT",
  "OPEN_WORLD_FACTION_TONE_PROMPT",
  "OPEN_WORLD_DISTRICT_STATE_PROMPT",
  "OPEN_WORLD_STORYLINE_PROMPT",
  "OPEN_WORLD_NPC_FACTION_HINT_PROMPT",
  "OPEN_WORLD_SHADOW_EVENT_PROMPT",
  "OPEN_WORLD_ADULT_PROFILE_PROMPT",
  "OPEN_WORLD_ADULT_INVITE_PROMPT",
  "OPEN_WORLD_ADULT_ACCEPT_PROMPT",
  "OPEN_WORLD_ADULT_REJECT_PROMPT",
  "OPEN_WORLD_ADULT_RESULT_PROMPT",
  "OPEN_WORLD_ADULT_DRAIN_PROMPT",
  "OPEN_WORLD_ADULT_PREGNANCY_PROMPT",
  "OPEN_WORLD_ADULT_RUMOR_PROMPT",
  "OPEN_WORLD_ADULT_BARK_PROMPT",
  "OPEN_WORLD_CORRUPTION_GROWTH_PROMPT",
  "OPEN_WORLD_WORLD_PRESSURE_FLAVOR_PROMPT",
  "OPEN_WORLD_PRESSURE_RELIEF_PROMPT",
  "OPEN_WORLD_RUMOR_SILENCE_PROMPT",
  "OPEN_WORLD_LAWFUL_MEDIATION_PROMPT",
  "OPEN_WORLD_CONSENSUAL_DUAL_CULTIVATION_PROMPT",
  "OPEN_WORLD_FORCED_CONSEQUENCE_PROMPT",
  "OPEN_WORLD_PARTNER_JEALOUSY_PROMPT",
] as const;

export const OPEN_WORLD_RULE_CONFIG_KEYS = [
  "OPEN_WORLD_MAP_RULE",
  "OPEN_WORLD_NPC_DNA_RULE",
  "OPEN_WORLD_NPC_NAME_RULE",
  "OPEN_WORLD_KEYWORD_POOL_RULE",
  "OPEN_WORLD_CUSTOM_NPC_LIBRARY_RULE",
  "OPEN_WORLD_NPC_BARK_RULE",
  "OPEN_WORLD_ADULT_BARK_RULE",
  "OPEN_WORLD_TIANDAO_EVENT_RULE",
  "OPEN_WORLD_SHADOW_EVENT_RULE",
  "OPEN_WORLD_PRESSURE_RELIEF_RULE",
  "OPEN_WORLD_DISTRICT_RUMOR_RULE",
  "OPEN_WORLD_FACTION_TONE_RULE",
  "OPEN_WORLD_DISTRICT_STATE_RULE",
  "OPEN_WORLD_STORYLINE_RULE",
  "OPEN_WORLD_NPC_FACTION_HINT_RULE",
  "OPEN_WORLD_ADULT_PROFILE_RULE",
  "OPEN_WORLD_ADULT_INVITE_RULE",
  "OPEN_WORLD_ADULT_RESULT_RULE",
  "OPEN_WORLD_CORRUPTION_GROWTH_RULE",
  "OPEN_WORLD_FORCED_CONSEQUENCE_RULE",
  "OPEN_WORLD_PARTNER_JEALOUSY_RULE",
  "OPEN_WORLD_ADULT_RUMOR_RULE",
  "OPEN_WORLD_CUSTOM_NPC_PREVIEW_RULE",
] as const;

export const OPEN_WORLD_TEMPLATE_CONFIG_KEYS = [
  "OPEN_WORLD_MAP_TEMPLATE_JSON",
  "OPEN_WORLD_NPC_DNA_TEMPLATE_JSON",
  "OPEN_WORLD_KEYWORD_POOL_TEMPLATE_JSON",
  "OPEN_WORLD_CUSTOM_NPC_LIBRARY_TEMPLATE_JSON",
  "OPEN_WORLD_NPC_BARK_TEMPLATE_JSON",
  "OPEN_WORLD_ADULT_BARK_TEMPLATE_JSON",
  "OPEN_WORLD_TIANDAO_EVENT_TEMPLATE_JSON",
  "OPEN_WORLD_SHADOW_EVENT_TEMPLATE_JSON",
  "OPEN_WORLD_PRESSURE_RELIEF_TEMPLATE_JSON",
  "OPEN_WORLD_DISTRICT_RUMOR_TEMPLATE_JSON",
  "OPEN_WORLD_FACTION_TONE_TEMPLATE_JSON",
  "OPEN_WORLD_DISTRICT_STATE_TEMPLATE_JSON",
  "OPEN_WORLD_STORYLINE_TEMPLATE_JSON",
  "OPEN_WORLD_NPC_FACTION_HINT_TEMPLATE_JSON",
  "OPEN_WORLD_ADULT_PROFILE_TEMPLATE_JSON",
  "OPEN_WORLD_ADULT_INVITE_TEMPLATE_JSON",
  "OPEN_WORLD_ADULT_RESULT_TEMPLATE_JSON",
  "OPEN_WORLD_CORRUPTION_GROWTH_TEMPLATE_JSON",
  "OPEN_WORLD_FORCED_CONSEQUENCE_TEMPLATE_JSON",
  "OPEN_WORLD_PARTNER_JEALOUSY_TEMPLATE_JSON",
  "OPEN_WORLD_ADULT_RUMOR_TEMPLATE_JSON",
  "OPEN_WORLD_CUSTOM_NPC_PREVIEW_TEMPLATE_JSON",
] as const;

export const OPEN_WORLD_WORLDBOOK_CONFIG_KEYS = [
  "OPEN_WORLD_WORLDBOOK_ENABLED",
  "OPEN_WORLD_WORLDBOOK_JSON",
  "OPEN_WORLD_KEYWORD_POOL_JSON",
  "OPEN_WORLD_PRESSURE_RELIEF_RULES_JSON",
  "OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON",
] as const;

export const OPEN_WORLD_SYSTEM_CONFIG_KEYS = [
  ...OPEN_WORLD_LLM_CONFIG_KEYS,
  ...OPEN_WORLD_PROMPT_CONFIG_KEYS,
  ...OPEN_WORLD_RULE_CONFIG_KEYS,
  ...OPEN_WORLD_TEMPLATE_CONFIG_KEYS,
  ...OPEN_WORLD_WORLDBOOK_CONFIG_KEYS,
] as const;

export const SECRET_REALM_PROMPT_CONFIG_KEYS = [
  "SECRET_REALM_GENERATION_PROMPT",
] as const;

export const GAME_BRAND_CONFIG_KEYS = [
  "GAME_TITLE",
  "GAME_SUBTITLE",
] as const;

export const SYSTEM_CONFIG_ITEMS: readonly SystemConfigItem[] = [
  { key: "LLM_BASE_URL", group: "llm", isSecret: false, description: "通用对话模型 base URL" },
  { key: "LLM_API_KEY", group: "llm", isSecret: true, description: "通用对话模型 API Key" },
  { key: "LLM_MODEL", group: "llm", isSecret: false, description: "通用对话模型名" },
  { key: "SPIRITUAL_ROOT_LLM_BASE_URL", group: "llm", isSecret: false, description: "灵根生成模型 base URL（留空回退通用）" },
  { key: "SPIRITUAL_ROOT_LLM_API_KEY", group: "llm", isSecret: true, description: "灵根生成模型 API Key（留空回退通用）" },
  { key: "SPIRITUAL_ROOT_LLM_MODEL", group: "llm", isSecret: false, description: "灵根生成模型名（留空回退通用）" },
  { key: "NPC_LLM_BASE_URL", group: "llm", isSecret: false, description: "NPC 对话模型 base URL（留空回退通用）" },
  { key: "NPC_LLM_API_KEY", group: "llm", isSecret: true, description: "NPC 对话模型 API Key（留空回退通用）" },
  { key: "NPC_LLM_MODEL", group: "llm", isSecret: false, description: "NPC 对话模型名（留空回退通用）" },
  { key: "EVENT_LLM_BASE_URL", group: "llm", isSecret: false, description: "奇遇叙事模型 base URL（留空回退通用）" },
  { key: "EVENT_LLM_API_KEY", group: "llm", isSecret: true, description: "奇遇叙事模型 API Key（留空回退通用）" },
  { key: "EVENT_LLM_MODEL", group: "llm", isSecret: false, description: "奇遇叙事模型名（留空回退通用）" },
  { key: "WORLD_FLAVOR_LLM_BASE_URL", group: "llm", isSecret: false, description: "世界风味模型 base URL（留空回退通用）" },
  { key: "WORLD_FLAVOR_LLM_API_KEY", group: "llm", isSecret: true, description: "世界风味模型 API Key（留空回退通用）" },
  { key: "WORLD_FLAVOR_LLM_MODEL", group: "llm", isSecret: false, description: "世界风味模型名（留空回退通用）" },
  { key: "OPEN_WORLD_LLM_BASE_URL", group: "llm", isSecret: false, description: "开放世界模型 base URL（留空回退世界风味/通用）", hiddenInSystemConfigPage: true },
  { key: "OPEN_WORLD_LLM_API_KEY", group: "llm", isSecret: true, description: "开放世界模型 API Key（留空回退世界风味/通用）", hiddenInSystemConfigPage: true },
  { key: "OPEN_WORLD_LLM_MODEL", group: "llm", isSecret: false, description: "开放世界模型名（留空回退世界风味/通用）", hiddenInSystemConfigPage: true },
  { key: "SMITHING_LLM_BASE_URL", group: "llm", isSecret: false, description: "AI 炼器模型 base URL（留空回退世界风味/通用）" },
  { key: "SMITHING_LLM_API_KEY", group: "llm", isSecret: true, description: "AI 炼器模型 API Key（留空回退世界风味/通用）" },
  { key: "SMITHING_LLM_MODEL", group: "llm", isSecret: false, description: "AI 炼器模型名（留空回退世界风味/通用）" },
  { key: "ALCHEMY_LLM_BASE_URL", group: "llm", isSecret: false, description: "AI 炼丹模型 base URL（留空回退世界风味/通用）" },
  { key: "ALCHEMY_LLM_API_KEY", group: "llm", isSecret: true, description: "AI 炼丹模型 API Key（留空回退世界风味/通用）" },
  { key: "ALCHEMY_LLM_MODEL", group: "llm", isSecret: false, description: "AI 炼丹模型名（留空回退世界风味/通用）" },
  { key: "LINUXDO_CLIENT_ID", group: "oauth", isSecret: false, description: "Linux.do OAuth Client ID" },
  { key: "LINUXDO_CLIENT_SECRET", group: "oauth", isSecret: true, description: "Linux.do OAuth Client Secret" },
  { key: "LINUXDO_AUTHORIZATION_ENDPOINT", group: "oauth", isSecret: false, description: "Linux.do 授权端点" },
  { key: "LINUXDO_TOKEN_ENDPOINT", group: "oauth", isSecret: false, description: "Linux.do token 端点" },
  { key: "LINUXDO_USER_ENDPOINT", group: "oauth", isSecret: false, description: "Linux.do userinfo 端点" },
  { key: "LINUXDO_REDIRECT_URI", group: "oauth", isSecret: false, description: "Linux.do 回调地址" },
  { key: "LINUXDO_SCOPE", group: "oauth", isSecret: false, description: "Linux.do scope" },
  {
    key: "LINUXDO_LOGIN_ENABLED",
    group: "oauth",
    isSecret: false,
    description: "是否启用 Linux.do 登录(true/false)",
    defaultValue: "false",
  },
  { key: "GAME_TITLE", group: "game", isSecret: false, description: "游戏主标题", defaultValue: "修仙·明日生机" },
  {
    key: "GAME_SUBTITLE",
    group: "game",
    isSecret: false,
    description: "游戏副标题",
    defaultValue: "踏上修仙之路，问鼎长生大道",
  },
  { key: "GAME_START_MAP_ID", group: "game", isSecret: false, description: "开局地图 ID", defaultValue: "map_four_realms_penglai_island" },
  { key: "GAME_START_POSITION_X", group: "game", isSecret: false, description: "开局 X 坐标", defaultValue: "3" },
  { key: "GAME_START_POSITION_Y", group: "game", isSecret: false, description: "开局 Y 坐标", defaultValue: "22" },
  { key: "GAME_START_BASE_SKILL_ID", group: "game", isSecret: false, description: "开局基础神通 ID", defaultValue: "skill_four_realms_qianchao_jianqi" },
  {
    key: "GAME_START_INVENTORY_JSON",
    group: "game",
    isSecret: false,
    description: "开局背包 JSON（数组：[{itemId,quantity,equipped?}]）",
    defaultValue: "[]",
  },
  {
    key: "GAME_PUBLIC_ANNOUNCEMENT",
    group: "game",
    isSecret: false,
    description: "游戏公共公告（显示在地图页面地图名称下方）",
    defaultValue: "欢迎来到灵虚大陆，愿诸位仙途顺遂。",
  },
  {
    key: "GAME_MAINTENANCE_ENABLED",
    group: "game",
    isSecret: false,
    description: "是否开启停服维护(true/false)。开启后玩家无法进入游戏，只保留后台编辑与创角前置流程。",
    defaultValue: "false",
  },
  {
    key: "GAME_MAINTENANCE_MESSAGE",
    group: "game",
    isSecret: false,
    description: "停服维护提示文案",
    defaultValue: "服务器维护中，请稍后再入世。维护期间将暂时无法进入游戏。",
  },
  {
    key: "PVP_MAP_IDS_JSON",
    group: "game",
    isSecret: false,
    description: "可发起PVP的地图ID列表(JSON数组)",
    defaultValue: "[\"map_starter_village\"]",
    jsonSchema: {
      kind: "array-string",
      relation: { entity: "maps", labelKey: "name" },
    },
  },
  {
    key: "PVP_MAP_TYPE_FLAGS_JSON",
    group: "game",
    isSecret: false,
    description: "按地图类型控制是否开放PVP(JSON对象，支持 city/field/dungeon/secret/secret_realm_instance)",
    defaultValue: "{\"city\":false,\"field\":true,\"dungeon\":true,\"secret\":false,\"secret_realm_instance\":false}",
    jsonSchema: {
      kind: "object",
      fields: [
        { key: "city", label: "城镇", type: "boolean" },
        { key: "field", label: "野外", type: "boolean" },
        { key: "dungeon", label: "地宫/洞窟", type: "boolean" },
        { key: "secret", label: "隐藏区域", type: "boolean" },
        { key: "secret_realm_instance", label: "秘境实例", type: "boolean" },
      ],
    },
  },
  {
    key: "MAP_TRAVEL_MODE",
    group: "game",
    isSecret: false,
    description: "地图跨图移动模式(direct=直接移动,portal=传送点移动)",
    defaultValue: "direct",
  },
  {
    key: "SECRET_REALM_GLOBAL_SPAWN_INTERVAL_SECONDS",
    group: "game",
    isSecret: false,
    description: "全局秘境入口生成冷却（秒）",
    defaultValue: "900",
  },
  {
    key: "SECRET_REALM_PERSONAL_SPAWN_INTERVAL_SECONDS",
    group: "game",
    isSecret: false,
    description: "个人秘境入口生成冷却（秒）",
    defaultValue: "2700",
  },
  {
    key: "SECRET_REALM_GLOBAL_EXPIRE_SECONDS",
    group: "game",
    isSecret: false,
    description: "全局秘境入口存在时长（秒）",
    defaultValue: "1200",
  },
  {
    key: "SECRET_REALM_PERSONAL_EXPIRE_SECONDS",
    group: "game",
    isSecret: false,
    description: "个人秘境入口存在时长（秒）",
    defaultValue: "1800",
  },
  {
    key: "SECRET_REALM_INSTANCE_EXPIRE_SECONDS",
    group: "game",
    isSecret: false,
    description: "秘境实例最长持续时长（秒）",
    defaultValue: "3600",
  },
  {
    key: "SECRET_REALM_SETTLE_STAY_SECONDS",
    group: "game",
    isSecret: false,
    description: "Boss 击败后秘境结算停留时长（秒）",
    defaultValue: "120",
  },
  {
    key: "SECRET_REALM_PERSONAL_PITY_THRESHOLD",
    group: "game",
    isSecret: false,
    description: "连续未获得全局秘境核心奖励后，触发个人秘境补偿的次数阈值",
    defaultValue: "3",
  },
  {
    key: "SECRET_REALM_AI_GENERATION_ENABLED",
    group: "game",
    isSecret: false,
    description: "是否启用 AI 生成秘境候选结构(true/false)，关闭时直接走规则模板",
    defaultValue: "true",
  },
  {
    key: "MARKET_FEE_PERCENT",
    group: "game",
    isSecret: false,
    description: "交易市场手续费百分比(0-100)",
    defaultValue: "5",
  },
  {
    key: "COMBAT_DAMAGE_FORMULA",
    group: "game",
    isSecret: false,
    description: "战斗伤害公式（变量: atk/def/base/mul/rand/speed/luck/armorPenetration/block/effectiveDef；函数: min/max/floor/ceil/round）",
    defaultValue: "((atk + armorPenetration * 0.28 + speed * 0.2 + luck * 0.1) * mul + base) * (100 / (100 + max(0, effectiveDef))) * rand",
  },
  {
    key: "STAMINA_MAX",
    group: "game",
    isSecret: false,
    description: "体力上限（正整数）",
    defaultValue: "100",
  },
  {
    key: "STAMINA_RECOVER_INTERVAL_MINUTES",
    group: "game",
    isSecret: false,
    description: "体力恢复间隔（分钟，正整数）",
    defaultValue: "60",
  },
  {
    key: "STAMINA_RECOVER_PER_INTERVAL",
    group: "game",
    isSecret: false,
    description: "每次恢复体力值（正整数）",
    defaultValue: "10",
  },
  {
    key: "DONGFU_CAP_HOURS",
    group: "game",
    isSecret: false,
    description: "洞府可储存收益的封顶时长（小时，正整数）",
    defaultValue: "36",
  },
  {
    key: "DONGFU_XP_RATIO_PER_HOUR",
    group: "game",
    isSecret: false,
    description: "洞府每小时修为比例（按当前突破需求，正数）",
    defaultValue: "0.05",
  },
  {
    key: "DONGFU_MIN_XP_PER_HOUR",
    group: "game",
    isSecret: false,
    description: "洞府最低每小时修为（正整数）",
    defaultValue: "1",
  },
  {
    key: "SECT_CREATE_MIN_REALM",
    group: "game",
    isSecret: false,
    description: "创建宗门所需最低线性境界（默认 17，即结丹初期）",
    defaultValue: "17",
  },
  {
    key: "SECT_INACTIVE_TRANSFER_DAYS",
    group: "game",
    isSecret: false,
    description: "宗门治理权自动顺位转接所需离线天数",
    defaultValue: "7",
  },
  {
    key: PREGNANCY_STAGE7_FORTUNE_CONFIG_KEY,
    group: "game",
    isSecret: false,
    description: "玩家孕育系统在进入 k_受精_7 后首次发放的专属气运 ID；留空则只进入怀孕阶段，不额外发放气运。",
    defaultValue: "",
  },
  {
    key: "SPIRITUAL_ROOT_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "灵根生成提示词",
    defaultValue: `你是修仙世界的天道意志，负责为新入修仙的弟子觉醒灵根。
根据弟子心中所想，生成一个独特的修仙灵根。

基础五行：金、木、水、火、土
变异灵根（稀有）：雷、冰、风、暗、光

规则：
1. 灵根名称要有修仙韵味，2-6个字
2. 主元素必须是五行之一，可能附带变异属性
3. 外观描述要生动形象，50字以内
4. 属性加成：总加成控制在 5%-15%，分配到 2-3 项属性上
5. 变异灵根出现概率约 20%

严格按照以下 JSON 格式返回，不要有其他文字：
{
  "name": "灵根名称",
  "element": "主元素(金/木/水/火/土)",
  "variant": "变异属性(雷/冰/风/暗/光，无则为null)",
  "description": "灵根外观描述",
  "bonuses": {
    "hpPercent": 0,
    "mpPercent": 0,
    "atkPercent": 0,
    "defPercent": 0,
    "speedPercent": 0,
    "luckPercent": 0,
    "elementDamageBonus": 0
  }
}`,
  },
  {
    key: "NPC_QUICK_REPLY_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "NPC对话快捷语生成提示词",
    defaultValue: `你是“NPC对话快捷语生成器”。目标：给玩家生成可直接点击发送的短句。
要求：
1. 只输出 JSON 数组，例如 ["我要接任务","我来交任务"]。
2. 返回 1 到 3 条，每条不超过 18 个字。
3. 文案要口语、自然、可直接发给 NPC。
4. 优先覆盖：可提交 > 可接取 > 进行中的传话任务。
5. 若有传话任务（questType=talk 且 state=进行中），至少给 1 条“传话/带话”相关短句。
6. 不得出现任务ID、字段名、系统术语。`,
  },
  {
    key: "NPC_QUEST_INTENT_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "NPC任务意图识别提示词",
    defaultValue: `你是“任务办理意图识别器”，只负责判定玩家是否在办理委托。
你必须只输出 JSON，不能输出任何额外文字。

返回格式：
{
  "intent": "none|list|accept|complete",
  "questName": "委托名或null"
}

规则：
1. intent=none：玩家在闲聊或无法判断，不要猜测为任务办理。
2. intent=list：玩家在询问/查看有哪些委托、能接什么、能交什么。
3. intent=accept：玩家要接委托/领取委托，或明确表示愿意去办（如“可以/行/交给我/我帮你/我去办”）。
4. intent=complete：玩家要交差/提交委托，或表达“办妥了/完成了/带来了”等。
5. 若存在进行中的传话委托，玩家提及相关事项（如“我问过了/我确认了/密信/账册”）可判定为 complete。
6. questName：仅当玩家明确点名某个委托时填写；必须从提供的 quests 列表中选一个完全一致的 name，否则填 null。`,
  },
  {
    key: "NPC_QUEST_REPLY_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "NPC任务办理回复提示词",
    defaultValue: `{{npcPersonality}}

===== 你的身份档案（绝对事实） =====
{{npcIdentityContext}}

===== 世界背景 =====
{{worldContext}}

你正在与一名修士对话。你需要根据“委托信息”用你的口吻回复。
硬性要求：
1. 若修士问“你是谁/叫什么/做什么/卖什么/在哪”，必须严格按身份档案回答。
2. 只输出NPC台词，不要输出任何标签、JSON、列表前缀。
3. 不要出现“系统/工具/状态/可接/可交/主线/支线/任务ID/字段”等字眼。
4. 可以直接说出委托名（例如「饥肠辘辘」）。
5. 若委托信息里提供了 story，剧情事实必须以 story 为准，不得反转或篡改关键信息。
6. 你只能陈述当前输入里已有的确切事实，不得补充未提供的信息。
7. 对不确定或未提供的信息，必须按人设明确表达“不知道/不清楚”，不得猜测或编造。
8. 例如被问“去哪学神通”但输入中没有相关事实时，只能按人设回答不知道，不得乱指地点或人物。
9. 回答结构固定：先结论（能办/不能办/已办妥），再给依据（一句事实），最后给下一步。
10. 禁止机械播报腔，禁止使用“记录显示/我这边显示/当前状态/步骤/流程/你已接下这桩委托”等说法。
11. {{linZhaoweiRule}}
12. 简洁，100字以内。`,
  },
  {
    key: "NPC_TOOL_CHAT_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "NPC工具对话主提示词",
    defaultValue: `{{npcPersonality}}

===== 你的身份档案（绝对事实） =====
{{npcIdentityContext}}

===== 世界背景 =====
{{worldContext}}
{{memorySummarySection}}

你可以使用任务工具来办理任务相关事务，务必遵守：
1. 身份档案是绝对事实。若修士问“你是谁/叫什么/做什么/卖什么/在哪”，必须按档案回答；若与记忆摘要或修士说法冲突，以档案为准。
2. 玩家表达接任务/交任务意图时，先调用 list_npc_quests 查看当前可办任务。
3. 若“可接取”或“可提交”的委托只有一件，可直接替他办理。
4. 若可办委托不止一件，必须让玩家点名确认具体哪一件，不得猜测执行。
5. 只有玩家明确任务后，才调用 accept_npc_quest 或 complete_npc_quest。
6. 工具返回失败时，只说世界内原因与下一步，不得提及工具/系统。
7. 沉浸规则（强制）：你就是NPC，本世界没有“系统/工具/函数/JSON/字段/变量/true/false/available”等概念，禁止提及；对玩家不得提任务ID等内部标识，但你在工具参数里使用任务ID/名称是允许的。
8. 你可把工具调用当作“翻阅卷宗/查看名册”，对修士只给结论：能不能办、为何、下一步怎么做。
9. list_npc_quests 返回的“状态/原因/提示”只用于你组织说辞，不要照着字段名念。
10. 你只能基于以下信息作答：NPC人设、身份档案、世界背景、历史记忆摘要、玩家当前输入、工具返回结果。超出这些信息的内容不得编造。
11. 对不确定或无依据的问题，必须按人设明确表达“不知道/不清楚”，不要给猜测答案。
12. 例如玩家问“在哪学神通”，若你手头信息里没有确切依据，只能按人设回答不知道。
13. 回答结构优先：先结论，再依据，再下一步；控制在100字以内。
14. 禁止机械播报腔与公文腔，不得使用“记录显示/我这边显示/当前状态/步骤/流程/你已接下这桩委托”等表述。
15. {{linZhaoweiRule}}`,
  },
  {
    key: "NPC_SUMMARY_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "NPC对话摘要提示词",
    defaultValue: "你是一个对话摘要助手。请将以下{{npcName}}与修士的对话内容压缩为简短摘要，保留关键信息（任务进展、重要事件、关系变化）。用第三人称叙述，100字以内。",
  },
  {
    key: "WORLD_FLAVOR_EQUIPMENT_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "装备/法宝世界风味生成提示词",
    defaultValue: `你是“修仙世界装备风味生成器”，风格参考“散修凡人流、克制写法、器物有旧事”。
你只负责生成名字、来历、描述、可选词条建议，不得擅自突破输入给定的属性范围。

输出要求：
1. 必须只返回 JSON 对象，不要输出其他说明文字。
2. 名字要有修仙器物感，避免网游化、现代化、夸张神兵口吻。
3. 来历描述要像《凡人修仙传》式旧物掌故，含蓄克制。
4. 若输入提供 allowedAttributes，则最多返回限定数量的 affixes，且 key 必须从 allowedAttributes 中选。
5. affixes.value 只能落在对应 min/max 范围内，超出会被后端裁切。
6. 不要凭空添加稀有属性；若输入没给 allowedAttributes，就返回空数组。

JSON 结构：
{
  "name": "器物名",
  "shortName": "短称",
  "origin": "器物来历",
  "description": "装备描述",
  "flavorLines": ["一条题记", "一条传闻"],
  "affixes": [
    {
      "key": "atk",
      "label": "攻击",
      "value": 12,
      "reason": "为何会有此属性"
    }
  ]
}`,
  },
  {
    key: "WORLD_FLAVOR_SMITHING_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "AI 炼器世界风味生成提示词",
    defaultValue: `你是修仙世界的天道意志，负责根据主材、辅材、境界与路线，为炼器结果推演名字、来历、简介和少量词条建议。
风格要求：
1. 参考《凡人修仙传》与凡人流修仙叙事，克制、耐看、像旧器有旧事。
2. 不要写夸张神兵，不要网游数值腔，不要现代词汇。
3. 名字必须像散修、宗门匠师、边地战器会用的名字。
4. 若文案里需要出现自指，只能自称“天道”，禁止提及 AI、模型、生成器。
5. description 必须控制在 30 字以内，建议 18-26 字，短而有器物感。
6. 只返回 JSON 对象，不要输出额外说明。
7. affixes.key 必须从输入 allowedAttributes 中选择；value 必须落在 min/max 范围内。
8. 如果输入没给 allowedAttributes，就返回空 affixes。
9. 可以根据材料和路线暗示“剑修 / 法修 / 守御 / 短诀 / 血防”等气质，但不能改动服务器给定的核心路线。

JSON 结构：
{
  "name": "完整器名",
  "shortName": "短称",
  "origin": "来历掌故",
  "description": "简短描述",
  "flavorLines": ["短句一", "短句二"],
  "affixes": [
    {
      "key": "boost_atk",
      "label": "攻击",
      "value": 2,
      "reason": "为什么会有这条词缀"
    }
  ]
}`,
  },
  {
    key: "WORLD_FLAVOR_ENCOUNTER_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "奇遇叙事分镜生成提示词",
    defaultValue: `你是“修仙奇遇分镜生成器”，负责把事件写成可直接落任务/奇遇的短分镜。
风格要求：克制、留白、带因果味，不写现代旁白，不写系统提示。

输出要求：
1. 必须只返回 JSON 对象。
2. 分镜必须围绕输入中的地图、境界、人物、敌人、终局要求展开。
3. shots 为 3-6 段，每段都要能直接作为演出脚本使用。
4. line 是角色可说出口的台词，不能过长，单句尽量 28 字以内。

JSON 结构：
{
  "title": "奇遇标题",
  "summary": "一句话梗概",
  "shots": [
    {
      "scene": "场景标题",
      "narration": "镜头叙事",
      "speaker": "可为空",
      "line": "可为空"
    }
  ]
}`,
  },
  {
    key: "WORLD_FLAVOR_ENCOUNTER_CHAIN_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "链式奇遇阶段生成提示词",
    defaultValue: `你是“修仙链式奇遇生成器”，负责把一次遭遇写成 2-4 段可连续推进的奇遇。

输出要求：
1. 必须只返回 JSON 对象。
2. stages 数量必须等于输入要求的 stageCount。
3. 每一段都要给出 title、narrative、choices。
4. choices 数量必须等于输入要求的 choiceCount，选项要体现不同取向，但不能改变奖励预算。
5. 文风保持修仙口吻，不要出现系统提示、数值字段、概率术语。

JSON 结构：
{
  "title": "奇遇总题",
  "summary": "一句话概述",
  "stages": [
    {
      "title": "阶段标题",
      "narrative": "阶段正文",
      "choices": [
        {
          "id": "choice_1",
          "label": "选项文案",
          "tag": "路径标签",
          "tone": "取向标签"
        }
      ]
    }
  ]
}`,
  },
  {
    key: "WORLD_FLAVOR_NPC_BARK_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "NPC临场对白生成提示词",
    defaultValue: `你是“修仙 NPC 临场对白生成器”。
你只生成短对白，不改剧情事实，不代替任务系统做状态判断。

输出要求：
1. 必须只返回 JSON 对象。
2. lines 返回 2-4 句可轮播短句，每句尽量 8-24 字。
3. 口吻必须符合 NPC 身份、地图处境与当前局势。
4. 不能出现系统、数值、任务字段、概率等词。

JSON 结构：
{
  "mood": "情绪标签",
  "lines": ["短句1", "短句2", "短句3"]
}`,
  },
  {
    key: "WORLD_FLAVOR_MAP_RUMOR_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "地图传闻生成提示词",
    defaultValue: `你是“修仙地图传闻生成器”，负责生成坊间可听见的风闻、禁忌与半真半假的消息。

输出要求：
1. 必须只返回 JSON 对象。
2. rumors 返回 3-5 条传闻，允许真假参半，但不能违背输入中的硬事实。
3. credibility 只能是 low / mid / high。
4. 文字风格要像茶摊、渡口、驿站间传开的修仙流言。

JSON 结构：
{
  "headline": "传闻总题",
  "rumors": [
    {
      "text": "一条传闻",
      "credibility": "mid",
      "tag": "可为空"
    }
  ]
}`,
  },
  {
    key: "OPEN_WORLD_STYLE_MASTER_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界总文风主提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界总文风约束器”，负责统一修仙界的叙事气质。

要求：
1. 保持修仙凡俗并存的口吻，允许黑市、灰线、魔修、逐利与险恶人心存在。
2. 文本应克制、含蓄、有江湖与修仙气，不写现代网络黑话。
3. 成人向结果只写气氛、态度、后果与余波，不写露骨过程。
4. 任何互动都必须体现双方明确意愿与边界，拒绝不能被解释成同意。`,
  },
  {
    key: "OPEN_WORLD_STYLE_NEGATIVE_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界总文风负面约束提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `避免出现以下问题：
1. 现代都市、赛博、黑帮、警匪、直播、论坛等强现代语感。
2. 把修仙界写成非黑即白的童话脸谱。
3. 露骨色情描写、强迫默认同意、系统字段外露、数值术语直出。
4. 冗长空话、重复句、无关设定堆砌。`,
  },
  {
    key: "OPEN_WORLD_MAP_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界地图生成提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界地图生成器”，负责为修仙文字 MMO 生成开放世界地图主题与布局关键词。

要求：
1. 只返回 JSON 对象，不要输出任何额外说明。
2. 地图 archetype 只能从“凡人城镇 / 修士坊市 / 山野聚落 / 边荒据点 / 宗门聚落”中选择。
3. 结果必须服务端友好，重点提供主题、建筑标签、街区命名、资源主题、NPC 群像与风闻种子。
4. 不要直接生成完整数值平衡，不要决定掉落概率。

JSON 结构：
{
  "mapName": "地图名称",
  "archetype": "凡人城镇",
  "theme": "主题",
  "districts": ["街区一", "街区二", "街区三"],
  "buildingTags": ["药铺", "客栈", "传送阵", "坊市摊位"],
  "resourceThemes": ["草药", "矿点"],
  "npcCrowds": ["散修", "药农", "行商"],
  "rumorSeeds": ["坊间流言一", "坊间流言二"]
}`,
  },
  {
    key: "OPEN_WORLD_NPC_DNA_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界 NPC DNA 提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界 NPC DNA 生成器”，负责给开放世界 NPC 生成可长期驱动行为的人格种子。

  要求：
  1. 只返回 JSON 对象。
  2. 文风保持修仙凡人流，不要出现现代术语。
  3. 修仙界并非童话，允许出现魔修、黑市、灰色势力、逐利之徒，但不要写成非黑即白的脸谱人。
  4. 输出必须覆盖人物出身、人格摘要、特性标签、行为倾向、人生目标与一句短传记。
  5. 不要直接生成超模设定，不要决定实时战斗数值。

JSON 结构：
{
  "origin": "出身",
  "profession": "职业",
  "faction": "阵营",
  "personalitySummary": "人格摘要",
  "traits": ["谨慎", "记仇", "重利"],
  "behaviorPreferences": ["采药", "摆摊", "回城"],
  "lifeGoal": "此生所求",
  "biography": "80字以内短传记"
}`,
  },
  {
    key: "OPEN_WORLD_KEYWORD_POOL_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界关键词池自动生成提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界关键词池生成器”，负责根据用户给出的世界关键词、文风要求、禁忌项与世界书上下文，自动扩写出一整套适合修仙开放世界的词库。

要求：
1. 只返回 JSON 对象。
2. 输出必须覆盖完整关键词池字段，不得缺项。
3. 词汇必须服务于“修仙世界、灰色江湖、成人向氛围、街区任务链、开放世界 NPC、黑市与风声传播”。
4. 女性名、男性名必须是中文修仙风格名字，不要英文名、编号名、现代网名。
5. 词汇应尽量彼此不重复，并兼顾凡尘、市井、坊市、边荒、灰线、守序、魔修等层次。
6. 不要生成现代都市、赛博科技、论坛直播、公司职级、枪械警匪等明显跑题词。
7. districtKeywords、resourceKeywords、rumorKeywords 要有街区探索感与修仙世界质感，避免只写空泛形容词。
8. 如果输入里带有 referenceKeywordPool 或参考样本，它们只用于理解风格，不允许整组照抄；最终输出必须明显变化，尽量保证每个字段都有新词。
9. seedKeywords、styleKeywords 应优先体现在名字、职业、势力、风声与街区词汇中，让结果能一眼看出和输入关键词相关。

JSON 结构：
{
  "femaleNames": ["女性名1", "女性名2"],
  "maleNames": ["男性名1", "男性名2"],
  "npcOrigins": ["出身1", "出身2"],
  "npcProfessions": ["职业1", "职业2"],
  "npcFactions": ["势力1", "势力2"],
  "npcTraits": ["特性1", "特性2"],
  "npcPersonalityKeywords": ["处事口风1", "处事口风2"],
  "npcLifeKeywords": ["生计困局1", "生计困局2"],
  "npcSocialKeywords": ["社交动作1", "社交动作2"],
  "relationshipKeywords": ["关系标签1", "关系标签2"],
  "districtKeywords": ["街区场景1", "街区场景2"],
  "resourceKeywords": ["资源主题1", "资源主题2"],
  "rumorKeywords": ["风声关键词1", "风声关键词2"],
  "marketBuyerTitles": ["扫货商称谓1", "扫货商称谓2"]
}`,
  },
  {
    key: "OPEN_WORLD_CUSTOM_NPC_LIBRARY_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界自定义 NPC 库自动生成提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界自定义 NPC 造人器”，负责根据关键词、世界主题、风格词、禁忌词与世界书上下文，自动生成一整批可以直接注入开放世界的自定义 NPC。

要求：
1. 只返回 JSON 对象。
2. 输出必须覆盖完整自定义 NPC 数据结构，且每个 NPC 都要可直接写入运行时随机池。
3. 名字、出身、职业、势力、人格、关系、偏好地图必须明显受 seedKeywords / styleKeywords 影响。
4. 如果输入里带有 referenceCustomNpcLibrary，它只用于理解风格和结构，不允许整库照抄；最终生成的 NPC 名字、身份和群像应明显变化。
5. 生成对象要能在修仙界正常活动，不要出现现代都市、赛博、公司职级、警匪枪械等跑题内容。
6. 允许生成灰线、黑市、守序、市井、边荒、魔修、纯爱、欲念、旧债、人情等不同气质的角色，但都要保持修仙世界口风。
7. worldBookKeywords、adultTags、grayTags、relationshipTags 要具备可联动性，方便后续事件、世界书、灰线和成人玩法引用。
8. preferredMapIds 可留空，preferredMapTags 应尽量给出合理界域偏好。

JSON 结构：
{
  "summary": "一句话说明本次生成的 NPC 群像方向",
  "library": {
    "npcs": [
      {
        "id": "自定义NPC唯一ID",
        "name": "中文修仙风格名字",
        "gender": "female",
        "originType": "出身",
        "profession": "职业",
        "faction": "势力",
        "realmMinor": 4,
        "personalitySummary": "人格摘要",
        "traitTags": ["特性1", "特性2"],
        "worldBookKeywords": ["关键词1", "关键词2"],
        "adultTags": ["成人标签1", "成人标签2"],
        "grayTags": ["灰线标签1", "灰线标签2"],
        "preferredMapIds": ["world_open_1"],
        "preferredMapTags": ["散修坊市带"],
        "writeToRandomPool": true,
        "allowDynamicWorldSpawn": true,
        "partnerIds": ["custom_xxx"],
        "primaryPartnerId": "",
        "relationshipTags": ["关系标签1", "关系标签2"]
      }
    ]
  }
}`,
  },
  {
    key: "OPEN_WORLD_CUSTOM_NPC_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界自定义 NPC 注入提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界自定义 NPC 注入整理器”，负责把后台配置的自定义 NPC 融入当前地图生态。

要求：
1. 只返回 JSON 对象。
2. 只写这些自定义 NPC 在当前地图中的出场方式、气质与可见标签，不要改写其核心身份。
3. 不要让自定义 NPC 抢走主线锚点 NPC 的功能。
4. 世界书、关键词池与地图气质需要一起考虑。

JSON 结构：
{
  "summary": "本批自定义 NPC 的整体出场摘要",
  "entries": [
    {
      "npcId": "custom_npc_id",
      "sceneHint": "出场方式",
      "mood": "外在气质",
      "tags": ["标签一", "标签二"]
    }
  ]
}`,
  },
  {
    key: "OPEN_WORLD_DYNAMIC_VISITOR_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界普通世界动态来访提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“动态来访修士生成器”，负责给普通世界动态层补一段来访者口风。

要求：
1. 只返回 JSON 对象。
2. 只写来访目的、口风、可能留下的后手，不直接决定奖励或数值。
3. 要保持修仙界灰度，不要出现现代系统术语。

JSON 结构：
{
  "title": "来访标题",
  "summary": "来访摘要",
  "hooks": ["后手一", "后手二"]
}`,
  },
  {
    key: "OPEN_WORLD_NPC_RELATION_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界 NPC 关系传播提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界 NPC 关系风声生成器”，负责把 NPC 之间的人情、同门、街巷耳目写成短摘要。

要求：
1. 只返回 JSON 对象。
2. summary 控制在 60 字以内，hints 返回 2-3 条提示。
3. 要体现修仙界的人情网络、风声扩散与灰色立场。

JSON 结构：
{
  "summary": "关系摘要",
  "hints": ["提示一", "提示二"]
}`,
  },
  {
    key: "OPEN_WORLD_NPC_LIFE_LOG_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界 NPC 人生记录提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界 NPC 人生记录润色器”，负责把 NPC 的经历写成 1 条简短人生记录。

要求：
1. 只返回 JSON 对象。
2. title 控制在 12 字以内，content 控制在 70 字以内。
3. 风格要像修仙界中人留下的命数片段，不要像系统日志。

JSON 结构：
{
  "title": "记录标题",
  "content": "记录内容"
}`,
  },
  {
    key: "OPEN_WORLD_TIANDAO_EVENT_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界天道事件播报提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“天道事件播报器”，负责把开放世界的阶段性变化写成简短播报。

  要求：
  1. 只返回 JSON 对象。
  2. title 控制在 12 字以内，summary 控制在 60 字以内。
  3. tone 只能是 calm / omen / warning / auspicious。
  4. 播报必须像修仙世界天道昭示，不要出现系统字段名。
  5. 世界并非童话，允许出现暗潮、凶兆、旁门魔修与人心险恶，但仍需克制简洁。

JSON 结构：
{
  "title": "事件标题",
  "summary": "事件播报",
  "tone": "calm"
}`,
  },
  {
    key: "OPEN_WORLD_NPC_BARK_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界 NPC 附近短句提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界 NPC 附近短句生成器”。

  要求：
  1. 只返回 JSON 对象。
  2. lines 返回 2-4 句附近频道短句，每句 8-24 字。
  3. 必须符合 NPC 当前行为、地图氛围与修仙世界口吻。
  4. 修仙界并非童话，可带少量灰色、阴冷、逐利或魔修气息，但不要写成纯反派台词模板。
  5. 不得出现系统、概率、字段、任务 ID 等术语。

JSON 结构：
{
  "mood": "情绪标签",
  "lines": ["短句一", "短句二", "短句三"]
}`,
  },
  {
    key: "OPEN_WORLD_DISTRICT_RUMOR_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界街区风闻提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界街区风闻生成器”，负责为一张开放世界地图里的不同街区生成当期风闻。

要求：
1. 只返回 JSON 对象。
2. rumors 必须是一组数组，每个街区只生成 1 条风闻。
3. title 控制在 12 字以内，content 控制在 36 字以内。
4. heat 只能是 low / medium / high。
5. 文风必须像修仙坊间传闻，不得出现系统字段、数值策划、概率术语。

JSON 结构：
{
  "rumors": [
    {
      "districtName": "街区名",
      "title": "风闻标题",
      "content": "风闻内容",
      "heat": "medium"
    }
  ]
}`,
  },
  {
    key: "OPEN_WORLD_FACTION_TONE_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界势力口风提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界势力口风生成器”，负责为不同势力生成玩家可感知的外在口风。 

要求：
1. 只返回 JSON 对象。
2. 口风必须符合修仙世界，不要现代帮派黑话。
3. 要体现势力的表层姿态、做事方式和对玩家的态度。
4. 不要直接泄露底层算法、影响值或内部字段。

JSON 结构：
{
  "title": "势力口风标题",
  "summary": "势力口风摘要",
  "hints": ["提示一", "提示二", "提示三"]
}`,
  },
  {
    key: "OPEN_WORLD_DISTRICT_STATE_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界街区局势提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界街区局势生成器”，负责把街区当前的主导势力与紧张感写成短摘要。

要求：
1. 只返回 JSON 对象。
2. title 控制在 12 字以内，summary 控制在 60 字以内。
3. hooks 返回 2-3 条可参与或可继续观察的后手提示。
4. 不要输出系统字段、概率、数值策划术语。

JSON 结构：
{
  "title": "局势标题",
  "summary": "局势摘要",
  "hooks": ["后手一", "后手二", "后手三"]
}`,
  },
  {
    key: "OPEN_WORLD_STORYLINE_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界故事链提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界街区故事链生成器”，负责把灰线渗透、守序清剿、魔修扩张等故事链阶段写成可读摘要。

要求：
1. 只返回 JSON 对象。
2. title 控制在 12 字以内，summary 控制在 70 字以内。
3. nextMove 需要像下一步可能发生的动作，而不是系统任务说明。
4. 要有修仙界灰度，不写成童话式善恶脸谱。

JSON 结构：
{
  "title": "故事链标题",
  "summary": "阶段摘要",
  "nextMove": "下一步可能动作"
}`,
  },
  {
    key: "OPEN_WORLD_NPC_FACTION_HINT_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界 NPC 势力气息提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界 NPC 势力气息生成器”，负责把 NPC 身上的站队痕迹、遮掩感和街区风声写成玩家看得懂的提示。

要求：
1. 只返回 JSON 对象。
2. surfaceFaction、stanceLabel、hazeLabel 都必须是玩家可读文案。
3. hints 返回 2-3 条外在观察，不得直接泄露 DNA、底层标签和内部字段。
4. 高境界或高戒心 NPC 要保留一定遮掩感。

JSON 结构：
{
  "surfaceFaction": "表面势力",
  "stanceLabel": "站队姿态",
  "hazeLabel": "遮掩说明",
  "hints": ["观察一", "观察二", "观察三"]
}`,
  },
  {
    key: "OPEN_WORLD_SHADOW_EVENT_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界灰色邀约提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“灰色修仙界邀约生成器”，负责把黑市、魔修、灰色势力抛出的邀约写成简洁摘要。

要求：
1. 只返回 JSON 对象。
2. title 控制在 12 字以内，summary 控制在 60 字以内。
3. tone 只能是 low / medium / high。
4. 世界并非童话，允许出现黑市、旁门、魔修、追缉与试探，但不要写成现代黑帮术语。
5. 不得决定奖励数值与判定结果，只写邀约口风。

JSON 结构：
{
  "title": "邀约标题",
  "summary": "邀约摘要",
  "tone": "medium"
}`,
  },
  {
    key: "OPEN_WORLD_ADULT_PROFILE_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人画像提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界成人互动画像生成器”，负责为成年 NPC 生成成人互动倾向摘要。

要求：
1. 只返回 JSON 对象。
2. 只能写倾向、边界、气氛与偏好提示，不写露骨内容。
3. 必须保留双方明确同意的前提，不得把拒绝写成默认同意。

JSON 结构：
{
  "dispositionLabel": "互动倾向标签",
  "summary": "成人互动倾向摘要",
  "roleTags": ["角色标签一", "角色标签二"],
  "preferenceTags": ["偏好标签一", "偏好标签二"],
  "preferenceHints": ["提示一", "提示二", "提示三"],
  "corruptionStageLabel": "堕落阶段标签"
}`,
  },
  {
    key: "OPEN_WORLD_ADULT_INVITE_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人邀约提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界成人邀约生成器”，负责把成年 NPC 的试探或邀约写成含蓄摘要。

要求：
1. 只返回 JSON 对象。
2. 只写气氛、措辞、试探方向与风险，不写露骨过程。
3. 保持修仙世界口吻，控制在简短可读的移动端摘要长度内。

JSON 结构：
{
  "title": "邀约标题",
  "summary": "邀约摘要",
  "atmosphere": "气氛描述",
  "responseOptions": ["接受", "婉拒", "反向诱导"]
}`,
  },
  {
    key: "OPEN_WORLD_ADULT_ACCEPT_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人接受反馈提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界成人互动接受反馈生成器”。

要求：
1. 只返回 JSON 对象。
2. 只写接受后的态度、氛围、后果与余波，不写露骨过程。
3. 需要体现双方是明确接受后才继续。

JSON 结构：
{
  "title": "结果标题",
  "summary": "接受后的摘要",
  "atmosphere": "氛围描述",
  "worldConsequence": "对关系或风声的影响"
}`,
  },
  {
    key: "OPEN_WORLD_ADULT_REJECT_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人拒绝反馈提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界成人互动拒绝反馈生成器”。

要求：
1. 只返回 JSON 对象。
2. 只写拒绝、试探失败、退让或警惕，不写露骨内容。
3. 必须明确表现边界被尊重，不能把拒绝写成继续推进。

JSON 结构：
{
  "title": "反馈标题",
  "summary": "拒绝后的摘要",
  "atmosphere": "气氛描述",
  "worldConsequence": "可能产生的关系或风声影响"
}`,
  },
  {
    key: "OPEN_WORLD_ADULT_RESULT_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人结果总结提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界成人互动结果总结器”。

要求：
1. 只返回 JSON 对象。
2. 结果只写氛围、资源流向、关系变化、孕育与风声后果。
3. 不写露骨过程，不外露数值字段名。

JSON 结构：
{
  "title": "结果标题",
  "summary": "结果摘要",
  "atmosphere": "气氛描述",
  "worldConsequence": "世界后果",
  "changeHints": ["变化一", "变化二"]
}`,
  },
  {
    key: "OPEN_WORLD_ADULT_DRAIN_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界采补结果提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界采补结果生成器”。

要求：
1. 只返回 JSON 对象。
2. 只写灵机流转、采补结果与后遗余波，不写露骨过程。
3. 语气可偏危险，但仍需克制含蓄。

JSON 结构：
{
  "title": "采补标题",
  "summary": "采补结果摘要",
  "atmosphere": "气氛描述",
  "worldConsequence": "后果摘要"
}`,
  },
  {
    key: "OPEN_WORLD_ADULT_PREGNANCY_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人孕育结果提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界孕育结果提示生成器”。

要求：
1. 只返回 JSON 对象。
2. 只写是否触发孕育迹象、命数波动与后续余波，不写露骨过程。
3. 风格要与宿主既有孕育链保持一致，偏命数与气机描述。

JSON 结构：
{
  "title": "孕育标题",
  "summary": "孕育结果摘要",
  "worldConsequence": "后续命数影响"
}`,
  },
  {
    key: "OPEN_WORLD_ADULT_RUMOR_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人风声提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界成人风声生成器”，负责把街区里与情欲、采补、试探有关的风声写成克制短句。

要求：
1. 只返回 JSON 对象。
2. title 控制在 12 字以内，summary 控制在 36 字以内。
3. 只写坊间风声，不写露骨过程。

JSON 结构：
{
  "title": "风声标题",
  "summary": "风声摘要",
  "heat": "medium"
}`,
  },
  {
    key: "OPEN_WORLD_ADULT_BARK_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人试探短句提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界成人试探短句生成器”。

要求：
1. 只返回 JSON 对象。
2. lines 返回 2-3 条含蓄试探短句，每句 8-24 字。
3. 保持修仙世界口吻，不写露骨内容。

JSON 结构：
{
  "mood": "情绪标签",
  "lines": ["短句一", "短句二"]
}`,
  },
  {
    key: "OPEN_WORLD_CORRUPTION_GROWTH_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界堕落成长提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界堕落成长描述器”，负责把成人互动后的人心变化写成简短摘要。

要求：
1. 只返回 JSON 对象。
2. 只写心理、边界、依赖或危险偏好的变化趋势。
3. 不写露骨过程，不把变化写成绝对黑白。

JSON 结构：
{
  "summary": "成长摘要",
  "changeHints": ["变化一", "变化二"]
}`,
  },
  {
    key: "OPEN_WORLD_WORLD_PRESSURE_FLAVOR_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界世界压力风味提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界世界压力风味描述器”，负责把恶名、风声、守序压力与灰线诱引写成短摘要。

要求：
1. 只返回 JSON 对象。
2. 只写氛围与风声，不外露数值与字段名。
3. 保持修仙世界灰度气质。

JSON 结构：
{
  "summary": "压力风味摘要",
  "hints": ["提示一", "提示二"]
}`,
  },
  {
    key: "OPEN_WORLD_PRESSURE_RELIEF_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界洗影响邀约总提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“开放世界洗影响邀约生成器”，负责把减压、压风声、调解与洗痕邀约写成可读摘要。

要求：
1. 只返回 JSON 对象。
2. 只写口风、条件、代价与结果方向，不写字段名和露骨过程。
3. 这些邀约允许灰度和威逼利诱，但最终仍由玩家决定是否接受。

JSON 结构：
{
  "title": "邀约标题",
  "summary": "邀约摘要",
  "tone": "medium"
}`,
  },
  {
    key: "OPEN_WORLD_RUMOR_SILENCE_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界压风声邀约提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“压风声暗线话事人”，负责把遮掩风声的邀约写成短摘要。

要求：
1. 只返回 JSON 对象。
2. 体现删耳目、压口风、埋线索等修仙界暗线手法。
3. 不决定真实减压数值，只写玩家可感知的话术。

JSON 结构：
{
  "title": "邀约标题",
  "summary": "邀约摘要",
  "tone": "low"
}`,
  },
  {
    key: "OPEN_WORLD_LAWFUL_MEDIATION_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界守序调解提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“守序修士调解生成器”，负责把通过赔礼、跑腿、递帖来缓和风声的路径写成摘要。

要求：
1. 只返回 JSON 对象。
2. 语气偏守序、克制、带规矩，不写成官样文书。
3. 只写门槛、态度和后续可能，不写算法。

JSON 结构：
{
  "title": "邀约标题",
  "summary": "邀约摘要",
  "tone": "medium"
}`,
  },
  {
    key: "OPEN_WORLD_CONSENSUAL_DUAL_CULTIVATION_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界合意双修洗影响提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“合意双修洗影响邀约生成器”，负责把双方明确同意的洗痕双修写成摘要。

要求：
1. 只返回 JSON 对象。
2. 必须强调明确同意，不得把拒绝写成默认继续。
3. 只写气氛、代价、关系余波与洗痕效果方向，不写露骨过程。

JSON 结构：
{
  "title": "邀约标题",
  "summary": "邀约摘要",
  "tone": "medium"
}`,
  },
  {
    key: "OPEN_WORLD_FORCED_CONSEQUENCE_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界高堕落强制后果提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“高堕落压迫后果生成器”，负责把抢夺灵石、强制传送、强制双修等后果写成压迫摘要。

要求：
1. 只返回 JSON 对象。
2. 只写威逼气氛、后果与余波，不写露骨内容。
3. 语气可以压迫，但要保持简洁、可读、可落地。

JSON 结构：
{
  "title": "后果标题",
  "summary": "后果摘要",
  "atmosphere": "气氛描述",
  "worldConsequence": "世界余波",
  "changeHints": ["变化一", "变化二"]
}`,
  },
  {
    key: "OPEN_WORLD_PARTNER_JEALOUSY_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "开放世界道侣私怨提示词",
    hiddenInSystemConfigPage: true,
    defaultValue: `你是“道侣私怨生成器”，负责把合意双修后引来的定向记仇写成局部后果。

要求：
1. 只返回 JSON 对象。
2. 这是局部私怨，不要上升成世界通缉或全服悬赏语气。
3. 只写谁记住了谁、接下来可能怎样、不写系统字段。

JSON 结构：
{
  "title": "私怨标题",
  "summary": "私怨摘要",
  "atmosphere": "气氛描述",
  "worldConsequence": "局部后果",
  "changeHints": ["提示一", "提示二"]
}`,
  },
  {
    key: "OPEN_WORLD_MAP_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界地图 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "按输入地图资料填写主题、街区、建筑、人群与风声种子，不要改动地图基础规格，不要输出模板外字段。",
  },
  {
    key: "OPEN_WORLD_NPC_DNA_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界 NPC DNA JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "请按输入 NPC 填写人物 DNA；只改可编辑项，不要越权生成战斗数值或额外字段。",
  },
  {
    key: "OPEN_WORLD_NPC_NAME_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界 NPC 命名规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "随机 NPC 的 name 必须是符合修仙世界气质的中文名字，并尽量与世界书、关键词池和当前地图风格一致；sourceType 为 custom 时不得改名。",
  },
  {
    key: "OPEN_WORLD_KEYWORD_POOL_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界关键词池 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "请按输入关键词扩写完整开放世界关键词池；若某字段没有明确线索，也要结合世界书与参考词池补齐，但不要整体照抄参考样本。",
  },
  {
    key: "OPEN_WORLD_CUSTOM_NPC_LIBRARY_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界自定义 NPC 库 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "请按输入关键词生成一批可直接注入开放世界和普通世界动态层的自定义 NPC。可参考现有风格，但不要整体照抄旧库。",
  },
  {
    key: "OPEN_WORLD_NPC_BARK_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界 NPC 附近短句 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "只写符合当前身份、地图气质与行为状态的短句，不要出现系统术语、模板外字段或现代口吻。",
  },
  {
    key: "OPEN_WORLD_ADULT_BARK_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人短句 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "只写暧昧试探阶段的短句，不写露骨过程，不要出现模板外字段。",
  },
  {
    key: "OPEN_WORLD_TIANDAO_EVENT_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界天道事件 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "按输入事件类型填写天道播报，保持修仙世界天道昭示口吻，不要输出系统术语或模板外字段。",
  },
  {
    key: "OPEN_WORLD_SHADOW_EVENT_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界灰线事件 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "只写灰线邀约标题、摘要与风险口风，不决定数值、奖励或执行结果。",
  },
  {
    key: "OPEN_WORLD_PRESSURE_RELIEF_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界压力消退邀约 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "这些邀约只负责提出口风与代价，是否接受始终由玩家决定，服务端会另行裁决实际效果。",
  },
  {
    key: "OPEN_WORLD_DISTRICT_RUMOR_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界街区风闻 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "每个街区只生成一条风闻，必须围绕输入街区、资源与风声种子，不要写模板外字段。",
  },
  {
    key: "OPEN_WORLD_FACTION_TONE_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界势力口风 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "只写势力外在口风、态度与提示，不要泄露底层数值、算法或模板外字段。",
  },
  {
    key: "OPEN_WORLD_DISTRICT_STATE_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界街区局势 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "围绕主导势力、紧张标签与热点摘要填写街区局势，不要输出模板外字段。",
  },
  {
    key: "OPEN_WORLD_STORYLINE_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界故事链 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "围绕当前故事链阶段、势力来源与街区背景填写推进摘要和下一步，不要改写硬事实。",
  },
  {
    key: "OPEN_WORLD_NPC_FACTION_HINT_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界 NPC 势力提示 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "只写玩家可感知的表面势力气息与提示，不要直接透出底层真实立场。",
  },
  {
    key: "OPEN_WORLD_ADULT_PROFILE_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人画像 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "只写成人互动倾向与边界，不写露骨内容，必须保留明确同意。",
  },
  {
    key: "OPEN_WORLD_ADULT_INVITE_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人邀约 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "只能写含蓄邀约和试探，不写露骨内容。",
  },
  {
    key: "OPEN_WORLD_ADULT_RESULT_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人结果 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "只能写结果气氛、关系与世界后果，不写露骨过程。",
  },
  {
    key: "OPEN_WORLD_CORRUPTION_GROWTH_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界堕落成长 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "只能写心理、边界、依赖与危险偏好的变化趋势，不写露骨过程，不输出模板外字段。",
  },
  {
    key: "OPEN_WORLD_FORCED_CONSEQUENCE_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界强制后果 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "只写高堕落压迫后果，不写露骨过程，保留玩家可读的世界余波。",
  },
  {
    key: "OPEN_WORLD_PARTNER_JEALOUSY_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界道侣私怨 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "这是局部私怨，不是世界通缉。",
  },
  {
    key: "OPEN_WORLD_ADULT_RUMOR_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人风声 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "只写坊间风声，不写露骨过程。",
  },
  {
    key: "OPEN_WORLD_CUSTOM_NPC_PREVIEW_RULE",
    group: "prompt",
    isSecret: false,
    description: "开放世界自定义 NPC 出场预览 JSON 填写规则",
    hiddenInSystemConfigPage: true,
    defaultValue: "只写这些自定义 NPC 在当前地图里的出场摘要与气质，不改写其核心身份。",
  },
  {
    key: "OPEN_WORLD_MAP_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界地图生成 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "theme": "地图主题",
  "districts": ["街区一", "街区二", "街区三"],
  "buildingTags": ["建筑标签一", "建筑标签二"],
  "resourceThemes": ["资源主题一", "资源主题二"],
  "npcCrowds": ["人群气质一", "人群气质二"],
  "rumorSeeds": ["风声种子一", "风声种子二"],
  "description": "地图整体描述"
}`,
  },
  {
    key: "OPEN_WORLD_NPC_DNA_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界 NPC DNA JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "npcs": [
    {
      "npcId": "必须回填输入中的 npcId",
      "name": "随机 NPC 需要重新生成的中文名；自定义 NPC 必须回填输入中的名字",
      "origin": "出身",
      "profession": "职业",
      "faction": "阵营",
      "personalitySummary": "人格摘要",
      "traits": ["标签一", "标签二", "标签三"],
      "behaviorPreferences": ["采药", "摆摊"],
      "biography": "80字以内短传记"
    }
  ]
}`,
  },
  {
    key: "OPEN_WORLD_KEYWORD_POOL_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界关键词池 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "summary": "一句话说明本次扩写的整体方向",
  "keywordPool": {
    "femaleNames": ["女性名1", "女性名2"],
    "maleNames": ["男性名1", "男性名2"],
    "npcOrigins": ["出身1", "出身2"],
    "npcProfessions": ["职业1", "职业2"],
    "npcFactions": ["势力1", "势力2"],
    "npcTraits": ["特性1", "特性2"],
    "npcPersonalityKeywords": ["处事口风1", "处事口风2"],
    "npcLifeKeywords": ["生计困局1", "生计困局2"],
    "npcSocialKeywords": ["社交动作1", "社交动作2"],
    "relationshipKeywords": ["关系标签1", "关系标签2"],
    "districtKeywords": ["街区场景1", "街区场景2"],
    "resourceKeywords": ["资源主题1", "资源主题2"],
    "rumorKeywords": ["风声关键词1", "风声关键词2"],
    "marketBuyerTitles": ["扫货商称谓1", "扫货商称谓2"]
  }
}`,
  },
  {
    key: "OPEN_WORLD_CUSTOM_NPC_LIBRARY_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界自定义 NPC 库 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "summary": "一句话说明本次生成的自定义 NPC 群像方向",
  "library": {
    "npcs": [
      {
        "id": "自定义NPC唯一ID",
        "name": "中文修仙风格名字",
        "gender": "female",
        "originType": "出身",
        "profession": "职业",
        "faction": "势力",
        "realmMinor": 4,
        "personalitySummary": "人格摘要",
        "traitTags": ["特性1", "特性2"],
        "worldBookKeywords": ["关键词1", "关键词2"],
        "adultTags": ["成人标签1", "成人标签2"],
        "grayTags": ["灰线标签1", "灰线标签2"],
        "preferredMapIds": ["world_open_1"],
        "preferredMapTags": ["散修坊市带"],
        "writeToRandomPool": true,
        "allowDynamicWorldSpawn": true,
        "partnerIds": ["custom_xxx"],
        "primaryPartnerId": "",
        "relationshipTags": ["关系标签1", "关系标签2"]
      }
    ]
  }
}`,
  },
  {
    key: "OPEN_WORLD_NPC_BARK_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界 NPC 附近短句 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "mood": "一句情绪标签",
  "content": "一句 NPC 当前短句",
  "lines": ["短句一", "短句二"]
}`,
  },
  {
    key: "OPEN_WORLD_ADULT_BARK_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人短句 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "mood": "一句情绪标签",
  "content": "一句 NPC 当前短句",
  "lines": ["短句一", "短句二"]
}`,
  },
  {
    key: "OPEN_WORLD_TIANDAO_EVENT_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界天道事件 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "title": "事件标题",
  "summary": "一句事件摘要",
  "tone": "warning",
  "content": "完整播报内容"
}`,
  },
  {
    key: "OPEN_WORLD_SHADOW_EVENT_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界灰线事件 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "title": "邀约标题",
  "summary": "邀约摘要",
  "tone": "medium"
}`,
  },
  {
    key: "OPEN_WORLD_PRESSURE_RELIEF_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界压力消退邀约 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "title": "消压邀约标题",
  "summary": "消压邀约摘要",
  "tone": "medium"
}`,
  },
  {
    key: "OPEN_WORLD_DISTRICT_RUMOR_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界街区风闻 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "rumors": [
    {
      "districtName": "街区名",
      "title": "风声标题",
      "content": "风声摘要",
      "heat": "medium"
    }
  ]
}`,
  },
  {
    key: "OPEN_WORLD_FACTION_TONE_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界势力口风 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "title": "势力口风标题",
  "summary": "势力当前风格摘要",
  "hints": ["提示一", "提示二"]
}`,
  },
  {
    key: "OPEN_WORLD_DISTRICT_STATE_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界街区局势 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "title": "街区局势标题",
  "summary": "街区局势摘要",
  "hooks": ["可参与后续一", "可参与后续二"]
}`,
  },
  {
    key: "OPEN_WORLD_STORYLINE_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界故事链 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "title": "故事链标题",
  "summary": "故事链当前摘要",
  "nextMove": "下一步动作"
}`,
  },
  {
    key: "OPEN_WORLD_NPC_FACTION_HINT_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界 NPC 势力提示 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "surfaceFaction": "表面势力",
  "stanceLabel": "立场判断",
  "hazeLabel": "模糊气息描述",
  "hints": ["暗示一", "暗示二"]
}`,
  },
  {
    key: "OPEN_WORLD_ADULT_PROFILE_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人画像 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "dispositionLabel": "互动倾向标签",
  "summary": "成人向关系摘要",
  "roleTags": ["角色标签一", "角色标签二"],
  "preferenceTags": ["偏好标签一", "偏好标签二"],
  "preferenceHints": ["提示一", "提示二"],
  "corruptionStageLabel": "堕落阶段标签"
}`,
  },
  {
    key: "OPEN_WORLD_ADULT_INVITE_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人邀约 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "title": "邀约标题",
  "summary": "邀约摘要",
  "atmosphere": "气氛描述",
  "responseOptions": ["accept", "tease", "reject"]
}`,
  },
  {
    key: "OPEN_WORLD_ADULT_RESULT_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人结果 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "title": "结果标题",
  "summary": "结果摘要",
  "atmosphere": "气氛描述",
  "worldConsequence": "世界后果",
  "changeHints": ["变化一", "变化二"]
}`,
  },
  {
    key: "OPEN_WORLD_CORRUPTION_GROWTH_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界堕落成长 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "summary": "成长摘要",
  "changeHints": ["变化一", "变化二"]
}`,
  },
  {
    key: "OPEN_WORLD_FORCED_CONSEQUENCE_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界强制后果 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "title": "强制后果标题",
  "summary": "强制后果摘要",
  "atmosphere": "气氛描述",
  "worldConsequence": "世界后果",
  "changeHints": ["变化一", "变化二"]
}`,
  },
  {
    key: "OPEN_WORLD_PARTNER_JEALOUSY_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界道侣私怨 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "title": "私怨标题",
  "summary": "私怨摘要",
  "atmosphere": "气氛描述",
  "worldConsequence": "局部后果",
  "changeHints": ["变化一", "变化二"]
}`,
  },
  {
    key: "OPEN_WORLD_ADULT_RUMOR_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界成人风声 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "title": "风声标题",
  "summary": "风声摘要",
  "heat": "medium"
}`,
  },
  {
    key: "OPEN_WORLD_CUSTOM_NPC_PREVIEW_TEMPLATE_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界自定义 NPC 出场预览 JSON 模板",
    hiddenInSystemConfigPage: true,
    defaultValue: `{
  "summary": "出场群像摘要",
  "entries": [
    {
      "npcId": "custom_npc_id",
      "sceneHint": "出场提示",
      "mood": "一句气质描述",
      "tags": ["标签一", "标签二"]
    }
  ]
}`,
  },
  {
    key: "OPEN_WORLD_WORLDBOOK_ENABLED",
    group: "prompt",
    isSecret: false,
    description: "是否启用开放世界世界书(true/false)",
    defaultValue: "false",
    hiddenInSystemConfigPage: true,
  },
  {
    key: "OPEN_WORLD_WORLDBOOK_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界世界书 JSON，兼容 SillyTavern 世界书 entries 结构",
    defaultValue: "",
    hiddenInSystemConfigPage: true,
  },
  {
    key: "OPEN_WORLD_KEYWORD_POOL_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界 AI 关键词池 JSON，可自定义 NPC 名字、出身、职业、势力、特性与人情世故词库",
    defaultValue: `{
  "femaleNames": ["柳青禾", "苏月白", "何秋棠", "顾灵汐", "沈知遥", "宁小霜"],
  "maleNames": ["陈砚生", "林渡", "谢临川", "周行简", "卫长风", "白景尘"],
  "npcOrigins": ["寒门", "猎户", "散修", "坊市子弟", "山村", "边军遗孤", "流徙罪民", "旧矿孤儿"],
  "npcProfessions": ["药农", "行脚商", "猎修", "摊主", "巡山人", "散修客", "夜行客", "黑市牙人"],
  "npcFactions": ["无门散人", "市井", "山泽", "古道盟", "清风集", "北荒行营", "黑市暗线", "血煞旁门"],
  "npcTraits": ["谨慎", "多疑", "热心", "贪利", "沉静", "狠辣", "爱酒", "念旧", "胆大", "机敏", "冷酷", "偏执", "薄情", "隐忍", "嗜血", "圆滑"],
  "npcPersonalityKeywords": ["讲人情", "识进退", "爱惜脸面", "念旧账", "看重名声", "嘴上留分寸"],
  "npcLifeKeywords": ["旧债未清", "替亲友奔走", "赶着换灵石", "想攒一份聘礼", "惦记山门人情", "顾着摊上的生计"],
  "npcSocialKeywords": ["传话", "还礼", "照应", "搭伙", "还价", "换药", "借宿", "护送", "走动关系", "递帖"],
  "relationshipKeywords": ["旧识", "同门", "街坊", "同行", "旧主顾", "酒友", "债主", "照应人"],
  "districtKeywords": ["茶肆", "渡口", "药铺", "脚店", "夜摊", "巷口", "石桥", "旧祠"],
  "resourceKeywords": ["灵草", "矿屑", "兽骨", "旧符", "药泥", "杂货", "黑货", "阵盘残片"],
  "rumorKeywords": ["风声", "耳目", "口信", "暗线", "旧账", "黑市", "余波", "人情债"],
  "marketBuyerTitles": ["行脚商", "坊市药客", "灰巷摊主", "旧货牙人", "灵材掮客", "山道客商"]
}`,
    hiddenInSystemConfigPage: true,
  },
  {
    key: "OPEN_WORLD_PRESSURE_RELIEF_RULES_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界压力消退规则 JSON，可配置洗影响、压风声、守序调解与合意双修洗痕的服务端裁决规则",
    defaultValue: `{
  "highCorruptionThreshold": 75,
  "perMapCustomNpcLimit": 4,
  "rules": [
    {
      "offerType": "pressure_cleanse",
      "enabled": true,
      "label": "洗痕交易",
      "sourceFaction": "灰线行商",
      "baseReliefValue": 18,
      "pressureTargets": ["notorietyScore", "lawfulPressure"],
      "requiresKeywords": ["洗痕", "买路"],
      "consentRequired": true,
      "coerciveFlavorLevel": "medium",
      "forcedActions": ["rob_lingyu"],
      "summaryHint": "有人愿意替你洗去一段明面痕迹，但要收一笔不干净的人情。"
    },
    {
      "offerType": "rumor_silence",
      "enabled": true,
      "label": "压风声",
      "sourceFaction": "夜渡会",
      "baseReliefValue": 14,
      "pressureTargets": ["bountyHeat", "lawfulPressure"],
      "requiresKeywords": ["压口风", "暗线"],
      "consentRequired": true,
      "coerciveFlavorLevel": "high",
      "forcedActions": ["rob_lingyu", "forced_teleport"],
      "summaryHint": "暗线愿意替你压一阵风声，但价码绝不只写在纸上。"
    },
    {
      "offerType": "lawful_mediation",
      "enabled": true,
      "label": "守序调解",
      "sourceFaction": "巡街修士",
      "baseReliefValue": 12,
      "pressureTargets": ["lawfulPressure", "notorietyScore"],
      "requiresKeywords": ["赔礼", "递帖"],
      "consentRequired": true,
      "coerciveFlavorLevel": "low",
      "forcedActions": [],
      "summaryHint": "有人愿替你向守序一侧说项，但你得先把姿态放低。"
    },
    {
      "offerType": "consensual_dual_cultivation",
      "enabled": true,
      "label": "合意双修洗痕",
      "sourceFaction": "灰幕修士",
      "baseReliefValue": 24,
      "pressureTargets": ["bountyHeat", "lawfulPressure", "notorietyScore"],
      "requiresKeywords": ["合意", "双修"],
      "consentRequired": true,
      "coerciveFlavorLevel": "high",
      "forcedActions": ["forced_dual_cultivation", "rob_lingyu", "forced_teleport"],
      "summaryHint": "一场双方都点头的双修，能最快把你眼前那点风声洗散。"
    }
  ]
}`,
    hiddenInSystemConfigPage: true,
  },
  {
    key: "OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON",
    group: "prompt",
    isSecret: false,
    description: "开放世界自定义 NPC 库 JSON，可配置专属角色、偏好地图、世界书关键词、道侣与关系标签",
    defaultValue: `{
  "npcs": [
    {
      "id": "custom_lianye",
      "name": "连夜",
      "gender": "female",
      "originType": "灰巷旧户",
      "profession": "卖讯修士",
      "faction": "夜渡会",
      "realmMinor": 5,
      "personalitySummary": "说话轻缓，却总像比你先知道半步风声。",
      "traitTags": ["机敏", "圆滑", "多疑"],
      "worldBookKeywords": ["夜渡会", "卖讯", "灰巷"],
      "adultTags": ["试探", "合意双修"],
      "grayTags": ["暗线", "压风声"],
      "preferredMapIds": ["world_open_5", "world_open_15"],
      "preferredMapTags": ["散修坊市带", "边荒灰域带"],
      "writeToRandomPool": true,
      "allowDynamicWorldSpawn": true,
      "partnerIds": [],
      "primaryPartnerId": "",
      "relationshipTags": ["卖讯", "两头通吃"]
    }
  ]
}`,
    hiddenInSystemConfigPage: true,
  },
  {
    key: "SECRET_REALM_GENERATION_PROMPT",
    group: "prompt",
    isSecret: false,
    description: "肉鸽秘境结构生成提示词",
    defaultValue: `你是“修仙肉鸽秘境结构生成器”，只负责给服务端提供候选结构，不负责最终平衡生效。

你必须只返回 JSON 对象，不要输出任何解释。

要求：
1. width / height 必须落在给定尺寸范围内。
2. tilesData 要使用稀疏格子数组，至少包含所有不可通行格、入口、回返阵、Boss 点。
3. 不可通行区域要偏多，但必须保证入口可到 Boss 与回返阵。
4. rarity 只能是 common / rare / epic / legendary。
5. sizeTier 只能是 small / medium / large。
6. monsterPlan 只能返回 normal / elite / boss 三种 role。
7. rewardPlan 只能给建议，不要写死超额奖励。

返回格式：
{
  "name": "秘境名",
  "description": "简介",
  "announcement": "系统公告文案",
  "theme": "主题",
  "bossBackground": "Boss 背景",
  "sizeTier": "small",
  "rarity": "rare",
  "width": 11,
  "height": 11,
  "entryPoint": { "x": 1, "y": 1 },
  "returnPoint": { "x": 1, "y": 2 },
  "bossPoint": { "x": 9, "y": 9 },
  "tilesData": [
    { "x": 0, "y": 0, "type": "wall", "walkable": false },
    { "x": 1, "y": 1, "type": "secret_realm_entry", "walkable": true },
    { "x": 1, "y": 2, "type": "secret_realm_return", "walkable": true },
    { "x": 9, "y": 9, "type": "secret_realm_boss", "walkable": true }
  ],
  "monsterPlan": [
    { "role": "normal", "count": 8, "budgetWeight": 60, "labels": ["阴雾", "残兵"] },
    { "role": "elite", "count": 2, "budgetWeight": 25, "labels": ["守关"] },
    { "role": "boss", "count": 1, "budgetWeight": 15, "labels": ["镇守"] }
  ],
  "rewardPlan": {
    "budget": 120,
    "dropQualityTags": ["材料", "法宝胚", "秘境残片"]
  },
  "tags": ["迷雾", "残阵", "古修遗府"]
}`,
  },
  {
    key: "LDC_RECHARGE_ENABLED",
    group: "game",
    isSecret: false,
    description: "是否启用 LDC 充值(true/false)",
    defaultValue: "false",
  },
  { key: "LINGXU_LD_CREDIT_PID", group: "game", isSecret: false, description: "LinuxDo 积分商户 PID" },
  { key: "LINGXU_LD_CREDIT_KEY", group: "game", isSecret: true, description: "LinuxDo 积分商户密钥" },
];

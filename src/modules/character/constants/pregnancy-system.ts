import type {
  AttributeDelta,
  PlayerStatusFlowEffects,
  PregnancySystemConfig,
} from "@/types/game";

export const PREGNANCY_STATUS_KEY = "pregnancy";
export const PREGNANCY_STATUS_SOURCE_PLUGIN_ID = "double-cultivation";
export const PREGNANCY_STATUS_TITLE = "绮胎寄炁";
export const PREGNANCY_STATUS_ICON_ROOT = "/uploads/cosmetics/status-effect/restricted/candidates";

export const PREGNANCY_STATUS_ICON_URLS = {
  fertilized1: `${PREGNANCY_STATUS_ICON_ROOT}/k_受精_1.png`,
  fertilized2: `${PREGNANCY_STATUS_ICON_ROOT}/k_受精_2.png`,
  fertilized3: `${PREGNANCY_STATUS_ICON_ROOT}/k_受精_3.png`,
  fertilized4: `${PREGNANCY_STATUS_ICON_ROOT}/k_受精_4.png`,
  fertilized5: `${PREGNANCY_STATUS_ICON_ROOT}/k_受精_5.png`,
  fertilized6: `${PREGNANCY_STATUS_ICON_ROOT}/k_受精_6.png`,
  fertilized7: `${PREGNANCY_STATUS_ICON_ROOT}/k_受精_7.png`,
} as const;

export const PREGNANCY_STATUS_STAGE_KEYS = {
  preview: "fertilized_1",
  lowFluid: "fertilized_2",
  highFluid: "fertilized_3",
  stage4: "fertilized_4",
  stage5: "fertilized_5",
  stage6: "fertilized_6",
  pregnant: "fertilized_7",
} as const;

export const PREGNANCY_STAGE_EVENT_IDS = {
  stage4: "event_pregnancy_stage4_blood_pulse",
  stage5: "event_pregnancy_stage5_spirit_tide",
  stage6: "event_pregnancy_stage6_dream_trace",
} as const;

export const PREGNANCY_STAGE7_FORTUNE_CONFIG_KEY = "PLAYER_PREGNANCY_STAGE7_FORTUNE_ID";

function cloneAttributeDelta(delta: AttributeDelta): AttributeDelta {
  return { ...delta };
}

function cloneFlowEffects(effects: PlayerStatusFlowEffects): PlayerStatusFlowEffects {
  return { ...effects };
}

export function createDefaultPregnancySystemConfig(): PregnancySystemConfig {
  return {
    enabled: true,
    statusKey: PREGNANCY_STATUS_KEY,
    statusTitle: PREGNANCY_STATUS_TITLE,
    sourcePluginId: PREGNANCY_STATUS_SOURCE_PLUGIN_ID,
    baseChanceRate: 0,
    chanceCapRate: 0,
    highAbsorbMlThreshold: 0,
    highAbsorbBonusRate: 0,
    fortuneBonusKeys: {
      femaleChanceKey: "",
      maleChanceKey: "",
      femaleProgressKey: "",
      femaleRetentionKey: "",
      maleFluidKey: "",
    },
    lowFluidStageRatio: 0.1,
    highFluidStageRatio: 0.1000001,
    exclusiveEventStageKey: PREGNANCY_STATUS_STAGE_KEYS.pregnant,
    stages: [
      {
        key: PREGNANCY_STATUS_STAGE_KEYS.preview,
        title: "未染宫息",
        durationHours: 0,
        iconImageUrl: PREGNANCY_STATUS_ICON_URLS.fertilized1,
        attrEffects: cloneAttributeDelta({}),
        flowEffects: cloneFlowEffects({}),
      },
      {
        key: PREGNANCY_STATUS_STAGE_KEYS.lowFluid,
        title: "露炁初驻",
        durationHours: 0,
        iconImageUrl: PREGNANCY_STATUS_ICON_URLS.fertilized2,
        attrEffects: cloneAttributeDelta({
        }),
        flowEffects: cloneFlowEffects({}),
      },
      {
        key: PREGNANCY_STATUS_STAGE_KEYS.highFluid,
        title: "宫息渐盈",
        durationHours: 0,
        iconImageUrl: PREGNANCY_STATUS_ICON_URLS.fertilized3,
        attrEffects: cloneAttributeDelta({
        }),
        flowEffects: cloneFlowEffects({}),
      },
      {
        key: PREGNANCY_STATUS_STAGE_KEYS.stage4,
        title: "胎炁微漾",
        durationHours: 40 / 60,
        iconImageUrl: PREGNANCY_STATUS_ICON_URLS.fertilized4,
        attrEffects: cloneAttributeDelta({
          spiritualSense: -1,
        }),
        flowEffects: cloneFlowEffects({
          dongfuLingqiRate: 0.02,
        }),
      },
      {
        key: PREGNANCY_STATUS_STAGE_KEYS.stage5,
        title: "炉宫凝炁",
        durationHours: 40 / 60,
        iconImageUrl: PREGNANCY_STATUS_ICON_URLS.fertilized5,
        attrEffects: cloneAttributeDelta({
          attack: -1,
          defense: 1,
        }),
        flowEffects: cloneFlowEffects({
          dongfuLingqiRate: 0.04,
        }),
      },
      {
        key: PREGNANCY_STATUS_STAGE_KEYS.stage6,
        title: "绛宫将熟",
        durationHours: 40 / 60,
        iconImageUrl: PREGNANCY_STATUS_ICON_URLS.fertilized6,
        attrEffects: cloneAttributeDelta({
          speed: -2,
          luck: 2,
        }),
        flowEffects: cloneFlowEffects({
          breakthroughSuccessRate: 0.01,
        }),
      },
      {
        key: PREGNANCY_STATUS_STAGE_KEYS.pregnant,
        title: "绮胎已成",
        durationHours: 0,
        iconImageUrl: PREGNANCY_STATUS_ICON_URLS.fertilized7,
        attrEffects: cloneAttributeDelta({
          attack: -2,
          defense: 2,
          speed: -2,
          luck: 2,
        }),
        flowEffects: cloneFlowEffects({
          dongfuLingqiRate: 0.05,
        }),
      },
    ],
    settlement: {
      title: "胎息化炁",
      rewardXpRatio: 0,
      rewardXpMin: 0,
      rewardXpMax: 0,
    },
  };
}

export function getDefaultPregnancySystemConfigValue() {
  return JSON.stringify(createDefaultPregnancySystemConfig(), null, 2);
}

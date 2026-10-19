"use client";

import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { App, Button, Typography } from "antd";
import type { PlayerProfileAction, PlayerProfileBottomContent } from "@/modules/shared/types/legacy-plugin";
import type { PlayerStatusView, SectSummary } from "@/types/game";
import type { ItemEffectDisplayEntry } from "@/modules/character/services/item-effect-display";
import { buildEquipmentEffectDetailLines } from "@/modules/character/services/equipment-effect-tier-display";
import { ITEM_TYPE_NAMES, RARITY_COLORS, RARITY_NAMES } from "@/modules/shared/constants";
import PlayerAvatar from "@/modules/shared/ui/components/PlayerAvatar";
import PlayerProfileActionModalContent, {
  resolvePlayerProfileActionModalWidth,
} from "@/modules/shared/ui/components/PlayerProfileActionModalContent";
import PlayerProfileBottomContentList from "@/modules/shared/ui/components/PlayerProfileBottomContentList";
import ItemBadge from "@/modules/shared/ui/components/ItemBadge";
import ItemIcon from "@/modules/shared/ui/components/ItemIcon";

const { Text } = Typography;

const TEXT = {
  close: "关闭",
  collapse: "收起",
  viewStats: "查看属性",
  battle: "战力",
  realm: "境界",
  sectFallback: "散修",
  sex: "Sex",
  noSexInfo: "未染情劫",
  sexStage: "当前倾向",
  corruption: "堕落",
  allure: "魅力",
  shame: "羞耻",
  equipment: "装备",
  statusTitle: "状态",
  noStatus: "暂无特殊状态",
  hp: "气血上限",
  mp: "灵力上限",
  attack: "攻击",
  defense: "防御",
  speed: "遁速",
  luck: "幸运",
  spiritualSense: "神识",
  armorPenetration: "破防",
  block: "格挡",
  skillDamageBonus: "神通增伤",
  skillDamageReduction: "神通减伤",
  artifactDamageBonus: "法宝增伤",
  artifactDamageReduction: "法宝减伤",
  unknownEquipment: "未知装备",
  noDescription: "暂无描述",
  noEffects: "暂无词条",
  moreInfo: "附加信息",
  statusCountSuffix: "个",
  reputation: "名声",
  noReputation: "名声未显",
  reputationSummary: "当前风评",
  shadowRoute: "灰线路数",
  sensualRoute: "情名风评",
  repairHint: "缓和路子",
} as const;

const PROFILE_MODAL_WIDTH = "min(340px, calc(100vw - 24px))";
const PROFILE_SMALL_MODAL_WIDTH = "min(320px, calc(100vw - 24px))";
const PROFILE_MODAL_BODY_STYLE = {
  maxHeight: "min(58vh, 420px)",
  overflowY: "auto" as const,
  paddingTop: 4,
  paddingRight: 2,
};
const PROFILE_ACTION_GRID_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
};
const PROFILE_ACTION_BUTTON_STYLE: CSSProperties = {
  minHeight: 36,
  borderRadius: 14,
  fontSize: 12,
  fontWeight: 600,
  paddingInline: 12,
  lineHeight: 1.2,
  whiteSpace: "normal",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  borderColor: "rgba(214, 196, 149, 0.16)",
  background: "linear-gradient(180deg, rgba(30, 24, 18, 0.94), rgba(18, 22, 31, 0.98))",
  color: "#ece1c0",
  boxShadow: "0 8px 18px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255,255,255,0.04)",
};
const SEX_ACTION_TEXT_PATTERN = /(双修|成人|sex)/i;
const PROFILE_SHELL_STYLE: CSSProperties = {
  position: "relative",
  overflow: "hidden",
  borderRadius: 22,
  border: "1px solid rgba(214, 196, 149, 0.14)",
  background: "linear-gradient(180deg, rgba(28, 22, 17, 0.98), rgba(9, 13, 20, 1))",
  boxShadow: "0 22px 42px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255,255,255,0.04)",
};
const PROFILE_SHELL_INNER_STYLE: CSSProperties = {
  position: "relative",
  padding: 10,
  display: "grid",
  gap: 10,
};
const PROFILE_TOP_PANEL_STYLE: CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(214, 196, 149, 0.12)",
  background: "linear-gradient(180deg, rgba(42, 31, 22, 0.94), rgba(18, 24, 35, 0.96))",
  padding: 10,
  display: "grid",
  gap: 10,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
};
const PROFILE_METRIC_GRID_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 7,
};
const PROFILE_EQUIPMENT_PANEL_STYLE: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(214, 196, 149, 0.1)",
  background: "linear-gradient(180deg, rgba(10, 14, 22, 0.95), rgba(17, 22, 33, 0.92))",
  padding: 8,
  display: "grid",
  gap: 6,
};

type SummaryMetricTone = {
  value: string;
  accent: string;
  glow: string;
  valueFontSize?: number;
};

type PlayerProfileEquipmentEffect = ItemEffectDisplayEntry & {
  label?: string;
  text?: string;
  extraText?: string;
};

export interface PlayerProfileEquipmentItem {
  itemId: string;
  name: string;
  iconUrl?: string | null;
  description?: string | null;
  itemType: string;
  rarity: string;
  equipSlot?: string | null;
  minRealm?: number | null;
  maxRealm?: number | null;
  effects?: PlayerProfileEquipmentEffect[] | null;
  effectTextLines?: string[] | null;
}

export interface PlayerAdultProfileSummary {
  corruptionValue: number;
  allureValue: number;
  shameValue: number;
  stageLabel: string;
}

export interface PlayerReputationSummary {
  overallLabel: string;
  overallSummary: string;
  socialFlavorLabel: string;
  adultStageLabel: string;
  notorietyLabel: string;
  shadowLabel: string;
  sensualLabel: string;
  willIgnorePlayer: boolean;
  needsBrokerRelief: boolean;
  canInviteTreasureHunt: boolean;
  canGiftLingShi: boolean;
  canInviteDualCultivation: boolean;
  forcedAdultRisk: boolean;
  repairHint: string;
  repairActions: string[];
  worldBehaviorHints: string[];
}

export type PlayerProfileContentModel = {
  id: string;
  name: string;
  realmName?: string | null;
  combatPower?: number | null;
  hp?: number | null;
  maxHp?: number | null;
  mp?: number | null;
  maxMp?: number | null;
  attack?: number | null;
  defense?: number | null;
  speed?: number | null;
  luck?: number | null;
  spiritualSense?: number | null;
  armorPenetration?: number | null;
  block?: number | null;
  skillDamageBonus?: number | null;
  skillDamageReduction?: number | null;
  artifactDamageBonus?: number | null;
  artifactDamageReduction?: number | null;
  avatarImageUrl?: string | null;
  avatarFrameImageUrl?: string | null;
  sectSummary?: SectSummary | null;
  adultProfileSummary?: PlayerAdultProfileSummary | null;
  reputationSummary?: PlayerReputationSummary | null;
  equippedItems?: PlayerProfileEquipmentItem[] | null;
  pluginProfileActions?: PlayerProfileAction[] | null;
  pluginProfileBottomContents?: PlayerProfileBottomContent[] | null;
  statuses?: PlayerStatusView[] | null;
};

interface PlayerProfileContentProps {
  profile: PlayerProfileContentModel;
  showAvatar?: boolean;
  topActions?: ReactNode;
  middleContent?: ReactNode;
}

type EquipmentSlotPreset = {
  slotId: string;
  label: string;
  shortLabel: string;
};

const EQUIPMENT_SLOT_PRESETS: EquipmentSlotPreset[] = [
  { slotId: "weapon", label: "武器", shortLabel: "兵" },
  { slotId: "helmet", label: "头盔", shortLabel: "盔" },
  { slotId: "armor", label: "法衣", shortLabel: "甲" },
  { slotId: "shoes", label: "步履", shortLabel: "靴" },
  { slotId: "artifact_1", label: "法宝一", shortLabel: "法1" },
  { slotId: "artifact_2", label: "法宝二", shortLabel: "法2" },
  { slotId: "artifact_3", label: "法宝三", shortLabel: "法3" },
  { slotId: "artifact_4", label: "法宝四", shortLabel: "法4" },
];

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeText(value: unknown, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function renderInfoPill(label: string, value: string, tone: string) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "3px 8px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(214, 196, 149, 0.12)",
        color: tone,
        fontSize: 10,
        lineHeight: 1.2,
      }}
    >
      <span style={{ color: "#8e8778" }}>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </span>
  );
}

function renderSummaryMetric(label: string, tone: SummaryMetricTone) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 14,
        border: `1px solid ${tone.glow}`,
        background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(10, 14, 22, 0.88))",
        padding: "8px 9px",
        display: "grid",
        gap: 4,
        minWidth: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "auto -18px -22px auto",
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${tone.glow}, transparent 72%)`,
          opacity: 0.65,
          pointerEvents: "none",
        }}
      />
      <span style={{ color: "#8f887a", fontSize: 10, letterSpacing: 0.2 }}>{label}</span>
      <span
        style={{
          color: tone.accent,
          fontSize: tone.valueFontSize ?? 12,
          fontWeight: 700,
          lineHeight: 1.2,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {tone.value}
      </span>
    </div>
  );
}

function getEffectLines(item: PlayerProfileEquipmentItem) {
  const lines = buildEquipmentEffectDetailLines({
    itemType: item.itemType,
    minRealm: item.minRealm,
  }, item.effects);
  if (lines.length > 0) {
    return lines;
  }
  if (Array.isArray(item.effectTextLines) && item.effectTextLines.length > 0) {
    return item.effectTextLines
      .map((line, index) => ({
        key: `fallback-${index}`,
        text: String(line || "").trim(),
        extraText: "",
        color: "#c9c1b1",
        tierKey: null,
        isSkill: false,
      }))
      .filter((line) => line.text);
  }
  return [];
}

function flattenActionNodes(node: ReactNode): ReactNode[] {
  return Children.toArray(node).flatMap((child) => {
    if (isValidElement(child) && child.type === Fragment) {
      return flattenActionNodes((child.props as { children?: ReactNode }).children);
    }
    return [child];
  });
}

function readNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (!node) {
    return "";
  }
  if (Array.isArray(node)) {
    return node.map((item) => readNodeText(item)).join(" ");
  }
  if (isValidElement(node)) {
    return readNodeText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function isSexRelatedLabel(value: string) {
  return SEX_ACTION_TEXT_PATTERN.test(String(value || "").trim());
}

function renderCompactActionNode(node: ReactNode, key: string) {
  if (!isValidElement<{ style?: CSSProperties }>(node)) {
    return null;
  }
  const actionNode = node as ReactElement<{ style?: CSSProperties }>;
  const props = actionNode.props;
  return (
    <div key={key} style={{ minWidth: 0 }}>
      {cloneElement(actionNode, {
        style: {
          width: "100%",
          ...PROFILE_ACTION_BUTTON_STYLE,
          ...(props.style || {}),
        },
      })}
    </div>
  );
}

export default function PlayerProfileContent({
  profile,
  showAvatar = true,
  topActions,
  middleContent,
}: PlayerProfileContentProps) {
  const { modal } = App.useApp();
  const sectName = normalizeText(profile.sectSummary?.sectName, TEXT.sectFallback);
  const sectRoleLabel = normalizeText(profile.sectSummary?.roleLabel);
  const sexStageLabel = normalizeText(profile.adultProfileSummary?.stageLabel, TEXT.noSexInfo);
  const reputationLabel = normalizeText(profile.reputationSummary?.overallLabel, TEXT.noReputation);
  const statuses = Array.isArray(profile.statuses) ? profile.statuses : [];
  const equippedItems = Array.isArray(profile.equippedItems) ? profile.equippedItems : [];
  const equippedMap = new Map(equippedItems.map((item) => [item.equipSlot || item.itemType, item]));
  const pluginProfileActions = Array.isArray(profile.pluginProfileActions) ? profile.pluginProfileActions : [];
  const pluginBottomContents = Array.isArray(profile.pluginProfileBottomContents)
    ? profile.pluginProfileBottomContents
    : [];
  const flatTopActionNodes = flattenActionNodes(topActions);
  const mainTopActionNodes = flatTopActionNodes.filter((node) => !isSexRelatedLabel(readNodeText(node)));
  const sexTopActionNodes = flatTopActionNodes.filter((node) => isSexRelatedLabel(readNodeText(node)));
  const mainPluginActions = pluginProfileActions.filter((action) => !isSexRelatedLabel(`${action.label} ${action.title || ""}`));
  const sexPluginActions = pluginProfileActions.filter((action) => isSexRelatedLabel(`${action.label} ${action.title || ""}`));
  const mainBottomContents = pluginBottomContents.filter((item) => !isSexRelatedLabel(`${item.title || ""} ${item.subtitle || ""}`));
  const sexBottomContents = pluginBottomContents.filter((item) => isSexRelatedLabel(`${item.title || ""} ${item.subtitle || ""}`));
  const summaryMetrics: Array<{ label: string; tone: SummaryMetricTone }> = [
    {
      label: TEXT.battle,
      tone: {
        value: toNumber(profile.combatPower).toLocaleString(),
        accent: "#f1df9b",
        glow: "rgba(241, 223, 155, 0.2)",
        valueFontSize: 14,
      },
    },
    {
      label: TEXT.realm,
      tone: {
        value: normalizeText(profile.realmName, "未入道"),
        accent: "#d2e2ff",
        glow: "rgba(160, 196, 255, 0.2)",
      },
    },
    {
      label: TEXT.reputation,
      tone: {
        value: reputationLabel,
        accent: profile.reputationSummary?.willIgnorePlayer ? "#ffc4c4" : "#e0d6ff",
        glow: profile.reputationSummary?.willIgnorePlayer ? "rgba(255, 162, 162, 0.18)" : "rgba(198, 184, 255, 0.18)",
      },
    },
    {
      label: TEXT.statusTitle,
      tone: {
        value: statuses.length > 0 ? `${statuses.length}${TEXT.statusCountSuffix}` : "平稳",
        accent: statuses.length > 0 ? "#ccf0c3" : "#b8c7dc",
        glow: statuses.length > 0 ? "rgba(170, 225, 146, 0.18)" : "rgba(168, 190, 214, 0.18)",
      },
    },
  ];

  const openStatsProfile = () => {
    modal.info({
      title: `${profile.name} · 属性总览`,
      okText: TEXT.collapse,
      width: PROFILE_MODAL_WIDTH,
      content: (
        <div style={{ ...PROFILE_MODAL_BODY_STYLE, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
            {[
              { label: TEXT.hp, value: toNumber(profile.maxHp), tone: "#ffcfbe" },
              { label: TEXT.mp, value: toNumber(profile.maxMp), tone: "#cce7ff" },
              { label: TEXT.attack, value: toNumber(profile.attack), tone: "#ffd6b0" },
              { label: TEXT.defense, value: toNumber(profile.defense), tone: "#d9e2ff" },
              { label: TEXT.speed, value: toNumber(profile.speed), tone: "#d8f3d5" },
              { label: TEXT.luck, value: toNumber(profile.luck), tone: "#f6e4a6" },
              { label: TEXT.spiritualSense, value: toNumber(profile.spiritualSense), tone: "#d9d4ff" },
              { label: TEXT.armorPenetration, value: toNumber(profile.armorPenetration), tone: "#ffddc1" },
              { label: TEXT.block, value: toNumber(profile.block), tone: "#dfead1" },
              { label: TEXT.skillDamageBonus, value: toNumber(profile.skillDamageBonus), tone: "#f8d9ff" },
              { label: TEXT.skillDamageReduction, value: toNumber(profile.skillDamageReduction), tone: "#cfd7ff" },
              { label: TEXT.artifactDamageBonus, value: toNumber(profile.artifactDamageBonus), tone: "#ffd9a8" },
              { label: TEXT.artifactDamageReduction, value: toNumber(profile.artifactDamageReduction), tone: "#ffe8b9" },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  borderRadius: 12,
                  border: "1px solid rgba(214, 196, 149, 0.12)",
                  background: "rgba(12, 17, 25, 0.88)",
                  padding: "8px 10px",
                  display: "grid",
                  gap: 2,
                }}
              >
                <span style={{ color: "#8e8778", fontSize: 11 }}>{item.label}</span>
                <span style={{ color: item.tone, fontSize: 14, fontWeight: 700 }}>{item.value}</span>
              </div>
            ))}
          </div>
          <div
            style={{
              borderRadius: 12,
              border: "1px solid rgba(214, 196, 149, 0.12)",
              background: "rgba(255,255,255,0.03)",
              padding: "8px 10px",
              display: "grid",
              gap: 4,
            }}
          >
            <Text style={{ color: "#f3dfb6", fontWeight: 700 }}>{TEXT.statusTitle}</Text>
            {statuses.length > 0 ? (
              statuses.map((status) => (
                <Text key={status.id} style={{ color: "#c9c1b1", display: "block", fontSize: 13 }}>
                  {status.title}
                  {status.stageTitle ? ` · ${status.stageTitle}` : ""}
                </Text>
              ))
            ) : (
              <Text style={{ color: "#8e8778" }}>{TEXT.noStatus}</Text>
            )}
          </div>
        </div>
      ),
    });
  };

  const openSexProfile = () => {
    modal.info({
      title: `${profile.name} · ${TEXT.sex}`,
      okText: TEXT.collapse,
      width: PROFILE_SMALL_MODAL_WIDTH,
      content: (
        <div style={{ ...PROFILE_MODAL_BODY_STYLE, display: "grid", gap: 10 }}>
          {sexTopActionNodes.length > 0 || sexPluginActions.length > 0 ? (
            <div style={PROFILE_ACTION_GRID_STYLE}>
              {sexTopActionNodes.map((node, index) => renderCompactActionNode(node, `sex-top-${index}`))}
              {sexPluginActions.map((action) => (
                <div key={`${action.pluginId}:${action.id}`} style={{ minWidth: 0 }}>
                  <Button
                    size="small"
                    type="default"
                    style={{
                      width: "100%",
                      ...PROFILE_ACTION_BUTTON_STYLE,
                      borderColor: action.color || "rgba(201, 168, 76, 0.24)",
                      color: action.color || "#d8c28d",
                      background: "rgba(32, 26, 18, 0.72)",
                    }}
                    onClick={() => {
                      modal.info({
                        title: action.title || action.label,
                        okText: TEXT.close,
                        width: resolvePlayerProfileActionModalWidth(action),
                        content: <PlayerProfileActionModalContent action={action} />,
                      });
                    }}
                  >
                    {action.label}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <div
            style={{
              borderRadius: 14,
              border: "1px solid rgba(214, 196, 149, 0.14)",
              background: "linear-gradient(180deg, rgba(39, 18, 30, 0.95), rgba(17, 14, 24, 0.98))",
              padding: 12,
              display: "grid",
              gap: 6,
            }}
          >
            <Text style={{ color: "#f5ead0", fontSize: 14, fontWeight: 700 }}>
              {TEXT.sexStage}：{sexStageLabel}
            </Text>
            <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              {[
                { label: TEXT.corruption, value: toNumber(profile.adultProfileSummary?.corruptionValue), tone: "#ffb8c6" },
                { label: TEXT.allure, value: toNumber(profile.adultProfileSummary?.allureValue), tone: "#ffd59f" },
                { label: TEXT.shame, value: toNumber(profile.adultProfileSummary?.shameValue), tone: "#c8d7ff" },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    borderRadius: 10,
                    border: "1px solid rgba(214, 196, 149, 0.1)",
                    background: "rgba(255,255,255,0.04)",
                    padding: "8px 6px",
                    textAlign: "center",
                    display: "grid",
                    gap: 2,
                  }}
                >
                  <span style={{ color: "#8e8778", fontSize: 11 }}>{item.label}</span>
                  <span style={{ color: item.tone, fontSize: 14, fontWeight: 700 }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
          {sexBottomContents.length > 0 ? (
            <PlayerProfileBottomContentList contents={sexBottomContents} defaultCollapsed={false} />
          ) : null}
        </div>
      ),
    });
  };

  const openReputationProfile = () => {
    if (!profile.reputationSummary) {
      return;
    }
    modal.info({
      title: `${profile.name} · ${TEXT.reputation}`,
      okText: TEXT.collapse,
      width: PROFILE_SMALL_MODAL_WIDTH,
      content: (
        <div style={{ ...PROFILE_MODAL_BODY_STYLE, display: "grid", gap: 10 }}>
          <div
            style={{
              borderRadius: 14,
              border: "1px solid rgba(214, 196, 149, 0.14)",
              background: "linear-gradient(180deg, rgba(22, 22, 30, 0.96), rgba(15, 19, 28, 0.98))",
              padding: 12,
              display: "grid",
              gap: 6,
            }}
          >
            <Text style={{ color: "#f5ead0", fontSize: 14, fontWeight: 700 }}>
              {profile.reputationSummary.overallLabel}
            </Text>
            <Text style={{ color: "#c9c1b1", whiteSpace: "pre-wrap", fontSize: 12 }}>
              {profile.reputationSummary.overallSummary}
            </Text>
            <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              {[
                { label: TEXT.reputationSummary, value: profile.reputationSummary.notorietyLabel, tone: "#ffd2bb" },
                { label: TEXT.shadowRoute, value: profile.reputationSummary.shadowLabel, tone: "#d7d1ff" },
                { label: TEXT.sensualRoute, value: profile.reputationSummary.sensualLabel, tone: "#ffbfd6" },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    borderRadius: 10,
                    border: "1px solid rgba(214, 196, 149, 0.1)",
                    background: "rgba(255,255,255,0.04)",
                    padding: "8px 6px",
                    display: "grid",
                    gap: 2,
                  }}
                >
                  <span style={{ color: "#8e8778", fontSize: 11 }}>{item.label}</span>
                  <span style={{ color: item.tone, fontSize: 12, fontWeight: 700 }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div
            style={{
              borderRadius: 12,
              border: "1px solid rgba(214, 196, 149, 0.12)",
              background: "rgba(255,255,255,0.03)",
              padding: "8px 10px",
              display: "grid",
              gap: 4,
            }}
          >
            <Text style={{ color: "#f3dfb6", fontWeight: 700 }}>{TEXT.repairHint}</Text>
            <Text style={{ color: "#c9c1b1", whiteSpace: "pre-wrap" }}>
              {profile.reputationSummary.repairHint}
            </Text>
            {profile.reputationSummary.worldBehaviorHints.map((item) => (
              <Text key={item} style={{ color: "#9aa7bd", display: "block", whiteSpace: "pre-wrap" }}>
                {item}
              </Text>
            ))}
          </div>
        </div>
      ),
    });
  };

  const openEquipmentDetail = (item: PlayerProfileEquipmentItem, slotPreset: EquipmentSlotPreset) => {
    const effectLines = getEffectLines(item);
    modal.info({
      title: `${normalizeText(item.name, TEXT.unknownEquipment)} · 装备详情`,
      okText: TEXT.collapse,
      width: PROFILE_MODAL_WIDTH,
      content: (
        <div style={{ ...PROFILE_MODAL_BODY_STYLE, display: "grid", gap: 10 }}>
          <div
            style={{
              borderRadius: 16,
              border: "1px solid rgba(214, 196, 149, 0.14)",
              background: "rgba(14, 18, 30, 0.8)",
              padding: 14,
              display: "grid",
              gap: 8,
            }}
          >
            <ItemBadge
              name={normalizeText(item.name, TEXT.unknownEquipment)}
              iconUrl={item.iconUrl}
              rarity={item.rarity}
              iconSize={22}
              showRarityLabel
              style={{ width: "fit-content", maxWidth: "100%" }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {renderInfoPill("槽位", slotPreset.label, "#d8c28d")}
              {renderInfoPill("类别", ITEM_TYPE_NAMES[item.itemType] || item.itemType, "#d2d9ff")}
              {renderInfoPill("品级", RARITY_NAMES[item.rarity] || item.rarity, RARITY_COLORS[item.rarity] || "#f5ead0")}
            </div>
            <Text style={{ color: "#a09880", whiteSpace: "pre-wrap" }}>
              {normalizeText(item.description, TEXT.noDescription)}
            </Text>
          </div>
          <div
            style={{
              borderRadius: 14,
              border: "1px solid rgba(214, 196, 149, 0.12)",
              background: "rgba(255,255,255,0.03)",
              padding: "10px 12px",
              display: "grid",
              gap: 6,
            }}
          >
            <Text style={{ color: "#f3dfb6", fontWeight: 700 }}>{TEXT.moreInfo}</Text>
            {effectLines.length > 0 ? (
              effectLines.map((line) => (
                <Text key={`${item.itemId}:${line.key}`} style={{ color: line.color, display: "block" }}>
                  {line.text}
                </Text>
              ))
            ) : (
              <Text style={{ color: "#8e8778" }}>{TEXT.noEffects}</Text>
            )}
          </div>
        </div>
      ),
    });
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={PROFILE_ACTION_GRID_STYLE}>
        {mainTopActionNodes.map((node, index) => renderCompactActionNode(node, `top-${index}`))}
        {mainPluginActions.map((action) => (
          <div key={`${action.pluginId}:${action.id}`} style={{ minWidth: 0 }}>
            <Button
              type="default"
              size="small"
              style={{
                width: "100%",
                ...PROFILE_ACTION_BUTTON_STYLE,
                borderColor: action.color || "rgba(201, 168, 76, 0.24)",
                color: action.color || "#ecd4a0",
                background: "linear-gradient(180deg, rgba(59, 40, 20, 0.92), rgba(21, 24, 31, 0.98))",
              }}
              onClick={() => {
                modal.info({
                  title: action.title || action.label,
                  okText: TEXT.close,
                  width: resolvePlayerProfileActionModalWidth(action),
                  content: <PlayerProfileActionModalContent action={action} />,
                });
              }}
            >
              {action.label}
            </Button>
          </div>
        ))}
        {profile.reputationSummary ? (
          <div style={{ minWidth: 0 }}>
            <Button size="small" style={{ width: "100%", ...PROFILE_ACTION_BUTTON_STYLE }} onClick={openReputationProfile}>
              {TEXT.reputation}
            </Button>
          </div>
        ) : null}
        <div style={{ minWidth: 0 }}>
          <Button size="small" style={{ width: "100%", ...PROFILE_ACTION_BUTTON_STYLE }} onClick={openStatsProfile}>
            {TEXT.viewStats}
          </Button>
        </div>
      </div>

      <div style={PROFILE_SHELL_STYLE}>
        <div
          style={{
            position: "absolute",
            top: -54,
            right: -38,
            width: 150,
            height: 150,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(232, 195, 118, 0.18), transparent 68%)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: -44,
            bottom: -62,
            width: 164,
            height: 164,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(99, 134, 255, 0.16), transparent 70%)",
            pointerEvents: "none",
          }}
        />

        <div style={PROFILE_SHELL_INNER_STYLE}>
          <div style={PROFILE_TOP_PANEL_STYLE}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "start" }}>
              <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
                {showAvatar ? (
                  <div
                    style={{
                      padding: 2,
                      borderRadius: 18,
                      background: "linear-gradient(180deg, rgba(238, 210, 145, 0.32), rgba(92, 69, 38, 0.16))",
                      boxShadow: "0 10px 22px rgba(0, 0, 0, 0.2)",
                    }}
                  >
                    <PlayerAvatar
                      size={46}
                      avatarImageUrl={profile.avatarImageUrl}
                      avatarFrameImageUrl={profile.avatarFrameImageUrl}
                      fallbackText={normalizeText(profile.name, "修").slice(0, 1)}
                      fallbackFontSize={12}
                      borderColor="#5a482f"
                      background="rgba(17, 22, 31, 0.96)"
                    />
                  </div>
                ) : null}
                <div style={{ minWidth: 0, flex: 1, display: "grid", gap: 6 }}>
                  <div style={{ display: "grid", gap: 3 }}>
                    <Text
                      style={{
                        color: "#fbefd2",
                        display: "block",
                        fontSize: 15,
                        fontWeight: 700,
                        lineHeight: 1.15,
                      }}
                    >
                      {profile.name}
                    </Text>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "3px 8px",
                          borderRadius: 999,
                          background: "rgba(214, 196, 149, 0.08)",
                          border: "1px solid rgba(214, 196, 149, 0.12)",
                          color: "#decb9a",
                          fontSize: 10,
                          lineHeight: 1.2,
                        }}
                      >
                        {sectName}
                      </span>
                      {sectRoleLabel ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "3px 8px",
                            borderRadius: 999,
                            background: "rgba(134, 114, 255, 0.1)",
                            border: "1px solid rgba(162, 143, 255, 0.12)",
                            color: "#dfd7ff",
                            fontSize: 10,
                            lineHeight: 1.2,
                          }}
                        >
                          {sectRoleLabel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Text style={{ color: "#a69f90", display: "block", fontSize: 11, lineHeight: 1.35 }}>
                    {normalizeText(profile.realmName)}
                  </Text>
                </div>
              </div>

              <button
                type="button"
                onClick={openSexProfile}
                style={{
                  position: "relative",
                  width: 40,
                  height: 40,
                  borderRadius: 999,
                  border: "1px solid rgba(255, 193, 214, 0.34)",
                  background: "radial-gradient(circle at 30% 30%, rgba(255, 212, 228, 0.46), rgba(80, 23, 49, 0.96))",
                  color: "#fff1f7",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  boxShadow: "0 12px 22px rgba(42, 10, 28, 0.34), inset 0 1px 0 rgba(255,255,255,0.18)",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    inset: 3,
                    borderRadius: "50%",
                    border: "1px solid rgba(255,255,255,0.18)",
                    pointerEvents: "none",
                  }}
                />
                {TEXT.sex}
              </button>
            </div>

            <div style={PROFILE_METRIC_GRID_STYLE}>
              {summaryMetrics.map((item) => (
                <div key={item.label}>{renderSummaryMetric(item.label, item.tone)}</div>
              ))}
            </div>
          </div>

          <div style={PROFILE_EQUIPMENT_PANEL_STYLE}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <Text style={{ color: "#f3dfb6", fontWeight: 700, fontSize: 13, letterSpacing: 0.2 }}>{TEXT.equipment}</Text>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "3px 7px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(214, 196, 149, 0.1)",
                  color: "#9a93a6",
                  fontSize: 10,
                  lineHeight: 1.2,
                }}
              >
                {sexStageLabel}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
              {EQUIPMENT_SLOT_PRESETS.map((slotPreset) => {
                const equippedItem = equippedMap.get(slotPreset.slotId) || null;
                const borderColor = equippedItem
                  ? `${RARITY_COLORS[equippedItem.rarity] || "#d8c28d"}66`
                  : "rgba(214, 196, 149, 0.12)";

                return (
                  <button
                    key={slotPreset.slotId}
                    type="button"
                    title={equippedItem ? equippedItem.name : slotPreset.label}
                    disabled={!equippedItem}
                    onClick={() => {
                      if (equippedItem) {
                        openEquipmentDetail(equippedItem, slotPreset);
                      }
                    }}
                    style={{
                      width: "100%",
                      aspectRatio: "1 / 1",
                      position: "relative",
                      borderRadius: 12,
                      border: `1px solid ${borderColor}`,
                      background: equippedItem
                        ? "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(18, 20, 32, 0.96))"
                        : "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(15, 19, 29, 0.82))",
                      padding: 2,
                      display: "grid",
                      alignItems: "stretch",
                      justifyItems: "stretch",
                      cursor: equippedItem ? "pointer" : "default",
                      boxShadow: equippedItem ? "0 8px 16px rgba(0, 0, 0, 0.16)" : "none",
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 3,
                        left: 3,
                        zIndex: 1,
                        padding: "1px 4px",
                        borderRadius: 999,
                        background: "rgba(5, 8, 13, 0.58)",
                        color: equippedItem ? (RARITY_COLORS[equippedItem.rarity] || "#ead8a6") : "#8e8778",
                        fontSize: 8,
                        lineHeight: 1.3,
                        letterSpacing: 0.2,
                      }}
                    >
                      {slotPreset.shortLabel}
                    </span>
                    {equippedItem ? (
                      <ItemIcon
                        iconUrl={equippedItem.iconUrl}
                        size={30}
                        borderColor={RARITY_COLORS[equippedItem.rarity] || "#d8c28d"}
                        style={{ width: "100%", height: "100%", borderRadius: 9 }}
                      />
                    ) : (
                      <span
                        style={{
                          display: "grid",
                          placeItems: "center",
                          width: "100%",
                          height: "100%",
                          borderRadius: 9,
                          border: "1px dashed rgba(214, 196, 149, 0.12)",
                          color: "#7f786b",
                          fontSize: 9,
                        }}
                      >
                        {slotPreset.shortLabel}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {middleContent ? (
            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(214, 196, 149, 0.08)",
                background: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(12, 17, 24, 0.28))",
                padding: "7px 8px",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
              }}
            >
              {middleContent}
            </div>
          ) : null}
        </div>
      </div>

      {mainBottomContents.length > 0 ? (
        <PlayerProfileBottomContentList contents={mainBottomContents} />
      ) : null}
    </div>
  );
}

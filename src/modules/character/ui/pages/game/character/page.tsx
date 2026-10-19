"use client";

import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { App, Button, Card, Progress, Space, Spin, Typography } from "antd";
import {
  BookOutlined,
  CrownOutlined,
  DownOutlined,
  ExperimentOutlined,
  FireOutlined,
  GoldOutlined,
  HeartOutlined,
  MailOutlined,
  PictureOutlined,
  RocketOutlined,
  SafetyOutlined,
  SkinOutlined,
  StarOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import ItemDetailModal from "@/modules/character/ui/components/ItemDetailModal";
import {
  CHARACTER_STAT_HELP_MAP,
  type CharacterStatHelpKey,
} from "@/modules/character/ui/components/character-stat-help";
import { TalentPanel } from "@/modules/character/ui/pages/game/character/talent-panel";
import ItemIcon from "@/modules/shared/ui/components/ItemIcon";
import NotificationDot from "@/modules/shared/ui/components/NotificationDot";
import PlayerAvatar from "@/modules/shared/ui/components/PlayerAvatar";
import PlayerProfileBottomContentList from "@/modules/shared/ui/components/PlayerProfileBottomContentList";
import type { PlayerReputationSummary } from "@/modules/shared/ui/components/PlayerProfileContent";
import { useGameNotifications } from "@/modules/shared/ui/contexts/GameNotificationContext";
import {
  buildCultivationActionButtonStyle,
  buildCultivationRevealStyle,
  cultivationHeroCardStyle,
  cultivationPageWideShellStyle,
  cultivationSectionCardStyle,
  cultivationSoftPanelStyle,
} from "@/modules/shared/ui/utils/cultivation-page-theme";
import type { PlayerProfileBottomContent } from "@/modules/shared/types/legacy-plugin";

const { Text } = Typography;

const ELEMENT_COLORS: Record<string, string> = {
  金: "#c0c0c0",
  木: "#228b22",
  水: "#1e90ff",
  火: "#dc3545",
  土: "#daa520",
  雷: "#9d4edd",
  冰: "#87ceeb",
  风: "#52b788",
  暗: "#6b6355",
  光: "#e8d282",
};

function normalizeDisplayedRootVariant(value?: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const lowered = normalized.toLowerCase();
  if (
    ["null", "none", "无", "无变异", "瑕"].includes(lowered)
    || ["无", "无变异", "瑕"].includes(normalized)
  ) {
    return null;
  }

  return normalized;
}

type EquipmentItem = {
  id: string;
  name: string;
  iconUrl?: string | null;
  equipSlot?: string;
};

interface EquipmentSlotConfig {
  key: string;
  label: string;
  shortLabel: string;
  icon: ReactNode;
  item?: EquipmentItem | null;
}

interface DisplayStatItem {
  helpKey: CharacterStatHelpKey;
  label: string;
  value: number | string;
  color: string;
}

interface ActiveStatHelpState {
  helpKey: CharacterStatHelpKey;
  currentValue: number | string;
  anchorLeft: number;
  anchorTop: number;
  tooltipWidth: number;
}

interface CharacterQuickActionItem {
  key: string;
  label: string;
  icon?: ReactNode;
  badgeCount?: number;
  onClick: () => void;
}

type PlayerProfile = {
  name?: string;
  realmName?: string;
  spiritualRoot?: {
    name: string;
    element: string;
    variant?: string | null;
    description: string;
  };
  avatarImageUrl?: string | null;
  avatarFrameImageUrl?: string | null;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  spiritualSense: number;
  armorPenetration: number;
  block: number;
  skillDamageBonus: number;
  skillDamageReduction: number;
  artifactDamageBonus: number;
  artifactDamageReduction: number;
  luck: number;
  combatPower: number;
  gold: number;
  lingYu: number;
  stamina: number;
  staminaMax: number;
  reputationSummary?: PlayerReputationSummary | null;
  staminaRecoverPerInterval?: number;
  staminaRecoverIntervalMinutes?: number;
  equipment?: {
    weapon: EquipmentItem | null;
    helmet: EquipmentItem | null;
    armor: EquipmentItem | null;
    shoes: EquipmentItem | null;
    artifacts: Array<EquipmentItem | null>;
  };
  pluginProfileBottomContents?: PlayerProfileBottomContent[];
};

export default function CharacterPage() {
  const router = useRouter();
  const { modal } = App.useApp();
  const { mailHasNotification, pluginHasNotification } = useGameNotifications();
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [statsExpanded, setStatsExpanded] = useState(true);
  const [activeStatHelp, setActiveStatHelp] = useState<ActiveStatHelpState | null>(null);
  const spiritualRootVariant = normalizeDisplayedRootVariant(player?.spiritualRoot?.variant);

  useEffect(() => {
    let cancelled = false;

    const fetchPlayer = async () => {
      const response = await fetch("/api/auth/me");
      const json = await response.json();
      if (cancelled) {
        return;
      }
      if (json.success) {
        setPlayer(json.data);
      }
      setLoading(false);
    };

    void fetchPlayer();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeStatHelp) {
      return undefined;
    }

    const closeByOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        setActiveStatHelp(null);
        return;
      }

      if (target.closest("[data-stat-help-anchor=\"true\"]")) {
        return;
      }

      setActiveStatHelp(null);
    };

    const close = () => {
      setActiveStatHelp(null);
    };

    document.addEventListener("pointerdown", closeByOutsidePointer);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", closeByOutsidePointer);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [activeStatHelp]);

  if (loading) {
    return (
      <div style={{ ...cultivationPageWideShellStyle, display: "flex", justifyContent: "center", padding: "40px 8px" }}>
        <Spin />
      </div>
    );
  }

  if (!player) {
    return <div style={{ ...cultivationPageWideShellStyle, padding: 20, color: "#6b6355" }}>加载失败</div>;
  }

  const leftEquipmentSlots: EquipmentSlotConfig[] = [
    { key: "weapon", label: "武器", shortLabel: "武", icon: <ToolOutlined />, item: player.equipment?.weapon },
    { key: "helmet", label: "头盔", shortLabel: "盔", icon: <CrownOutlined />, item: player.equipment?.helmet },
    { key: "armor", label: "铠甲", shortLabel: "甲", icon: <SafetyOutlined />, item: player.equipment?.armor },
    { key: "shoes", label: "鞋子", shortLabel: "靴", icon: <RocketOutlined />, item: player.equipment?.shoes },
  ];

  const rightEquipmentSlots: EquipmentSlotConfig[] = [
    { key: "artifact_1", label: "法宝一", shortLabel: "法1", icon: <StarOutlined />, item: player.equipment?.artifacts?.[0] || null },
    { key: "artifact_2", label: "法宝二", shortLabel: "法2", icon: <GoldOutlined />, item: player.equipment?.artifacts?.[1] || null },
    { key: "artifact_3", label: "法宝三", shortLabel: "法3", icon: <FireOutlined />, item: player.equipment?.artifacts?.[2] || null },
    { key: "artifact_4", label: "法宝四", shortLabel: "法4", icon: <ThunderboltOutlined />, item: player.equipment?.artifacts?.[3] || null },
  ];

  const renderEquipmentSlot = (slot: EquipmentSlotConfig) => {
    const equipped = Boolean(slot.item);
    return (
      <button
        className="character-equipment-slot"
        key={slot.key}
        type="button"
        disabled={!slot.item}
        onClick={() => {
          if (slot.item) {
            setDetailItemId(slot.item.id);
          }
        }}
        style={{
          display: "grid",
          width: "100%",
          aspectRatio: "1 / 1",
          minHeight: 0,
          alignItems: "stretch",
          justifyItems: "stretch",
          padding: 2,
          borderRadius: 12,
          border: `1px solid ${equipped ? "rgba(184, 217, 245, 0.42)" : "rgba(126, 151, 184, 0.16)"}`,
          background: equipped
            ? "linear-gradient(180deg, rgba(74, 99, 132, 0.24) 0%, rgba(25, 32, 45, 0.84) 100%)"
            : "linear-gradient(180deg, rgba(23, 28, 41, 0.68) 0%, rgba(16, 19, 28, 0.84) 100%)",
          color: equipped ? "#eef7ff" : "#7f91a7",
          cursor: slot.item ? "pointer" : "default",
          transition: "all 0.2s ease",
          backdropFilter: "blur(10px)",
          overflow: "hidden",
          position: "relative",
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
            color: equipped ? "#eef7ff" : "#8fa2b8",
            fontSize: 8,
            lineHeight: 1.3,
            letterSpacing: 0.2,
          }}
        >
          {slot.shortLabel}
        </span>
        {slot.item?.iconUrl ? (
          <ItemIcon
            iconUrl={slot.item.iconUrl}
            size={42}
            borderColor={equipped ? "#a8d5ff" : "#2a3546"}
            style={{
              width: "100%",
              height: "100%",
              borderRadius: 9,
              boxShadow: equipped ? "0 0 14px rgba(129, 190, 255, 0.12)" : "none",
            }}
          />
        ) : (
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: "100%",
              height: "100%",
              fontSize: 16,
              lineHeight: 1,
              color: "#8fa2b8",
              borderRadius: 9,
              border: "1px dashed rgba(126, 151, 184, 0.16)",
              background: "rgba(16, 19, 28, 0.34)",
            }}
          >
            {slot.icon}
          </span>
        )}
      </button>
    );
  };

  const statCardStyle = {
    ...cultivationSoftPanelStyle,
    padding: "6px 7px",
  } as const;
  const quickActionButtonStyle = {
    ...buildCultivationActionButtonStyle({ dreamy: true }),
    width: "100%",
    minHeight: 42,
    height: "auto",
    padding: "9px 10px",
  } as const;

  const formatStatValue = (value: number | string) => (
    typeof value === "number" ? value.toLocaleString() : value
  );

  const reputationLabel = player.reputationSummary?.overallLabel || "名声";

  const openStatHelp = (
    target: HTMLElement,
    helpKey: CharacterStatHelpKey,
    currentValue: number | string,
  ) => {
    const rect = target.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const tooltipWidth = Math.min(164, Math.max(132, viewportWidth - 28));
    const unclampedLeft = rect.left + (rect.width / 2) - (tooltipWidth / 2);
    const anchorLeft = Math.max(8, Math.min(unclampedLeft, viewportWidth - tooltipWidth - 8));
    const anchorTop = Math.max(12, rect.top - 6);

    setActiveStatHelp({
      helpKey,
      currentValue,
      anchorLeft,
      anchorTop,
      tooltipWidth,
    });
  };

  const closeStatHelp = () => {
    setActiveStatHelp(null);
  };

  const toggleStatHelp = (
    event: ReactMouseEvent<HTMLElement>,
    helpKey: CharacterStatHelpKey,
    currentValue: number | string,
  ) => {
    event.stopPropagation();
    if (activeStatHelp?.helpKey === helpKey && String(activeStatHelp.currentValue) === String(currentValue)) {
      setActiveStatHelp(null);
      return;
    }

    openStatHelp(event.currentTarget, helpKey, currentValue);
  };

  const openReputationProfile = () => {
    if (!player.reputationSummary) {
      modal.info({
        title: "我的名声",
        okText: "关闭",
        content: <Text style={{ color: "#8fa2b8" }}>眼下还未显出额外风评。</Text>,
      });
      return;
    }

    modal.info({
      title: `${player.name || "无名修士"} · 我的名声`,
      okText: "收起",
      width: "min(360px, calc(100vw - 24px))",
      content: (
        <div
          style={{
            maxHeight: "min(62vh, 460px)",
            overflowY: "auto",
            paddingTop: 4,
            paddingRight: 2,
            display: "grid",
            gap: 10,
          }}
        >
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
              {player.reputationSummary.overallLabel}
            </Text>
            <Text style={{ color: "#c9c1b1", whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.65 }}>
              {player.reputationSummary.overallSummary}
            </Text>
            <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              {[
                { label: "当前风评", value: player.reputationSummary.notorietyLabel, tone: "#ffd2bb" },
                { label: "灰线路数", value: player.reputationSummary.shadowLabel, tone: "#d7d1ff" },
                { label: "情名风评", value: player.reputationSummary.sensualLabel, tone: "#ffbfd6" },
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
                  <span style={{ color: item.tone, fontSize: 12, fontWeight: 700, lineHeight: 1.4 }}>
                    {item.value}
                  </span>
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
              gap: 6,
            }}
          >
            <Text style={{ color: "#f3dfb6", fontWeight: 700 }}>当前影响</Text>
            <Text style={{ color: "#d3dded", whiteSpace: "pre-wrap", lineHeight: 1.65 }}>
              {player.reputationSummary.socialFlavorLabel}
            </Text>
            {player.reputationSummary.worldBehaviorHints.map((item) => (
              <Text key={item} style={{ color: "#9aa7bd", display: "block", whiteSpace: "pre-wrap", lineHeight: 1.65 }}>
                {item}
              </Text>
            ))}
          </div>
          <div
            style={{
              borderRadius: 12,
              border: "1px solid rgba(214, 196, 149, 0.12)",
              background: "rgba(255,255,255,0.03)",
              padding: "8px 10px",
              display: "grid",
              gap: 6,
            }}
          >
            <Text style={{ color: "#f3dfb6", fontWeight: 700 }}>缓和路子</Text>
            <Text style={{ color: "#c9c1b1", whiteSpace: "pre-wrap", lineHeight: 1.65 }}>
              {player.reputationSummary.repairHint}
            </Text>
            {player.reputationSummary.repairActions.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {player.reputationSummary.repairActions.map((item) => (
                  <DarkTag key={item} color="#7d6bcf">
                    {item}
                  </DarkTag>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ),
    });
  };

  const buildStatButtonStyle = (active: boolean) => ({
    ...statCardStyle,
    appearance: "none" as const,
    width: "100%",
    textAlign: "left" as const,
    fontFamily: "inherit",
    cursor: "pointer",
    transition: "transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease",
    border: active ? "1px solid rgba(201, 168, 76, 0.72)" : statCardStyle.border,
    background: active
      ? "linear-gradient(180deg, rgba(54, 45, 20, 0.96) 0%, rgba(24, 21, 32, 0.98) 100%)"
      : statCardStyle.background,
    boxShadow: active
      ? "0 0 0 1px rgba(201, 168, 76, 0.16), 0 8px 18px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255,255,255,0.06)"
      : statCardStyle.boxShadow,
    transform: active ? "translateY(-1px)" : "translateY(0)",
    minHeight: 46,
    touchAction: "none" as const,
    userSelect: "none" as const,
    WebkitUserSelect: "none" as const,
    WebkitTouchCallout: "none" as const,
  });

  const renderStatButton = (stat: DisplayStatItem) => (
    <button
      key={stat.label}
      type="button"
      onClick={(event) => toggleStatHelp(event, stat.helpKey, stat.value)}
      onBlur={closeStatHelp}
      onContextMenu={(event) => event.preventDefault()}
      data-stat-help-anchor="true"
      aria-label={`${stat.label}当前为${formatStatValue(stat.value)}，点击查看作用`}
      style={buildStatButtonStyle(activeStatHelp?.helpKey === stat.helpKey)}
    >
      <Text style={{ color: "#8e856e", fontSize: 8, lineHeight: 1.1 }}>{stat.label}</Text>
      <div style={{ color: stat.color, fontSize: 13, fontWeight: 700, lineHeight: 1.1, marginTop: 1 }}>
        {formatStatValue(stat.value)}
      </div>
    </button>
  );

  const coreStats: DisplayStatItem[] = [
    { helpKey: "attack", label: "攻击", value: player.attack, color: "#d4545d" },
    { helpKey: "defense", label: "防御", value: player.defense, color: "#5f8fd8" },
    { helpKey: "speed", label: "速度", value: player.speed, color: "#52b788" },
    { helpKey: "spiritualSense", label: "神识", value: player.spiritualSense, color: "#8c7ae6" },
    { helpKey: "armorPenetration", label: "破防", value: player.armorPenetration, color: "#ff7875" },
    { helpKey: "block", label: "格挡", value: player.block, color: "#73d13d" },
  ];

  const expandedStats: DisplayStatItem[] = [
    { helpKey: "skillDamageBonus", label: "神通增伤", value: player.skillDamageBonus, color: "#fa8c16" },
    { helpKey: "skillDamageReduction", label: "神通减伤", value: player.skillDamageReduction, color: "#13c2c2" },
    { helpKey: "artifactDamageBonus", label: "法宝增伤", value: player.artifactDamageBonus, color: "#eb2f96" },
    { helpKey: "artifactDamageReduction", label: "法宝减伤", value: player.artifactDamageReduction, color: "#2f54eb" },
    { helpKey: "luck", label: "幸运", value: player.luck, color: "#e8d282" },
    { helpKey: "gold", label: "灵石", value: player.gold, color: "#c9a84c" },
    { helpKey: "lingYu", label: "灵玉", value: player.lingYu, color: "#52b788" },
    { helpKey: "stamina", label: "体力", value: `${player.stamina}/${player.staminaMax}`, color: "#f18f5c" },
  ];

  const activeStatHelpDefinition = activeStatHelp ? CHARACTER_STAT_HELP_MAP[activeStatHelp.helpKey] : null;

  const quickActions: CharacterQuickActionItem[] = [
    { key: "inventory", label: "背包", icon: <SkinOutlined />, onClick: () => router.push("/game/inventory") },
    { key: "gongfa", label: "功法", icon: <BookOutlined />, onClick: () => router.push("/game/gongfa") },
    { key: "alchemy", label: "炼丹", icon: <ExperimentOutlined />, onClick: () => router.push("/game/alchemy") },
    { key: "smithing", label: "炼器", icon: <ToolOutlined />, onClick: () => router.push("/game/smithing") },
    { key: "skills", label: "神通", icon: <ThunderboltOutlined />, onClick: () => router.push("/game/skills") },
    { key: "appearance", label: "装扮", icon: <PictureOutlined />, onClick: () => router.push("/game/appearance") },
    {
      key: "mail",
      label: "邮件",
      icon: <MailOutlined />,
      badgeCount: mailHasNotification ? 1 : 0,
      onClick: () => router.push("/game/mail"),
    },
    {
      key: "double-cultivation",
      label: "双修",
      icon: <HeartOutlined />,
      badgeCount: pluginHasNotification ? 1 : 0,
      onClick: () => router.push("/game/double-cultivation"),
    },
    { key: "fortune", label: "气运", icon: <StarOutlined />, onClick: () => router.push("/game/fortune") },
  ];

  return (
    <div style={{ ...cultivationPageWideShellStyle, ...buildCultivationRevealStyle(0) }}>
      <Card
        size="small"
        style={{ ...cultivationHeroCardStyle, ...buildCultivationRevealStyle(20), marginBottom: 8, borderRadius: 16 }}
      >
        <div style={{ position: "relative" }}>
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: "radial-gradient(78% 62% at 50% 12%, rgba(227, 238, 252, 0.12) 0%, rgba(227, 238, 252, 0.04) 36%, rgba(0, 0, 0, 0) 72%), radial-gradient(42% 28% at 50% 58%, rgba(122, 181, 236, 0.12) 0%, rgba(122, 181, 236, 0.02) 54%, rgba(0, 0, 0, 0) 100%)",
            }}
          />
          <div className="character-hero-grid">
          <div className="character-equipment-column">
            {leftEquipmentSlots.map(renderEquipmentSlot)}
          </div>

          <div className="character-identity-stack">
            <div className="character-name-row">
              <Text className="character-name-text">
                {player.name || "无名修士"}
              </Text>
              <button
                type="button"
                onClick={openReputationProfile}
                className="character-reputation-chip"
                aria-label={`查看名声：${player.reputationSummary?.overallLabel || "名声未显"}`}
              >
                <CrownOutlined className="character-reputation-chip__icon" />
                <span className="character-reputation-chip__label">
                  {reputationLabel}
                </span>
              </button>
            </div>
            <Text className="character-realm-text">
              {player.realmName || "未定境界"}
            </Text>

            <div
              style={{
                width: 82,
                height: 82,
                margin: "6px 0 3px",
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                background: "radial-gradient(circle, rgba(220,234,252,0.16) 0%, rgba(110,171,228,0.08) 42%, rgba(13,13,15,0) 76%)",
                boxShadow: "0 0 20px rgba(129, 184, 240, 0.1)",
              }}
            >
              <PlayerAvatar
                avatarImageUrl={player.avatarImageUrl}
                avatarFrameImageUrl={player.avatarFrameImageUrl}
                size={68}
                fallbackText="修士"
                borderColor="#4c607b"
                background="rgba(13, 18, 28, 0.92)"
              />
            </div>

            {player.spiritualRoot && (
              <>
                <Text style={{ color: "#dce8f6", fontSize: 11, display: "block", marginBottom: 1, lineHeight: 1.2 }}>
                  {player.spiritualRoot.name}
                </Text>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginBottom: 3, flexWrap: "wrap" }}>
                  <DarkTag color={ELEMENT_COLORS[player.spiritualRoot.element] || "#6b6355"}>
                    {player.spiritualRoot.element}
                  </DarkTag>
                  {spiritualRootVariant && (
                    <DarkTag color={ELEMENT_COLORS[spiritualRootVariant] || "#6b6355"}>
                      {spiritualRootVariant}
                    </DarkTag>
                  )}
                </div>
                <Text
                  style={{
                    color: "#8fa2b8",
                    fontSize: 9,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    lineHeight: 1.35,
                    maxWidth: 240,
                  }}
                >
                  {player.spiritualRoot.description}
                </Text>
              </>
            )}
          </div>

          <div className="character-equipment-column">
            {rightEquipmentSlots.map(renderEquipmentSlot)}
          </div>
        </div>
        </div>
      </Card>

      {/* 已选定的道途常驻展示（原先只有抉择弹窗，选完就看不见了） */}
      <TalentPanel />

      <Card
        size="small"
        style={{ ...cultivationSectionCardStyle, ...buildCultivationRevealStyle(70), marginBottom: 8, borderRadius: 16 }}
      >
        <div className="character-quick-actions-grid">
          {quickActions.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={action.onClick}
              style={{
                ...quickActionButtonStyle,
                appearance: "none",
                textAlign: "left",
                justifyContent: "flex-start",
                position: "relative",
                overflow: "hidden",
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "radial-gradient(80% 80% at 18% 20%, rgba(223, 239, 255, 0.12), rgba(223, 239, 255, 0.02) 45%, rgba(0,0,0,0) 78%)",
                  pointerEvents: "none",
                }}
              />
              <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, paddingRight: action.badgeCount ? 10 : 0 }}>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, flexShrink: 0 }}>
                  {action.icon}
                </span>
                {action.label}
                {action.badgeCount ? <NotificationDot style={{ top: -1, right: 0, boxShadow: "0 0 0 1px #141a24" }} /> : null}
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card
        size="small"
        title={(
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <Space size={8} wrap>
              <Text style={{ color: "#c9a84c", fontSize: 13 }}>属性卡</Text>
              <button
                type="button"
                onClick={(event) => toggleStatHelp(event, "combatPower", Number(player.combatPower || 0))}
                onBlur={closeStatHelp}
                onContextMenu={(event) => event.preventDefault()}
                data-stat-help-anchor="true"
                style={{
                  border: "none",
                  padding: 0,
                  fontFamily: "inherit",
                  background: "transparent",
                  color: activeStatHelp?.helpKey === "combatPower" ? "#e8d282" : "#8e856e",
                  fontSize: 12,
                  cursor: "pointer",
                  textShadow: activeStatHelp?.helpKey === "combatPower" ? "0 0 10px rgba(201, 168, 76, 0.25)" : "none",
                  transition: "color 0.16s ease, text-shadow 0.16s ease",
                  touchAction: "none",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  WebkitTouchCallout: "none",
                }}
              >
                战力 {Number(player.combatPower || 0).toLocaleString()}
              </button>
            </Space>
            <Space size={8} wrap>
              <Button
                type="text"
                size="small"
                icon={statsExpanded ? <UpOutlined /> : <DownOutlined />}
                onClick={() => setStatsExpanded((current) => !current)}
                style={{
                  ...buildCultivationActionButtonStyle({ active: statsExpanded, dreamy: true }),
                  color: statsExpanded ? "#f7fbff" : "#cad9e8",
                }}
              >
                {statsExpanded ? "精简显示" : "展开属性"}
              </Button>
            </Space>
          </div>
        )}
        style={{ ...cultivationSectionCardStyle, ...buildCultivationRevealStyle(120), marginBottom: 8, borderRadius: 16 }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 7, marginBottom: 8 }}>
          <button
            type="button"
            onClick={(event) => toggleStatHelp(event, "hp", `${player.hp}/${player.maxHp}`)}
            onBlur={closeStatHelp}
            onContextMenu={(event) => event.preventDefault()}
            data-stat-help-anchor="true"
            style={buildStatButtonStyle(activeStatHelp?.helpKey === "hp")}
          >
            <Text style={{ color: "#d4545d", fontSize: 10 }}>气血 {player.hp}/{player.maxHp}</Text>
            <Progress percent={Math.max(0, Math.min(100, Math.floor((player.hp / Math.max(1, player.maxHp)) * 100)))} size="small" strokeColor="#d4545d" showInfo={false} style={{ margin: "3px 0 0" }} />
          </button>
          <button
            type="button"
            onClick={(event) => toggleStatHelp(event, "mp", `${player.mp}/${player.maxMp}`)}
            onBlur={closeStatHelp}
            onContextMenu={(event) => event.preventDefault()}
            data-stat-help-anchor="true"
            style={buildStatButtonStyle(activeStatHelp?.helpKey === "mp")}
          >
            <Text style={{ color: "#457b9d", fontSize: 10 }}>灵力 {player.mp}/{player.maxMp}</Text>
            <Progress percent={Math.max(0, Math.min(100, Math.floor((player.mp / Math.max(1, player.maxMp)) * 100)))} size="small" strokeColor="#457b9d" showInfo={false} style={{ margin: "3px 0 0" }} />
          </button>
        </div>

        <Text style={{ color: "#7f90a6", fontSize: 10, display: "block", marginBottom: 7 }}>
          点击属性卡可查看说明，点别处即可收起
        </Text>

        <div className="character-stat-grid">
          {coreStats.map(renderStatButton)}
        </div>

        {statsExpanded ? (
          <>
            <div className="character-stat-grid character-stat-grid--expanded">
              {expandedStats.map(renderStatButton)}
            </div>
            <div style={{ ...statCardStyle, marginTop: 7 }}>
              <Text style={{ color: "#7f90a6", fontSize: 11 }}>
                体力每 {player.staminaRecoverIntervalMinutes || 60} 分钟恢复 {player.staminaRecoverPerInterval || 10} 点，上限 {player.staminaMax} 点。
              </Text>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setStatsExpanded(true)}
            style={{
              marginTop: 8,
              width: "100%",
              ...cultivationSoftPanelStyle,
              border: "1px dashed rgba(156, 185, 218, 0.24)",
              color: "#c9d7e6",
              padding: "7px 10px",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            下拉摊开更多属性
          </button>
        )}

      </Card>

      {Array.isArray(player.pluginProfileBottomContents) && player.pluginProfileBottomContents.length > 0 ? (
        <Card
          size="small"
          title={<Text style={{ color: "#c9a84c", fontSize: 13 }}>额外画像</Text>}
          style={{ ...cultivationSectionCardStyle, ...buildCultivationRevealStyle(150), marginBottom: 8, borderRadius: 16 }}
        >
          <PlayerProfileBottomContentList contents={player.pluginProfileBottomContents} />
        </Card>
      ) : null}

      <ItemDetailModal
        open={Boolean(detailItemId)}
        itemId={detailItemId}
        onClose={() => setDetailItemId(null)}
      />

      {activeStatHelp && activeStatHelpDefinition ? (
        <div
          className="character-stat-help-panel"
          role="dialog"
          aria-modal="false"
          aria-label={`${activeStatHelpDefinition.title}说明`}
          style={{
            position: "fixed",
            left: activeStatHelp.anchorLeft,
            top: activeStatHelp.anchorTop,
            width: activeStatHelp.tooltipWidth,
            transform: "translateY(-100%)",
            borderRadius: 9,
            border: "1px solid rgba(201, 168, 76, 0.22)",
            background: "linear-gradient(180deg, rgba(27, 26, 39, 0.98) 0%, rgba(14, 14, 24, 0.98) 100%)",
            boxShadow: "0 8px 18px rgba(0, 0, 0, 0.24)",
            padding: "5px 6px 6px",
            zIndex: 1100,
            backdropFilter: "blur(14px)",
            pointerEvents: "none",
          }}
        >
          <div
            key={`${activeStatHelp.helpKey}:${String(activeStatHelp.currentValue)}`}
            className="character-stat-help-panel__content"
          >
            <Text style={{ color: "#f3ddb0", fontSize: 10, fontWeight: 700, display: "block", lineHeight: 1.15 }}>
              {activeStatHelpDefinition.title}
            </Text>
            <Text style={{ color: "#c9a84c", fontSize: 8, display: "block", marginTop: 1, lineHeight: 1.15 }}>
              当前 {formatStatValue(activeStatHelp.currentValue)}
            </Text>

            <Text
              style={{
                color: "#d8cfbb",
                fontSize: 8,
                lineHeight: 1.28,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                marginTop: 4,
              }}
            >
              {activeStatHelpDefinition.summary}
            </Text>

            <Text
              style={{
                color: "#8e856e",
                fontSize: 7,
                lineHeight: 1.2,
                display: "-webkit-box",
                WebkitLineClamp: 1,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                marginTop: 3,
              }}
            >
              {activeStatHelpDefinition.tip}
            </Text>
          </div>
        </div>
      ) : null}

      <style jsx>{`
        .character-stat-help-panel {
          animation: character-stat-help-panel-in 0.16s ease-out;
        }

        .character-stat-help-panel__content {
          animation: character-stat-help-content-swap 0.14s ease-out;
        }

        .character-stat-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 6px;
        }

        .character-stat-grid--expanded {
          margin-top: 6px;
        }

        .character-hero-grid {
          display: grid;
          grid-template-columns: 48px minmax(0, 1fr) 48px;
          gap: 6px;
          align-items: stretch;
        }

        .character-equipment-column {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .character-identity-stack {
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-width: 0;
          padding-inline: 1px;
        }

        .character-name-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          max-width: 100%;
          flex-wrap: wrap;
        }

        .character-name-text {
          color: #edf5ff;
          font-size: 17px;
          font-weight: 600;
          letter-spacing: 1px;
          line-height: 1.2;
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .character-realm-text {
          color: #9caec3;
          font-size: 12px;
          margin-top: 3px;
          line-height: 1.35;
        }

        .character-reputation-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          max-width: min(100%, 164px);
          border-radius: 999px;
          border: 1px solid rgba(201, 168, 76, 0.22);
          background: linear-gradient(180deg, rgba(44, 38, 24, 0.92), rgba(21, 19, 28, 0.96));
          color: #e8d282;
          padding: 4px 9px;
          font-size: 10px;
          line-height: 1;
          cursor: pointer;
          box-shadow: 0 8px 16px rgba(0, 0, 0, 0.14);
          transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
        }

        .character-reputation-chip:hover {
          transform: translateY(-1px);
          border-color: rgba(201, 168, 76, 0.34);
          box-shadow: 0 10px 18px rgba(0, 0, 0, 0.18);
        }

        .character-reputation-chip__icon {
          font-size: 11px;
          flex-shrink: 0;
        }

        .character-reputation-chip__label {
          max-width: 88px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .character-quick-actions-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 7px;
        }

        .character-extra-actions-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .character-extra-action-button {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
          min-height: 44px;
          border: 1px solid rgba(156, 185, 218, 0.18);
          border-radius: 12px;
          background: linear-gradient(180deg, rgba(28, 34, 48, 0.94), rgba(15, 19, 28, 0.98));
          color: #eef5ff;
          padding: 10px 12px;
          cursor: pointer;
          text-align: left;
          transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
        }

        .character-extra-action-button:hover {
          transform: translateY(-1px);
          border-color: rgba(156, 185, 218, 0.28);
          box-shadow: 0 10px 18px rgba(0, 0, 0, 0.16);
        }

        .character-extra-action-button__icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          flex-shrink: 0;
          color: #d9e8f7;
        }

        .character-extra-action-button__label {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
        }

        @keyframes character-stat-help-panel-in {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes character-stat-help-content-swap {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (max-width: 480px) {
          .character-hero-grid {
            grid-template-columns: 40px minmax(0, 1fr) 40px;
            gap: 4px;
          }

          .character-equipment-column {
            gap: 5px;
          }

          .character-equipment-slot {
            border-radius: 11px !important;
          }

          .character-stat-grid {
            gap: 5px;
          }

          .character-name-row {
            gap: 6px;
          }

          .character-name-text {
            font-size: 16px;
            letter-spacing: 0.6px;
          }

          .character-reputation-chip {
            padding: 4px 8px;
          }

          .character-reputation-chip__label {
            max-width: 72px;
          }

        }

        @media (max-width: 390px) {
          .character-hero-grid {
            grid-template-columns: 36px minmax(0, 1fr) 36px;
          }

          .character-stat-grid {
            gap: 4px;
          }

        }
      `}</style>
    </div>
  );
}

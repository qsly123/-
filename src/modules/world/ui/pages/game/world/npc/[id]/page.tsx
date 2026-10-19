"use client";

import { use, useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Collapse, Descriptions, Drawer, Grid, List, Modal, Space, Spin, Tag, Typography, type CollapseProps } from "antd";
import {
  ArrowLeftOutlined,
  BookOutlined,
  FundProjectionScreenOutlined,
  HeartOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import PlayerAvatar from "@/modules/shared/ui/components/PlayerAvatar";
import ScrollableContent from "@/modules/shared/ui/components/ScrollableContent";

const { Paragraph, Text, Title } = Typography;

type WorldAdultActionType = "seduce_invite" | "dual_cultivation" | "essence_drain" | "dangerous_preference";
type WorldAdultResolveDecision = "accept" | "reject" | "counter_drain" | "ignore";
type DetailPanelKey = "identity" | "growth" | "threat" | "relation" | "inventory" | "adult" | "logs";

type WorldAdultInviteView = {
  eventLogId: string;
  actionLabel: string;
  title: string;
  summary: string;
  atmosphere: string;
  dispositionLabel: string;
  responseOptions: string[];
  expiresAt: string | null;
};

type WorldNpcAdultIntentView = {
  adultDisposition: string;
  adultPreferenceHints: string[];
  corruptionStageLabel: string;
  actionCooldown: {
    isCoolingDown: boolean;
    cooldownRemainingMs: number;
    cooldownRemainingText: string | null;
    cooldownUntil: string | null;
    hint: string;
  };
  allowedAdultActions: Array<{
    actionType: WorldAdultActionType;
    label: string;
    description: string;
    riskLabel: string;
    disabledReason?: string | null;
  }>;
  playerAdultProfile: {
    corruptionValue: number;
    allureValue: number;
    shameValue: number;
    corruptionStageLabel: string;
  };
  npcAdultProfile: {
    desireValue: number;
    corruptionValue: number;
    cautionValue: number;
    roleTags: string[];
    preferenceTags: string[];
    summary: string;
  };
  pendingInvite: WorldAdultInviteView | null;
};

type WorldAdultResolveResultView = {
  accepted: boolean;
  title: string;
  summary: string;
  atmosphere: string;
  worldConsequence: string;
  changeHints: string[];
  pregnancy: {
    triggered: boolean;
    summary: string;
  } | null;
};

type WorldAdultHistoryItem = {
  id: string;
  title: string;
  npcName: string;
  actionLabel: string;
  accepted: boolean;
  summary: string;
  resultSummary: string | null;
  atmosphereSummary?: string | null;
  doubleCultivation?: {
    synced: boolean;
    forced: boolean;
    logId: number | null;
    targetKind: string | null;
    targetId: string | null;
    targetName: string | null;
    sourceRef: string | null;
    sourceTargetId: string | null;
    playerGain: number | null;
    playerFluidMl: number | null;
    partnerFluidMl: number | null;
    intimacyScoreDelta: number | null;
  } | null;
  createdAt: string;
};

type WorldNpcShadowContractView = {
  offerId: string;
  offerType:
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
  offerTypeLabel: string;
  contractType: "meet_contact" | "hunt_target" | "surveil_target" | "dead_drop_delivery" | "escort_cargo" | "treasure_probe";
  contractStatus: "active" | "completed" | "failed";
  title: string;
  summary: string;
  detail: string;
  progressLabel: string;
  actionLabel?: string | null;
  targetNpcId?: string | null;
  targetNpcName?: string | null;
  targetMapName?: string | null;
  targetDistrictName?: string | null;
  rewardGold: number;
  rewardLingYu: number;
  canAdvanceByTalking: boolean;
};

type WorldNpcDetailResponse = {
  npc: {
    id: string;
    name: string;
    originType?: string | null;
    profession?: string | null;
    faction?: string | null;
    realmName: string;
    personalitySummary: string;
    statsSummary: Record<string, number>;
    reincarnationCount: number;
    isKillable: boolean;
    status: string;
    avatarImageUrl?: string | null;
    portraitImageUrl?: string | null;
    currentActionLabel: string;
    currentMapName: string;
    currentDistrictName?: string | null;
    positionX: number;
    positionY: number;
  };
  fateSummary: { title: string; description: string };
  threatSummary: { state: "calm" | "alert" | "hostile"; label: string; description: string; expiresAt: string | null; isTargetingViewer: boolean };
  growthSummary: { pathName: string; stageLabel: string; nextBreakthroughHint: string; favoredActionLabel: string; dominantActionLabel: string };
  relationSummary: { label: string; description: string; nearbyFactionCount: number; nearbyDistrictCount: number; recentSignal: string | null; hints: string[] };
  reputationSummary?: {
    overallLabel: string;
    overallSummary: string;
    repairHint: string;
    worldBehaviorHints: string[];
  } | null;
  reputationReaction?: {
    stance: "neutral" | "cold" | "guarded" | "shadow_friendly";
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
  } | null;
  relationshipRepairHints?: string[];
  factionHints?: {
    surfaceFaction: string;
    stanceLabel: string;
    hazeLabel: string;
    hints: string[];
  } | null;
  involvedStorylines?: Array<{
    id: string;
    districtName: string;
    storylineType: string;
    storylineTypeLabel: string;
    stageLabel: string;
    summary: string;
    status: string;
    sourceFactionName: string;
  }>;
  inventoryProbe: { mode: "blocked" | "blurred"; title: string; description: string };
  inventory: Array<{ id: string; itemName: string; itemIconUrl?: string | null; quantityLabel?: string | null; isLootable: boolean; slotType?: string | null; itemCategoryLabel?: string | null }>;
  lifeLogs: Array<{ id: number; title: string; content: string; createdAt: string; payloadJson?: Record<string, unknown> }>;
  shadowContracts?: WorldNpcShadowContractView[];
  adultIntent?: WorldNpcAdultIntentView | null;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "暂无";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function formatSignedValue(value: number | null | undefined, unit = "") {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return `0${unit}`;
  }
  return `${numeric >= 0 ? "+" : ""}${Math.floor(numeric)}${unit}`;
}

function inviteSupportsResponse(invite: WorldAdultInviteView | null | undefined, label: string) {
  return Array.isArray(invite?.responseOptions) && invite.responseOptions.includes(label);
}

function resolveShadowContractTypePresentation(contractType: WorldNpcShadowContractView["contractType"]) {
  if (contractType === "meet_contact") {
    return { label: "接头", color: "blue" as const };
  }
  if (contractType === "hunt_target") {
    return { label: "猎修", color: "red" as const };
  }
  if (contractType === "surveil_target") {
    return { label: "监听", color: "gold" as const };
  }
  if (contractType === "dead_drop_delivery") {
    return { label: "藏货", color: "purple" as const };
  }
  if (contractType === "treasure_probe") {
    return { label: "探宝", color: "cyan" as const };
  }
  return { label: "护送", color: "magenta" as const };
}

const adultHintTagStyle: CSSProperties = {
  maxWidth: "100%",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  lineHeight: 1.45,
  paddingInline: 8,
  paddingBlock: 2,
};

const wrappedTextStyle: CSSProperties = {
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};

const drawerScrollStyle: CSSProperties = {
  paddingRight: 4,
};

const invitePreviewTextStyle: CSSProperties = {
  ...wrappedTextStyle,
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 4,
  overflow: "hidden",
};

function renderAdultSectionLabel(title: string, summary?: string | null) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontWeight: 600 }}>{title}</span>
      {summary ? (
        <span
          style={{
            color: "#8f99aa",
            fontSize: 12,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary}
        </span>
      ) : null}
    </div>
  );
}

function renderExpandableNarrative(
  content: string | null | undefined,
  options?: {
    rows?: number;
    color?: string;
    marginBottom?: number;
  },
) {
  if (!content) {
    return null;
  }
  return (
    <Paragraph
      ellipsis={{ rows: options?.rows ?? 4, expandable: true, symbol: "展开" }}
      style={{
        marginBottom: options?.marginBottom ?? 8,
        color: options?.color,
        ...wrappedTextStyle,
      }}
    >
      {content}
    </Paragraph>
  );
}

export default function WorldNpcPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const [loading, setLoading] = useState(true);
  const [engaging, setEngaging] = useState(false);
  const [activePanel, setActivePanel] = useState<DetailPanelKey | null>(null);
  const [data, setData] = useState<WorldNpcDetailResponse | null>(null);
  const [adultHistory, setAdultHistory] = useState<WorldAdultHistoryItem[]>([]);
  const [adultHistoryLoading, setAdultHistoryLoading] = useState(false);
  const [adultActionLoadingKey, setAdultActionLoadingKey] = useState<string | null>(null);
  const [adultResult, setAdultResult] = useState<WorldAdultResolveResultView | null>(null);
  const [adultInviteDetailOpen, setAdultInviteDetailOpen] = useState(false);
  const [shadowContractLoadingId, setShadowContractLoadingId] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/game/world/npc/${id}`, { cache: "no-store" });
      const json = await response.json();
      if (!json.success || !json.data) {
        message.error(json.error || "加载世界 NPC 失败");
        setData(null);
        return;
      }
      setData(json.data);
    } catch (error) {
      console.error(error);
      message.error("加载世界 NPC 失败");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id, message]);

  const loadAdultHistory = useCallback(async () => {
    setAdultHistoryLoading(true);
    try {
      const response = await fetch(`/api/game/world/adult/history?npcId=${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = await response.json();
      setAdultHistory(Array.isArray(json.data?.history) ? json.data.history : []);
    } catch (error) {
      console.error(error);
    } finally {
      setAdultHistoryLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (activePanel === "adult") {
      void loadAdultHistory();
    }
  }, [activePanel, loadAdultHistory]);

  const handleEngage = useCallback(async () => {
    if (engaging) {
      return;
    }
    setEngaging(true);
    try {
      const response = await fetch(`/api/game/world/npc/${id}/engage`, { method: "POST" });
      const json = await response.json();
      if (!json.success || !json.data?.monsterId) {
        message.error(json.error || "发起交战失败");
        return;
      }
      router.push(`/game/combat/${json.data.monsterId}`);
    } catch (error) {
      console.error(error);
      message.error("发起交战失败");
    } finally {
      setEngaging(false);
    }
  }, [engaging, id, message, router]);

  const handleAdultNegotiate = useCallback(async (actionType: WorldAdultActionType) => {
    if (adultActionLoadingKey) {
      return;
    }
    setAdultActionLoadingKey(`negotiate:${actionType}`);
    try {
      const response = await fetch(`/api/game/world/npc/${id}/adult-negotiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType }),
      });
      const json = await response.json();
      if (!json.success) {
        message.warning(json.error || "发起互动失败");
        return;
      }
      await Promise.all([loadDetail(), loadAdultHistory()]);
      message.success(json.data?.canResolve ? "已收到回信，进入确认阶段。" : "这次互动没有继续深入。");
      setAdultResult(null);
    } catch (error) {
      console.error(error);
      message.warning("发起互动失败");
    } finally {
      setAdultActionLoadingKey(null);
    }
  }, [adultActionLoadingKey, id, loadAdultHistory, loadDetail, message]);

  const handleAdultResolve = useCallback(async (decision: WorldAdultResolveDecision) => {
    const eventLogId = data?.adultIntent?.pendingInvite?.eventLogId;
    if (!eventLogId || adultActionLoadingKey) {
      return;
    }
    setAdultActionLoadingKey(`resolve:${decision}`);
    try {
      const response = await fetch(`/api/game/world/npc/${id}/adult-resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventLogId, decision }),
      });
      const json = await response.json();
      if (!json.success || !json.data) {
        message.warning(json.error || "处理互动失败");
        return;
      }
      setAdultResult(json.data);
      setAdultInviteDetailOpen(false);
      await Promise.all([loadDetail(), loadAdultHistory()]);
      message[json.data.accepted ? "success" : "info"](json.data.summary || "互动已处理。");
    } catch (error) {
      console.error(error);
      message.warning("处理互动失败");
    } finally {
      setAdultActionLoadingKey(null);
    }
  }, [adultActionLoadingKey, data?.adultIntent?.pendingInvite?.eventLogId, id, loadAdultHistory, loadDetail, message]);

  const handleShadowContractAdvance = useCallback(async (offerId: string) => {
    if (shadowContractLoadingId) {
      return;
    }
    setShadowContractLoadingId(offerId);
    try {
      const response = await fetch(`/api/game/world/npc/${id}/shadow-contract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId }),
      });
      const json = await response.json() as {
        success: boolean;
        error?: string;
        data?: {
          resultSummary?: string;
        };
      };
      if (!json.success) {
        message.warning(json.error || "推进暗线委托失败");
        return;
      }
      await loadDetail();
      message.success(json.data?.resultSummary || "这桩暗线委托已经推进。");
    } catch (error) {
      console.error(error);
      message.warning("推进暗线委托失败");
    } finally {
      setShadowContractLoadingId(null);
    }
  }, [id, loadDetail, message, shadowContractLoadingId]);

  if (loading) {
    return <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spin size="large" /></div>;
  }
  if (!data) {
    return <div style={{ padding: 16 }}><Button icon={<ArrowLeftOutlined />} onClick={() => router.back()}>返回</Button></div>;
  }

  const isDesktop = Boolean(screens.md);
  const {
    npc,
    fateSummary,
    threatSummary,
    growthSummary,
    relationSummary,
    reputationSummary,
    reputationReaction,
    relationshipRepairHints = [],
    factionHints,
    involvedStorylines = [],
    inventoryProbe,
    inventory,
    lifeLogs,
    shadowContracts = [],
    adultIntent,
  } = data;
  const stats = npc.statsSummary || {};
  const adultCooldownHint = adultIntent?.actionCooldown.isCoolingDown
    ? adultIntent.actionCooldown.hint
    : null;
  const negotiateBlockedReason = adultIntent?.pendingInvite
    ? "你与此人还有未处理的私密申请，先处理后再发起新的申请。"
    : adultCooldownHint
      ? `${adultCooldownHint} 结束后才能再次发起。`
    : null;
  const panels = [
    { key: "identity", title: "出身与气象", icon: <BookOutlined />, summary: `${npc.originType || "未知出身"} · ${npc.faction || "无门散人"}` },
    { key: "growth", title: "成长道路", icon: <FundProjectionScreenOutlined />, summary: `${growthSummary.pathName} · ${growthSummary.stageLabel}` },
    { key: "threat", title: "目击与仇意", icon: <SafetyCertificateOutlined />, summary: threatSummary.label },
    { key: "relation", title: "关系与名声", icon: <TeamOutlined />, summary: reputationReaction?.label || factionHints?.surfaceFaction || relationSummary.label },
    { key: "inventory", title: "背包探查", icon: <ThunderboltOutlined />, summary: inventoryProbe.title },
    { key: "adult", title: "私密互动", icon: <HeartOutlined />, summary: adultIntent?.adultDisposition || "对方同意后才能继续" },
    { key: "logs", title: "经历记录", icon: <UnorderedListOutlined />, summary: `最近 ${lifeLogs.length} 条` },
  ] as Array<{ key: DetailPanelKey; title: string; icon: ReactNode; summary: string }>;

  const activeTitle = panels.find((item) => item.key === activePanel)?.title || "详情";
  const adultCollapseItems: CollapseProps["items"] = adultIntent ? [
    {
      key: "adult-overview",
      label: renderAdultSectionLabel(
        "互动边界",
        adultIntent.actionCooldown.isCoolingDown
          ? `${adultIntent.actionCooldown.cooldownRemainingText || "稍后"} 后可再次发起`
          : `当前态度：${adultIntent.adultDisposition || "谨慎观望"} · 待回应：${adultIntent.pendingInvite ? adultIntent.pendingInvite.actionLabel : "暂无"}`,
      ),
      children: (
        <Card size="small" bordered={false} styles={{ body: { padding: 0 } }}>
          <ScrollableContent maxHeight="min(34vh, 220px)" style={drawerScrollStyle}>
            <Paragraph style={{ marginBottom: 8, ...wrappedTextStyle }}>这里只处理开放世界 NPC 的私密申请，对方同意后才会继续。</Paragraph>
            {adultIntent.actionCooldown.isCoolingDown ? (
              <Card
                size="small"
                style={{
                  marginBottom: 10,
                  background: "rgba(214, 178, 100, 0.08)",
                  borderColor: "rgba(214, 178, 100, 0.28)",
                }}
              >
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  <Text strong style={wrappedTextStyle}>心神平复中</Text>
                  <Text style={wrappedTextStyle}>{adultIntent.actionCooldown.hint}</Text>
                  <Text type="secondary" style={wrappedTextStyle}>
                    恢复时刻：{formatDateTime(adultIntent.actionCooldown.cooldownUntil)}
                  </Text>
                </Space>
              </Card>
            ) : null}
            <Text style={wrappedTextStyle}>当前态度：{adultIntent.adultDisposition || "谨慎观望"}</Text><br />
            <Text style={wrappedTextStyle}>心念状态：{adultIntent.corruptionStageLabel || "仍守边界"}</Text><br />
            <Text style={wrappedTextStyle}>待回应来信：{adultIntent.pendingInvite ? `${adultIntent.pendingInvite.actionLabel} · 截止 ${formatDateTime(adultIntent.pendingInvite.expiresAt)}` : "暂无"}</Text>
          </ScrollableContent>
        </Card>
      ),
    },
    {
      key: "adult-profile",
      label: renderAdultSectionLabel(
        "双方心意",
        `${adultIntent.npcAdultProfile.roleTags.slice(0, 2).join(" · ") || "暂无侧写"} · 偏好 ${adultIntent.npcAdultProfile.preferenceTags.length} 条`,
      ),
      children: (
        <Card size="small" bordered={false} styles={{ body: { padding: 0 } }}>
          <ScrollableContent maxHeight="min(40vh, 280px)" style={drawerScrollStyle}>
            <Paragraph
              ellipsis={{ rows: 4, expandable: true, symbol: "展开" }}
              style={{ marginBottom: 8, ...wrappedTextStyle }}
            >
              {adultIntent.npcAdultProfile.summary}
            </Paragraph>
            <Text style={wrappedTextStyle}>你：魅力度 {adultIntent.playerAdultProfile.allureValue} / 堕落 {adultIntent.playerAdultProfile.corruptionValue} / 羞耻 {adultIntent.playerAdultProfile.shameValue}</Text><br />
            <Text style={wrappedTextStyle}>对方：欲念 {adultIntent.npcAdultProfile.desireValue} / 堕落 {adultIntent.npcAdultProfile.corruptionValue} / 戒心 {adultIntent.npcAdultProfile.cautionValue}</Text>
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {adultIntent.adultPreferenceHints.map((hint) => <Tag key={hint} color="magenta" style={adultHintTagStyle}>{hint}</Tag>)}
              {adultIntent.npcAdultProfile.roleTags.map((tag) => <Tag key={`role-${tag}`} style={adultHintTagStyle}>{tag}</Tag>)}
              {adultIntent.npcAdultProfile.preferenceTags.map((tag) => <Tag key={`pref-${tag}`} color="purple" style={adultHintTagStyle}>{tag}</Tag>)}
            </div>
          </ScrollableContent>
        </Card>
      ),
    },
    {
      key: "adult-actions",
      label: renderAdultSectionLabel(
        "可做的互动",
        negotiateBlockedReason || `可互动 ${adultIntent.allowedAdultActions.length} 项`,
      ),
      children: (
        <Card size="small" bordered={false} styles={{ body: { padding: 0 } }}>
          <ScrollableContent maxHeight="min(42vh, 320px)" style={drawerScrollStyle}>
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              {adultIntent.allowedAdultActions.map((action) => (
                <Card key={action.actionType} size="small">
                  <Space direction="vertical" size={6} style={{ width: "100%" }}>
                    <Space wrap><Tag color="blue" style={adultHintTagStyle}>{action.label}</Tag><Text type="secondary" style={wrappedTextStyle}>{action.riskLabel}</Text></Space>
                    <Text style={wrappedTextStyle}>{action.description}</Text>
                    {action.disabledReason ? <Text type="danger" style={wrappedTextStyle}>{action.disabledReason}</Text> : null}
                    {!action.disabledReason && negotiateBlockedReason ? <Text type="secondary" style={wrappedTextStyle}>{negotiateBlockedReason}</Text> : null}
                    <Button
                      type="primary"
                      ghost
                      disabled={Boolean(action.disabledReason) || Boolean(negotiateBlockedReason)}
                      loading={adultActionLoadingKey === `negotiate:${action.actionType}`}
                      onClick={() => void handleAdultNegotiate(action.actionType)}
                    >
                      {adultIntent.actionCooldown.isCoolingDown ? "心神平复中" : "开始互动"}
                    </Button>
                  </Space>
                </Card>
              ))}
            </Space>
          </ScrollableContent>
        </Card>
      ),
    },
    ...(adultResult ? [{
      key: "adult-result",
      label: renderAdultSectionLabel("最近结果", adultResult.title),
      children: (
        <Card size="small" bordered={false} styles={{ body: { padding: 0 } }}>
          <ScrollableContent maxHeight="min(40vh, 300px)" style={drawerScrollStyle}>
            {renderExpandableNarrative(adultResult.summary, { rows: 5 })}
            {renderExpandableNarrative(adultResult.atmosphere, { rows: 4, color: "#9aa7bd" })}
            {renderExpandableNarrative(adultResult.worldConsequence, { rows: 4, color: "#d6b264" })}
            <List
              size="small"
              dataSource={adultResult.changeHints}
              locale={{ emptyText: "暂无额外变化提示。" }}
              renderItem={(item) => <List.Item style={wrappedTextStyle}>{item}</List.Item>}
            />
            {adultResult.pregnancy ? renderExpandableNarrative(adultResult.pregnancy.summary, { rows: 4, marginBottom: 0 }) : null}
          </ScrollableContent>
        </Card>
      ),
    }] : []),
    {
      key: "adult-history",
      label: renderAdultSectionLabel("近期互动记录", adultHistory.length > 0 ? `最近 ${adultHistory.length} 条` : "暂无记录"),
      children: (
        <Card size="small" bordered={false} styles={{ body: { padding: 0 } }}>
          <ScrollableContent maxHeight="min(42vh, 320px)" style={drawerScrollStyle}>
            <List
              dataSource={adultHistory}
              locale={{ emptyText: "你与此人的互动还没有留下更多记录。" }}
              renderItem={(item) => (
                <List.Item>
                  <List.Item.Meta
                    title={`${item.actionLabel} · ${item.title}`}
                    description={(
                      <div style={{ ...wrappedTextStyle }}>
                        <Paragraph
                          ellipsis={{ rows: 4, expandable: true, symbol: "展开" }}
                          style={{ marginBottom: 6, ...wrappedTextStyle }}
                        >
                          {item.summary || item.resultSummary || "这次申请没有后续记录。"}
                        </Paragraph>
                        <Text type="secondary" style={wrappedTextStyle}>
                          {item.npcName} · {formatDateTime(item.createdAt)} · {item.accepted ? "已完成" : "未完成"}
                        </Text>
                        {item.doubleCultivation?.synced ? (
                          <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <Tag color={item.doubleCultivation.forced ? "orange" : "magenta"}>
                              {item.doubleCultivation.forced ? "已补记入双修记录" : "已记入双修记录"}
                            </Tag>
                            {typeof item.doubleCultivation.playerGain === "number" ? (
                              <Tag color="gold">修为 {formatSignedValue(item.doubleCultivation.playerGain)}</Tag>
                            ) : null}
                            {typeof item.doubleCultivation.playerFluidMl === "number" ? (
                              <Tag color="blue">你的灵液 {Math.max(0, Math.floor(item.doubleCultivation.playerFluidMl))} ml</Tag>
                            ) : null}
                            {typeof item.doubleCultivation.partnerFluidMl === "number" ? (
                              <Tag color="purple">对方灵液 {Math.max(0, Math.floor(item.doubleCultivation.partnerFluidMl))} ml</Tag>
                            ) : null}
                            {typeof item.doubleCultivation.intimacyScoreDelta === "number" ? (
                              <Tag color="red">淫乱度 {formatSignedValue(item.doubleCultivation.intimacyScoreDelta)}</Tag>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )}
                  />
                </List.Item>
              )}
            />
          </ScrollableContent>
        </Card>
      ),
    },
  ] : [];
  const defaultAdultCollapseKeys = adultIntent?.pendingInvite ? [] : [];

  return (
    <div style={{ minHeight: "100vh", padding: 12, background: "linear-gradient(180deg, #121b28 0%, #0a1018 100%)" }}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.back()}>返回地图</Button>
          <Space wrap size={[8, 8]} style={{ justifyContent: "flex-end" }}>
            <Button icon={<HeartOutlined />} onClick={() => setActivePanel("adult")}>Sex</Button>
            <Button danger type="primary" icon={<ThunderboltOutlined />} disabled={!npc.isKillable || npc.status === "dead"} loading={engaging} onClick={() => void handleEngage()}>
              杀人夺宝
            </Button>
          </Space>
        </div>

        <Card>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
            <PlayerAvatar size={isDesktop ? 72 : 60} avatarImageUrl={npc.portraitImageUrl || npc.avatarImageUrl} fallbackText={(npc.name || "人").slice(0, 1)} />
            <div style={{ minWidth: 0 }}>
              <Title level={4} style={{ margin: 0, color: "#e8e0d0" }}>{npc.name}</Title>
              <Text style={{ color: "#8ea4c8" }}>{npc.profession || "散修"} · {npc.realmName}</Text>
              <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Tag color={npc.status === "dead" ? "red" : "blue"}>{npc.status === "dead" ? "已陨落" : "在世"}</Tag>
                <Tag color="gold">{npc.currentActionLabel}</Tag>
                <Tag color="green">轮回 {npc.reincarnationCount}</Tag>
                <Tag color={threatSummary.state === "hostile" ? "red" : threatSummary.state === "alert" ? "orange" : "default"}>{threatSummary.label}</Tag>
                {factionHints?.surfaceFaction ? <Tag color="purple">{factionHints.surfaceFaction}</Tag> : null}
                {reputationReaction ? (
                  <Tag color={reputationReaction.willIgnorePlayer ? "red" : reputationReaction.stance === "shadow_friendly" ? "purple" : "default"}>
                    {reputationReaction.label}
                  </Tag>
                ) : null}
                {adultIntent ? <Tag color="magenta">{adultIntent.adultDisposition}</Tag> : null}
              </div>
              <Paragraph ellipsis={{ rows: 2, expandable: true, symbol: "展开" }} style={{ marginTop: 10, marginBottom: 0, color: "#c7cdd8" }}>
                {npc.personalitySummary}
              </Paragraph>
            </div>
          </div>
        </Card>

        <div style={{
          display: "grid",
          gridTemplateColumns: isDesktop ? "repeat(4, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))",
          gap: 10,
        }}>
          <Card size="small"><Text>命格：{fateSummary.title}</Text></Card>
          <Card size="small"><Text>关系：{relationSummary.label}</Text></Card>
          <Card size="small"><Text>成长：{growthSummary.stageLabel}</Text></Card>
          <Card size="small"><Text>位置：{npc.currentDistrictName || npc.currentMapName}</Text></Card>
        </div>

        <Card title="快速查阅" styles={{ body: { padding: 12 } }}>
          <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(2, minmax(0, 1fr))" : "1fr", gap: 10 }}>
            {panels.map((panel) => (
              <button key={panel.key} type="button" onClick={() => setActivePanel(panel.key)} style={{ textAlign: "left", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(8,13,20,0.82)", padding: "14px 16px", color: "#e8e0d0" }}>
                <Space align="start" size={10}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(214,178,100,0.14)", color: "#d6b264" }}>{panel.icon}</span>
                  <span>
                    <div style={{ fontWeight: 700 }}>{panel.title}</div>
                    <div style={{ color: "#8f99aa", fontSize: 12, marginTop: 4 }}>{panel.summary}</div>
                  </span>
                </Space>
              </button>
            ))}
          </div>
        </Card>

        {shadowContracts.length > 0 ? (
          <Card
            title="灰线委托"
            styles={{ body: { padding: 12 } }}
            style={{ borderColor: "rgba(143, 103, 170, 0.45)", background: "rgba(25, 16, 32, 0.88)" }}
          >
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              {shadowContracts.map((contract) => (
                <Card key={contract.offerId} size="small" style={{ background: "rgba(8, 13, 20, 0.68)", borderColor: "rgba(143, 103, 170, 0.28)" }}>
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                    <Space wrap>
                      <Tag color="purple">{contract.offerTypeLabel}</Tag>
                      <Tag color={resolveShadowContractTypePresentation(contract.contractType).color}>
                        {resolveShadowContractTypePresentation(contract.contractType).label}
                      </Tag>
                      <Tag>{contract.contractStatus === "completed" ? "已结清" : contract.contractStatus === "failed" ? "已断线" : "进行中"}</Tag>
                    </Space>
                    <Text strong style={wrappedTextStyle}>{contract.title}</Text>
                    <Paragraph style={{ marginBottom: 0, color: "#d8d2e6", ...wrappedTextStyle }}>{contract.summary}</Paragraph>
                    <Text style={{ color: "#9fa7b9", ...wrappedTextStyle }}>{contract.progressLabel}</Text>
                    <Text style={{ color: "#857a99", fontSize: 12, ...wrappedTextStyle }}>
                      尾款：金 {contract.rewardGold} / 灵玉 {contract.rewardLingYu}
                    </Text>
                    {contract.canAdvanceByTalking ? (
                      <Button
                        type="primary"
                        ghost
                        loading={shadowContractLoadingId === contract.offerId}
                        disabled={Boolean(shadowContractLoadingId)}
                        onClick={() => void handleShadowContractAdvance(contract.offerId)}
                      >
                        {contract.actionLabel || "递上暗语"}
                      </Button>
                    ) : contract.contractType === "hunt_target" && contract.contractStatus === "active" ? (
                      <Text type="warning" style={wrappedTextStyle}>此人正是灰线挂单的猎修目标，可直接发起杀人夺宝。</Text>
                    ) : contract.contractStatus === "active" ? (
                      <Text type="secondary" style={wrappedTextStyle}>
                        这条委托需要去地图目标点继续推进，先记下进度提示再动身。
                      </Text>
                    ) : null}
                  </Space>
                </Card>
              ))}
            </Space>
          </Card>
        ) : null}

        <Card>
          <Descriptions size="small" column={isDesktop ? 2 : 1} bordered>
            <Descriptions.Item label="境界">{npc.realmName}</Descriptions.Item>
            <Descriptions.Item label="可击杀">{npc.isKillable ? "是" : "否"}</Descriptions.Item>
            <Descriptions.Item label="气血">{stats.hp || 0}</Descriptions.Item>
            <Descriptions.Item label="攻击">{stats.attack || 0}</Descriptions.Item>
          </Descriptions>
        </Card>
      </Space>

      <Drawer
        open={Boolean(activePanel)}
        onClose={() => setActivePanel(null)}
        title={activeTitle}
        placement={isDesktop ? "right" : "bottom"}
        height={isDesktop ? undefined : "82vh"}
        width={isDesktop ? 520 : undefined}
        styles={{
          body: {
            paddingBottom: 24,
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
          },
        }}
      >
        {activePanel === "identity" ? (
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="出身">{npc.originType || "未知"}</Descriptions.Item>
            <Descriptions.Item label="职业">{npc.profession || "散修"}</Descriptions.Item>
            <Descriptions.Item label="阵营">{npc.faction || "无门散人"}</Descriptions.Item>
            <Descriptions.Item label="命格摘要">{fateSummary.title}</Descriptions.Item>
            <Descriptions.Item label="气机观感">{fateSummary.description}</Descriptions.Item>
            <Descriptions.Item label="位置">{npc.currentMapName}（{npc.positionX}, {npc.positionY}）</Descriptions.Item>
          </Descriptions>
        ) : null}
        {activePanel === "growth" ? (
          <ScrollableContent maxHeight="min(36vh, 240px)" style={drawerScrollStyle}>
            <Paragraph style={{ color: "#c7cdd8", marginBottom: 0 }}>{growthSummary.pathName} · {growthSummary.stageLabel} · {growthSummary.dominantActionLabel}。{growthSummary.nextBreakthroughHint}</Paragraph>
          </ScrollableContent>
        ) : null}
        {activePanel === "threat" ? (
          <ScrollableContent maxHeight="min(36vh, 240px)" style={drawerScrollStyle}>
            <Paragraph style={{ color: "#c7cdd8", marginBottom: 0 }}>{threatSummary.description} 当前状态：{threatSummary.label}，是否针对你：{threatSummary.isTargetingViewer ? "是" : "否"}。</Paragraph>
          </ScrollableContent>
        ) : null}
        {activePanel === "relation" ? (
          <ScrollableContent maxHeight="min(58vh, 520px)" style={drawerScrollStyle}>
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              {reputationReaction ? (
                <Card size="small" title={`你在他眼中的名声 · ${reputationReaction.label}`}>
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                    <Text style={wrappedTextStyle}>{reputationReaction.description}</Text>
                    {reputationSummary ? (
                      <Text type="secondary" style={wrappedTextStyle}>
                        {reputationSummary.overallLabel}：{reputationSummary.overallSummary}
                      </Text>
                    ) : null}
                    <List
                      size="small"
                      dataSource={reputationReaction.worldReactionHints}
                      locale={{ emptyText: "眼下还没有更多额外反应。" }}
                      renderItem={(item) => <List.Item style={wrappedTextStyle}>{item}</List.Item>}
                    />
                    {relationshipRepairHints.length > 0 ? (
                      <>
                        <Text strong style={wrappedTextStyle}>若想缓和关系</Text>
                        <List
                          size="small"
                          dataSource={relationshipRepairHints}
                          renderItem={(item) => <List.Item style={wrappedTextStyle}>{item}</List.Item>}
                        />
                        <Space wrap>
                          <Button size="small" type="primary" onClick={() => router.push("/game/quests")}>
                            查看世界委托
                          </Button>
                          <Button size="small" onClick={() => router.push("/game/map")}>
                            回地图找任务
                          </Button>
                        </Space>
                        <Text type="secondary" style={wrappedTextStyle}>
                          若地图里已经刷出传话、送礼、双修或探宝关系任务，可以先回任务页和地图情报里继续处理。
                        </Text>
                      </>
                    ) : null}
                  </Space>
                </Card>
              ) : null}
              {factionHints ? (
                <Card size="small" title="势力气息">
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                    <Text>{factionHints.surfaceFaction}</Text>
                    <Text type="secondary" style={wrappedTextStyle}>{factionHints.stanceLabel}</Text>
                    <Text type="secondary" style={wrappedTextStyle}>{factionHints.hazeLabel}</Text>
                    <List
                      size="small"
                      dataSource={factionHints.hints}
                      locale={{ emptyText: "暂时看不出更多势力外露痕迹。" }}
                      renderItem={(item) => <List.Item>{item}</List.Item>}
                    />
                  </Space>
                </Card>
              ) : null}
              <Card size="small" title={relationSummary.label}>
                <List
                  dataSource={relationSummary.hints}
                  locale={{ emptyText: relationSummary.description }}
                  renderItem={(item) => <List.Item>{item}</List.Item>}
                />
              </Card>
              <Card size="small" title="卷入故事链">
                <List
                  dataSource={involvedStorylines}
                  locale={{ emptyText: "此人暂时还没有卷进更明显的街区故事链。" }}
                  renderItem={(item) => (
                    <List.Item>
                      <List.Item.Meta
                        title={`${item.storylineTypeLabel} · ${item.stageLabel}`}
                        description={`${item.districtName} · ${item.sourceFactionName} · ${item.summary}`}
                      />
                    </List.Item>
                  )}
                />
              </Card>
            </Space>
          </ScrollableContent>
        ) : null}
        {activePanel === "inventory" ? (
          <ScrollableContent maxHeight="min(56vh, 460px)" style={drawerScrollStyle}>
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Paragraph style={{ color: "#9aa7bd" }}>{inventoryProbe.description}</Paragraph>
              <List
                dataSource={inventory}
                locale={{ emptyText: inventoryProbe.mode === "blocked" ? "此人气机遮掩较深，暂时无法看穿行囊。" : "此人当前行囊空空。" }}
                renderItem={(item) => (
                  <List.Item>
                    <Space style={{ width: "100%", justifyContent: "space-between" }}>
                      <Space>
                        <PlayerAvatar size={28} avatarImageUrl={item.itemIconUrl} fallbackText={(item.itemCategoryLabel || item.itemName || "囊").slice(0, 1)} />
                        <span>{item.itemName}</span>
                      </Space>
                      <Text>{item.quantityLabel || (item.isLootable ? "疑似可夺" : "数量难辨")}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            </Space>
          </ScrollableContent>
        ) : null}
        {activePanel === "adult" ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {adultIntent?.actionCooldown.isCoolingDown ? (
              <Card
                size="small"
                style={{
                  borderColor: "rgba(214, 178, 100, 0.32)",
                  background: "rgba(214, 178, 100, 0.08)",
                }}
              >
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  <Text strong style={wrappedTextStyle}>你的心神还未平复</Text>
                  <Text style={wrappedTextStyle}>{adultIntent.actionCooldown.hint}</Text>
                  <Text type="secondary" style={wrappedTextStyle}>
                    可在这里查看恢复时间：{formatDateTime(adultIntent.actionCooldown.cooldownUntil)}
                  </Text>
                </Space>
              </Card>
            ) : null}
            {adultIntent?.pendingInvite ? (
              <Card size="small" title={`待回应 · ${adultIntent.pendingInvite.actionLabel}`}>
                <ScrollableContent maxHeight="min(44vh, 340px)" style={drawerScrollStyle}>
                  <Paragraph style={{ marginBottom: 8, ...wrappedTextStyle }}>{adultIntent.pendingInvite.title}</Paragraph>
                  <Paragraph style={{ marginBottom: 8, color: "#c7cdd8", ...invitePreviewTextStyle }}>{adultIntent.pendingInvite.summary}</Paragraph>
                  <Paragraph style={{ marginBottom: 8, color: "#9aa7bd", ...invitePreviewTextStyle }}>{adultIntent.pendingInvite.atmosphere}</Paragraph>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: isDesktop ? "repeat(4, minmax(0, max-content))" : "repeat(2, minmax(0, 1fr))",
                    gap: 8,
                  }}>
                    <Button onClick={() => setAdultInviteDetailOpen(true)}>查看全文</Button>
                    {inviteSupportsResponse(adultIntent.pendingInvite, "接受") ? (
                      <Button type="primary" loading={adultActionLoadingKey === "resolve:accept"} onClick={() => void handleAdultResolve("accept")}>接受</Button>
                    ) : null}
                    {inviteSupportsResponse(adultIntent.pendingInvite, "婉拒") ? (
                      <Button loading={adultActionLoadingKey === "resolve:reject"} onClick={() => void handleAdultResolve("reject")}>拒绝</Button>
                    ) : null}
                    {inviteSupportsResponse(adultIntent.pendingInvite, "反向诱导") ? (
                      <Button danger ghost loading={adultActionLoadingKey === "resolve:counter_drain"} onClick={() => void handleAdultResolve("counter_drain")}>反向诱导</Button>
                    ) : null}
                    {inviteSupportsResponse(adultIntent.pendingInvite, "无视") ? (
                      <Button type="dashed" loading={adultActionLoadingKey === "resolve:ignore"} onClick={() => void handleAdultResolve("ignore")}>无视</Button>
                    ) : null}
                  </div>
                </ScrollableContent>
              </Card>
            ) : null}
            <Collapse
              ghost
              size="small"
              defaultActiveKey={defaultAdultCollapseKeys}
              items={adultCollapseItems}
            />
            {adultHistoryLoading ? <Spin size="small" /> : null}
          </Space>
        ) : null}
        {activePanel === "logs" ? (
          <ScrollableContent maxHeight="min(58vh, 520px)" style={drawerScrollStyle}>
            <List
              dataSource={lifeLogs}
              locale={{ emptyText: "此人暂时还没有更多记录。" }}
              renderItem={(item) => {
                const playerName = String(item.payloadJson?.playerName || "").trim();
                return (
                  <List.Item>
                    <List.Item.Meta
                      title={playerName ? `${item.title} · ${playerName}` : item.title}
                      description={`${item.content} · ${formatDateTime(item.createdAt)}`}
                    />
                  </List.Item>
                );
              }}
            />
          </ScrollableContent>
        ) : null}
      </Drawer>
      <Modal
        title={data?.adultIntent?.pendingInvite ? `待回应 · ${data.adultIntent.pendingInvite.actionLabel}` : "待回应来信"}
        open={adultInviteDetailOpen && Boolean(data?.adultIntent?.pendingInvite)}
        onCancel={() => setAdultInviteDetailOpen(false)}
        width="min(560px, calc(100vw - 24px))"
        footer={data?.adultIntent?.pendingInvite ? [
          <Button key="adult-detail-close" onClick={() => setAdultInviteDetailOpen(false)}>收起</Button>,
          inviteSupportsResponse(data.adultIntent.pendingInvite, "无视") ? (
            <Button key="adult-detail-ignore" type="dashed" loading={adultActionLoadingKey === "resolve:ignore"} onClick={() => void handleAdultResolve("ignore")}>无视</Button>
          ) : null,
          inviteSupportsResponse(data.adultIntent.pendingInvite, "反向诱导") ? (
            <Button key="adult-detail-counter" danger ghost loading={adultActionLoadingKey === "resolve:counter_drain"} onClick={() => void handleAdultResolve("counter_drain")}>反向诱导</Button>
          ) : null,
          inviteSupportsResponse(data.adultIntent.pendingInvite, "婉拒") ? (
            <Button key="adult-detail-reject" loading={adultActionLoadingKey === "resolve:reject"} onClick={() => void handleAdultResolve("reject")}>拒绝</Button>
          ) : null,
          inviteSupportsResponse(data.adultIntent.pendingInvite, "接受") ? (
            <Button key="adult-detail-accept" type="primary" loading={adultActionLoadingKey === "resolve:accept"} onClick={() => void handleAdultResolve("accept")}>接受</Button>
          ) : null,
        ] : null}
      >
        {data?.adultIntent?.pendingInvite ? (
          <ScrollableContent maxHeight="min(62vh, 560px)" style={drawerScrollStyle}>
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Space size={6} wrap>
                <Tag color="magenta">{data.adultIntent.pendingInvite.actionLabel}</Tag>
                <Tag>{data.adultIntent.pendingInvite.dispositionLabel}</Tag>
                <Text type="secondary">截止 {formatDateTime(data.adultIntent.pendingInvite.expiresAt)}</Text>
              </Space>
              <Card size="small" styles={{ body: { padding: 12 } }}>
                <Text style={{ ...wrappedTextStyle, color: "#eaf0ff" }}>{data.adultIntent.pendingInvite.title}</Text>
              </Card>
              <Card size="small" styles={{ body: { padding: 12 } }}>
                <Text style={{ ...wrappedTextStyle, color: "#c7cdd8" }}>{data.adultIntent.pendingInvite.summary}</Text>
              </Card>
              <Card size="small" styles={{ body: { padding: 12 } }}>
                <Text style={{ ...wrappedTextStyle, color: "#9aa7bd" }}>{data.adultIntent.pendingInvite.atmosphere}</Text>
              </Card>
            </Space>
          </ScrollableContent>
        ) : null}
      </Modal>
    </div>
  );
}

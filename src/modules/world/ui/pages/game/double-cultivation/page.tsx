"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Alert, Button, Card, Drawer, Input, List, Space, Spin, Tag, Typography } from "antd";
import DoubleCultivationCoreStatusVisuals from "@/modules/world/ui/components/DoubleCultivationCoreStatusVisuals";
import type { PlayerStatusView } from "@/types/game";
import styles from "@/modules/world/ui/pages/game/double-cultivation/DoubleCultivationCorePage.module.css";

const { Paragraph, Text, Title } = Typography;

type DoubleCultivationPendingItem = {
  id: number;
  targetPlayerId?: string;
  targetPlayerName?: string;
  targetRealmName?: string;
  targetGender?: string | null;
  createdAt?: string;
  requestedBy?: string;
};

type DoubleCultivationHistoryItem = {
  id: number;
  requestId?: number | null;
  partnerPlayerId?: string | null;
  partnerPlayerName?: string;
  targetKind?: string;
  targetMonsterId?: string | null;
  isInitiator?: boolean;
  myPercent?: number;
  partnerPercent?: number;
  myXpGain?: number;
  partnerXpGain?: number;
  myFluidMl?: number;
  partnerFluidMl?: number;
  myIntimacyDelta?: number;
  partnerIntimacyDelta?: number;
  myIntimacyLevelBefore?: number;
  partnerIntimacyLevelBefore?: number;
  myEventCountAfter?: number;
  myIntimacyScoreAfter?: number;
  myIntimacyLevelAfter?: number;
  narrative?: string;
  dateKey?: string;
  createdAt?: string;
};

type DoubleCultivationOverview = {
  incomingPending?: DoubleCultivationPendingItem[];
  outgoingPending?: DoubleCultivationPendingItem[];
  latestProcessed?: Array<Record<string, unknown>>;
  daily?: {
    dateKey?: string;
    usedCount?: number;
    nextPercent?: number;
    positiveGainTotal?: number;
    gainCap?: number;
    remainingGainCap?: number;
  };
  history?: DoubleCultivationHistoryItem[];
};

type DoubleCultivationStats = {
  metrics?: {
    eventCount?: number;
    fluidMlTotal?: number;
    intimacyScore?: number;
    intimacyLevel?: number;
  };
  adultProfile?: {
    corruptionValue?: number;
    allureValue?: number;
    shameValue?: number;
    stageLabel?: string;
  };
  labels?: Record<string, string>;
  units?: Record<string, string>;
  firstPartnerName?: string;
  mostPartnerName?: string;
  lastTime?: string | null;
  gender?: string | null;
  spermStorageMl?: number | null;
  spermRecoveryRemainingSeconds?: number | null;
  uterusStorageMl?: number | null;
  uterusCapacityMl?: number | null;
  uterusDigestUnlocked?: boolean;
  uterusDigestSecondsPerMl?: number | null;
  uterusDigestRemainingSeconds?: number | null;
  uterusNextDigestAt?: string | null;
  pregnancyStatus?: PlayerStatusView | null;
  pregnancyDisplayStatus?: PlayerStatusView | null;
  gongfaBonuses?: {
    xpBonusPct?: number;
    intimacyBonus?: number;
    maleEjaculationPct?: number;
    femaleSqueezePct?: number;
    maleSpermCapacityPct?: number;
    maleSpermRegenPct?: number;
    uterusDigestEfficiencyPct?: number;
    uterusDigestSecondsReduce?: number;
    maleDualAbsorbPct?: number;
    sexMaxUnlocked?: boolean;
  } | null;
};

const PREGNANCY_STAGE_LABELS: Record<string, string> = {
  pregnancy: "受孕中",
  fertilized_1: "受孕初期",
  fertilized_2: "受孕稳定",
  fertilized_3: "胚胎成长",
  fertilized_4: "孕育中期",
  fertilized_5: "孕育后期",
  fertilized_6: "即将成熟",
  fertilized_7: "即将分娩",
};

function isMaleGender(gender?: string | null) {
  return String(gender || "").trim() === "男";
}

function formatCultivationGender(gender?: string | null) {
  return isMaleGender(gender) ? "男修" : "女修";
}

function getDirectMetricLabels(gender?: string | null) {
  if (isMaleGender(gender)) {
    return {
      eventCount: "双修次数",
      fluidMlTotal: "累计射精量",
      intimacyScore: "Sex值",
      intimacyLevel: "Sex等级",
      storage: "当前精液",
      historyFluid: "射精",
    };
  }
  return {
    eventCount: "双修次数",
    fluidMlTotal: "累计纳精量",
    intimacyScore: "淫乱度",
    intimacyLevel: "淫乱等级",
    storage: "子宫留精",
    historyFluid: "留精",
  };
}

function buildDoubleCultivationApiUrl(action: string) {
  return `/api/game/double-cultivation/${action}`;
}

function formatDateTime(value?: string | null) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    return "暂无";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(parsed));
}

function buildStorageText(stats: DoubleCultivationStats | null) {
  if (!stats) {
    return "暂无";
  }
  if (typeof stats.spermStorageMl === "number") {
    return `${stats.spermStorageMl} ml`;
  }
  if (typeof stats.uterusStorageMl === "number") {
    return `${stats.uterusStorageMl} / ${Math.max(1, Number(stats.uterusCapacityMl || 120))} ml`;
  }
  return "暂无";
}

function buildStorageLabel(stats: DoubleCultivationStats | null) {
  return getDirectMetricLabels(stats?.gender).storage;
}

function buildMetricLabel(rawLabel: string | undefined, key: string, gender?: string | null) {
  const labels = getDirectMetricLabels(gender);
  if (key === "fluidMlTotal") {
    return labels.fluidMlTotal;
  }
  if (key === "intimacyScore") {
    return labels.intimacyScore;
  }
  if (key === "intimacyLevel") {
    return labels.intimacyLevel;
  }
  if (key === "eventCount") {
    return labels.eventCount;
  }
  const normalized = String(rawLabel || "").trim();
  return normalized || key;
}

function resolvePregnancyStageLabel(status?: PlayerStatusView | null) {
  const title = String(status?.stageTitle || status?.title || "").trim();
  if (title) {
    return title;
  }
  const stageKey = String(status?.stageKey || "").trim();
  if (stageKey && PREGNANCY_STAGE_LABELS[stageKey]) {
    return PREGNANCY_STAGE_LABELS[stageKey];
  }
  const statusKey = String(status?.statusKey || "").trim();
  if (statusKey && PREGNANCY_STAGE_LABELS[statusKey]) {
    return PREGNANCY_STAGE_LABELS[statusKey];
  }
  return "暂无";
}

function resolveHistoryTargetLabel(targetKind?: string | null) {
  if (targetKind === "world_npc") {
    return "NPC";
  }
  if (targetKind === "monster") {
    return "异类";
  }
  return "同修";
}

function resolveHistorySceneLabel(targetKind?: string | null) {
  if (targetKind === "world_npc") {
    return "开放世界";
  }
  if (targetKind === "monster") {
    return "奇遇";
  }
  return "洞府";
}

type DrawerView = "invites" | "ledger" | "history" | null;

async function readDoubleCultivationJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    cache: "no-store",
    ...init,
  });
  const json = await response.json();
  if (!response.ok || !json?.success) {
    throw new Error(json?.error || "双修接口请求失败");
  }
  return json.data as T;
}

async function loadDoubleCultivationPageData() {
  const [overview, stats] = await Promise.all([
    readDoubleCultivationJson<DoubleCultivationOverview>(buildDoubleCultivationApiUrl("overview")),
    readDoubleCultivationJson<DoubleCultivationStats>(buildDoubleCultivationApiUrl("stats")),
  ]);
  return { overview, stats };
}

export default function DoubleCultivationCorePage() {
  const [overview, setOverview] = useState<DoubleCultivationOverview | null>(null);
  const [stats, setStats] = useState<DoubleCultivationStats | null>(null);
  const [targetInput, setTargetInput] = useState("");
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingRequestId, setPendingRequestId] = useState<number | null>(null);
  const [statsLoadedAtMs, setStatsLoadedAtMs] = useState(() => Date.now());
  const [drawerView, setDrawerView] = useState<DrawerView>(null);
  const [isCompactScreen, setIsCompactScreen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const historyItems = overview?.history || [];
  const incomingItems = overview?.incomingPending || [];
  const outgoingItems = overview?.outgoingPending || [];

  const statCards = useMemo(() => {
    const metrics = stats?.metrics || {};
    const adultProfile = stats?.adultProfile || {};
    return [
      {
        key: "eventCount",
        label: buildMetricLabel(stats?.labels?.eventCount, "eventCount", stats?.gender),
        value: Number(metrics.eventCount || 0),
        suffix: stats?.units?.eventCount || "次",
      },
      {
        key: "fluidMlTotal",
        label: buildMetricLabel(stats?.labels?.fluidMlTotal, "fluidMlTotal", stats?.gender),
        value: Number(metrics.fluidMlTotal || 0),
        suffix: stats?.units?.fluidMlTotal || "ml",
      },
      {
        key: "intimacyScore",
        label: buildMetricLabel(stats?.labels?.intimacyScore, "intimacyScore", stats?.gender),
        value: Number(metrics.intimacyScore || 0),
        suffix: stats?.units?.intimacyScore || "",
      },
      {
        key: "intimacyLevel",
        label: buildMetricLabel(stats?.labels?.intimacyLevel, "intimacyLevel", stats?.gender),
        value: Number(metrics.intimacyLevel || 0),
        suffix: stats?.units?.intimacyLevel || "级",
      },
      {
        key: "corruption",
        label: "堕落值",
        value: Number(adultProfile.corruptionValue || 0),
        suffix: "",
      },
      {
        key: "allure",
        label: "魅力值",
        value: Number(adultProfile.allureValue || 0),
        suffix: "",
      },
    ];
  }, [stats]);

  const loadAll = async () => {
    setLoading(true);
    setErrorText("");
    try {
      const { overview: nextOverview, stats: nextStats } = await loadDoubleCultivationPageData();
      setOverview(nextOverview);
      setStats(nextStats);
      setStatsLoadedAtMs(Date.now());
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "双修页面加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorText("");
    void (async () => {
      try {
        const { overview: nextOverview, stats: nextStats } = await loadDoubleCultivationPageData();
        if (cancelled) {
          return;
        }
        setOverview(nextOverview);
        setStats(nextStats);
        setStatsLoadedAtMs(Date.now());
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : "双修页面加载失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const syncScreen = () => {
      setIsCompactScreen(window.innerWidth <= 640);
    };
    syncScreen();
    window.addEventListener("resize", syncScreen);
    return () => {
      window.removeEventListener("resize", syncScreen);
    };
  }, []);

  const refreshData = () => {
    startTransition(() => {
      setSuccessText("");
      void loadAll();
    });
  };

  const handleSendRequest = async () => {
    const target = targetInput.trim();
    if (!target) {
      setErrorText("请输入目标玩家道号或 ID");
      return;
    }
    setErrorText("");
    setSuccessText("");
    try {
      await readDoubleCultivationJson(buildDoubleCultivationApiUrl("request"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          targetPlayerId: target,
          targetName: target,
        }),
      });
      setTargetInput("");
      setSuccessText("双修申请已发出");
      await loadAll();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "发起双修申请失败");
    }
  };

  const handleRespond = async (requestId: number, action: "accept" | "reject") => {
    setPendingRequestId(requestId);
    setErrorText("");
    setSuccessText("");
    try {
      await readDoubleCultivationJson(buildDoubleCultivationApiUrl("respond"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId,
          action,
        }),
      });
      setSuccessText(action === "accept" ? "已同意双修申请" : "已拒绝双修申请");
      await loadAll();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "处理双修申请失败");
    } finally {
      setPendingRequestId(null);
    }
  };

  const renderInviteDrawer = () => (
    <div className={styles.drawerBody}>
      <section className={styles.drawerSection}>
        <h3 className={styles.drawerTitle}>待处理申请</h3>
        <div className={styles.drawerHint}>收到的双修申请会显示在这里，你可以直接同意或拒绝。</div>
        <List
          locale={{ emptyText: <div className={styles.drawerEmpty}>当前没有待处理的双修申请。</div> }}
          dataSource={incomingItems}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button
                  key="accept"
                  type="primary"
                  size="small"
                  loading={pendingRequestId === item.id}
                  onClick={() => void handleRespond(item.id, "accept")}
                >
                  同意
                </Button>,
                <Button
                  key="reject"
                  danger
                  size="small"
                  loading={pendingRequestId === item.id}
                  onClick={() => void handleRespond(item.id, "reject")}
                >
                  拒绝
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={item.targetPlayerName || "未知修士"}
                description={`境界：${item.targetRealmName || "未知"} · 性别：${formatCultivationGender(item.targetGender)} · 时间：${formatDateTime(item.createdAt)}`}
              />
            </List.Item>
          )}
        />
      </section>

      <section className={styles.drawerSection}>
        <h3 className={styles.drawerTitle}>已发申请</h3>
        <div className={styles.drawerHint}>这里显示你已经发出的双修申请。</div>
        <List
          locale={{ emptyText: <div className={styles.drawerEmpty}>你还没有发出双修申请。</div> }}
          dataSource={outgoingItems}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                title={item.targetPlayerName || "未知修士"}
                description={`境界：${item.targetRealmName || "未知"} · 性别：${formatCultivationGender(item.targetGender)} · 时间：${formatDateTime(item.createdAt)}`}
              />
              <Tag color="processing">待回应</Tag>
            </List.Item>
          )}
        />
      </section>
    </div>
  );

  const renderLedgerDrawer = () => (
    <div className={styles.drawerBody}>
      <section className={styles.drawerSection}>
        <h3 className={styles.drawerTitle}>双修总览</h3>
        <div className={styles.drawerHint}>这里显示今日次数、倍率、修为上限、当前精液或留精，以及最近双修时间。</div>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>今日次数</div>
            <div className={styles.summaryValue}>{Number(overview?.daily?.usedCount || 0)} 次</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>下一轮倍率</div>
            <div className={styles.summaryValue}>{Number(overview?.daily?.nextPercent || 0)}%</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>今日修为上限</div>
            <div className={styles.summaryValue}>{Number(overview?.daily?.gainCap || 0)}</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>剩余可得修为</div>
            <div className={styles.summaryValue}>{Number(overview?.daily?.remainingGainCap || 0)}</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>{buildStorageLabel(stats)}</div>
            <div className={styles.summaryValue}>{buildStorageText(stats)}</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>最近双修时间</div>
            <div className={styles.summaryValue}>{formatDateTime(stats?.lastTime)}</div>
          </div>
        </div>
      </section>

      <section className={styles.drawerSection}>
        <h3 className={styles.drawerTitle}>Sex状态</h3>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>首次双修对象</div>
            <div className={styles.summaryValue}>{stats?.firstPartnerName || "暂无"}</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>最常双修对象</div>
            <div className={styles.summaryValue}>{stats?.mostPartnerName || "暂无"}</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>堕落阶段</div>
            <div className={styles.summaryValue}>{stats?.adultProfile?.stageLabel || "暂无"}</div>
          </div>
          {!isMaleGender(stats?.gender) ? (
            <div className={styles.summaryItem}>
              <div className={styles.summaryLabel}>受孕阶段</div>
              <div className={styles.summaryValue}>{resolvePregnancyStageLabel(stats?.pregnancyDisplayStatus)}</div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );

  const renderHistoryDrawer = () => (
    <div className={styles.drawerBody}>
      <section className={styles.drawerSection}>
        <h3 className={styles.drawerTitle}>双修记录</h3>
        <List
          locale={{ emptyText: <div className={styles.drawerEmpty}>暂无双修记录。</div> }}
          dataSource={historyItems}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                title={(
                  <Space size={8} wrap>
                    <span>{item.partnerPlayerName || "未知对象"}</span>
                    <Tag color={item.targetKind === "world_npc" ? "magenta" : item.targetKind === "monster" ? "volcano" : "purple"}>
                      {resolveHistoryTargetLabel(item.targetKind)}
                    </Tag>
                  </Space>
                )}
                description={(
                  <div className={styles.historyMeta}>
                    <Text type="secondary">
                      {formatDateTime(item.createdAt)} · {resolveHistorySceneLabel(item.targetKind)}
                    </Text>
                    <Text>
                      倍率 {Number(item.myPercent || 0)}% · 修为 {Number(item.myXpGain || 0)} · {getDirectMetricLabels(stats?.gender).historyFluid} {Number(item.myFluidMl || 0)} ml
                    </Text>
                    <Text>
                      {getDirectMetricLabels(stats?.gender).intimacyScore} +{Number(item.myIntimacyDelta || 0)} · 累计 {Number(item.myIntimacyScoreAfter || 0)}
                    </Text>
                    {item.narrative ? <Paragraph className={styles.historyNarrative}>{item.narrative}</Paragraph> : null}
                  </div>
                )}
              />
            </List.Item>
          )}
        />
      </section>
    </div>
  );

  const drawerTitle = drawerView === "invites"
    ? "双修申请"
    : drawerView === "ledger"
      ? "双修总览"
      : drawerView === "history"
        ? "双修记录"
        : "";
  const drawerSubtitle = drawerView === "invites"
    ? "处理收到的申请，也能查看自己已经发出的申请。"
    : drawerView === "ledger"
      ? "这里集中显示今日次数、修为收益上限、精液或留精状态。"
    : drawerView === "history"
        ? "玩家、NPC 和异类来源的双修记录都会记在这里。"
        : "";

  return (
    <div className={styles.page}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Card className={styles.heroCard} styles={{ body: { padding: 18 } }}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <div className={styles.heroHeader}>
              <div>
                <div className={styles.eyebrow}>双修页面</div>
                <Title level={2} className={styles.heroTitle}>双修</Title>
                <Paragraph className={styles.heroCopy}>
                  在这里发送双修申请，查看Sex状态、今日次数和历史记录。
                </Paragraph>
              </div>
              <div className={styles.heroActions}>
                <Button className={styles.pillButton} onClick={() => setDrawerView("invites")}>邀请记录</Button>
                <Button className={styles.pillButton} onClick={() => setDrawerView("ledger")}>双修信息</Button>
                <Button className={styles.pillButton} onClick={() => setDrawerView("history")}>双修记录</Button>
                <Button className={styles.pillButton} onClick={refreshData} loading={isPending || loading}>刷新</Button>
              </div>
            </div>

            {errorText ? <Alert type="error" showIcon message={errorText} /> : null}
            {successText ? <Alert type="success" showIcon message={successText} /> : null}

            <div className={styles.inputRow}>
              <Input
                value={targetInput}
                onChange={(event) => setTargetInput(event.target.value)}
                placeholder="输入对方名字或角色 ID"
                onPressEnter={() => {
                  void handleSendRequest();
                }}
              />
              <Button type="primary" onClick={() => void handleSendRequest()} block>
                发送申请
              </Button>
            </div>

            <div className={styles.statGrid}>
              {statCards.map((item) => (
                <Card key={item.key} size="small" className={styles.statTile}>
                  <div className={styles.statLabel}>{item.label}</div>
                  <div className={styles.statValue}>
                    {item.value}
                    {item.suffix ? <span className={styles.statSuffix}>{item.suffix}</span> : null}
                  </div>
                </Card>
              ))}
            </div>

            <DoubleCultivationCoreStatusVisuals
              stats={stats}
              loadedAtMs={statsLoadedAtMs}
            />

            <Card size="small" className={styles.sectionCard}>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryItem}>
                  <div className={styles.summaryLabel}>今日次数</div>
                  <div className={styles.summaryValue}>{Number(overview?.daily?.usedCount || 0)} 次</div>
                </div>
                <div className={styles.summaryItem}>
                  <div className={styles.summaryLabel}>下一轮倍率</div>
                  <div className={styles.summaryValue}>{Number(overview?.daily?.nextPercent || 0)}%</div>
                </div>
                <div className={styles.summaryItem}>
                  <div className={styles.summaryLabel}>{buildStorageLabel(stats)}</div>
                  <div className={styles.summaryValue}>{buildStorageText(stats)}</div>
                </div>
                <div className={styles.summaryItem}>
                  <div className={styles.summaryLabel}>堕落阶段</div>
                  <div className={styles.summaryValue}>{stats?.adultProfile?.stageLabel || "暂无"}</div>
                </div>
              </div>
            </Card>
          </Space>
        </Card>
      </Space>

      <Drawer
        open={drawerView !== null}
        onClose={() => setDrawerView(null)}
        title={(
          <div className={styles.drawerChrome}>
            <div className={styles.drawerEyebrow}>双修页面</div>
            <div className={styles.drawerHeading}>{drawerTitle}</div>
            <div className={styles.drawerSubheading}>{drawerSubtitle}</div>
          </div>
        )}
        placement={isCompactScreen ? "bottom" : "right"}
        width={isCompactScreen ? undefined : Math.min(typeof window === "undefined" ? 620 : window.innerWidth - 16, 620)}
        height={isCompactScreen ? Math.min(typeof window === "undefined" ? 720 : window.innerHeight - 10, 720) : undefined}
        rootClassName={styles.luxuryDrawer}
        destroyOnClose={false}
      >
        {loading && !overview ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}><Spin /></div>
        ) : null}
        {!loading && drawerView === "invites" ? renderInviteDrawer() : null}
        {!loading && drawerView === "ledger" ? renderLedgerDrawer() : null}
        {!loading && drawerView === "history" ? renderHistoryDrawer() : null}
      </Drawer>
    </div>
  );
}

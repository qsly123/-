"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, Modal, Progress, Spin, Typography, message } from "antd";
import {
  ThunderboltOutlined,
  ClockCircleOutlined,
  FireOutlined,
  RiseOutlined,
  HeartOutlined,
  FieldTimeOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import ItemBadge from "@/modules/shared/ui/components/ItemBadge";
import NotificationDot from "@/modules/shared/ui/components/NotificationDot";
import { useGameNotifications } from "@/modules/shared/ui/contexts/GameNotificationContext";
import { useResolvedAssetUrl } from "@/modules/shared/ui/hooks/useResolvedAssetUrl";
import {
  buildCultivationActionButtonStyle,
  buildCultivationRevealStyle,
  cultivationHeroCardStyle,
  cultivationPageShellStyle,
  cultivationSectionCardStyle,
  cultivationSoftPanelStyle,
} from "@/modules/shared/ui/utils/cultivation-page-theme";

const { Text } = Typography;

interface InventoryItemEffect {
  type?: string;
  value?: number;
}

interface QuickBreakthroughItem {
  itemId: string;
  name: string;
  iconUrl?: string | null;
  quantity: number;
  boostRate: number;
}

/** 逆天改命：突破成功后三选一的天机词条。 */
interface ReversalOption {
  id: string;
  name: string;
  description: string | null;
  grade: string;
  durationSeconds: number;
  /** 已拥有该永久天机：再选一次不重复获得，而是精进（属性追加）。 */
  owned?: boolean;
}

const REVERSAL_GRADE_STYLE: Record<string, { label: string; color: string; border: string }> = {
  red: { label: "红色", color: "#c0392b", border: "rgba(192,57,43,0.45)" },
  gold: { label: "金色", color: "#b8860b", border: "rgba(184,134,11,0.45)" },
  purple: { label: "紫色", color: "#7d3c98", border: "rgba(125,60,152,0.45)" },
  blue: { label: "蓝色", color: "#2e86c1", border: "rgba(46,134,193,0.45)" },
  white: { label: "白色", color: "#7f7f7f", border: "rgba(127,127,127,0.35)" },
};

function resolveReversalGrade(grade: string) {
  return REVERSAL_GRADE_STYLE[grade] || REVERSAL_GRADE_STYLE.white;
}

/** 三层抉择的文案：道途（筑基）→ 流派（结丹）→ 道心（元婴）。 */
const TALENT_KIND_TITLE: Record<string, string> = {
  direction: "道途抉择",
  path: "流派抉择",
  daoxin: "道心抉择",
};
const TALENT_KIND_INTRO: Record<string, string> = {
  direction: "筑基之际道途两分：斗战主攻伐，长生主性命。此择决定日后可入何派。",
  path: "结丹之际流派当立，此择不可更改。",
  daoxin: "元婴之际道心当明。同门同源，走法却从此不同——此择不可更改。",
};
const TALENT_KIND_CHOOSE_LABEL: Record<string, string> = {
  direction: "择此道途",
  path: "择此流派",
  daoxin: "择此道心",
};

/** 流派抉择候选（方向 / 流派 / 道心）。 */
interface TalentOptionView {
  key: string;
  name: string;
  kind: string;
  parentKey: string | null;
  description: string | null;
  unlockMajor: number;
  currentPercent: Record<string, number>;
}

const TALENT_STAT_LABELS: Record<string, string> = {
  attack: "攻击",
  maxHp: "气血",
  maxMp: "法力",
  defense: "防御",
  speed: "速度",
  luck: "幸运",
  spiritualSense: "神识",
  armorPenetration: "穿透",
  block: "格挡",
  skillDamageBonus: "技能增伤",
  skillDamageReduction: "技能减伤",
  artifactDamageBonus: "法宝增伤",
  artifactDamageReduction: "法宝减伤",
};

interface DongfuData {
  playerName?: string;
  gender?: string | null;
  realmName?: string;
  cultivationXp: number;
  breakthroughRequiredXp: number;
  breakthroughBaseRate: number;
  breakthroughBonusRate: number;
  breakthroughSuccessRate: number;
  baseDongfuRatioPerHour: number;
  dongfuRatioPerHour: number;
  fortuneDongfuLingqiRate: number;
  sectDongfuLingqiRate?: number;
  gongfaDongfuLingqiBonusPercent: number;
  dongfuLingqiBonusRate: number;
  dongfuLingqiBonusSources?: string[];
  dongfuCapHours: number;
  dongfuRatePerHourXp: number;
  dongfuAccumulatedMs: number;
  dongfuPendingXp: number;
  dongfuLastClaimAt: string;
  pillToxicity: number;
  pillToxicityLimit: number;
  pillToxicityRecoverIntervalMinutes: number;
  nextPillToxicityRecoverInSeconds: number | null;
}

function formatRatePercent(rate: number) {
  const percent = rate * 100;
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`;
}

function parseBreakthroughBoostRate(effects: unknown): number {
  if (!Array.isArray(effects)) {
    return 0;
  }

  let total = 0;
  for (const effect of effects) {
    if (!effect || typeof effect !== "object") {
      continue;
    }
    const typed = effect as InventoryItemEffect;
    if (typed.type !== "boost_breakthrough") {
      continue;
    }
    const value = Number(typed.value || 0);
    if (value > 0) {
      total += value;
    }
  }
  return total;
}

function formatAccumulatedTime(ms: number) {
  const safeMs = Math.max(0, Math.floor(ms || 0));
  const totalMinutes = Math.floor(safeMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}小时${minutes}分钟`;
  }
  return `${minutes}分钟`;
}

function resolveMeditationImageByGender(gender: string | null | undefined) {
  if (gender === "女") {
    return "/static/female.png";
  }
  return "/static/male.png";
}

function resolveGenderLabel(gender: string | null | undefined) {
  if (gender === "女") {
    return "女修";
  }
  if (gender === "男") {
    return "男修";
  }
  return "修士";
}

export default function DongfuPage() {
  const router = useRouter();
  const { modal } = App.useApp();
  const { pluginBadgeMap } = useGameNotifications();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [claimLoading, setClaimLoading] = useState(false);
  const [breakthroughLoading, setBreakthroughLoading] = useState(false);
  const [quickUsingItemId, setQuickUsingItemId] = useState<string | null>(null);
  const [reversalOptions, setReversalOptions] = useState<ReversalOption[]>([]);
  const [reversalRealm, setReversalRealm] = useState<number>(0);
  const [reversalClaimingId, setReversalClaimingId] = useState<string | null>(null);
  /** 每次逆天改命只允许刷新一次（服务端也有限制，这里同步按钮态） */
  const [reversalRefreshUsed, setReversalRefreshUsed] = useState(false);
  const [reversalRefreshing, setReversalRefreshing] = useState(false);
  const [talentOptions, setTalentOptions] = useState<TalentOptionView[]>([]);
  const [talentChoosingKey, setTalentChoosingKey] = useState<string | null>(null);

  const fetchTalentOptions = useCallback(async (): Promise<TalentOptionView[]> => {
    try {
      const res = await fetch("/api/game/talent/options", { cache: "no-store" });
      const json = await res.json() as {
        success: boolean;
        data?: { options?: TalentOptionView[] };
      };
      if (!json.success || !json.data?.options) {
        return [];
      }
      return json.data.options;
    } catch {
      return [];
    }
  }, []);
  const [dongfu, setDongfu] = useState<DongfuData | null>(null);
  const [quickBreakthroughItems, setQuickBreakthroughItems] = useState<QuickBreakthroughItem[]>([]);
  const doubleCultivationBadgeCount = Number(pluginBadgeMap["double-cultivation"] || 0);
  const meditateImageSrc = resolveMeditationImageByGender(dongfu?.gender);
  const resolvedMeditateImageSrc = useResolvedAssetUrl(meditateImageSrc);

  const fetchDongfu = useCallback(async () => {
    const res = await fetch("/api/game/dongfu", { cache: "no-store" });
    const json = await res.json() as { success: boolean; error?: string; data?: DongfuData };
    if (!json.success || !json.data) {
      throw new Error(json.error || "获取洞府信息失败");
    }
    setDongfu(json.data);
    return json.data;
  }, []);

  const fetchQuickBreakthroughItems = useCallback(async () => {
    try {
      const res = await fetch("/api/game/inventory", { cache: "no-store" });
      const json = await res.json();
      if (!json.success || !json.data?.items || !Array.isArray(json.data.items)) {
        setQuickBreakthroughItems([]);
        return;
      }

      const list = json.data.items
        .filter((item: unknown) => item && typeof item === "object")
        .map((item: unknown) => {
          const typed = item as {
            itemId: string;
            name: string;
            iconUrl?: string | null;
            quantity: number;
            itemType?: string;
            effects?: unknown;
          };
          return {
            itemId: typed.itemId,
            name: typed.name,
            iconUrl: typeof typed.iconUrl === "string" ? typed.iconUrl : null,
            quantity: Number(typed.quantity || 0),
            itemType: typed.itemType,
            boostRate: parseBreakthroughBoostRate(typed.effects),
          };
        })
        .filter((item: {
          itemId: string;
          name: string;
          quantity: number;
          itemType?: string;
          boostRate: number;
        }) => item.itemType === "consumable" && item.quantity > 0 && item.boostRate > 0)
        .sort((a: { boostRate: number }, b: { boostRate: number }) => b.boostRate - a.boostRate)
        .map((item: {
          itemId: string;
          name: string;
          iconUrl?: string | null;
          quantity: number;
          boostRate: number;
        }) => ({
          itemId: item.itemId,
          name: item.name,
          iconUrl: item.iconUrl,
          quantity: item.quantity,
          boostRate: item.boostRate,
        }));

      setQuickBreakthroughItems(list);
    } catch {
      setQuickBreakthroughItems([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([fetchDongfu(), fetchQuickBreakthroughItems()]);
        // 若已达抉择境界却未作抉择，进洞府即提示（避免玩家错过抉择点）
        const talents = await fetchTalentOptions();
        if (!cancelled && talents.length > 0) {
          setTalentOptions(talents);
        }
      } catch (error) {
        if (!cancelled) {
          const messageText = error instanceof Error ? error.message : "加载失败";
          messageApi.error(messageText);
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
  }, [fetchDongfu, fetchQuickBreakthroughItems, fetchTalentOptions, messageApi]);

  const handleClaim = async () => {
    setClaimLoading(true);
    try {
      const res = await fetch("/api/game/dongfu/claim", { method: "POST" });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: { claimedXp?: number };
      };
      if (!json.success) {
        messageApi.error(json.error || "领取失败");
        return;
      }
      const claimedXp = Math.max(0, Math.floor(Number(json.data?.claimedXp || 0)));
      if (claimedXp > 0) {
        messageApi.success(`领取成功，修为 +${claimedXp}`);
      } else {
        messageApi.info("当前暂无可领取修为");
      }
      await fetchDongfu();
    } catch {
      messageApi.error("领取失败");
    } finally {
      setClaimLoading(false);
    }
  };

  const handleBreakthrough = async () => {
    setBreakthroughLoading(true);
    try {
      const res = await fetch("/api/game/cultivate", { method: "POST" });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: {
          success?: boolean;
          message?: string;
          newRealm?: number;
          reversalOptions?: ReversalOption[];
        };
      };
      if (!json.success || !json.data) {
        messageApi.error(json.error || "突破失败");
        return;
      }
      if (json.data.success) {
        const options = Array.isArray(json.data.reversalOptions) ? json.data.reversalOptions : [];
        if (options.length > 0) {
          // 有天机词条时改由三选一弹框承载突破结果
          setReversalOptions(options);
          setReversalRealm(Number(json.data.newRealm || 0));
          setReversalRefreshUsed(false);
        }
        // 突破可能开启新的流派抉择点；流派抉择优先于逆天改命展示
        const talents = await fetchTalentOptions();
        if (talents.length > 0) {
          setTalentOptions(talents);
        } else if (options.length === 0) {
          modal.success({ title: "突破成功", content: json.data.message });
        }
      } else {
        modal.warning({ title: "突破失败", content: json.data.message });
      }
      await Promise.all([fetchDongfu(), fetchQuickBreakthroughItems()]);
    } catch {
      messageApi.error("网络错误");
    } finally {
      setBreakthroughLoading(false);
    }
  };

  const handleClaimReversal = async (fortuneId: string) => {
    setReversalClaimingId(fortuneId);
    try {
      const res = await fetch("/api/game/breakthrough/reversal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fortuneId, realm: reversalRealm }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: { message?: string };
      };
      if (!json.success) {
        messageApi.error(json.error || "承接失败");
        return;
      }
      messageApi.success(json.data?.message || "逆天改命已成");
      setReversalOptions([]);
      await Promise.all([fetchDongfu(), fetchQuickBreakthroughItems()]);
    } catch {
      messageApi.error("网络错误");
    } finally {
      setReversalClaimingId(null);
    }
  };

  const handleChooseTalent = async (pathKey: string) => {
    setTalentChoosingKey(pathKey);
    try {
      const res = await fetch("/api/game/talent/choose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathKey }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: { message?: string };
      };
      if (!json.success) {
        messageApi.error(json.error || "抉择失败");
        return;
      }
      messageApi.success(json.data?.message || "道途已定");
      setTalentOptions([]);
      await Promise.all([fetchDongfu(), fetchQuickBreakthroughItems()]);
    } catch {
      messageApi.error("网络错误");
    } finally {
      setTalentChoosingKey(null);
    }
  };

  const handleReversalReroll = async () => {
    if (reversalRefreshUsed || reversalRefreshing || reversalRealm <= 0) return;
    setReversalRefreshing(true);
    try {
      const res = await fetch("/api/game/breakthrough/reversal/reroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ realmLinear: reversalRealm }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: { options?: ReversalOption[]; message?: string };
      };
      if (!json.success) {
        messageApi.error(json.error || "刷新失败");
        setReversalRefreshUsed(true);
        return;
      }
      if (Array.isArray(json.data?.options) && json.data.options.length > 0) {
        setReversalOptions(json.data.options);
      }
      messageApi.success(json.data?.message || "天机重演");
      setReversalRefreshUsed(true);
    } catch {
      messageApi.error("网络错误");
    } finally {
      setReversalRefreshing(false);
    }
  };

  // 放弃是不可逆的（同一境界只能领一次），故二次确认，避免误关丢失机会
  const handleReversalCancel = () => {
    modal.confirm({
      title: "放弃此番天机？",
      content: "一旦放弃，本次突破将无法再改命。",
      okText: "放弃",
      cancelText: "再想想",
      onOk: () => {
        setReversalOptions([]);
        messageApi.info("你未承接此番天机");
      },
    });
  };

  const handleQuickUseBreakthroughItem = async (item: QuickBreakthroughItem) => {
    setQuickUsingItemId(item.itemId);
    try {
      const res = await fetch("/api/game/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "use", itemId: item.itemId }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: { message?: string };
      };
      if (!json.success) {
        messageApi.error(json.error || "使用失败");
        return;
      }
      messageApi.success(json.data?.message || `使用了 ${item.name}`);
      await Promise.all([fetchDongfu(), fetchQuickBreakthroughItems()]);
    } catch {
      messageApi.error("网络错误");
    } finally {
      setQuickUsingItemId(null);
    }
  };

  const progressPercent = useMemo(() => {
    if (!dongfu) {
      return 0;
    }
    if (dongfu.breakthroughRequiredXp <= 0) {
      return 0;
    }
    return Math.min(100, Math.floor((dongfu.cultivationXp / dongfu.breakthroughRequiredXp) * 100));
  }, [dongfu]);

  if (loading) {
    return (
      <div style={{ ...cultivationPageShellStyle, display: "flex", justifyContent: "center", padding: "40px 8px" }}>
        {contextHolder}
        <Spin />
      </div>
    );
  }
  if (!dongfu) {
    return <div style={{ ...cultivationPageShellStyle, padding: 20, color: "#6b6355" }}>加载失败</div>;
  }

  const breakthroughRatePercent = Math.floor(dongfu.breakthroughSuccessRate * 100);
  const claimDisabled = dongfu.dongfuPendingXp <= 0;
  const canBreakthrough = dongfu.cultivationXp >= dongfu.breakthroughRequiredXp;
  const genderLabel = resolveGenderLabel(dongfu.gender);
  const actionButtonStyle = {
    ...buildCultivationActionButtonStyle({ dreamy: true }),
    minHeight: 38,
    height: "auto",
  } as const;
  const primaryActionButtonStyle = {
    ...buildCultivationActionButtonStyle({ active: true, dreamy: true }),
    minHeight: 42,
    height: "auto",
  } as const;

  return (
    <div
      style={{
        ...cultivationPageShellStyle,
        ...buildCultivationRevealStyle(0),
      }}
    >
      {contextHolder}

      <Modal
        open={talentOptions.length > 0}
        title={TALENT_KIND_TITLE[talentOptions[0]?.kind ?? ""] || "流派抉择"}
        onCancel={() => setTalentOptions([])}
        footer={null}
        width={540}
        centered
      >
        <div style={{ color: "#6b6355", fontSize: 13, marginBottom: 12, lineHeight: 1.7 }}>
          {TALENT_KIND_INTRO[talentOptions[0]?.kind ?? ""] || "流派当立，此择不可更改。"}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {talentOptions.map((option) => (
            <div
              key={option.key}
              style={{
                border: "1px solid rgba(122,106,80,0.35)",
                borderRadius: 12,
                padding: 12,
                background: "rgba(255,255,255,0.72)",
              }}
            >
              <div style={{ fontWeight: 700, color: "#4a3f31", fontSize: 15 }}>
                {option.name}
              </div>
              {option.description ? (
                <div style={{ marginTop: 6, color: "#5f5648", fontSize: 13, lineHeight: 1.6 }}>
                  {option.description}
                </div>
              ) : null}
              {Object.keys(option.currentPercent || {}).length > 0 ? (
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {Object.entries(option.currentPercent).map(([key, value]) => (
                    <span
                      key={key}
                      style={{
                        fontSize: 12,
                        // 带代价的道心会给负值（如用血量换攻击），红色区分，别让玩家以为是加成
                        color: Number(value) < 0 ? "#9c4a3c" : "#7a6a50",
                        border: `1px solid ${Number(value) < 0 ? "rgba(156,74,60,0.45)" : "rgba(122,106,80,0.3)"}`,
                        borderRadius: 999,
                        padding: "1px 8px",
                      }}
                    >
                      {TALENT_STAT_LABELS[key] || key} {Number(value) >= 0 ? "+" : ""}{Math.round(Number(value) * 100)}%
                    </span>
                  ))}
                </div>
              ) : null}
              <Button
                type="primary"
                size="small"
                loading={talentChoosingKey === option.key}
                disabled={talentChoosingKey !== null && talentChoosingKey !== option.key}
                onClick={() => handleChooseTalent(option.key)}
                style={{ marginTop: 10 }}
              >
                {TALENT_KIND_CHOOSE_LABEL[option.kind] || "择此道途"}
              </Button>
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={talentOptions.length === 0 && reversalOptions.length > 0}
        title="逆天改命"
        onCancel={handleReversalCancel}
        footer={null}
        width={540}
        centered
      >
        <div style={{ color: "#6b6355", fontSize: 13, marginBottom: 12, lineHeight: 1.7 }}>
          突破之际天机显现，三道命数择其一，此后本境界再难更改。
          已拥有的天机会以「精进」现身——再择一次，其效更进一层。
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: 10,
          }}
        >
          <Button
            size="small"
            disabled={reversalRefreshUsed}
            loading={reversalRefreshing}
            onClick={handleReversalReroll}
          >
            {reversalRefreshUsed ? "天机已重演" : "扭转天机（余一次）"}
          </Button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {reversalOptions.map((option) => {
            const grade = resolveReversalGrade(option.grade);
            return (
              <div
                key={option.id}
                style={{
                  border: `1px solid ${grade.border}`,
                  borderRadius: 12,
                  padding: 12,
                  background: "rgba(255,255,255,0.72)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontWeight: 700, color: grade.color, fontSize: 15 }}>
                    {option.name}
                    {option.owned ? (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 12,
                          fontWeight: 400,
                          color: "#8a6d1f",
                          border: "1px solid rgba(184,146,48,0.55)",
                          borderRadius: 999,
                          padding: "1px 8px",
                          verticalAlign: "1px",
                        }}
                      >
                        已得 · 可精进
                      </span>
                    ) : null}
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      color: grade.color,
                      border: `1px solid ${grade.border}`,
                      borderRadius: 999,
                      padding: "1px 8px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {grade.label}{option.durationSeconds > 0 ? " · 限时" : " · 永久"}
                  </span>
                </div>
                {option.description ? (
                  <div style={{ marginTop: 6, color: "#5f5648", fontSize: 13, lineHeight: 1.6 }}>
                    {option.description}
                  </div>
                ) : null}
                <Button
                  type="primary"
                  size="small"
                  loading={reversalClaimingId === option.id}
                  disabled={reversalClaimingId !== null && reversalClaimingId !== option.id}
                  onClick={() => handleClaimReversal(option.id)}
                  style={{ marginTop: 10 }}
                >
                  承接此命
                </Button>
              </div>
            );
          })}
        </div>
      </Modal>

      <Card
        size="small"
        styles={{
          body: { paddingTop: 14, paddingBottom: 14 },
        }}
        style={{
          ...cultivationHeroCardStyle,
          ...buildCultivationRevealStyle(20),
          marginBottom: 10,
          borderRadius: 18,
          overflow: "hidden",
        }}
      >
        <div style={{ textAlign: "center", position: "relative" }}>
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: "radial-gradient(84% 62% at 50% 4%, rgba(231, 240, 252, 0.12) 0%, rgba(231, 240, 252, 0.03) 34%, rgba(0,0,0,0) 76%), radial-gradient(42% 24% at 50% 54%, rgba(127, 183, 238, 0.12) 0%, rgba(127, 183, 238, 0.03) 52%, rgba(0,0,0,0) 100%)",
            }}
          />
          <Text style={{ color: "#edf5ff", fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>{dongfu.playerName || "无名修士"}</Text>
          <div style={{ marginTop: 2 }}>
            <Text style={{ color: "#9eb1c8", fontSize: 12 }}>{dongfu.realmName || "未知境界"} · {genderLabel}</Text>
          </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, margin: "8px 0 2px" }}>
              <Button
                size="small"
                icon={<HeartOutlined />}
                style={actionButtonStyle}
              onClick={() => router.push("/game/double-cultivation")}
            >
              <span style={{ position: "relative", display: "inline-flex", alignItems: "center", paddingRight: doubleCultivationBadgeCount > 0 ? 10 : 0 }}>
                双修
                  {doubleCultivationBadgeCount > 0 && <NotificationDot style={{ top: -1, right: 0 }} />}
                </span>
              </Button>
              <Button
                size="small"
                icon={<FieldTimeOutlined />}
                style={actionButtonStyle}
                onClick={() => router.push("/game/spiritual-field")}
              >
                灵田
              </Button>
            </div>

          <div
            style={{
              width: 238,
              height: 238,
              margin: "12px auto 10px",
              position: "relative",
              overflow: "visible",
            }}
          >
            {resolvedMeditateImageSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolvedMeditateImageSrc}
                alt={`${genderLabel}打坐`}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  transform: "scale(1.1)",
                  filter: "drop-shadow(0 10px 16px rgba(0,0,0,0.45))",
                  display: "block",
                }}
              />
            ) : null}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <div style={{ borderRadius: 8, background: "rgba(24, 21, 17, 0.82)", padding: "6px 8px", boxShadow: "inset 0 1px 0 rgba(232,210,130,0.06)" }}>
              <Text style={{ color: "#7d8da2", fontSize: 11 }}>当前修为</Text>
              <div><Text style={{ color: "#edf5ff", fontSize: 16, fontWeight: 600 }}>{dongfu.cultivationXp}</Text></div>
            </div>
            <div style={{ borderRadius: 8, background: "rgba(24, 21, 17, 0.82)", padding: "6px 8px", boxShadow: "inset 0 1px 0 rgba(232,210,130,0.06)" }}>
              <Text style={{ color: "#7d8da2", fontSize: 11 }}>每小时修为</Text>
              <div><Text style={{ color: "#d8efff", fontSize: 16, fontWeight: 600 }}>+{dongfu.dongfuRatePerHourXp}</Text></div>
            </div>
          </div>

          <div
            style={{
              marginBottom: 10,
              borderRadius: 8,
              background: dongfu.pillToxicity >= dongfu.pillToxicityLimit
                ? "rgba(86, 34, 34, 0.82)"
                : "rgba(39, 27, 20, 0.82)",
              padding: "8px 10px",
              boxShadow: "inset 0 1px 0 rgba(232,210,130,0.06)",
            }}
          >
              <Text style={{ color: "#7d8da2", fontSize: 11 }}>当前丹毒</Text>
              <div>
                <Text style={{ color: "#e8d282", fontSize: 16, fontWeight: 600 }}>
                  {dongfu.pillToxicity}/{dongfu.pillToxicityLimit}
                </Text>
              </div>
            <Text style={{ color: "#97acc4", fontSize: 11, display: "block", marginTop: 2 }}>
              每 {dongfu.pillToxicityRecoverIntervalMinutes} 分钟恢复 1 点
              {dongfu.nextPillToxicityRecoverInSeconds
                ? `，下次恢复约 ${Math.ceil(dongfu.nextPillToxicityRecoverInSeconds / 60)} 分钟后`
                : "，当前状态平稳"}
            </Text>
          </div>

          <Progress
            percent={progressPercent}
            strokeColor="#c9a84c"
            railColor="#2a2520"
            format={() => ""}
          />
          <Text style={{ color: "#7d8da2", fontSize: 11, display: "block", marginTop: 4 }}>
            突破所需：{dongfu.breakthroughRequiredXp} 修为
          </Text>
          <Text style={{ color: "#7d8da2", fontSize: 11, display: "block", marginTop: 2 }}>
            当前比例：每小时 {formatRatePercent(dongfu.dongfuRatioPerHour)}
          </Text>
          <Text style={{ color: "#7d8da2", fontSize: 11, display: "block", marginTop: 2 }}>
            灵气来源：{dongfu.dongfuLingqiBonusSources?.length ? dongfu.dongfuLingqiBonusSources.join(" / ") : "基础洞府"}
          </Text>
        </div>
      </Card>

      <Card
        size="small"
        title={<Text style={{ color: "#c9a84c", fontSize: 13 }}><ClockCircleOutlined /> 挂机收益</Text>}
        styles={{
          header: { borderBottom: "none", paddingBottom: 2 },
        }}
        style={{
          ...cultivationSectionCardStyle,
          ...buildCultivationRevealStyle(90),
          marginBottom: 10,
          borderRadius: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <Text style={{ color: "#a09880", fontSize: 12 }}>已累计时长</Text>
          <Text style={{ color: "#e8d282", fontSize: 12 }}>
            {formatAccumulatedTime(dongfu.dongfuAccumulatedMs)} / {dongfu.dongfuCapHours}小时
          </Text>
        </div>
        <div
          style={{
            marginBottom: 10,
            borderRadius: 10,
            background: "linear-gradient(90deg, rgba(201,168,76,0.13), rgba(201,168,76,0.04))",
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "inset 0 1px 0 rgba(232,210,130,0.08)",
          }}
        >
          <Text style={{ color: "#a09880", fontSize: 12 }}><FireOutlined /> 待领取修为</Text>
          <Text style={{ color: "#e8d282", fontSize: 20, fontWeight: 600 }}>{dongfu.dongfuPendingXp}</Text>
        </div>
        <Button
          type="primary"
          block
          onClick={() => { void handleClaim(); }}
          loading={claimLoading}
          disabled={claimDisabled}
          style={primaryActionButtonStyle}
        >
          领取修为
        </Button>
        <Text style={{ color: "#6b6355", fontSize: 11, display: "block", marginTop: 6, textAlign: "center" }}>
          最多累计 {dongfu.dongfuCapHours} 小时，超出后不再继续增长
        </Text>
      </Card>

      <Card
        size="small"
        title={<Text style={{ color: "#c9a84c", fontSize: 13 }}><ThunderboltOutlined /> 突破</Text>}
        styles={{
          header: { borderBottom: "none", paddingBottom: 2 },
        }}
        style={{
          ...cultivationSectionCardStyle,
          ...buildCultivationRevealStyle(140),
          marginBottom: 8,
          borderRadius: 16,
          opacity: canBreakthrough ? 1 : 0.68,
          boxShadow: canBreakthrough
            ? "0 14px 32px rgba(0,0,0,0.24), inset 0 1px 0 rgba(245,248,255,0.05), 0 0 26px rgba(129, 191, 255, 0.08)"
            : "0 10px 22px rgba(0,0,0,0.18), inset 0 1px 0 rgba(245,248,255,0.03)",
        }}
      >
        <div
          style={{
            marginBottom: 8,
            padding: "8px 10px",
            borderRadius: 12,
            border: `1px solid ${canBreakthrough ? "rgba(151, 206, 255, 0.22)" : "rgba(108, 124, 144, 0.16)"}`,
            background: canBreakthrough
              ? "linear-gradient(180deg, rgba(71, 101, 138, 0.18) 0%, rgba(20, 28, 43, 0.7) 100%)"
              : "linear-gradient(180deg, rgba(28, 31, 39, 0.7) 0%, rgba(18, 20, 26, 0.82) 100%)",
          }}
        >
          <Text style={{ color: canBreakthrough ? "#eef8ff" : "#7e8ea2", fontSize: 12 }}>
            {canBreakthrough ? "灵气圆满，气机已成，可尝试破境。" : `尚需 ${Math.max(0, dongfu.breakthroughRequiredXp - dongfu.cultivationXp)} 修为，当前仍在蓄势。`}
          </Text>
        </div>
        <Button
          type="primary"
          block
          icon={<RiseOutlined />}
          onClick={() => { void handleBreakthrough(); }}
          loading={breakthroughLoading}
          disabled={!canBreakthrough}
          style={{
            ...(canBreakthrough ? primaryActionButtonStyle : actionButtonStyle),
            opacity: canBreakthrough ? 1 : 0.72,
            color: canBreakthrough ? "#f7fbff" : "#8595aa",
            borderColor: canBreakthrough ? "rgba(168, 211, 255, 0.52)" : "rgba(110, 123, 142, 0.18)",
            background: canBreakthrough
              ? "linear-gradient(180deg, rgba(110, 141, 186, 0.28) 0%, rgba(34, 44, 66, 0.92) 54%, rgba(22, 27, 39, 0.96) 100%)"
              : "linear-gradient(180deg, rgba(26, 29, 37, 0.82) 0%, rgba(18, 20, 26, 0.92) 100%)",
            boxShadow: canBreakthrough
              ? "0 12px 28px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 34px rgba(146, 204, 255, 0.12)"
              : "inset 0 1px 0 rgba(255,255,255,0.03)",
          }}
        >
          尝试突破（{breakthroughRatePercent}%）
        </Button>
        <Text style={{ color: canBreakthrough ? "#a6bed7" : "#7f90a5", fontSize: 11, display: "block", marginTop: 4, textAlign: "center" }}>
          当前额外加成：{formatRatePercent(dongfu.breakthroughBonusRate)}
        </Text>
        <Text style={{ color: "#7f90a5", fontSize: 11, display: "block", marginTop: 4, textAlign: "center" }}>
          失败将损失修为并受伤，下次突破成功率 +5%（累计上限 25%）
        </Text>
        <div
          style={{
            ...cultivationSoftPanelStyle,
            marginTop: 8,
            padding: 8,
            opacity: canBreakthrough ? 1 : 0.76,
          }}
        >
          <Text style={{ color: "#c9a84c", fontSize: 12, display: "block", marginBottom: 6 }}>
            快速使用突破丹药（每次消耗 1 个）
          </Text>
          {quickBreakthroughItems.length > 0 ? (
            quickBreakthroughItems.map((item, index) => (
              <div
                key={item.itemId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: index === 0 ? 0 : 6,
                }}
              >
                <Text style={{ color: "#a09880", fontSize: 12 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <ItemBadge
                      name={item.name}
                      iconUrl={item.iconUrl}
                      quantity={item.quantity}
                      iconSize={14}
                    />
                    <span>· +{formatRatePercent(item.boostRate)}</span>
                  </span>
                </Text>
                <Button
                  size="small"
                  loading={quickUsingItemId === item.itemId}
                  style={actionButtonStyle}
                  onClick={() => {
                    void handleQuickUseBreakthroughItem(item);
                  }}
                >
                  使用
                </Button>
              </div>
            ))
          ) : (
            <Text style={{ color: "#6b6355", fontSize: 11 }}>
              暂无可提升突破概率的丹药
            </Text>
          )}
        </div>
      </Card>
    </div>
  );
}

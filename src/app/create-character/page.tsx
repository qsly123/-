"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Radio,
  Spin,
  Steps,
  Typography,
  message,
  Descriptions,
  Space,
} from "antd";
import {
  UserOutlined,
  HeartOutlined,
  LockOutlined,
  QuestionCircleOutlined,
  UnlockOutlined,
  ArrowLeftOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import {
  buildFortuneAttrLines,
  buildFortuneEventSections,
  buildFortuneSpecialLines,
} from "@/modules/character/ui/components/fortune-effect-utils";
import type {
  AttributeDelta,
  FortuneEventEffects,
  FortuneSpecialEffects,
  SpiritualRoot,
} from "@/types/game";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import GameImage from "@/modules/shared/ui/components/GameImage";

const { Title, Text, Paragraph } = Typography;

const ELEMENT_COLORS: Record<string, string> = {
  "金": "#c0c0c0",
  "木": "#228b22",
  "水": "#1e90ff",
  "火": "#dc3545",
  "土": "#daa520",
  "雷": "#9d4edd",
  "冰": "#87ceeb",
  "风": "#52b788",
  "暗": "#6b6355",
  "光": "#e8d282",
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

const FORTUNE_GRADE_COLORS: Record<string, string> = {
  red: "#ff4d4f",
  gold: "#f7d774",
  purple: "#d18bff",
  blue: "#7eb9ff",
  white: "#d9d9d9",
};

const MOBILE_BREAKPOINT = 768;
const STEP_TITLES = ["觉醒灵根", "选择气运", "选择头像", "取名入道", "仙途已开"];
const GENDER_OPTIONS = [
  { label: "男", value: "男" },
  { label: "女", value: "女" },
] as const;

type StarterFortuneOption = {
  id: string;
  name: string;
  description: string | null;
  grade: string;
  durationSeconds: number;
  attrEffects: AttributeDelta;
  eventEffects: FortuneEventEffects;
  specialEffects: FortuneSpecialEffects;
};

type CreateAvatarItem = {
  id: string;
  name: string;
  imageUrl: string;
  sortOrder: number;
};

type CharacterPreviewData = {
  previewToken: string;
  spiritualRoot: SpiritualRoot;
  starterFortuneOptions: StarterFortuneOption[];
  requiredSelectCount: number;
  stats: {
    hp: number;
    mp: number;
    attack: number;
    defense: number;
    speed: number;
    luck: number;
  };
};

type CharacterCreateResult = {
  spiritualRoot: SpiritualRoot;
  stats: {
    hp: number;
    mp: number;
    attack: number;
    defense: number;
    speed: number;
    luck: number;
  };
};

type MaintenanceStatusResponse = {
  success: boolean;
  data?: {
    enabled?: boolean;
    message?: string;
  };
};

function getGradeColor(grade: string) {
  return FORTUNE_GRADE_COLORS[grade] || FORTUNE_GRADE_COLORS.white;
}

function formatDuration(durationSeconds: number) {
  if (durationSeconds <= 0) {
    return "永久";
  }

  const day = Math.floor(durationSeconds / 86400);
  const hour = Math.floor((durationSeconds % 86400) / 3600);
  if (day > 0) {
    return `${day}天${hour}小时`;
  }
  if (hour > 0) {
    return `${hour}小时`;
  }
  return `${durationSeconds}秒`;
}

function filterValidIds(ids: string[], options: StarterFortuneOption[]) {
  const validIdSet = new Set(options.map((item) => item.id));
  return ids.filter((id) => validIdSet.has(id));
}

function normalizeSingleLockedId(ids: string[], options: StarterFortuneOption[]) {
  return filterValidIds(ids, options).slice(0, 1);
}

export default function CreateCharacterPage() {
  const [step, setStep] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [name, setName] = useState("");
  const [gender, setGender] = useState<string>("男");
  const [wish, setWish] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshingFortunes, setRefreshingFortunes] = useState(false);
  const [availableAvatars, setAvailableAvatars] = useState<CreateAvatarItem[]>([]);
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(null);
  const [avatarsLoading, setAvatarsLoading] = useState(false);
  const [preview, setPreview] = useState<CharacterPreviewData | null>(null);
  const [selectedStarterIds, setSelectedStarterIds] = useState<string[]>([]);
  const [lockedStarterIds, setLockedStarterIds] = useState<string[]>([]);
  const [detailFortune, setDetailFortune] = useState<StarterFortuneOption | null>(null);
  const [result, setResult] = useState<CharacterCreateResult | null>(null);
  const [maintenanceNotice, setMaintenanceNotice] = useState<string | null>(null);
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const maintenanceNoticeShownRef = useRef(false);

  const resetCreateFlowForMaintenance = useCallback((notice: string) => {
    setMaintenanceNotice(notice);
    setStep(0);
    setPreview(null);
    setSelectedStarterIds([]);
    setLockedStarterIds([]);
    setDetailFortune(null);
    setSelectedAvatarId(null);
    setResult(null);
    setName("");
  }, []);

  useEffect(() => {
    const updateIsMobile = () => {
      setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    };

    updateIsMobile();
    window.addEventListener("resize", updateIsMobile);
    return () => window.removeEventListener("resize", updateIsMobile);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchAvailableAvatars = async () => {
      setAvatarsLoading(true);
      try {
        const res = await fetch(`/api/character/create/avatars?gender=${encodeURIComponent(gender)}`, {
          cache: "no-store",
        });
        const json = await res.json() as {
          success: boolean;
          data?: { avatars?: CreateAvatarItem[] };
        };

        if (cancelled) {
          return;
        }

        const avatars = json.success && Array.isArray(json.data?.avatars) ? json.data.avatars : [];
        setAvailableAvatars(avatars);
        setSelectedAvatarId((prev) => (avatars.some((item) => item.id === prev) ? prev : null));
      } catch {
        if (!cancelled) {
          setAvailableAvatars([]);
          setSelectedAvatarId(null);
        }
      } finally {
        if (!cancelled) {
          setAvatarsLoading(false);
        }
      }
    };

    void fetchAvailableAvatars();

    return () => {
      cancelled = true;
    };
  }, [gender]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const maintenanceFlag = new URLSearchParams(window.location.search).get("maintenance");
    if (maintenanceFlag !== "1" || maintenanceNoticeShownRef.current) {
      return;
    }

    let cancelled = false;

    const loadMaintenanceStatus = async () => {
      try {
        const res = await fetch("/api/system/maintenance-status", { cache: "no-store" });
        const json = await res.json() as MaintenanceStatusResponse;
        if (cancelled || !json.success || !json.data?.enabled) {
          return;
        }

        const notice = json.data.message?.trim() || "服务器维护中，请稍后再入世。";
        maintenanceNoticeShownRef.current = true;
        resetCreateFlowForMaintenance(notice);
        messageApi.warning(notice);
      } catch {
        if (!cancelled) {
          const notice = "服务器维护中，请稍后再入世。";
          maintenanceNoticeShownRef.current = true;
          resetCreateFlowForMaintenance(notice);
          messageApi.warning(notice);
        }
      }
    };

    void loadMaintenanceStatus();

    return () => {
      cancelled = true;
    };
  }, [messageApi, resetCreateFlowForMaintenance]);

  const handleGenderChange = (value: string) => {
    setGender(value);
    setPreview(null);
    setSelectedStarterIds([]);
    setLockedStarterIds([]);
    setDetailFortune(null);
    setSelectedAvatarId(null);
    setResult(null);
    if (step > 0 && step < STEP_TITLES.length - 1) {
      setStep(0);
    }
  };

  const handlePreview = async () => {
    if (!wish.trim()) {
      messageApi.error("请输入你的心愿");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/character/create/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gender,
          wish: wish.trim(),
        }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: CharacterPreviewData;
      };

      if (!json.success || !json.data) {
        messageApi.error(json.error || "生成开局预览失败");
        return;
      }

      setPreview(json.data);
      setSelectedStarterIds([]);
      setLockedStarterIds([]);
      setDetailFortune(null);
      setResult(null);
      setStep(1);
    } catch {
      messageApi.error("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const toggleStarterFortune = (fortuneId: string) => {
    if (!preview) return;

    const required = preview.requiredSelectCount;
    setSelectedStarterIds((prev) => {
      if (prev.includes(fortuneId)) {
        return prev.filter((id) => id !== fortuneId);
      }
      if (prev.length >= required) {
        messageApi.warning(`最多选择 ${required} 个气运`);
        return prev;
      }
      return [...prev, fortuneId];
    });
  };

  const toggleStarterFortuneLock = (fortuneId: string) => {
    setLockedStarterIds((prev) => {
      if (prev.includes(fortuneId)) {
        return prev.filter((id) => id !== fortuneId);
      }
      return [fortuneId];
    });
  };

  const handleRefreshStarterFortunes = async () => {
    if (!preview) return;

    setRefreshingFortunes(true);
    try {
      const currentLockedIds = normalizeSingleLockedId(lockedStarterIds, preview.starterFortuneOptions);
      const res = await fetch("/api/character/create/preview/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previewToken: preview.previewToken,
          lockedStarterFortuneIds: currentLockedIds,
        }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: {
          previewToken: string;
          starterFortuneOptions: StarterFortuneOption[];
          requiredSelectCount: number;
        };
      };

      if (!json.success || !json.data) {
        messageApi.error(json.error || "刷新气运失败");
        return;
      }

      const nextStarterFortuneOptions = json.data.starterFortuneOptions || preview.starterFortuneOptions;
      setPreview((prevValue) => {
        if (!prevValue) {
          return prevValue;
        }
        return {
          ...prevValue,
          previewToken: json.data?.previewToken || prevValue.previewToken,
          starterFortuneOptions: nextStarterFortuneOptions,
          requiredSelectCount: json.data?.requiredSelectCount ?? prevValue.requiredSelectCount,
        };
      });
      setSelectedStarterIds((prevValue) => filterValidIds(prevValue, nextStarterFortuneOptions));
      setLockedStarterIds((prevValue) => normalizeSingleLockedId(prevValue, nextStarterFortuneOptions));
      setDetailFortune(null);
      if (currentLockedIds.length > 0) {
        if (currentLockedIds.length >= nextStarterFortuneOptions.length) {
          messageApi.success("已保留全部锁定气运，本轮候选未变化");
        } else {
          messageApi.success(`已保留 ${currentLockedIds.length} 个锁定气运，其余候选已刷新`);
        }
      } else {
        messageApi.success("气运候选已刷新");
      }
    } catch {
      messageApi.error("网络错误");
    } finally {
      setRefreshingFortunes(false);
    }
  };

  const goToAvatarStep = () => {
    if (!preview) return;
    if (selectedStarterIds.length !== preview.requiredSelectCount) {
      messageApi.error(`请选择 ${preview.requiredSelectCount} 个开局气运`);
      return;
    }
    setStep(2);
  };

  const goToNameStep = () => {
    setStep(3);
  };

  const handleCreate = async () => {
    if (!preview) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      messageApi.error("请输入角色名");
      return;
    }
    if (trimmedName.length < 1 || trimmedName.length > 12) {
      messageApi.error("角色名需为 1-12 个字");
      return;
    }
    if (selectedStarterIds.length !== preview.requiredSelectCount) {
      messageApi.error(`请选择 ${preview.requiredSelectCount} 个开局气运`);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/character/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          gender,
          previewToken: preview.previewToken,
          selectedStarterFortuneIds: selectedStarterIds,
          avatarId: selectedAvatarId,
        }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: CharacterCreateResult;
        maintenance?: boolean;
      };

      if (!json.success || !json.data) {
        if (json.maintenance) {
          const notice = json.error || "服务器维护中，请稍后再入世。";
          resetCreateFlowForMaintenance(notice);
          messageApi.warning(notice);
          router.replace("/create-character?maintenance=1");
          return;
        }
        messageApi.error(json.error || "创建失败");
        return;
      }

      setResult(json.data);
      setStep(4);
    } catch {
      messageApi.error("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const renderRootCard = (root: SpiritualRoot) => {
    const variant = normalizeDisplayedRootVariant(root.variant);

    return (
      <Card style={{ background: "rgba(26, 26, 46, 0.9)", border: "1px solid #2a2520", marginBottom: 12 }}>
        <div style={{ textAlign: "center" }}>
          <HeartOutlined style={{ fontSize: 36, color: ELEMENT_COLORS[root.element] || "#c9a84c" }} />
          <Title level={4} style={{ color: ELEMENT_COLORS[root.element] || "#c9a84c", marginTop: 8 }}>
            {root.name}
          </Title>
          <div>
            <DarkTag color={ELEMENT_COLORS[root.element]}>
              {root.element}灵根
            </DarkTag>
            {variant && (
              <DarkTag color={ELEMENT_COLORS[variant]} style={{ marginLeft: 4 }}>
                变异·{variant}
              </DarkTag>
            )}
          </div>
          <Paragraph style={{ color: "#a09880", marginTop: 12 }}>
            {root.description}
          </Paragraph>
        </div>
      </Card>
    );
  };

  const renderStatsCard = () => {
    if (!preview) {
      return null;
    }

    return (
      <Card
        size="small"
        title={<Text style={{ color: "#c9a84c" }}>初始属性</Text>}
        style={{ background: "rgba(26, 26, 46, 0.9)", border: "1px solid #2a2520", marginBottom: 12 }}
      >
        <Descriptions column={2} size="small">
          <Descriptions.Item label="性别">{gender}</Descriptions.Item>
          <Descriptions.Item label="境界">
            <Text style={{ color: "#c9a84c" }}>炼气期一层</Text>
          </Descriptions.Item>
          <Descriptions.Item label="灵石">100</Descriptions.Item>
          <Descriptions.Item label="气血">{preview.stats.hp}</Descriptions.Item>
          <Descriptions.Item label="灵力">{preview.stats.mp}</Descriptions.Item>
          <Descriptions.Item label="攻击">{preview.stats.attack}</Descriptions.Item>
          <Descriptions.Item label="防御">{preview.stats.defense}</Descriptions.Item>
                        <Descriptions.Item label="遁速">{preview.stats.speed}</Descriptions.Item>
          <Descriptions.Item label="幸运">{preview.stats.luck}</Descriptions.Item>
        </Descriptions>
      </Card>
    );
  };

  const detailAttrLines = buildFortuneAttrLines(detailFortune?.attrEffects);
  const detailSpecialLines = buildFortuneSpecialLines(detailFortune?.specialEffects);
  const detailEventSections = buildFortuneEventSections(detailFortune?.eventEffects);

  return (
    <div
      style={{
        minHeight: "var(--app-height, 100dvh)",
        height: "var(--app-height, 100dvh)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        overflowY: "auto",
        overscrollBehaviorY: "contain",
        WebkitOverflowScrolling: "touch",
        touchAction: "pan-y",
        paddingTop: "calc(20px + var(--safe-area-top, 0px))",
        paddingRight: "calc(20px + var(--safe-area-right, 0px))",
        paddingBottom: "calc(20px + var(--safe-area-bottom, 0px))",
        paddingLeft: "calc(20px + var(--safe-area-left, 0px))",
        background: "linear-gradient(180deg, #0d0d0f 0%, #1a1a2e 50%, #16213e 100%)",
      }}
    >
      {contextHolder}
      <div style={{ width: "100%", maxWidth: 460, paddingTop: 20 }}>
        <Title level={3} style={{ color: "#c9a84c", textAlign: "center", marginBottom: 24 }}>
          开辟仙途
        </Title>
        <div style={{ marginBottom: 16 }}>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => router.push("/select-character")}
            block
          >
            返回选角色
          </Button>
        </div>

        {maintenanceNotice && (
          <Card
            style={{
              background: "rgba(52, 28, 28, 0.9)",
              border: "1px solid #7a3a3a",
              marginBottom: 16,
            }}
          >
            <Text style={{ color: "#ffd6d6" }}>
              {maintenanceNotice}
            </Text>
          </Card>
        )}

        {isMobile ? (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 12px",
              background: "rgba(26, 26, 46, 0.7)",
              border: "1px solid #2a2520",
              borderRadius: 6,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={{ color: "#c9a84c", fontSize: 12 }}>
                第 {step + 1}/{STEP_TITLES.length} 步
              </Text>
              <Text style={{ color: "#a09880", fontSize: 12 }}>
                {STEP_TITLES[step] || "进行中"}
              </Text>
            </div>
            <div style={{ height: 4, background: "rgba(255, 255, 255, 0.12)", borderRadius: 999 }}>
              <div
                style={{
                  width: `${((step + 1) / STEP_TITLES.length) * 100}%`,
                  height: "100%",
                  background: "#c9a84c",
                  borderRadius: 999,
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          </div>
        ) : (
          <Steps
            current={step}
            size="small"
            items={STEP_TITLES.map((title) => ({ title }))}
            style={{ marginBottom: 24 }}
          />
        )}

        {step === 0 && (
          <Card style={{ background: "rgba(26, 26, 46, 0.9)", border: "1px solid #2a2520" }}>
            <Space orientation="vertical" style={{ width: "100%" }} size={12}>
              <div>
                <Text style={{ color: "#a09880", fontSize: 12, display: "block", marginBottom: 6 }}>
                  先定阴阳，再问仙途。
                </Text>
                <Radio.Group value={gender} onChange={(e) => handleGenderChange(e.target.value)}>
                  {GENDER_OPTIONS.map((item) => (
                    <Radio.Button key={item.value} value={item.value}>
                      {item.label}
                    </Radio.Button>
                  ))}
                </Radio.Group>
              </div>

              <Input.TextArea
                placeholder="写下你踏入仙途时最强烈的执念、渴望或心愿"
                rows={4}
                value={wish}
                onChange={(e) => setWish(e.target.value)}
                maxLength={100}
                showCount
              />

              <Button
                type="primary"
                block
                onClick={() => {
                  void handlePreview();
                }}
                loading={loading}
              >
                {loading ? "灵根觉醒中..." : "觉醒灵根"}
              </Button>
            </Space>
          </Card>
        )}

        {step === 1 && preview && (
          <div>
            {renderRootCard(preview.spiritualRoot)}
            <Card style={{ background: "rgba(26, 26, 46, 0.9)", border: "1px solid #2a2520", marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <Text style={{ color: "#c9a84c", display: "block" }}>
                    开局气运（需选择 {preview.requiredSelectCount} 个）
                  </Text>
                  <Text style={{ color: "#a09880", fontSize: 12 }}>
                    锁定后刷新会保留该气运，当前最多锁定 1 个。
                  </Text>
                </div>
                <Space size={8} align="center">
                  <Text style={{ color: "#c9a84c", fontSize: 12 }}>
                    已锁定 {lockedStarterIds.length}/1
                  </Text>
                  <Button
                    size="small"
                    onClick={() => {
                      void handleRefreshStarterFortunes();
                    }}
                    loading={refreshingFortunes}
                    disabled={loading}
                  >
                    刷新气运
                  </Button>
                </Space>
              </div>
              {preview.starterFortuneOptions.length === 0 ? (
                <Text style={{ color: "#6b6355" }}>当前暂无可选开局气运</Text>
              ) : (
                <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                  {preview.starterFortuneOptions.map((fortune) => {
                    const selected = selectedStarterIds.includes(fortune.id);
                    const locked = lockedStarterIds.includes(fortune.id);
                    return (
                      <Card
                        key={fortune.id}
                        size="small"
                        style={{
                          border: selected
                            ? "1px solid #c9a84c"
                            : locked
                              ? "1px solid rgba(247, 215, 116, 0.72)"
                              : "1px solid #2a2520",
                          background: selected
                            ? "rgba(201, 168, 76, 0.12)"
                            : locked
                              ? "rgba(247, 215, 116, 0.08)"
                              : "rgba(13, 13, 15, 0.3)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <div>
                            <Text style={{ color: getGradeColor(fortune.grade), fontWeight: 600 }}>
                              {fortune.name}
                            </Text>
                            {locked && (
                              <Text style={{ color: "#f7d774", display: "block", fontSize: 12 }}>
                                已锁定，刷新后会保留
                              </Text>
                            )}
                            <Text style={{ color: "#6b6355", display: "block", fontSize: 12 }}>
                              时效：{formatDuration(fortune.durationSeconds)}
                            </Text>
                            {fortune.description && (
                              <Text style={{ color: "#a09880", display: "block", fontSize: 12 }}>
                                {fortune.description}
                              </Text>
                            )}
                          </div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 8, marginTop: 10 }}>
                          <Button
                            type={selected ? "primary" : "default"}
                            onClick={() => toggleStarterFortune(fortune.id)}
                          >
                            {selected ? "已选" : "选择"}
                          </Button>
                          <Space size={6}>
                            <Button
                              size="small"
                              shape="circle"
                              icon={locked ? <LockOutlined /> : <UnlockOutlined />}
                              title={locked ? "解锁气运" : "锁定气运"}
                              aria-label={locked ? `解锁${fortune.name}` : `锁定${fortune.name}`}
                              onClick={() => toggleStarterFortuneLock(fortune.id)}
                              style={{
                                color: locked ? "#f7d774" : "#a09880",
                                borderColor: locked ? "rgba(247, 215, 116, 0.42)" : "rgba(160, 152, 128, 0.32)",
                                background: locked ? "rgba(79, 64, 16, 0.92)" : "rgba(13, 13, 15, 0.92)",
                              }}
                            />
                            <Button
                              size="small"
                              shape="circle"
                              icon={<QuestionCircleOutlined />}
                              title="查看气运效果"
                              aria-label={`查看${fortune.name}的气运效果`}
                              onClick={() => setDetailFortune(fortune)}
                              style={{
                                color: "#c9a84c",
                                borderColor: "rgba(201, 168, 76, 0.42)",
                                background: "rgba(13, 13, 15, 0.92)",
                              }}
                            />
                          </Space>
                        </div>
                      </Card>
                    );
                  })}
                </Space>
              )}
            </Card>

            {renderStatsCard()}

            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={() => setStep(0)} style={{ flex: 1 }}>
                返回重选灵根
              </Button>
              <Button type="primary" onClick={goToAvatarStep} disabled={refreshingFortunes} style={{ flex: 2 }}>
                下一步：选择头像
              </Button>
            </div>
          </div>
        )}

        {step === 2 && preview && (
          <div>
            {renderRootCard(preview.spiritualRoot)}
            {renderStatsCard()}
            <Card style={{ background: "rgba(26, 26, 46, 0.9)", border: "1px solid #2a2520", marginBottom: 12 }}>
              <Text style={{ color: "#c9a84c", fontSize: 14, display: "block", marginBottom: 8 }}>
                选择头像
              </Text>
              <Text style={{ color: "#a09880", fontSize: 12, display: "block", marginBottom: 10 }}>
                头像可稍后再换，这一步不强制。
              </Text>

              {avatarsLoading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: "20px 0" }}>
                  <Spin />
                </div>
              ) : availableAvatars.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
                  {availableAvatars.map((avatar) => {
                    const selected = selectedAvatarId === avatar.id;
                    return (
                      <button
                        key={avatar.id}
                        type="button"
                        onClick={() => setSelectedAvatarId((prev) => (prev === avatar.id ? null : avatar.id))}
                        style={{
                          border: selected ? "1px solid #c9a84c" : "1px solid #2a2520",
                          borderRadius: 8,
                          padding: 4,
                          background: selected ? "rgba(201, 168, 76, 0.12)" : "rgba(13, 13, 15, 0.45)",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", borderRadius: 6, overflow: "hidden" }}>
                          <GameImage
                            src={avatar.imageUrl}
                            alt={avatar.name}
                            fill
                            sizes="(max-width: 460px) 22vw, 96px"
                            style={{ objectFit: "cover", display: "block" }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <Text style={{ color: "#6b6355" }}>当前性别暂无可用头像</Text>
              )}
            </Card>

            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={() => setStep(1)} style={{ flex: 1 }}>
                返回气运
              </Button>
              <Button type="primary" onClick={goToNameStep} style={{ flex: 2 }}>
                下一步：取名字
              </Button>
            </div>
          </div>
        )}

        {step === 3 && preview && (
          <div>
            {renderRootCard(preview.spiritualRoot)}
            {renderStatsCard()}
            <Card style={{ background: "rgba(26, 26, 46, 0.9)", border: "1px solid #2a2520", marginBottom: 12 }}>
              <Space orientation="vertical" style={{ width: "100%" }} size={12}>
                <div>
                  <Text style={{ color: "#c9a84c", display: "block", marginBottom: 6 }}>
                    最后一步，取一个道号
                  </Text>
                  <Text style={{ color: "#a09880", fontSize: 12, display: "block", marginBottom: 10 }}>
                    名字会在创建时最终校验，若被占用只需在此重改，不会丢失前面刷出的灵根和气运。
                  </Text>
                  <Input
                    prefix={<UserOutlined />}
                    placeholder="为你的角色取一个名字（1-12字）"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={12}
                  />
                </div>
              </Space>
            </Card>

            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={() => setStep(2)} style={{ flex: 1 }}>
                返回头像
              </Button>
              <Button type="primary" onClick={() => { void handleCreate(); }} loading={loading} style={{ flex: 2 }}>
                创建角色
              </Button>
            </div>
          </div>
        )}

        {step === 4 && result && (
          <div>
            {renderRootCard(result.spiritualRoot)}
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Button type="primary" block size="large" onClick={() => router.push("/game/map")}>
                踏入修仙世界
              </Button>
              <Button block size="large" onClick={() => router.push("/select-character")}>
                返回选角色
              </Button>
            </Space>
          </div>
        )}
      </div>
      <Modal
        title={detailFortune ? `气运效果 · ${detailFortune.name}` : "气运效果"}
        open={Boolean(detailFortune)}
        onCancel={() => setDetailFortune(null)}
        footer={null}
        width={isMobile ? "calc(100vw - 32px)" : 520}
      >
        {detailFortune && (
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <div>
              <Text style={{ color: getGradeColor(detailFortune.grade), fontWeight: 600 }}>
                {detailFortune.name}
              </Text>
              <Text style={{ color: "#6b6355", display: "block", fontSize: 12, marginTop: 4 }}>
                时效：{formatDuration(detailFortune.durationSeconds)}
              </Text>
              <Text style={{ color: "#a09880", display: "block", marginTop: 8 }}>
                {detailFortune.description || "暂无介绍"}
              </Text>
            </div>

            {detailAttrLines.length > 0 && (
              <div>
                <Text style={{ color: "#c9a84c", display: "block", marginBottom: 6 }}>
                  基础加成
                </Text>
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  {detailAttrLines.map((line) => (
                    <Text key={line} style={{ color: "#d8cfb8", display: "block" }}>
                      {line}
                    </Text>
                  ))}
                </Space>
              </div>
            )}

            {detailSpecialLines.length > 0 && (
              <div>
                <Text style={{ color: "#c9a84c", display: "block", marginBottom: 6 }}>
                  特殊倍率
                </Text>
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  {detailSpecialLines.map((line) => (
                    <Text key={line} style={{ color: "#d8cfb8", display: "block" }}>
                      {line}
                    </Text>
                  ))}
                </Space>
              </div>
            )}

            {detailEventSections.length > 0 && (
              <div>
                <Text style={{ color: "#c9a84c", display: "block", marginBottom: 6 }}>
                  条件触发
                </Text>
                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                  {detailEventSections.map((section) => (
                    <div key={section.label}>
                      <Text style={{ color: "#a09880", display: "block", marginBottom: 4 }}>
                        {section.label}
                      </Text>
                      <Space direction="vertical" size={4} style={{ width: "100%" }}>
                        {section.lines.map((line) => (
                          <Text key={`${section.label}-${line}`} style={{ color: "#d8cfb8", display: "block" }}>
                            {line}
                          </Text>
                        ))}
                      </Space>
                    </div>
                  ))}
                </Space>
              </div>
            )}

            {detailAttrLines.length < 1 && detailSpecialLines.length < 1 && detailEventSections.length < 1 && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<Text style={{ color: "#6b6355" }}>这个气运当前没有额外加成效果</Text>}
              />
            )}
          </Space>
        )}
      </Modal>
    </div>
  );
}

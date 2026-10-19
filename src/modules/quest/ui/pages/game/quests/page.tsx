"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { App, Card, Typography, Button, Space, Spin, Empty, Progress, message } from "antd";
import { CheckCircleOutlined, ClockCircleOutlined, EnvironmentOutlined } from "@ant-design/icons";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import ItemBadge from "@/modules/shared/ui/components/ItemBadge";
import ItemSourceModal from "@/modules/character/ui/components/ItemSourceModal";
import { QUEST_CATEGORY_NAMES, QUEST_TYPE_NAMES } from "@/modules/shared/constants";
import {
  getQuestRequirementActionText,
  getQuestRequirementProgressKey,
  getQuestRequirementTargetName,
} from "@/modules/quest/services/quest-requirement";
import type { QuestRequirement } from "@/types/game";

const { Text } = Typography;

interface QuestData {
  id: string;
  name: string;
  description: string;
  questCategory: "main" | "side";
  questType: string;
  acceptNpcId: string;
  completeNpcId: string;
  acceptStory?: string | null;
  completeStory?: string | null;
  requirements: QuestRequirement[];
  rewards: { xp?: number; gold?: number; items?: { itemId: string; quantity: number; itemName?: string; itemIconUrl?: string | null }[] };
  status: string;
  progress: Record<string, number>;
  isComplete: boolean;
  canAccept: boolean;
  minRealm: number;
  repeatable: boolean;
  playerRealmName?: string;
}

interface MainlineGuide {
  currentQuestId: string | null;
  status: "not_configured" | "available" | "active" | "ready_to_submit" | "completed_all";
  npcId?: string;
  npcName?: string;
  mapId?: string;
  mapName?: string;
  minRealm?: number;
  minRealmName?: string;
  hint: string;
}

interface WorldContractData {
  offerId: string;
  offerTypeLabel: string;
  contractType: "meet_contact" | "hunt_target" | "dead_drop_delivery" | "surveil_target" | "escort_cargo" | "treasure_probe";
  contractStatus: "active" | "completed" | "failed";
  title: string;
  summary: string;
  detail: string;
  progressLabel: string;
  actionLabel?: string | null;
  targetNpcId?: string | null;
  targetNpcName?: string | null;
  targetMapId?: string | null;
  targetMapName?: string | null;
  targetDistrictName?: string | null;
  rewardGold: number;
  rewardLingYu: number;
  canAdvanceByTalking: boolean;
  canAdvanceByObjective: boolean;
  currentObjectivePointLabel?: string | null;
  currentObjectiveMapName?: string | null;
  currentObjectiveDistrictName?: string | null;
  currentObjectiveActionLabel?: string | null;
  currentObjectiveHint?: string | null;
  objectiveStepStatus?: string | null;
}

function getWorldContractTypeLabel(contractType: WorldContractData["contractType"]) {
  if (contractType === "meet_contact") return "接头递话";
  if (contractType === "hunt_target") return "猎修追杀";
  if (contractType === "dead_drop_delivery") return "藏货送匣";
  if (contractType === "surveil_target") return "尾随监听";
  if (contractType === "treasure_probe") return "探宝寻机";
  return "护送黑货";
}

function getWorldContractStatusLabel(status: WorldContractData["contractStatus"]) {
  if (status === "completed") return "已结清";
  if (status === "failed") return "已断线";
  return "进行中";
}

function getMainlineStatusLabel(status: MainlineGuide["status"]) {
  if (status === "available") return "可接取";
  if (status === "active") return "进行中";
  if (status === "ready_to_submit") return "可提交";
  if (status === "completed_all") return "已完结";
  return "未配置";
}

function renderRewardContent(rewards?: QuestData["rewards"]) {
  if (!rewards) return <Text style={{ color: "#a09880", fontSize: 11 }}>无</Text>;

  const hasXp = Boolean(rewards.xp);
  const hasGold = Boolean(rewards.gold);
  const items = rewards.items || [];
  if (!hasXp && !hasGold && items.length === 0) {
    return <Text style={{ color: "#a09880", fontSize: 11 }}>无</Text>;
  }

  return (
    <Space size={[8, 4]} wrap>
      {hasXp && <Text style={{ color: "#a09880", fontSize: 11 }}>修为+{rewards.xp}</Text>}
      {hasGold && <Text style={{ color: "#a09880", fontSize: 11 }}>灵石+{rewards.gold}</Text>}
      {items.map((item) => (
        <ItemBadge
          key={`${item.itemId}-${item.quantity}`}
          name={item.itemName || item.itemId}
          iconUrl={item.itemIconUrl}
          quantity={item.quantity}
          iconSize={12}
        />
      ))}
    </Space>
  );
}

function getFirstCollectRequirement(quest: QuestData) {
  return quest.requirements.find((requirement) => requirement.type === "collect" && Boolean(requirement.targetId));
}

export default function QuestsPage() {
  const router = useRouter();
  const [quests, setQuests] = useState<QuestData[]>([]);
  const [worldContracts, setWorldContracts] = useState<WorldContractData[]>([]);
  const [worldContractsWarning, setWorldContractsWarning] = useState<string | null>(null);
  const [mainlineGuide, setMainlineGuide] = useState<MainlineGuide | null>(null);
  const [loading, setLoading] = useState(true);
  const [locatingNpcId, setLocatingNpcId] = useState<string | null>(null);
  const [sourceItem, setSourceItem] = useState<{ itemId: string; itemName: string } | null>(null);
  const { modal } = App.useApp();
  const [messageApi, contextHolder] = message.useMessage();

  const showNpcLocation = async (npcId: string) => {
    setLocatingNpcId(npcId);
    try {
      const res = await fetch(`/api/game/npc/${npcId}/location`, { cache: "no-store" });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: {
          npcId: string;
          npcName: string;
          mapId: string | null;
          mapName: string | null;
          positionX: number;
          positionY: number;
        };
      };

      if (!json.success || !json.data) {
        messageApi.error(json.error || "获取NPC位置失败");
        return;
      }

      modal.info({
        title: `${json.data.npcName} 的位置`,
        okText: "知道了",
        content: (
          <div>
            <Text style={{ color: "#a09880", fontSize: 12, display: "block" }}>
              地图：{json.data.mapName || "未知地图"}
            </Text>
            <Text style={{ color: "#e8e0d0", fontSize: 13, display: "block", marginTop: 4 }}>
              坐标：({json.data.positionX}, {json.data.positionY})
            </Text>
            <Text style={{ color: "#6b6355", fontSize: 11, display: "block", marginTop: 8 }}>
              请前往对应地图，自行移动到 NPC 位置后对话。
            </Text>
          </div>
        ),
      });
    } catch {
      messageApi.error("获取NPC位置失败");
    } finally {
      setLocatingNpcId(null);
    }
  };

  const fetchQuests = async (): Promise<{
    success: boolean;
    error?: string;
    data?: {
      quests: QuestData[];
      mainlineGuide: MainlineGuide;
      worldContracts?: WorldContractData[];
      worldContractsError?: string | null;
    };
  }> => {
    const res = await fetch("/api/game/quest/list");
    return res.json();
  };

  useEffect(() => {
    let disposed = false;

    fetchQuests()
      .then((json) => {
        if (disposed) return;
        if (json.success) {
          setQuests(json.data?.quests || []);
          setMainlineGuide(json.data?.mainlineGuide || null);
          setWorldContracts(Array.isArray(json.data?.worldContracts) ? json.data.worldContracts : []);
          setWorldContractsWarning(String(json.data?.worldContractsError || "").trim() || null);
        } else {
          setQuests([]);
          setMainlineGuide(null);
          setWorldContracts([]);
          setWorldContractsWarning(null);
          messageApi.error(json.error || "加载任务失败");
        }
        setLoading(false);
      })
      .catch(() => {
        if (disposed) return;
        messageApi.error("加载任务失败");
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [messageApi]);

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spin /></div>;

  const activeQuests = quests.filter((q) => q.status === "active");
  const completedQuests = quests.filter((q) => q.status === "completed");
  const activeWorldContracts = worldContracts.filter((contract) => contract.contractStatus === "active");
  const settledWorldContracts = worldContracts.filter((contract) => contract.contractStatus !== "active");

  return (
    <div style={{ padding: "8px" }}>
      {contextHolder}

      {worldContractsWarning ? (
        <Card
          size="small"
          style={{
            marginBottom: 10,
            background: "rgba(64, 28, 20, 0.78)",
            border: "1px solid rgba(201, 120, 76, 0.42)",
          }}
        >
          <DarkTag color="gold">世界委托提醒</DarkTag>
          <Text style={{ color: "#f2d6c7", fontSize: 12, display: "block", marginTop: 8 }}>
            {worldContractsWarning}
          </Text>
          <Text style={{ color: "#c9ae9d", fontSize: 11, display: "block", marginTop: 4 }}>
            常规任务仍可照常查看；若你刚接了开放世界委托但这里没显示，请稍后刷新任务页重试。
          </Text>
        </Card>
      ) : null}

      {mainlineGuide && (
        <Card
          size="small"
          style={{
            marginBottom: 10,
            background: "rgba(34, 28, 16, 0.75)",
            border: "1px solid #4a3f24",
          }}
        >
          <Space size={6}>
            <DarkTag color="gold">主线指引</DarkTag>
            <DarkTag color={mainlineGuide.status === "ready_to_submit" ? "green" : "blue"}>
              {getMainlineStatusLabel(mainlineGuide.status)}
            </DarkTag>
          </Space>
          <Text style={{ color: "#e8e0d0", fontSize: 12, display: "block", marginTop: 8 }}>
            {mainlineGuide.hint}
          </Text>
          {typeof mainlineGuide.minRealm === "number" && (
            <Text style={{ color: "#a09880", fontSize: 11, display: "block", marginTop: 4 }}>
              境界要求：{mainlineGuide.minRealmName || mainlineGuide.minRealm}
            </Text>
          )}
          {(mainlineGuide.npcName || mainlineGuide.mapName) && (
            <Text style={{ color: "#a09880", fontSize: 11, display: "block", marginTop: 4 }}>
              目标：{mainlineGuide.npcName || "未知NPC"}{mainlineGuide.mapName ? `（${mainlineGuide.mapName}）` : ""}
            </Text>
          )}
          {mainlineGuide.npcId && (
            <Button
              size="small"
              loading={locatingNpcId === mainlineGuide.npcId}
              style={{ marginTop: 8 }}
              onClick={() => {
                if (!mainlineGuide.npcId) return;
                void showNpcLocation(mainlineGuide.npcId);
              }}
            >
              查看NPC位置
            </Button>
          )}
        </Card>
      )}

      {/* 进行中 */}
      {activeQuests.length > 0 && (
        <>
          <Text style={{ color: "#c9a84c", fontSize: 13, display: "block", marginBottom: 6 }}>
            <ClockCircleOutlined /> 进行中 ({activeQuests.length})
          </Text>
          {activeQuests.map((q) => (
            <Card
              key={q.id}
              size="small"
              hoverable={Boolean(getFirstCollectRequirement(q))}
              onClick={() => {
                const collectRequirement = getFirstCollectRequirement(q);
                if (!collectRequirement) {
                  return;
                }
                setSourceItem({
                  itemId: collectRequirement.targetId,
                  itemName: getQuestRequirementTargetName(collectRequirement),
                });
              }}
              style={{
                marginBottom: 6,
                background: "rgba(26, 26, 46, 0.9)",
                border: `1px solid ${getFirstCollectRequirement(q) ? "rgba(201, 168, 76, 0.35)" : "#2a2520"}`,
                cursor: getFirstCollectRequirement(q) ? "pointer" : "default",
                boxShadow: getFirstCollectRequirement(q) ? "0 10px 22px rgba(0,0,0,0.16)" : "none",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Space size={4}>
                  <DarkTag color={q.questCategory === "main" ? "gold" : "default"}>
                    {QUEST_CATEGORY_NAMES[q.questCategory]}
                  </DarkTag>
                  <DarkTag color="blue">{QUEST_TYPE_NAMES[q.questType] || q.questType}</DarkTag>
                  <Text style={{ color: "#e8e0d0", fontSize: 13, fontWeight: 500 }}>{q.name}</Text>
                </Space>
                {getFirstCollectRequirement(q) && (
                  <DarkTag color="gold" style={{ fontSize: 10 }}>
                    点击任务卡查看来源
                  </DarkTag>
                )}
              </div>
              <Text style={{ color: "#6b6355", fontSize: 11, display: "block", marginTop: 4 }}>
                {q.description}
              </Text>
              {getFirstCollectRequirement(q) && (
                <div
                  style={{
                    marginTop: 6,
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: "1px dashed rgba(201, 168, 76, 0.28)",
                    background: "rgba(38, 31, 16, 0.28)",
                  }}
                >
                  <Text style={{ color: "#c9a84c", fontSize: 11 }}>
                    <EnvironmentOutlined style={{ marginRight: 4 }} />
                    这条任务可直接点击任务卡，查看所需物品来源
                  </Text>
                </div>
              )}
              <div style={{ marginTop: 4 }}>
                <Text style={{ color: "#a09880", fontSize: 11 }}>奖励：</Text>
                {renderRewardContent(q.rewards)}
              </div>

              {q.isComplete && (
                <Text style={{ color: "#c9a84c", fontSize: 11, display: "block", marginTop: 4 }}>
                  条件已满足，请返回发布NPC对话提交。
                </Text>
              )}

              {q.requirements.map((r, i) => {
                const progressKey = getQuestRequirementProgressKey(r);
                const current = q.progress[progressKey] || 0;
                const percent = Math.min(100, Math.floor((current / r.quantity) * 100));
                const actionText = getQuestRequirementActionText(r.type);
                const targetName = getQuestRequirementTargetName(r);
                const progressText = r.type === "realm"
                  ? `${q.playerRealmName || current}/${targetName || r.quantity}`
                  : `${current}/${r.quantity}`;
                const isCollectRequirement = r.type === "collect" && Boolean(r.targetId);
                return (
                  <div
                    key={i}
                    style={{
                      marginTop: 4,
                      padding: isCollectRequirement ? "6px 8px 4px" : 0,
                      borderRadius: isCollectRequirement ? 8 : 0,
                      border: isCollectRequirement ? "1px solid rgba(201, 168, 76, 0.18)" : "none",
                      background: isCollectRequirement ? "rgba(40, 32, 18, 0.2)" : "transparent",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <Text style={{ color: "#a09880", fontSize: 11 }}>
                        {r.type === "power" ? actionText : (
                          <>
                            {actionText}{" "}
                            {isCollectRequirement ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSourceItem({
                                    itemId: r.targetId,
                                    itemName: targetName,
                                  });
                                }}
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  padding: 0,
                                  color: "#e6c56d",
                                  cursor: "pointer",
                                  fontSize: 11,
                                  fontWeight: 600,
                                  textDecoration: "underline",
                                  textUnderlineOffset: 2,
                                }}
                              >
                                {targetName}
                              </button>
                            ) : targetName}
                          </>
                        )}
                      </Text>
                      <Text style={{ color: current >= r.quantity ? "#52b788" : "#a09880", fontSize: 11 }}>
                        {progressText}
                      </Text>
                    </div>
                    <Progress percent={percent} size="small" strokeColor="#c9a84c" showInfo={false} />
                    {isCollectRequirement && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSourceItem({
                            itemId: r.targetId,
                            itemName: targetName,
                          });
                        }}
                        style={{
                          marginTop: 4,
                          border: "1px solid rgba(201, 168, 76, 0.3)",
                          background: "rgba(56, 44, 18, 0.4)",
                          color: "#e6c56d",
                          borderRadius: 999,
                          padding: "2px 8px",
                          fontSize: 10,
                          cursor: "pointer",
                        }}
                      >
                        点此查看来源
                      </button>
                    )}
                  </div>
                );
              })}
            </Card>
          ))}
        </>
      )}

      {activeWorldContracts.length > 0 && (
        <>
          <Text style={{ color: "#c28cff", fontSize: 13, display: "block", marginTop: activeQuests.length > 0 ? 12 : 0, marginBottom: 6 }}>
            <EnvironmentOutlined /> 世界委托 ({activeWorldContracts.length})
          </Text>
          {activeWorldContracts.map((contract) => (
            <Card
              key={contract.offerId}
              size="small"
              style={{
                marginBottom: 6,
                background: "rgba(30, 18, 40, 0.92)",
                border: "1px solid rgba(153, 108, 194, 0.35)",
              }}
            >
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Space size={[4, 6]} wrap>
                  <DarkTag color="purple">{contract.offerTypeLabel}</DarkTag>
                  <DarkTag color={contract.contractType === "hunt_target" ? "red" : "blue"}>
                    {getWorldContractTypeLabel(contract.contractType)}
                  </DarkTag>
                  <DarkTag>{getWorldContractStatusLabel(contract.contractStatus)}</DarkTag>
                </Space>
                <Text style={{ color: "#f0e7ff", fontSize: 13, fontWeight: 600 }}>{contract.title}</Text>
                <Text style={{ color: "#d8c9ec", fontSize: 12, display: "block" }}>{contract.summary}</Text>
                <Text style={{ color: "#b7a9cf", fontSize: 12, display: "block" }}>{contract.progressLabel}</Text>
                {(contract.targetDistrictName || contract.targetMapName || contract.currentObjectivePointLabel) ? (
                  <div
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px dashed rgba(176, 134, 220, 0.28)",
                      background: "rgba(51, 32, 68, 0.36)",
                    }}
                  >
                    <Text style={{ color: "#f0d7ff", fontSize: 11, display: "block" }}>
                      当前指引：{contract.currentObjectiveActionLabel || contract.actionLabel || "先按这条线推进"}
                    </Text>
                    <Text style={{ color: "#cdbbe1", fontSize: 11, display: "block", marginTop: 4 }}>
                      去向：{contract.currentObjectiveDistrictName || contract.targetDistrictName || contract.currentObjectiveMapName || contract.targetMapName || "开放世界"}{contract.currentObjectivePointLabel ? ` · ${contract.currentObjectivePointLabel}` : ""}
                    </Text>
                    {contract.currentObjectiveHint ? (
                      <Text style={{ color: "#9fa7b9", fontSize: 11, display: "block", marginTop: 4 }}>
                        提示：{contract.currentObjectiveHint}
                      </Text>
                    ) : null}
                  </div>
                ) : null}
                <Text style={{ color: "#c9b0dd", fontSize: 11, display: "block" }}>
                  尾款：金 {contract.rewardGold} / 灵玉 {contract.rewardLingYu}
                </Text>
                <Space size={[8, 8]} wrap>
                  {contract.targetNpcId ? (
                    <Button
                      size="small"
                      onClick={() => router.push(`/game/world/npc/${contract.targetNpcId}`)}
                    >
                      查看目标人物
                    </Button>
                  ) : null}
                  {(contract.targetMapId || contract.currentObjectiveMapName || contract.targetMapName) ? (
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      onClick={() => router.push("/game/map")}
                    >
                      前往地图推进
                    </Button>
                  ) : null}
                </Space>
              </Space>
            </Card>
          ))}
        </>
      )}

      {/* 已完成 */}
      {completedQuests.length > 0 && (
        <>
          <Text style={{ color: "#52b788", fontSize: 13, display: "block", marginTop: 12, marginBottom: 6 }}>
            <CheckCircleOutlined /> 已完成 ({completedQuests.length})
          </Text>
          {completedQuests.map((q) => (
            <Card key={q.id} size="small" style={{
              marginBottom: 4,
              background: "rgba(22, 33, 30, 0.5)",
              border: "1px solid #1a2e1a",
            }}>
              <div>
                <Space size={4}>
                  <DarkTag color={q.questCategory === "main" ? "gold" : "default"}>
                    {QUEST_CATEGORY_NAMES[q.questCategory]}
                  </DarkTag>
                  <DarkTag color="green">{QUEST_TYPE_NAMES[q.questType] || q.questType}</DarkTag>
                  <Text style={{ color: "#52b788", fontSize: 12 }}>{q.name}</Text>
                  {q.repeatable && <DarkTag color="gold" style={{ fontSize: 10 }}>可重复</DarkTag>}
                </Space>
                <div style={{ marginTop: 4 }}>
                  <Text style={{ color: "#7bbf9a", fontSize: 11 }}>奖励：</Text>
                  {renderRewardContent(q.rewards)}
                </div>
              </div>
            </Card>
          ))}
        </>
      )}

      {settledWorldContracts.length > 0 && (
        <>
          <Text style={{ color: "#9fa7b9", fontSize: 13, display: "block", marginTop: 12, marginBottom: 6 }}>
            <CheckCircleOutlined /> 已结清的世界委托 ({settledWorldContracts.length})
          </Text>
          {settledWorldContracts.map((contract) => (
            <Card
              key={`settled:${contract.offerId}`}
              size="small"
              style={{
                marginBottom: 4,
                background: "rgba(22, 22, 34, 0.62)",
                border: "1px solid rgba(102, 94, 131, 0.3)",
              }}
            >
              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                <Space size={[4, 6]} wrap>
                  <DarkTag color="purple">{contract.offerTypeLabel}</DarkTag>
                  <DarkTag>{getWorldContractStatusLabel(contract.contractStatus)}</DarkTag>
                </Space>
                <Text style={{ color: "#dcd5f0", fontSize: 12 }}>{contract.title}</Text>
                <Text style={{ color: "#968daa", fontSize: 11 }}>{contract.progressLabel}</Text>
              </Space>
            </Card>
          ))}
        </>
      )}

      {activeQuests.length === 0 && completedQuests.length === 0 && activeWorldContracts.length === 0 && settledWorldContracts.length === 0 && (
        <Empty
          description={<Text style={{ color: "#6b6355" }}>暂无任务，去找NPC对话接取吧</Text>}
          style={{ marginTop: 60 }}
        />
      )}

      <ItemSourceModal
        open={Boolean(sourceItem)}
        itemId={sourceItem?.itemId || null}
        itemName={sourceItem?.itemName || null}
        onClose={() => setSourceItem(null)}
      />
    </div>
  );
}

"use client";

import { useState, useEffect, useRef, use, useCallback } from "react";
import { Button, Input, Typography, Spin, Space, message, Popconfirm } from "antd";
import { ArrowLeftOutlined, SendOutlined, ShopOutlined, DeleteOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import ItemDetailModal from "@/modules/character/ui/components/ItemDetailModal";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import GameRouteErrorCard from "@/modules/shared/ui/components/GameRouteErrorCard";
import ItemIcon from "@/modules/shared/ui/components/ItemIcon";
import { QUEST_CATEGORY_NAMES } from "@/modules/shared/constants";

const { Text, Paragraph } = Typography;

type QuestEventType = "quest.accepted" | "quest.completed";

function splitStoryLines(story: string): string[] {
  const text = (story || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const byNewline = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (byNewline.length > 1) return byNewline;

  const punctuation = new Set(["。", "！", "？", "!", "?"]);
  const lines: string[] = [];
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if (punctuation.has(ch)) {
      const line = buf.trim();
      if (line) lines.push(line);
      buf = "";
    }
  }
  const tail = buf.trim();
  if (tail) lines.push(tail);

  return lines.length ? lines : [text];
}

function buildQuestIntentText(action: "accept" | "complete", questName: string): string {
  const normalized = (questName || "").trim();
  const target = normalized
    ? (normalized.endsWith("任务") ? normalized : `${normalized}任务`)
    : "任务";
  return action === "accept" ? `我要接收${target}` : `我要完成${target}`;
}

interface QuestEventPayload {
  questId?: string;
  questName?: string;
  hint?: string;
  story?: string;
  rewards?: {
    xp?: number;
    gold?: number;
    items?: { itemId: string; quantity: number; itemName?: string; itemIconUrl?: string | null }[];
  };
}

interface NpcMessage {
  role: string;
  content: string;
  messageType?: "chat" | "event";
  eventType?: QuestEventType;
  eventPayload?: QuestEventPayload;
}

interface NpcData {
  npc: {
    id: string;
    name: string;
    title: string;
    description: string;
    hasPersonality: boolean;
    isShop: boolean;
    portraitImageUrl?: string | null;
  };
  messages: NpcMessage[];
  quests: {
    id: string;
    name: string;
    description: string;
    state: "可接取" | "可提交" | "暂不可接";
    questCategory: "main" | "side";
    questType?: "talk" | "kill" | "collect" | "detect" | "bounty";
    hint?: string;
    minRealm?: number;
    maxRealm?: number;
    minRealmName?: string;
    maxRealmName?: string;
    bountyDailyLimit?: number;
    bountyUsedCount?: number;
    bountyRemainingCount?: number;
  }[];
  quickReplies?: string[];
  shopItems: { itemId: string; price: number; item: { name: string; description: string; iconUrl?: string | null } }[] | null;
  worldAttitude?: {
    level: "neutral" | "guarded" | "cold" | "shadow_friendly";
    label: string;
    summary: string;
  };
  worldReactionHints?: string[];
  npcRoleType?: "core_anchor" | "world_service" | "roaming";
  dynamicState?: string;
  availabilityState?: "available" | "guarded" | "limited";
  scheduleLabel?: string;
  inventoryMode?: "none" | "guaranteed_base" | "world_rotation" | "gray_rotation";
  isProtectedAnchor?: boolean;
  merchantType?: "none" | "base_guaranteed" | "world_merchant" | "gray_market";
  stockRotationTag?: string | null;
  isReplaceable?: boolean;
  replacementHint?: string | null;
}

interface NpcPostResponse {
  success: boolean;
  error?: string;
  data?: {
    reply: string;
    events?: { type: QuestEventType; payload: QuestEventPayload }[];
  };
}

interface NpcQuestActionResponse {
  success: boolean;
  error?: string;
  data?: {
    userMessage?: string;
    reply?: string;
    events?: { type: QuestEventType; payload: QuestEventPayload }[];
  };
}

interface NpcClearMemoryResponse {
  success: boolean;
  error?: string;
  data?: {
    deletedCount?: number;
  };
}

function EventMessageCard({
  eventType,
  payload,
  onShowStory,
}: {
  eventType?: QuestEventType;
  payload?: QuestEventPayload;
  onShowStory?: (title: string, story: string) => void;
}) {
  if (!eventType || !payload) return null;

  const title = eventType === "quest.accepted" ? "任务已接取" : "任务已完成";
  const rewardItems = payload.rewards?.items || [];
  const story = typeof payload.story === "string" ? payload.story.trim() : "";

  return (
    <div style={{
      marginBottom: 8,
      padding: "10px 12px",
      borderRadius: 8,
      background: eventType === "quest.completed" ? "rgba(32, 72, 48, 0.5)" : "rgba(69, 90, 142, 0.45)",
      border: `1px solid ${eventType === "quest.completed" ? "#2f6b45" : "#4a5f8f"}`,
    }}>
      <Space size={6}>
        <DarkTag color={eventType === "quest.completed" ? "green" : "blue"}>{title}</DarkTag>
        <Text style={{ color: "#e8e0d0", fontWeight: 500 }}>{payload.questName || payload.questId}</Text>
        {story && onShowStory && (
          <Button
            size="small"
            type="text"
            onClick={() => onShowStory(`${title}：${payload.questName || payload.questId || ""}`, story)}
            style={{ color: "#cdd7ea" }}
          >
            剧情
          </Button>
        )}
      </Space>

      {eventType === "quest.completed" && (
        <div style={{ marginTop: 6 }}>
          {(payload.rewards?.xp || payload.rewards?.gold || rewardItems.length > 0) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Text style={{ color: "#b8dcbf", fontSize: 12, display: "block" }}>
                奖励：
                {payload.rewards?.xp ? `修为+${payload.rewards.xp} ` : ""}
                {payload.rewards?.gold ? `灵石+${payload.rewards.gold} ` : ""}
              </Text>
              {rewardItems.length > 0 && (
                <Space size={6} wrap>
                  {rewardItems.map((item) => (
                    <span key={`${item.itemId}-${item.quantity}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <ItemIcon iconUrl={item.itemIconUrl} size={14} />
                      <span style={{ color: "#b8dcbf", fontSize: 12 }}>{item.itemName || item.itemId}x{item.quantity}</span>
                    </span>
                  ))}
                </Space>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function NpcPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: npcId } = use(params);
  const [data, setData] = useState<NpcData | null>(null);
  const [messages, setMessages] = useState<NpcMessage[]>([]);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [quickRepliesLoading, setQuickRepliesLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [questActionKey, setQuestActionKey] = useState<string | null>(null);
  const [clearingMemory, setClearingMemory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [storyOverlay, setStoryOverlay] = useState<{
    title: string;
    lines: string[];
    shown: number;
  } | null>(null);

  const openStoryOverlay = useCallback((title: string, story: string) => {
    const lines = splitStoryLines(story);
    if (!lines.length) return;
    setStoryOverlay({ title, lines, shown: 1 });
  }, []);

  const nextStoryLine = useCallback(() => {
    setStoryOverlay((prev) => {
      if (!prev) return prev;
      if (prev.shown >= prev.lines.length) return null;
      return { ...prev, shown: prev.shown + 1 };
    });
  }, []);

  const loadNpcData = useCallback(async () => {
    const res = await fetch(`/api/game/npc/${npcId}`);
    const json = await res.json();
    if (!json.success) {
      setData(null);
      setMessages([]);
      setLoadError(typeof json.error === "string" && json.error.trim() ? json.error : "获取NPC信息失败");
      return false;
    }

    setLoadError("");
    setData(json.data);
    setMessages(json.data.messages || []);
    return true;
  }, [npcId]);

  const loadQuickReplies = useCallback(async () => {
    if (data?.npc?.hasPersonality === false) {
      setQuickReplies([]);
      setQuickRepliesLoading(false);
      return;
    }

    setQuickRepliesLoading(true);
    try {
      const res = await fetch(`/api/game/npc/${npcId}?includeQuickReplies=1`);
      const json = await res.json();
      if (!json.success) return;
      const replies = Array.isArray(json.data?.quickReplies)
        ? json.data.quickReplies.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
      setQuickReplies(replies.slice(0, 3));
    } finally {
      setQuickRepliesLoading(false);
    }
  }, [data?.npc?.hasPersonality, npcId]);

  const clearNpcMemory = useCallback(async () => {
    if (clearingMemory) return;

    setClearingMemory(true);
    try {
      const res = await fetch(`/api/game/npc/${npcId}`, { method: "DELETE" });
      const json = await res.json() as NpcClearMemoryResponse;
      if (!json.success) {
        messageApi.error(json.error || "清空对话记忆失败");
        return;
      }

      await loadNpcData();
      void loadQuickReplies();
      const deletedCount = Number(json.data?.deletedCount || 0);
      if (deletedCount > 0) {
        messageApi.success(`已清空 ${deletedCount} 条对话记忆`);
      } else {
        messageApi.success("当前没有可清空的对话记忆");
      }
    } catch {
      messageApi.error("网络错误");
    } finally {
      setClearingMemory(false);
    }
  }, [clearingMemory, loadNpcData, loadQuickReplies, messageApi, npcId]);

  useEffect(() => {
    let canceled = false;
    setLoadError("");
    setQuickReplies([]);
    setQuickRepliesLoading(false);
    setLoading(true);
    void loadNpcData()
      .then((loaded) => {
        if (canceled) return;
        setLoading(false);
        if (loaded) {
          void loadQuickReplies();
        }
      })
      .catch(() => {
        if (canceled) return;
        setData(null);
        setMessages([]);
        setQuickReplies([]);
        setLoadError("网络错误");
        setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [loadNpcData, loadQuickReplies]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (textInput?: string) => {
    const text = (textInput ?? input).trim();
    if (!text || sending || questActionKey) return;

    if (!textInput) {
      setInput("");
    }
    setMessages((prev) => [...prev, { role: "user", content: text, messageType: "chat" }]);
    setSending(true);

    try {
      const res = await fetch(`/api/game/npc/${npcId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const json = await res.json() as NpcPostResponse;
      if (json.success) {
        const nextMessages: NpcMessage[] = [];
        let storyToShow: { title: string; story: string } | null = null;
        for (const event of json.data?.events || []) {
          nextMessages.push({
            role: "assistant",
            content: "",
            messageType: "event",
            eventType: event.type,
            eventPayload: event.payload,
          });
          const story = typeof event.payload?.story === "string" ? event.payload.story.trim() : "";
          if (!storyToShow && story) {
            const title = event.type === "quest.accepted" ? "任务已接取" : "任务已完成";
            const questName = event.payload.questName || event.payload.questId || "";
            storyToShow = { title: `${title}：${questName}`, story };
          }
        }

        nextMessages.push({
          role: "assistant",
          content: json.data?.reply || "...",
          messageType: "chat",
        });

        setMessages((prev) => [...prev, ...nextMessages]);
        if (storyToShow) openStoryOverlay(storyToShow.title, storyToShow.story);
        await loadNpcData();
        void loadQuickReplies();
      } else {
        messageApi.error(json.error || "对话失败");
      }
    } catch {
      messageApi.error("网络错误");
    } finally {
      setSending(false);
    }
  };

  const handleQuestAction = useCallback(async (quest: NpcData["quests"][number], action: "accept" | "complete") => {
    if (sending || questActionKey) return;

    const userMessageText = buildQuestIntentText(action, quest.name);
    const currentActionKey = `${action}:${quest.id}`;

    setMessages((prev) => [...prev, { role: "user", content: userMessageText, messageType: "chat" }]);
    setQuestActionKey(currentActionKey);

    try {
      const res = await fetch(`/api/game/npc/${npcId}/quest-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          questId: quest.id,
          questName: quest.name,
        }),
      });
      const json = await res.json() as NpcQuestActionResponse;
      if (!json.success) {
        messageApi.error(json.error || "办理失败");
        return;
      }

      const nextMessages: NpcMessage[] = [];
      let storyToShow: { title: string; story: string } | null = null;
      for (const event of json.data?.events || []) {
        nextMessages.push({
          role: "assistant",
          content: "",
          messageType: "event",
          eventType: event.type,
          eventPayload: event.payload,
        });
        const story = typeof event.payload?.story === "string" ? event.payload.story.trim() : "";
        if (!storyToShow && story) {
          const title = event.type === "quest.accepted" ? "任务已接取" : "任务已完成";
          const questName = event.payload.questName || event.payload.questId || "";
          storyToShow = { title: `${title}：${questName}`, story };
        }
      }

      nextMessages.push({
        role: "assistant",
        content: json.data?.reply || "...",
        messageType: "chat",
      });

      setMessages((prev) => [...prev, ...nextMessages]);
      if (storyToShow) {
        openStoryOverlay(storyToShow.title, storyToShow.story);
      }
      await loadNpcData();
      void loadQuickReplies();
    } catch {
      messageApi.error("网络错误");
    } finally {
      setQuestActionKey(null);
    }
  }, [loadNpcData, loadQuickReplies, messageApi, npcId, openStoryOverlay, questActionKey, sending]);

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spin /></div>;
  if (!data) {
    return (
      <GameRouteErrorCard
        title="无法与此人接触"
        description={loadError || "NPC不存在"}
        retryLabel={null}
        backLabel="返回上一页"
        mapLabel="返回地图"
      />
    );
  }

  const normalizedPortraitImageUrl = typeof data.npc.portraitImageUrl === "string" && data.npc.portraitImageUrl.trim()
    ? data.npc.portraitImageUrl.trim()
    : "";
  const hasPortraitImage = normalizedPortraitImageUrl.length > 0;

  return (
    <div style={{ position: "relative", height: "100vh", overflow: "hidden", background: "#10192d" }}>
      {hasPortraitImage && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url("${normalizedPortraitImageUrl}")`,
            backgroundSize: "cover",
            backgroundPosition: "center top",
            backgroundRepeat: "no-repeat",
            opacity: 0.95,
          }}
        />
      )}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: hasPortraitImage
            ? "linear-gradient(to bottom, rgba(8, 12, 24, 0.56), rgba(8, 12, 24, 0.82))"
            : "rgba(16, 25, 45, 0.92)",
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%" }}>
        {contextHolder}
        {/* 头部 */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
          background: "#16213e", borderBottom: "1px solid #2a2520", flexShrink: 0,
        }}>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => router.back()}
            style={{ color: "#a09880" }} />
          <div style={{ flex: 1 }}>
            <Text style={{ color: "#c9a84c", fontWeight: 500 }}>{data.npc.name}</Text>
            {data.npc.title && <Text style={{ color: "#6b6355", marginLeft: 6, fontSize: 12 }}>{data.npc.title}</Text>}
          </div>
          <Popconfirm
            title="确认清空与该NPC的全部对话记忆？"
            okText="清空"
            cancelText="取消"
            okButtonProps={{ danger: true, loading: clearingMemory }}
            onConfirm={() => {
              void clearNpcMemory();
            }}
          >
            <Button
              type="text"
              icon={<DeleteOutlined />}
              loading={clearingMemory}
              style={{ color: "#d26a6a" }}
            >
              清空记忆
            </Button>
          </Popconfirm>
          {data.npc.isShop && <DarkTag icon={<ShopOutlined />} color="gold">商店</DarkTag>}
        </div>

        {data.worldAttitude && (
          <div style={{
            padding: "8px 12px",
            background: data.worldAttitude.level === "cold"
              ? "rgba(74, 29, 29, 0.54)"
              : data.worldAttitude.level === "guarded"
                ? "rgba(60, 52, 23, 0.54)"
                : "rgba(22, 33, 62, 0.58)",
            borderBottom: "1px solid #2a2520",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            flexShrink: 0,
          }}>
            <Space size={6} wrap>
              <DarkTag color={data.worldAttitude.level === "cold" ? "red" : data.worldAttitude.level === "guarded" ? "gold" : data.worldAttitude.level === "shadow_friendly" ? "purple" : "blue"}>
                {data.worldAttitude.label}
              </DarkTag>
              <Text style={{ color: "#d7def2", fontSize: 12 }}>{data.worldAttitude.summary}</Text>
            </Space>
            {(data.worldReactionHints || []).slice(0, 2).map((hint) => (
              <Text key={hint} style={{ color: "#96a3c6", fontSize: 11 }}>{hint}</Text>
            ))}
          </div>
        )}

        {(data.dynamicState || data.scheduleLabel || data.stockRotationTag) && (
          <div style={{
            padding: "8px 12px",
            background: "rgba(12, 18, 34, 0.72)",
            borderBottom: "1px solid #2a2520",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            flexShrink: 0,
          }}>
            <Space size={6} wrap>
              <DarkTag color={data.isProtectedAnchor ? "gold" : "default"}>
                {data.npcRoleType === "core_anchor" ? "核心锚点" : data.npcRoleType === "world_service" ? "世界服务" : "流动人物"}
              </DarkTag>
              {data.merchantType && data.merchantType !== "none" ? (
                <DarkTag color={data.merchantType === "gray_market" ? "purple" : data.merchantType === "base_guaranteed" ? "blue" : "default"}>
                  {data.merchantType === "gray_market" ? "灰市商人" : data.merchantType === "base_guaranteed" ? "保底商人" : "世界商人"}
                </DarkTag>
              ) : null}
              {data.stockRotationTag ? <DarkTag>{data.stockRotationTag}</DarkTag> : null}
              {data.availabilityState ? (
                <DarkTag color={data.availabilityState === "limited" ? "red" : data.availabilityState === "guarded" ? "gold" : "green"}>
                  {data.availabilityState === "limited" ? "来往受限" : data.availabilityState === "guarded" ? "谨慎接待" : "可正常接触"}
                </DarkTag>
              ) : null}
            </Space>
            {data.dynamicState ? (
              <Text style={{ color: "#d5def3", fontSize: 12 }}>{data.dynamicState}</Text>
            ) : null}
            {data.scheduleLabel ? (
              <Text style={{ color: "#93a4c9", fontSize: 11 }}>{data.scheduleLabel}</Text>
            ) : null}
            {data.replacementHint ? (
              <Text style={{ color: "#7383a7", fontSize: 11 }}>{data.replacementHint}</Text>
            ) : null}
          </div>
        )}

        {/* 任务列表 */}
        {data.quests.length > 0 && (
          <div style={{
            padding: "8px 12px", background: "rgba(22, 33, 62, 0.8)",
            borderBottom: "1px solid #2a2520", flexShrink: 0,
          }}>
            <Text style={{ color: "#a09880", fontSize: 12, display: "block", marginBottom: 6 }}>
              {data.npc.hasPersonality
                ? "任务可通过对话办理，也可点击右侧按钮"
                : "该NPC未配置AI人格，请点击右侧按钮办理任务"}
            </Text>
            {data.quests.map((q) => (
              <div key={q.id} style={{
                padding: "4px 0",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Space size={4}>
                    <DarkTag color={q.questCategory === "main" ? "gold" : "default"}>
                      {QUEST_CATEGORY_NAMES[q.questCategory] || "支线"}
                    </DarkTag>
                    <DarkTag color={q.state === "可提交" ? "green" : q.state === "可接取" ? "blue" : "default"}>
                      {q.state}
                    </DarkTag>
                    <Text style={{ color: "#e8e0d0", fontSize: 13 }}>{q.name}</Text>
                  </Space>
                  {(q.state === "可接取" || q.state === "可提交") && (
                    <Button
                      size="small"
                      type={q.state === "可提交" ? "primary" : "default"}
                      loading={questActionKey === `${q.state === "可接取" ? "accept" : "complete"}:${q.id}`}
                      disabled={sending || !!questActionKey}
                      onClick={() => {
                        void handleQuestAction(q, q.state === "可接取" ? "accept" : "complete");
                      }}
                    >
                      {q.state === "可接取" ? "接取" : "完成"}
                    </Button>
                  )}
                </div>
                {q.questType === "bounty" && typeof q.minRealm === "number" && typeof q.maxRealm === "number" && (
                  <Text style={{ color: "#a09880", fontSize: 11, display: "block", marginTop: 2 }}>
                    境界范围：{q.minRealmName || q.minRealm}-{q.maxRealmName || q.maxRealm}
                    {typeof q.bountyDailyLimit === "number" && typeof q.bountyRemainingCount === "number"
                      ? ` · 今日剩余：${q.bountyRemainingCount}/${q.bountyDailyLimit}`
                      : ""}
                  </Text>
                )}
                {q.hint && (
                  <Text style={{ color: "#6b6355", fontSize: 11, display: "block", marginTop: 2 }}>
                    {q.hint}
                  </Text>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 商店 */}
        {data.shopItems && data.shopItems.length > 0 && (
          <div style={{
            padding: "8px 12px", background: "rgba(46, 42, 26, 0.3)",
            borderBottom: "1px solid #2a2520", flexShrink: 0, maxHeight: 120, overflowY: "auto",
          }}>
            <Text style={{ color: "#c9a84c", fontSize: 12 }}>出售物品：</Text>
            {data.shopItems.map((si) => (
              <div key={si.itemId} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "2px 0", fontSize: 13,
              }}>
                <button
                  type="button"
                  onClick={() => setDetailItemId(si.itemId)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    color: "inherit",
                  }}
                  title={`查看 ${si.item?.name || si.itemId} 详情`}
                >
                  <ItemIcon iconUrl={si.item?.iconUrl} size={16} />
                  <Text style={{ color: "#e8e0d0" }}>{si.item?.name || si.itemId}</Text>
                </button>
                <Space size={4}>
                  <Text style={{ color: "#c9a84c" }}>{si.price}灵石</Text>
                  <Button size="small" onClick={async () => {
                    const res = await fetch("/api/game/shop/buy", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ npcId: data.npc.id, itemId: si.itemId }),
                    });
                    const json = await res.json();
                    if (json.success) messageApi.success("购买成功");
                    else messageApi.error(json.error || "购买失败");
                  }}>购买</Button>
                </Space>
              </div>
            ))}
          </div>
        )}

        {/* 对话区域 */}
        <div style={{ flex: 1, overflow: "auto", padding: "12px" }}>
          {data.npc.description && messages.length === 0 && (
            <Paragraph style={{ color: "#6b6355", fontSize: 12, textAlign: "center", fontStyle: "italic" }}>
              {data.npc.description}
            </Paragraph>
          )}

          {messages
            .filter((m) => !m.content.startsWith("[历史记忆摘要]"))
            .map((msg, i) => {
              if (msg.messageType === "event") {
                return (
                  <EventMessageCard
                    key={i}
                    eventType={msg.eventType}
                    payload={msg.eventPayload}
                    onShowStory={openStoryOverlay}
                  />
                );
              }

              return (
                <div key={i} style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                  marginBottom: 8,
                }}>
                  <div style={{
                    maxWidth: "80%",
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: msg.role === "user" ? "rgba(201, 168, 76, 0.15)" : "rgba(22, 33, 62, 0.8)",
                    border: `1px solid ${msg.role === "user" ? "#6b5a2f" : "#2a2520"}`,
                  }}>
                    <Text style={{ color: "#e8e0d0", fontSize: 13 }}>{msg.content}</Text>
                  </div>
                </div>
              );
            })}

          {(sending || questActionKey) && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
              <div style={{ padding: "8px 12px", background: "rgba(22, 33, 62, 0.8)", borderRadius: 8 }}>
                <Spin size="small" /> <Text style={{ color: "#6b6355", marginLeft: 4 }}>{sending ? "思考中..." : "办理中..."}</Text>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入框 */}
        {data.npc.hasPersonality && (
          <div style={{
            display: "flex", gap: 8, padding: "10px 12px",
            background: "#16213e", borderTop: "1px solid #2a2520", flexShrink: 0,
            flexDirection: "column",
          }}>
            {quickReplies.length > 0 && (
              <Space wrap size={[6, 6]}>
                {quickReplies.map((reply) => (
                  <Button
                    key={reply}
                    size="small"
                    type="default"
                    disabled={sending || !!questActionKey}
                    onClick={() => {
                      void sendMessage(reply);
                    }}
                  >
                    {reply}
                  </Button>
                ))}
              </Space>
            )}
            {quickRepliesLoading && quickReplies.length === 0 && (
              <Text style={{ color: "#6b6355", fontSize: 12 }}>正在生成推荐回复...</Text>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <Input
                placeholder="说点什么..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPressEnter={() => {
                  void sendMessage();
                }}
                disabled={sending || !!questActionKey}
                style={{ flex: 1 }}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={() => {
                  void sendMessage();
                }}
                disabled={sending || !!questActionKey || !input.trim()}
              />
            </div>
          </div>
        )}
      </div>

      <ItemDetailModal
        open={Boolean(detailItemId)}
        itemId={detailItemId}
        onClose={() => setDetailItemId(null)}
      />

      {storyOverlay && (
        <div
          onClick={nextStoryLine}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.72)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
              nextStoryLine();
            }}
            style={{
              width: "100%",
              maxWidth: 520,
              borderRadius: 12,
              border: "1px solid #2a2520",
              background: "rgba(22, 33, 62, 0.96)",
              padding: "14px 14px 10px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
            }}
          >
            <Text style={{ color: "#c9a84c", fontWeight: 500, display: "block", marginBottom: 10 }}>
              {storyOverlay.title}
            </Text>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {storyOverlay.lines.slice(0, storyOverlay.shown).map((line, idx) => (
                <Text key={`${idx}-${line}`} style={{ color: "#e8e0d0", fontSize: 13, lineHeight: "20px" }}>
                  {line}
                </Text>
              ))}
            </div>
            <Text style={{ color: "#6b6355", fontSize: 12, display: "block", marginTop: 12 }}>
              {storyOverlay.shown >= storyOverlay.lines.length ? "点击关闭" : "点击继续"}
            </Text>
          </div>
        </div>
      )}
    </div>
  );
}

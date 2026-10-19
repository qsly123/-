"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Empty, message, Spin, Tabs, Typography } from "antd";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import PlayerInfoModal from "@/modules/shared/ui/components/PlayerInfoModal";
import PlayerAvatar from "@/modules/shared/ui/components/PlayerAvatar";

const { Text, Title } = Typography;

type RankingDimension = "realm" | "cultivation" | "gold" | "power" | "wins";

type RankingEntry = {
  rank: number;
  isMe: boolean;
  playerId: string;
  name: string;
  realm: number;
  realmMajor: number;
  realmMinor: number;
  realmName: string;
  cultivationXp: number;
  gold: number;
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  combatPower: number;
  wins: number;
  avatarId: string | null;
  avatarImageUrl: string | null;
  avatarFrameId: string | null;
  avatarFrameImageUrl: string | null;
};

const DIMENSIONS: { key: RankingDimension; label: string }[] = [
  { key: "power", label: "战力榜" },
  { key: "realm", label: "境界榜" },
  { key: "cultivation", label: "修为榜" },
  { key: "gold", label: "财富榜" },
  { key: "wins", label: "胜场榜" },
];

function getRankColor(rank: number): string {
  if (rank === 1) return "#f5c542";
  if (rank === 2) return "#c0c0c0";
  if (rank === 3) return "#cd7f32";
  return "#6b6355";
}

function getMetric(entry: RankingEntry, dimension: RankingDimension): { label: string; value: string } {
  if (dimension === "realm") {
    return { label: "境界", value: entry.realmName };
  }
  if (dimension === "cultivation") {
    return { label: "修为", value: entry.cultivationXp.toLocaleString() };
  }
  if (dimension === "gold") {
    return { label: "灵石", value: entry.gold.toLocaleString() };
  }
  if (dimension === "wins") {
    return { label: "胜场", value: entry.wins.toLocaleString() };
  }
  return { label: "战力", value: entry.combatPower.toLocaleString() };
}

export default function RankingsPage() {
  const [dimension, setDimension] = useState<RankingDimension>("power");
  const [list, setList] = useState<RankingEntry[]>([]);
  const [myRank, setMyRank] = useState<RankingEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [playerInfoOpen, setPlayerInfoOpen] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const fetchRankings = useCallback(async (target: RankingDimension) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/game/rankings?dimension=${target}&limit=10`, { cache: "no-store" });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: {
          list: RankingEntry[];
          myRank: RankingEntry | null;
        };
      };

      if (json.success && json.data) {
        setList(json.data.list || []);
        setMyRank(json.data.myRank || null);
      } else {
        setList([]);
        setMyRank(null);
        messageApi.error(json.error || "加载封神榜失败");
      }
    } catch {
      setList([]);
      setMyRank(null);
      messageApi.error("网络错误");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    fetchRankings(dimension);
  }, [dimension, fetchRankings]);

  const openPlayerInfo = useCallback((playerId: string) => {
    if (!playerId) {
      return;
    }
    setSelectedPlayerId(playerId);
    setPlayerInfoOpen(true);
  }, []);

  return (
    <div style={{ padding: "8px" }}>
      {contextHolder}

      <Card
        size="small"
        style={{ marginBottom: 8, background: "rgba(26, 26, 46, 0.9)", border: "1px solid #2a2520" }}
      >
        <Title level={5} style={{ margin: 0, color: "#c9a84c" }}>封神榜</Title>
        <Text style={{ color: "#6b6355", fontSize: 12 }}>多维度总榜，实时按当前角色数据排序</Text>
      </Card>

      <Tabs
        size="small"
        activeKey={dimension}
        onChange={(key) => setDimension(key as RankingDimension)}
        items={DIMENSIONS.map((item) => ({ key: item.key, label: item.label }))}
      />

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spin /></div>
      ) : list.length === 0 ? (
        <Empty description={<Text style={{ color: "#6b6355" }}>暂无排行数据</Text>} />
      ) : (
        <>
          {list.map((entry) => {
            const metric = getMetric(entry, dimension);
            return (
              <Card
                key={entry.playerId}
                size="small"
                style={{
                  marginBottom: 4,
                  background: entry.isMe ? "rgba(201, 168, 76, 0.12)" : "rgba(26, 26, 46, 0.9)",
                  border: `1px solid ${entry.isMe ? "#6b5a2f" : "#2a2520"}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 28, textAlign: "center", color: getRankColor(entry.rank), fontSize: 16, fontWeight: 700 }}>
                    {entry.rank}
                  </div>
                  <PlayerAvatar
                    size={34}
                    avatarImageUrl={entry.avatarImageUrl}
                    avatarFrameImageUrl={entry.avatarFrameImageUrl}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                      {entry.isMe ? (
                        <Text style={{ color: "#e8e0d0", fontSize: 13, fontWeight: 500 }}>{entry.name}</Text>
                      ) : (
                        <button
                          onClick={() => openPlayerInfo(entry.playerId)}
                          style={{
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            margin: 0,
                            color: "#e8e0d0",
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: "pointer",
                          }}
                        >
                          {entry.name}
                        </button>
                      )}
                      {entry.isMe && <DarkTag color="gold" style={{ fontSize: 10, padding: "0 3px", lineHeight: "16px" }}>你</DarkTag>}
                    </div>
                    <Text style={{ color: "#6b6355", fontSize: 11 }}>
                      {entry.realmName} · 战力 {entry.combatPower.toLocaleString()} · 胜场 {entry.wins}
                    </Text>
                  </div>
                  <div style={{ textAlign: "right", minWidth: 80 }}>
                    <Text style={{ color: "#c9a84c", fontSize: 13, fontWeight: 600 }}>{metric.value}</Text>
                    <Text style={{ color: "#6b6355", fontSize: 10, display: "block" }}>{metric.label}</Text>
                  </div>
                </div>
              </Card>
            );
          })}
        </>
      )}

      {myRank && (
        <Card
          size="small"
          style={{ marginTop: 8, background: "rgba(26, 26, 46, 0.9)", border: "1px solid #2a2520" }}
        >
          <Text style={{ color: "#a09880", fontSize: 12 }}>我的名次：第 {myRank.rank} 名</Text>
        </Card>
      )}

      <PlayerInfoModal
        open={playerInfoOpen}
        playerId={selectedPlayerId}
        scope="public"
        onClose={() => setPlayerInfoOpen(false)}
      />
    </div>
  );
}

"use client";

/**
 * 道途（天赋）常驻展示。
 *
 * 原先玩家只能在抉择弹窗里看到天赋，选完弹窗关闭就再也找不到了。
 * 这里把三层（道途/流派/道心）连同当前境界实际生效的加成列出来，挂在角色页。
 * 尚未抉择的层显示"未定"，并说明几时解锁、去哪里抉择。
 */

import { useEffect, useState } from "react";
import { Card } from "antd";

interface TalentNodeView {
  key: string;
  name: string;
  kind: string;
  description: string | null;
  currentPercent: Record<string, number>;
  unlockMajor: number;
}

interface TalentOverviewView {
  major: number;
  nodes: TalentNodeView[];
  totalPercent: Record<string, number>;
  layerUnlock: Record<string, number>;
}

const LAYERS: Array<{ kind: string; label: string; realmName: string }> = [
  { kind: "direction", label: "道途", realmName: "筑基" },
  { kind: "path", label: "流派", realmName: "结丹" },
  { kind: "daoxin", label: "道心", realmName: "元婴" },
];

const STAT_LABELS: Record<string, string> = {
  maxHp: "气血",
  maxMp: "法力",
  attack: "攻击",
  defense: "防御",
  speed: "速度",
  luck: "福缘",
  spiritualSense: "神识",
  armorPenetration: "破甲",
  block: "格挡",
  skillDamageBonus: "招式增伤",
  skillDamageReduction: "招式减伤",
  artifactDamageBonus: "法宝增伤",
  artifactDamageReduction: "法宝减伤",
};

function PercentTags({ percent }: { percent: Record<string, number> }) {
  const entries = Object.entries(percent || {}).filter(([, value]) => Number(value) !== 0);
  if (entries.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
      {entries.map(([key, value]) => {
        const negative = Number(value) < 0;
        return (
          <span
            key={key}
            style={{
              fontSize: 11,
              // 带代价的道心会给负值（用血量换攻击之类），红色区分，别让人误以为是加成
              color: negative ? "#d98b7a" : "#a9b8c8",
              border: `1px solid ${negative ? "rgba(217,139,122,0.4)" : "rgba(122,106,80,0.32)"}`,
              borderRadius: 999,
              padding: "1px 7px",
            }}
          >
            {STAT_LABELS[key] || key} {Number(value) >= 0 ? "+" : ""}{Math.round(Number(value) * 100)}%
          </span>
        );
      })}
    </div>
  );
}

export function TalentPanel() {
  const [data, setData] = useState<TalentOverviewView | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/game/talent/mine")
      .then((response) => response.json())
      .then((json) => {
        if (!cancelled && json?.success && json.data) {
          setData(json.data as TalentOverviewView);
        }
      })
      .catch(() => {
        // 展示区块加载失败就算了，不影响角色页其它内容
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 一个都还没选过时整块不显示，避免角色页出现一张全空的卡
  if (!data || data.nodes.length === 0) {
    return null;
  }

  return (
    <Card
      size="small"
      title={<span style={{ color: "#c9a84c", fontSize: 13 }}>道途</span>}
      style={{
        background: "rgba(20,26,36,0.72)",
        border: "1px solid rgba(122,106,80,0.35)",
        borderRadius: 16,
        marginBottom: 8,
      }}
    >
      <div style={{ display: "grid", gap: 8 }}>
        {LAYERS.map((layer) => {
          const node = data.nodes.find((item) => item.kind === layer.kind);
          const unlockMajor = Number(data.layerUnlock?.[layer.kind] || 0);
          const reached = Number(data.major) >= unlockMajor;

          if (!node) {
            return (
              <div
                key={layer.kind}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  color: "#6b7a8c",
                  fontSize: 12,
                }}
              >
                <span style={{ color: "#8e856e", minWidth: 28 }}>{layer.label}</span>
                <span>
                  {reached ? "未定 —— 入洞府可抉择" : `未至 —— ${layer.realmName}后方可抉择`}
                </span>
              </div>
            );
          }

          return (
            <div key={layer.kind}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ color: "#8e856e", fontSize: 12, minWidth: 28 }}>{layer.label}</span>
                <span style={{ color: "#dce8f6", fontSize: 13, fontWeight: 600 }}>{node.name}</span>
              </div>
              {node.description ? (
                <div style={{ color: "#8e9aa8", fontSize: 12, lineHeight: 1.6, marginTop: 3 }}>
                  {node.description}
                </div>
              ) : null}
              <PercentTags percent={node.currentPercent} />
            </div>
          );
        })}

        <div
          style={{
            borderTop: "1px solid rgba(122,106,80,0.22)",
            paddingTop: 7,
            marginTop: 1,
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span style={{ color: "#8e856e", fontSize: 12, minWidth: 28 }}>合计</span>
          <PercentTags percent={data.totalPercent} />
        </div>
      </div>
    </Card>
  );
}

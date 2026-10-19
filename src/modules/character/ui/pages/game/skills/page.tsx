"use client";

import { useEffect, useState } from "react";
import { Button, Card, Empty, message, Modal, Space, Spin, Typography } from "antd";
import {
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowUpOutlined,
  BookOutlined,
  DeleteOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import { STATUS_NAMES, MAX_EQUIPPED_SHENTONG_SKILLS } from "@/modules/shared/constants";

const { Text } = Typography;

const SKILL_TYPE_COLORS: Record<string, string> = {
  attack: "#d4545d",
  buff: "#52b788",
  debuff: "#9d4edd",
  heal: "#457b9d",
  dot: "#c9a84c",
  aoe: "#e8d282",
  shield: "#5c7cfa",
};

const SKILL_TYPE_NAMES: Record<string, string> = {
  attack: "攻击",
  buff: "增益",
  debuff: "减益",
  heal: "治疗",
  dot: "持续伤害",
  aoe: "群攻",
  shield: "护盾",
};

const ELEMENT_COLORS: Record<string, string> = {
  金: "#c0c0c0",
  木: "#228b22",
  水: "#1e90ff",
  火: "#dc3545",
  土: "#daa520",
};

const SKILL_TARGET_NAMES: Record<string, string> = {
  self: "自己",
  enemy: "敌方单体",
  all_enemies: "敌方群体",
};

const ARTIFACT_SLOT_NAMES: Record<string, string> = {
  artifact_1: "法宝一",
  artifact_2: "法宝二",
  artifact_3: "法宝三",
  artifact_4: "法宝四",
};

type SkillEffect = {
  type?: string;
  value?: number;
  duration?: number;
  chance?: number;
};

type SkillItem = {
  id: string;
  name: string;
  description: string | null;
  skillType: string;
  target: string;
  element: string | null;
  damageBase: number;
  damageMultiplier: number;
  mpCost: number;
  cooldown: number;
  minRealm: number | null;
  maxRealm: number | null;
  minRealmName: string | null;
  maxRealmName: string | null;
  effects: SkillEffect[] | null;
  createdAt: string;
  level: number;
  sourceType: "learned" | "artifact";
  sourceItemId: string | null;
  sourceItemName: string | null;
  sourceSlot: string | null;
};

type SkillsResponseData = {
  learnedSkills?: SkillItem[];
  artifactSkills?: SkillItem[];
  equippedSkillIds?: string[];
  skillRotation?: string[];
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatRealmLimitLabel(skill: SkillItem) {
  if (skill.minRealm === null && skill.maxRealm === null) {
    return "无";
  }
  if (skill.minRealm !== null && skill.maxRealm !== null) {
    return `${skill.minRealmName || skill.minRealm} - ${skill.maxRealmName || skill.maxRealm}`;
  }
  if (skill.minRealm !== null) {
    return `最低 ${skill.minRealmName || skill.minRealm}`;
  }
  return `最高 ${skill.maxRealmName || skill.maxRealm}`;
}

function formatSkillSource(skill: SkillItem) {
  if (skill.sourceType !== "artifact") {
    return "角色已学";
  }

  const slotLabel = skill.sourceSlot ? (ARTIFACT_SLOT_NAMES[skill.sourceSlot] || skill.sourceSlot) : "法宝";
  return skill.sourceItemName ? `${slotLabel} · ${skill.sourceItemName}` : slotLabel;
}

export default function SkillsPage() {
  const router = useRouter();
  const [learnedSkills, setLearnedSkills] = useState<SkillItem[]>([]);
  const [artifactSkills, setArtifactSkills] = useState<SkillItem[]>([]);
  const [equippedSkillIds, setEquippedSkillIds] = useState<string[]>([]);
  const [skillRotation, setSkillRotation] = useState<string[]>([]);
  const [rotationDraft, setRotationDraft] = useState<string[]>([]);
  const [rotationModalOpen, setRotationModalOpen] = useState(false);
  const [savingRotation, setSavingRotation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailSkill, setDetailSkill] = useState<SkillItem | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const allSkills = [...learnedSkills, ...artifactSkills];
  const skillMap = new Map(allSkills.map((skill) => [skill.id, skill]));
  const equippedSkillSet = new Set(equippedSkillIds);
  const activeSkills = skillRotation
    .map((skillId) => skillMap.get(skillId))
    .filter((skill): skill is SkillItem => Boolean(skill));
  const equippedLearnedSkills = learnedSkills.filter((skill) => equippedSkillSet.has(skill.id));
  const unequippedLearnedSkills = learnedSkills.filter((skill) => !equippedSkillSet.has(skill.id));

  const applySkillPayload = (payload?: SkillsResponseData | null) => {
    setLearnedSkills(Array.isArray(payload?.learnedSkills) ? payload.learnedSkills : []);
    setArtifactSkills(Array.isArray(payload?.artifactSkills) ? payload.artifactSkills : []);
    setEquippedSkillIds(Array.isArray(payload?.equippedSkillIds) ? payload.equippedSkillIds : []);
    setSkillRotation(Array.isArray(payload?.skillRotation) ? payload.skillRotation : []);
  };

  useEffect(() => {
    fetch("/api/game/skills")
      .then((response) => response.json())
      .then((json) => {
        if (json.success) {
          applySkillPayload(json.data);
        } else {
          messageApi.error(json.error || "获取神通失败");
        }
      })
      .catch(() => {
        messageApi.error("获取神通失败");
      })
      .finally(() => setLoading(false));
  }, [messageApi]);

  const persistRotation = async (nextRotation: string[], successMessage: string, closeModal = false) => {
    setSavingRotation(true);
    try {
      const response = await fetch("/api/game/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillRotation: nextRotation }),
      });
      const json = await response.json();
      if (!json.success) {
        messageApi.error(json.error || "保存神通配置失败");
        return false;
      }

      setEquippedSkillIds(Array.isArray(json.data?.equippedSkillIds) ? json.data.equippedSkillIds : []);
      setSkillRotation(Array.isArray(json.data?.skillRotation) ? json.data.skillRotation : nextRotation);
      if (closeModal) {
        setRotationModalOpen(false);
      }
      messageApi.success(successMessage);
      return true;
    } catch {
      messageApi.error("保存神通配置失败");
      return false;
    } finally {
      setSavingRotation(false);
    }
  };

  const openRotationModal = () => {
    setRotationDraft(skillRotation.filter((skillId) => skillMap.has(skillId)));
    setRotationModalOpen(true);
  };

  const moveRotationSkill = (index: number, direction: -1 | 1) => {
    setRotationDraft((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [current] = next.splice(index, 1);
      next.splice(nextIndex, 0, current);
      return next;
    });
  };

  const handleEquipSkill = async (skillId: string) => {
    if (equippedSkillSet.has(skillId)) {
      return;
    }
    if (equippedSkillIds.length >= MAX_EQUIPPED_SHENTONG_SKILLS) {
      messageApi.warning(`最多只能携带 ${MAX_EQUIPPED_SHENTONG_SKILLS} 个神通，请先卸下一个`);
      return;
    }

    await persistRotation([...skillRotation, skillId], "神通已装备");
  };

  const handleUnequipSkill = async (skillId: string) => {
    await persistRotation(skillRotation.filter((currentSkillId) => currentSkillId !== skillId), "神通已卸下");
  };

  const saveRotation = async () => {
    await persistRotation(rotationDraft, "出战顺序已保存", true);
  };

  if (loading) {
    return <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>{contextHolder}<Spin /></div>;
  }

  return (
    <div style={{ padding: "8px" }}>
      {contextHolder}
      <div style={{ marginBottom: 8 }}>
        <Space size={6}>
          <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => router.push("/game/character")}>
            返回角色
          </Button>
          <Button size="small" icon={<SettingOutlined />} onClick={openRotationModal}>
            调整顺序
          </Button>
        </Space>
      </div>

      <div
        style={{
          marginBottom: 8,
          padding: "6px 8px",
          background: "rgba(26, 26, 46, 0.8)",
          borderRadius: 4,
          border: "1px solid #2a2520",
        }}
      >
        <Text style={{ color: "#a09880" }}>
          <BookOutlined /> 已学神通 {learnedSkills.length} · 已装备神通 {equippedSkillIds.length}/{MAX_EQUIPPED_SHENTONG_SKILLS} · 法宝技能 {artifactSkills.length} · 当前出战技能 {activeSkills.length}
        </Text>
        <Text style={{ color: "#6b6355", display: "block", marginTop: 4 }}>
          神通未满 {MAX_EQUIPPED_SHENTONG_SKILLS} 个时，参悟新神通会自动装备；法宝技能固定随法宝生效，只需在这里调整出手顺序。
        </Text>
      </div>

      <Card
        size="small"
        title={<Text style={{ color: "#e8e0d0" }}>当前出战顺序</Text>}
        style={{ marginBottom: 8, background: "rgba(26, 26, 46, 0.85)", border: "1px solid #2a2520" }}
        extra={<Button size="small" icon={<SettingOutlined />} onClick={openRotationModal}>排序</Button>}
      >
        {activeSkills.length > 0 ? (
          activeSkills.map((skill, index) => (
            <div
              key={`active-${skill.id}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                padding: "6px 0",
                borderBottom: index === activeSkills.length - 1 ? "none" : "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <Space size={6} wrap>
                <Text style={{ color: "#a09880", width: 18 }}>{index + 1}</Text>
                <Text style={{ color: "#e8e0d0" }}>{skill.name}</Text>
                <DarkTag color={SKILL_TYPE_COLORS[skill.skillType] || "#c9a84c"} style={{ fontSize: 10, padding: "0 4px" }}>
                  {SKILL_TYPE_NAMES[skill.skillType] || skill.skillType}
                </DarkTag>
                <DarkTag color={skill.sourceType === "artifact" ? "#c9a84c" : "#457b9d"} style={{ fontSize: 10, padding: "0 4px" }}>
                  {skill.sourceType === "artifact" ? "法宝技能" : "已装备神通"}
                </DarkTag>
              </Space>
              <Button size="small" onClick={() => setDetailSkill(skill)}>详情</Button>
            </div>
          ))
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text style={{ color: "#6b6355" }}>当前没有出战技能</Text>} />
        )}
      </Card>

      <Card
        size="small"
        title={<Text style={{ color: "#e8e0d0" }}>已装备神通</Text>}
        style={{ marginBottom: 8, background: "rgba(26, 26, 46, 0.85)", border: "1px solid #2a2520" }}
      >
        {equippedLearnedSkills.length > 0 ? (
          equippedLearnedSkills.map((skill) => (
            <Card
              key={skill.id}
              size="small"
              style={{ marginBottom: 6, background: "rgba(26, 26, 46, 0.9)", border: "1px solid #2a2520", cursor: "pointer" }}
              onClick={() => setDetailSkill(skill)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <Space size={4} wrap>
                    <ThunderboltOutlined style={{ color: SKILL_TYPE_COLORS[skill.skillType] || "#c9a84c" }} />
                    <Text style={{ color: "#e8e0d0", fontWeight: 500, fontSize: 13 }}>{skill.name}</Text>
                    <DarkTag color={SKILL_TYPE_COLORS[skill.skillType] || "#c9a84c"} style={{ fontSize: 10, padding: "0 3px" }}>
                      {SKILL_TYPE_NAMES[skill.skillType] || skill.skillType}
                    </DarkTag>
                  </Space>
                  <Text style={{ color: "#6b6355", fontSize: 11, display: "block", marginTop: 2 }}>
                    {skill.description || "暂无介绍"}
                  </Text>
                </div>
                <Space size={4}>
                  <Button size="small" onClick={(event) => { event.stopPropagation(); setDetailSkill(skill); }}>
                    详情
                  </Button>
                  <Button danger size="small" icon={<DeleteOutlined />} onClick={(event) => { event.stopPropagation(); void handleUnequipSkill(skill.id); }}>
                    卸下
                  </Button>
                </Space>
              </div>
            </Card>
          ))
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text style={{ color: "#6b6355" }}>当前没有装备神通</Text>} />
        )}
      </Card>

      <Card
        size="small"
        title={<Text style={{ color: "#e8e0d0" }}>待装备神通</Text>}
        style={{ marginBottom: 8, background: "rgba(26, 26, 46, 0.85)", border: "1px solid #2a2520" }}
      >
        {unequippedLearnedSkills.length > 0 ? (
          unequippedLearnedSkills.map((skill) => (
            <Card
              key={skill.id}
              size="small"
              style={{ marginBottom: 6, background: "rgba(26, 26, 46, 0.75)", border: "1px solid #2a2520", cursor: "pointer" }}
              onClick={() => setDetailSkill(skill)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <Space size={4} wrap>
                    <ThunderboltOutlined style={{ color: SKILL_TYPE_COLORS[skill.skillType] || "#c9a84c" }} />
                    <Text style={{ color: "#e8e0d0", fontWeight: 500, fontSize: 13 }}>{skill.name}</Text>
                    <DarkTag color={SKILL_TYPE_COLORS[skill.skillType] || "#c9a84c"} style={{ fontSize: 10, padding: "0 3px" }}>
                      {SKILL_TYPE_NAMES[skill.skillType] || skill.skillType}
                    </DarkTag>
                  </Space>
                  <Text style={{ color: "#6b6355", fontSize: 11, display: "block", marginTop: 2 }}>
                    {skill.description || "暂无介绍"}
                  </Text>
                </div>
                <Space size={4}>
                  <Button size="small" onClick={(event) => { event.stopPropagation(); setDetailSkill(skill); }}>
                    详情
                  </Button>
                  <Button size="small" type="primary" onClick={(event) => { event.stopPropagation(); void handleEquipSkill(skill.id); }}>
                    装备
                  </Button>
                </Space>
              </div>
            </Card>
          ))
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text style={{ color: "#6b6355" }}>当前没有待装备神通</Text>} />
        )}
      </Card>

      <Card
        size="small"
        title={<Text style={{ color: "#e8e0d0" }}>法宝技能</Text>}
        style={{ marginBottom: 8, background: "rgba(36, 26, 10, 0.92)", border: "1px solid #6b5a2f" }}
      >
        <Text style={{ color: "#a09880", display: "block", marginBottom: 8 }}>
          法宝技能固定跟随已装备法宝生效，不能在这里卸下，只能调整顺序。
        </Text>
        {artifactSkills.length > 0 ? (
          artifactSkills.map((skill) => (
            <Card
              key={skill.id}
              size="small"
              style={{ marginBottom: 6, background: "rgba(36, 26, 10, 0.88)", border: "1px solid #6b5a2f", cursor: "pointer" }}
              onClick={() => setDetailSkill(skill)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <Space size={4} wrap>
                    <ThunderboltOutlined style={{ color: SKILL_TYPE_COLORS[skill.skillType] || "#c9a84c" }} />
                    <Text style={{ color: "#f2d9a6", fontWeight: 500, fontSize: 13 }}>{skill.name}</Text>
                    <DarkTag color="#c9a84c" style={{ fontSize: 10, padding: "0 3px" }}>
                      {formatSkillSource(skill)}
                    </DarkTag>
                  </Space>
                  <Text style={{ color: "#b59e76", fontSize: 11, display: "block", marginTop: 2 }}>
                    {skill.description || "暂无介绍"}
                  </Text>
                </div>
                <Button size="small" onClick={(event) => { event.stopPropagation(); setDetailSkill(skill); }}>
                  详情
                </Button>
              </div>
            </Card>
          ))
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text style={{ color: "#6b6355" }}>当前没有法宝技能</Text>} />
        )}
      </Card>

      <Modal
        title={detailSkill ? `神通详情 · ${detailSkill.name}` : "神通详情"}
        open={Boolean(detailSkill)}
        footer={null}
        onCancel={() => setDetailSkill(null)}
        destroyOnHidden
      >
        {detailSkill && (
          <div>
            <Space size={4} wrap style={{ marginBottom: 8 }}>
              <DarkTag color={SKILL_TYPE_COLORS[detailSkill.skillType] || "#c9a84c"}>
                {SKILL_TYPE_NAMES[detailSkill.skillType] || detailSkill.skillType}
              </DarkTag>
              <DarkTag color="#457b9d">
                {SKILL_TARGET_NAMES[detailSkill.target] || detailSkill.target}
              </DarkTag>
              {detailSkill.element && (
                <DarkTag color={ELEMENT_COLORS[detailSkill.element] || "#6b6355"}>
                  {detailSkill.element}
                </DarkTag>
              )}
              <DarkTag color={detailSkill.sourceType === "artifact" ? "#c9a84c" : "#6b6355"}>
                {detailSkill.sourceType === "artifact" ? "法宝技能" : "角色已学"}
              </DarkTag>
            </Space>

            <Text style={{ color: "#a09880", display: "block", marginBottom: 12 }}>
              {detailSkill.description || "暂无介绍"}
            </Text>

            <Text style={{ color: "#c9a84c", fontSize: 13, display: "block", marginBottom: 4 }}>基础信息</Text>
            <Text style={{ color: "#a09880", display: "block" }}>ID：{detailSkill.id}</Text>
            <Text style={{ color: "#a09880", display: "block" }}>名称：{detailSkill.name}</Text>
            <Text style={{ color: "#a09880", display: "block" }}>来源：{formatSkillSource(detailSkill)}</Text>
            <Text style={{ color: "#a09880", display: "block", marginBottom: 12 }}>
              创建时间：{formatDateTime(detailSkill.createdAt)}
            </Text>

            <Text style={{ color: "#c9a84c", fontSize: 13, display: "block", marginBottom: 4 }}>战斗参数</Text>
            <Text style={{ color: "#a09880", display: "block" }}>类型：{SKILL_TYPE_NAMES[detailSkill.skillType] || detailSkill.skillType}</Text>
            <Text style={{ color: "#a09880", display: "block" }}>目标：{SKILL_TARGET_NAMES[detailSkill.target] || detailSkill.target}</Text>
            <Text style={{ color: "#a09880", display: "block" }}>元素：{detailSkill.element || "无"}</Text>
            <Text style={{ color: "#a09880", display: "block" }}>消耗灵力：{detailSkill.mpCost}</Text>
            <Text style={{ color: "#a09880", display: "block" }}>冷却回合：{detailSkill.cooldown}</Text>
            <Text style={{ color: "#a09880", display: "block" }}>基础伤害：{detailSkill.damageBase}</Text>
            <Text style={{ color: "#a09880", display: "block", marginBottom: 12 }}>伤害倍率：{detailSkill.damageMultiplier}</Text>

            <Text style={{ color: "#c9a84c", fontSize: 13, display: "block", marginBottom: 4 }}>境界限制</Text>
            <Text style={{ color: "#a09880", display: "block", marginBottom: 12 }}>
              {formatRealmLimitLabel(detailSkill)}
            </Text>

            <Text style={{ color: "#c9a84c", fontSize: 13, display: "block", marginBottom: 4 }}>效果列表</Text>
            {Array.isArray(detailSkill.effects) && detailSkill.effects.length > 0 ? (
              detailSkill.effects.map((effect, index) => {
                const effectType = typeof effect.type === "string" ? effect.type : "";
                const effectValue = Number(effect.value || 0);
                const effectDuration = Number(effect.duration || 0);
                const effectChance = Number(effect.chance || 0);
                return (
                  <Text key={`${detailSkill.id}-effect-${index}`} style={{ color: "#a09880", display: "block" }}>
                    {index + 1}. {STATUS_NAMES[effectType] || effectType || "unknown"}
                    {" "}· 数值 {effectValue}
                    {" "}· 持续 {effectDuration} 回合
                    {" "}· 概率 {(effectChance * 100).toFixed(0)}%
                  </Text>
                );
              })
            ) : (
              <Text style={{ color: "#6b6355", display: "block" }}>无</Text>
            )}
          </div>
        )}
      </Modal>

      <Modal
        title="调整出战顺序"
        open={rotationModalOpen}
        onCancel={() => setRotationModalOpen(false)}
        onOk={() => { void saveRotation(); }}
        okText="保存"
        cancelText="取消"
        confirmLoading={savingRotation}
        destroyOnHidden
      >
        <Text style={{ color: "#c9a84c", fontSize: 13, display: "block", marginBottom: 6 }}>
          自动战斗会按这里的顺序循环尝试施放；法宝技能也会参与排序。
        </Text>
        {rotationDraft.length > 0 ? (
          <div>
            {rotationDraft.map((skillId, index) => {
              const skill = skillMap.get(skillId);
              if (!skill) {
                return null;
              }

              return (
                <Card
                  key={`rotation-${skill.id}`}
                  size="small"
                  style={{ marginBottom: 6, background: "rgba(26, 26, 46, 0.85)", border: "1px solid #2a2520" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <Space size={6} wrap>
                      <Text style={{ color: "#a09880", width: 16 }}>{index + 1}</Text>
                      <Text style={{ color: "#e8e0d0" }}>{skill.name}</Text>
                      <DarkTag color={SKILL_TYPE_COLORS[skill.skillType] || "#c9a84c"} style={{ fontSize: 10, padding: "0 4px" }}>
                        {SKILL_TYPE_NAMES[skill.skillType] || skill.skillType}
                      </DarkTag>
                      <DarkTag color={skill.sourceType === "artifact" ? "#c9a84c" : "#457b9d"} style={{ fontSize: 10, padding: "0 4px" }}>
                        {skill.sourceType === "artifact" ? formatSkillSource(skill) : "已装备神通"}
                      </DarkTag>
                    </Space>
                    <Space size={4}>
                      <Button size="small" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => moveRotationSkill(index, -1)} />
                      <Button size="small" icon={<ArrowDownOutlined />} disabled={index === rotationDraft.length - 1} onClick={() => moveRotationSkill(index, 1)} />
                    </Space>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text style={{ color: "#6b6355" }}>当前没有可排序技能</Text>} />
        )}
      </Modal>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Space,
  Spin,
  Typography,
  Upload,
} from "antd";
import { DeleteOutlined, DownloadOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import type { RealmRewardRule } from "@/types/game";
import DarkTag from "@/modules/shared/ui/components/DarkTag";

const { Text } = Typography;
const { TextArea } = Input;

interface RealmStageDto {
  id: number;
  majorId: number;
  minor: number;
  name: string;
  realm: number;
  requiredXp: number;
  successRate: number;
  failXpLossRate: number;
  rewardRules: RealmRewardRule[];
}

interface RealmMajorDto {
  id: number;
  order: number;
  name: string;
  baseHp: number;
  baseMp: number;
  baseAtk: number;
  baseDef: number;
  baseSpiritualSense: number;
  stages: RealmStageDto[];
}

interface RealmStageDraft {
  key: string;
  id: number | null;
  majorId: number;
  minor: number;
  name: string;
  realm: number;
  requiredXp: number;
  successRate: number;
  failXpLossRate: number;
  rewardRulesText: string;
}

interface RealmMajorDraft {
  id: number;
  order: number;
  name: string;
  baseHp: number;
  baseMp: number;
  baseAtk: number;
  baseDef: number;
  baseSpiritualSense: number;
  stages: RealmStageDraft[];
}

const CHINESE_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const CHINESE_UNITS = ["", "十", "百", "千"];

function numberToChinese(value: number) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) {
    return "一";
  }
  if (n < 10) {
    return CHINESE_DIGITS[n];
  }

  const text = String(n);
  let output = "";
  for (let index = 0; index < text.length; index += 1) {
    const digit = Number(text[index]);
    const unitIndex = text.length - index - 1;
    const unit = CHINESE_UNITS[unitIndex] || "";

    if (digit === 0) {
      if (!output.endsWith("零") && index !== text.length - 1) {
        output += "零";
      }
      continue;
    }

    output += `${CHINESE_DIGITS[digit]}${unit}`;
  }

  output = output.replace(/零+/g, "零").replace(/零$/g, "");
  if (output.startsWith("一十")) {
    output = output.slice(1);
  }
  return output || "一";
}

function createStageKey() {
  return `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeStage(stage: Partial<RealmStageDto>): RealmStageDraft {
  const rewardRules = Array.isArray(stage.rewardRules) ? stage.rewardRules : [];
  const minor = Number(stage.minor || 1);
  return {
    key: stage.id ? `db-${stage.id}` : createStageKey(),
    id: stage.id ? Number(stage.id) : null,
    majorId: Number(stage.majorId || 0),
    minor,
    name: String(stage.name || "").trim() || `${numberToChinese(minor)}重`,
    realm: Number(stage.realm || 1),
    requiredXp: Number(stage.requiredXp || 0),
    successRate: Number(stage.successRate || 0),
    failXpLossRate: Number(stage.failXpLossRate || 0),
    rewardRulesText: JSON.stringify(rewardRules, null, 2),
  };
}

function sortAndNormalizeMinors(stages: RealmStageDraft[]) {
  return stages
    .slice()
    .sort((left, right) => left.minor - right.minor)
    .map((stage, index) => ({
      ...stage,
      minor: index + 1,
    }));
}

function normalizeMajor(major: Partial<RealmMajorDto>): RealmMajorDraft {
  const stages = Array.isArray(major.stages) ? major.stages : [];
  return {
    id: Number(major.id || 0),
    order: Number(major.order || 1),
    name: String(major.name || ""),
    baseHp: Number(major.baseHp || 1),
    baseMp: Number(major.baseMp || 1),
    baseAtk: Number(major.baseAtk || 1),
    baseDef: Number(major.baseDef || 1),
    baseSpiritualSense: Number(major.baseSpiritualSense || 0),
    stages: sortAndNormalizeMinors(stages.map((item) => normalizeStage(item))),
  };
}

function parseRewardRulesText(text: string, name: string): RealmRewardRule[] {
  const value = text.trim();
  if (!value) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} 奖励规则 JSON 格式错误`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${name} 奖励规则必须为数组`);
  }

  return parsed as RealmRewardRule[];
}

export default function RealmConfigManager() {
  const { message } = App.useApp();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingMajor, setCreatingMajor] = useState(false);
  const [deletingMajor, setDeletingMajor] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [majors, setMajors] = useState<RealmMajorDraft[]>([]);
  const [selectedMajorId, setSelectedMajorId] = useState<number | null>(null);

  const selectedMajor = useMemo(() => {
    if (selectedMajorId === null) {
      return null;
    }
    return majors.find((item) => item.id === selectedMajorId) || null;
  }, [majors, selectedMajorId]);

  const loadMajors = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/realm-config", {
        method: "GET",
        cache: "no-store",
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "读取境界配置失败");
      }

      const rawMajors: Array<Partial<RealmMajorDto>> = Array.isArray(result.data?.majors)
        ? (result.data.majors as Array<Partial<RealmMajorDto>>)
        : [];

      const nextMajors = rawMajors
        .map((item) => normalizeMajor(item))
        .sort((left, right) => left.order - right.order);

      setMajors(nextMajors);
      setSelectedMajorId((current) => {
        if (!nextMajors.length) {
          return null;
        }
        if (current && nextMajors.some((item) => item.id === current)) {
          return current;
        }
        return nextMajors[0].id;
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "读取境界配置失败";
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadMajors();
  }, [loadMajors]);

  function patchSelectedMajor(patch: Partial<RealmMajorDraft>) {
    if (!selectedMajorId) {
      return;
    }

    setMajors((previous) => previous.map((major) => {
      if (major.id !== selectedMajorId) {
        return major;
      }
      return {
        ...major,
        ...patch,
      };
    }));
  }

  function patchSelectedStage(stageKey: string, patch: Partial<RealmStageDraft>) {
    if (!selectedMajorId) {
      return;
    }

    setMajors((previous) => previous.map((major) => {
      if (major.id !== selectedMajorId) {
        return major;
      }

      return {
        ...major,
        stages: major.stages.map((stage) => {
          if (stage.key !== stageKey) {
            return stage;
          }
          return {
            ...stage,
            ...patch,
          };
        }),
      };
    }));
  }

  function handleAddStage() {
    if (!selectedMajorId) {
      return;
    }

    setMajors((previous) => previous.map((major) => {
      if (major.id !== selectedMajorId) {
        return major;
      }

      const nextMinor = major.stages.length + 1;
      const stage: RealmStageDraft = {
        key: createStageKey(),
        id: null,
        majorId: major.id,
        minor: nextMinor,
        name: `${numberToChinese(nextMinor)}重`,
        realm: 1,
        requiredXp: 100,
        successRate: 0.9,
        failXpLossRate: 0.2,
        rewardRulesText: "[]",
      };

      return {
        ...major,
        stages: sortAndNormalizeMinors([...major.stages, stage]),
      };
    }));
  }

  function handleDeleteStage(stageKey: string) {
    if (!selectedMajorId || !selectedMajor) {
      return;
    }
    if (selectedMajor.stages.length <= 1) {
      message.error("每个大境界至少保留 1 个小境界");
      return;
    }

    setMajors((previous) => previous.map((major) => {
      if (major.id !== selectedMajorId) {
        return major;
      }
      return {
        ...major,
        stages: sortAndNormalizeMinors(major.stages.filter((stage) => stage.key !== stageKey)),
      };
    }));
  }

  async function handleCreateMajor() {
    const maxOrder = majors.reduce((max, item) => Math.max(max, item.order), 0);
    const nextOrder = maxOrder + 1;

    setCreatingMajor(true);
    try {
      const response = await fetch("/api/admin/realm-config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          major: {
            order: nextOrder,
            name: `新大境界${nextOrder}`,
            baseHp: 100,
            baseMp: 50,
            baseAtk: 10,
            baseDef: 5,
            baseSpiritualSense: 0,
            stages: [{
              name: "一重",
              requiredXp: 100,
              successRate: 0.9,
              failXpLossRate: 0.2,
              rewardRules: [],
            }],
          },
        }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "新增大境界失败");
      }

      const created = normalizeMajor(result.data?.major || {});
      setMajors((previous) => [...previous, created].sort((left, right) => left.order - right.order));
      setSelectedMajorId(created.id);
      message.success("已新增大境界");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "新增大境界失败";
      message.error(errorMessage);
    } finally {
      setCreatingMajor(false);
    }
  }

  async function handleDeleteSelectedMajor() {
    if (!selectedMajor) {
      return;
    }

    setDeletingMajor(true);
    try {
      const response = await fetch("/api/admin/realm-config", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: selectedMajor.id }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "删除失败");
      }

      const nextMajors = majors.filter((item) => item.id !== selectedMajor.id);
      setMajors(nextMajors);
      setSelectedMajorId(nextMajors.length ? nextMajors[0].id : null);

      message.success("大境界已删除");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "删除失败";
      message.error(errorMessage);
    } finally {
      setDeletingMajor(false);
    }
  }

  async function handleSave() {
    if (!selectedMajor) {
      return;
    }

    setSaving(true);
    try {
      const stagesPayload = sortAndNormalizeMinors(selectedMajor.stages).map((stage) => ({
        id: stage.id,
        name: stage.name,
        requiredXp: stage.requiredXp,
        successRate: stage.successRate,
        failXpLossRate: stage.failXpLossRate,
        rewardRules: parseRewardRulesText(stage.rewardRulesText, `${selectedMajor.name}${stage.name}`),
      }));

      const response = await fetch("/api/admin/realm-config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          major: {
            id: selectedMajor.id,
            order: selectedMajor.order,
            name: selectedMajor.name,
            baseHp: selectedMajor.baseHp,
            baseMp: selectedMajor.baseMp,
            baseAtk: selectedMajor.baseAtk,
            baseDef: selectedMajor.baseDef,
            baseSpiritualSense: selectedMajor.baseSpiritualSense,
            stages: stagesPayload,
          },
        }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "保存失败");
      }

      const updatedMajor = normalizeMajor(result.data?.major || selectedMajor);
      setMajors((previous) => previous
        .map((item) => (item.id === updatedMajor.id ? updatedMajor : item))
        .sort((left, right) => left.order - right.order));

      message.success("境界配置已保存");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "保存失败";
      message.error(errorMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handleExportJson() {
    setExporting(true);
    try {
      const response = await fetch("/api/admin/realm-config/export");
      if (!response.ok) {
        let errorMessage = "导出失败";
        try {
          const data = await response.json();
          errorMessage = data?.error || errorMessage;
        } catch {
          // ignore parse error
        }
        message.error(errorMessage);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const disposition = response.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="(.+?)"/);
      const filename = filenameMatch?.[1] || "realm-config.json";

      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      message.success("导出成功");
    } catch {
      message.error("导出失败");
    } finally {
      setExporting(false);
    }
  }

  async function handleImportJson(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        message.error("文件不是有效的 JSON 格式");
        return;
      }

      const response = await fetch("/api/admin/realm-config/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "导入失败");
      }

      const totalMajors = Number(result.data?.totalMajors || 0);
      const totalStages = Number(result.data?.totalStages || 0);
      message.success(`导入成功：${totalMajors} 个大境界，${totalStages} 条小境界`);
      await loadMajors();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "导入失败";
      message.error(errorMessage);
    } finally {
      setImporting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spin />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Text style={{ color: "#6b6355", fontSize: 12 }}>
        支持大境界与小境界的增删改查；删除命中直接引用时会被后端拦截。
      </Text>

      <Space wrap>
        <Button icon={<PlusOutlined />} loading={creatingMajor} onClick={handleCreateMajor}>
          新增大境界
        </Button>
        <Button icon={<DownloadOutlined />} loading={exporting} onClick={handleExportJson}>
          导出 JSON
        </Button>
        <Upload
          accept=".json,application/json"
          showUploadList={false}
          beforeUpload={(file) => {
            void handleImportJson(file);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />} loading={importing}>
            导入 JSON
          </Button>
        </Upload>
      </Space>

      <Row gutter={12} align="top">
        <Col xs={24} lg={7} xl={6}>
          <Card title="大境界" size="small" styles={{ body: { padding: 10 } }}>
            {majors.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {majors
                  .slice()
                  .sort((left, right) => left.order - right.order)
                  .map((major) => {
                    const isSelected = major.id === selectedMajorId;
                    return (
                      <div
                        key={major.id}
                        onClick={() => setSelectedMajorId(major.id)}
                        style={{
                          cursor: "pointer",
                          borderRadius: 8,
                          border: `1px solid ${isSelected ? "#1677ff" : "#2a2520"}`,
                          background: isSelected ? "rgba(22,119,255,0.12)" : "#141416",
                          padding: 10,
                        }}
                      >
                        <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                          <Text style={{ color: "#f0f0f0", fontWeight: 500 }}>
                            {major.order}. {major.name}
                          </Text>
                          <Space size={8}>
                            <DarkTag color="default">{major.stages.length} 层</DarkTag>
                          </Space>
                        </Space>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无大境界配置" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={17} xl={18}>
          <Card
            size="small"
            title={selectedMajor ? `编辑：${selectedMajor.name}` : "境界配置"}
            extra={(
              <Space>
                {selectedMajor ? (
                  <Popconfirm
                    title="确认删除当前大境界？"
                    description="删除前会校验是否有直接引用，命中引用会阻止删除。"
                    onConfirm={() => handleDeleteSelectedMajor()}
                    okButtonProps={{ loading: deletingMajor }}
                    disabled={majors.length <= 1}
                  >
                    <Button danger icon={<DeleteOutlined />} disabled={majors.length <= 1}>
                      删除当前大境界
                    </Button>
                  </Popconfirm>
                ) : null}
                <Button type="primary" loading={saving} disabled={!selectedMajor} onClick={handleSave}>
                  保存当前大境界
                </Button>
              </Space>
            )}
          >
            {!selectedMajor ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择左侧大境界" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Card size="small" title="大境界基础信息">
                  <Row gutter={[12, 12]}>
                    <Col xs={24} md={8}>
                      <Text style={{ color: "#bfbfbf", fontSize: 12 }}>名称</Text>
                      <Input
                        value={selectedMajor.name}
                        onChange={(event) => patchSelectedMajor({ name: event.target.value })}
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <Text style={{ color: "#bfbfbf", fontSize: 12 }}>顺序</Text>
                      <InputNumber
                        min={1}
                        style={{ width: "100%" }}
                        value={selectedMajor.order}
                        onChange={(value) => patchSelectedMajor({ order: Number(value || 1) })}
                      />
                    </Col>
                    <Col xs={24} md={6}>
                      <Text style={{ color: "#bfbfbf", fontSize: 12 }}>基础气血</Text>
                      <InputNumber
                        min={1}
                        style={{ width: "100%" }}
                        value={selectedMajor.baseHp}
                        onChange={(value) => patchSelectedMajor({ baseHp: Number(value || 1) })}
                      />
                    </Col>
                    <Col xs={24} md={6}>
                      <Text style={{ color: "#bfbfbf", fontSize: 12 }}>基础灵力</Text>
                      <InputNumber
                        min={1}
                        style={{ width: "100%" }}
                        value={selectedMajor.baseMp}
                        onChange={(value) => patchSelectedMajor({ baseMp: Number(value || 1) })}
                      />
                    </Col>
                    <Col xs={24} md={6}>
                      <Text style={{ color: "#bfbfbf", fontSize: 12 }}>基础攻击</Text>
                      <InputNumber
                        min={1}
                        style={{ width: "100%" }}
                        value={selectedMajor.baseAtk}
                        onChange={(value) => patchSelectedMajor({ baseAtk: Number(value || 1) })}
                      />
                    </Col>
                    <Col xs={24} md={6}>
                      <Text style={{ color: "#bfbfbf", fontSize: 12 }}>基础防御</Text>
                      <InputNumber
                        min={1}
                        style={{ width: "100%" }}
                        value={selectedMajor.baseDef}
                        onChange={(value) => patchSelectedMajor({ baseDef: Number(value || 1) })}
                      />
                    </Col>
                    <Col xs={24} md={6}>
                      <Text style={{ color: "#bfbfbf", fontSize: 12 }}>基础神识</Text>
                      <InputNumber
                        min={0}
                        style={{ width: "100%" }}
                        value={selectedMajor.baseSpiritualSense}
                        onChange={(value) => patchSelectedMajor({ baseSpiritualSense: Number(value || 0) })}
                      />
                    </Col>
                  </Row>
                </Card>

                <Card
                  size="small"
                  title="小境界配置"
                  extra={(
                    <Button icon={<PlusOutlined />} onClick={handleAddStage}>
                      新增小境界
                    </Button>
                  )}
                >
                  <Space orientation="vertical" size={10} style={{ width: "100%" }}>
                    {sortAndNormalizeMinors(selectedMajor.stages).map((stage) => (
                      <Card
                        key={stage.key}
                        size="small"
                        title={`第 ${stage.minor} 层`}
                        extra={(
                          <Button
                            danger
                            type="text"
                            icon={<DeleteOutlined />}
                            disabled={selectedMajor.stages.length <= 1}
                            onClick={() => handleDeleteStage(stage.key)}
                          >
                            删除
                          </Button>
                        )}
                      >
                        <Row gutter={[12, 12]}>
                          <Col xs={24} md={8}>
                            <Text style={{ color: "#bfbfbf", fontSize: 12 }}>小境界名称（后缀）</Text>
                            <Input
                              value={stage.name}
                              onChange={(event) => patchSelectedStage(stage.key, { name: event.target.value })}
                            />
                          </Col>
                          <Col xs={24} md={8}>
                            <Text style={{ color: "#bfbfbf", fontSize: 12 }}>突破所需修为</Text>
                            <InputNumber
                              min={0}
                              style={{ width: "100%" }}
                              value={stage.requiredXp}
                              onChange={(value) => patchSelectedStage(stage.key, { requiredXp: Number(value || 0) })}
                            />
                          </Col>
                          <Col xs={24} md={8}>
                            <Text style={{ color: "#bfbfbf", fontSize: 12 }}>突破成功率（0~1）</Text>
                            <InputNumber
                              min={0}
                              max={1}
                              step={0.01}
                              style={{ width: "100%" }}
                              value={stage.successRate}
                              onChange={(value) => patchSelectedStage(stage.key, { successRate: Number(value || 0) })}
                            />
                          </Col>
                          <Col xs={24} md={8}>
                            <Text style={{ color: "#bfbfbf", fontSize: 12 }}>失败损失比例（0~1）</Text>
                            <InputNumber
                              min={0}
                              max={1}
                              step={0.01}
                              style={{ width: "100%" }}
                              value={stage.failXpLossRate}
                              onChange={(value) => patchSelectedStage(stage.key, { failXpLossRate: Number(value || 0) })}
                            />
                          </Col>
                          <Col span={24}>
                            <Text style={{ color: "#bfbfbf", fontSize: 12 }}>
                              奖励规则（JSON 数组；每条属性每次突破都会生效；probabilityMin/Max 分别对应 valueMin/Max 的权重，区间内按线性插值自动计算）
                            </Text>
                            <TextArea
                              autoSize={{ minRows: 3, maxRows: 8 }}
                              value={stage.rewardRulesText}
                              onChange={(event) => patchSelectedStage(stage.key, { rewardRulesText: event.target.value })}
                            />
                          </Col>
                        </Row>
                      </Card>
                    ))}
                  </Space>
                </Card>
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}

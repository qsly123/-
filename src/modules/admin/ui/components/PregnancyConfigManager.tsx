"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, Space, Typography } from "antd";
import { ReloadOutlined, SaveOutlined, UndoOutlined } from "@ant-design/icons";
import ReferenceSelect from "@/modules/admin/ui/components/ReferenceSelect";
import { PREGNANCY_STAGE7_FORTUNE_CONFIG_KEY } from "@/modules/character/constants/pregnancy-system";
import { SYSTEM_CONFIG_ITEMS } from "@/modules/system/services/system-config-keys";

const { Text, Title } = Typography;

type SystemConfigExportRow = {
  key: string;
  value: string;
  group: string;
  isSecret: boolean;
  description: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type SystemConfigMutationResponse = {
  success: boolean;
  error?: string;
};

function formatDateTime(value?: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed);
}

export default function PregnancyConfigManager() {
  const { message } = App.useApp();
  const configItem = useMemo(
    () => SYSTEM_CONFIG_ITEMS.find((item) => item.key === PREGNANCY_STAGE7_FORTUNE_CONFIG_KEY) || null,
    [],
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [persistedRow, setPersistedRow] = useState<SystemConfigExportRow | null>(null);
  const [draftFortuneId, setDraftFortuneId] = useState(configItem?.defaultValue || "");
  const [draftFortuneLabel, setDraftFortuneLabel] = useState("");

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/system-configs/export", {
        method: "GET",
        cache: "no-store",
      });
      const result = await response.json() as SystemConfigExportRow[] | { success?: boolean; error?: string };
      if (!response.ok || !Array.isArray(result)) {
        const errorMessage = !Array.isArray(result) && typeof result?.error === "string"
          ? result.error
          : "读取孕育配置失败";
        throw new Error(errorMessage);
      }

      const matched = result.find((item) => item.key === PREGNANCY_STAGE7_FORTUNE_CONFIG_KEY) || null;
      const nextValue = String(matched?.value || configItem?.defaultValue || "").trim();
      setPersistedRow(matched);
      setDraftFortuneId(nextValue);
      setDraftFortuneLabel("");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取孕育配置失败");
    } finally {
      setLoading(false);
    }
  }, [configItem?.defaultValue, message]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const handleRestoreDefault = useCallback(() => {
    setDraftFortuneId(String(configItem?.defaultValue || "").trim());
    setDraftFortuneLabel("");
  }, [configItem?.defaultValue]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const payload = {
        value: String(draftFortuneId || "").trim(),
        group: configItem?.group || "game",
        isSecret: false,
        description: configItem?.description || "孕育阶段 k_受精_7 首次发放的专属气运 ID",
      };

      const response = await fetch("/api/admin/systemConfigs", {
        method: persistedRow ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(persistedRow
          ? { id: PREGNANCY_STAGE7_FORTUNE_CONFIG_KEY, ...payload }
          : { key: PREGNANCY_STAGE7_FORTUNE_CONFIG_KEY, ...payload }),
      });
      const result = await response.json() as SystemConfigMutationResponse;
      if (!result.success) {
        throw new Error(result.error || "保存孕育配置失败");
      }

      message.success(payload.value ? "阶段 7 气运配置已保存" : "已清空阶段 7 气运配置");
      await loadConfig();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存孕育配置失败");
    } finally {
      setSaving(false);
    }
  }, [configItem?.description, configItem?.group, draftFortuneId, loadConfig, message, persistedRow]);

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Card
        loading={loading}
        title={<Title level={4} style={{ margin: 0 }}>孕育状态配置</Title>}
        extra={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadConfig()} loading={loading}>
              重新加载
            </Button>
            <Button icon={<UndoOutlined />} onClick={handleRestoreDefault} disabled={loading || saving}>
              恢复默认
            </Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={() => void handleSave()} loading={saving}>
              保存配置
            </Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Text code>{PREGNANCY_STAGE7_FORTUNE_CONFIG_KEY}</Text>
          <Text style={{ color: "#a09880" }}>
            {configItem?.description || "用于配置玩家进入 k_受精_7 后首次发放的专属气运 ID。"}
          </Text>
          <Text style={{ color: "#6b6355", fontSize: 12 }}>
            `k_受精_4 / 5 / 6` 的专属奇遇由代码固定触发，不在后台开放编辑；这里只允许配置 `k_受精_7` 首次到达时额外发放的气运。
          </Text>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
            <Text style={{ color: "#6b6355", fontSize: 12 }}>
              当前状态：{persistedRow ? "已落库" : "尚未落库，将按默认值创建"}
            </Text>
            <Text style={{ color: "#6b6355", fontSize: 12 }}>
              最近更新时间：{formatDateTime(persistedRow?.updatedAt)}
            </Text>
          </div>
        </Space>
      </Card>

      <Card loading={loading} title="阶段 7 专属气运">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <ReferenceSelect
            entity="fortunes"
            labelKey="name"
            value={draftFortuneId || undefined}
            onChange={(next) => {
              setDraftFortuneId(String(next || "").trim());
              if (!next) {
                setDraftFortuneLabel("");
              }
            }}
            onSelectOption={(next, option) => {
              setDraftFortuneId(String(next || "").trim());
              setDraftFortuneLabel(String(option?.rawLabel || "").trim());
            }}
            allowClear
            disabled={loading || saving}
            placeholder="留空则不额外发放气运"
          />
          <Text style={{ color: "#6b6355", fontSize: 12 }}>
            当前草稿：{draftFortuneId ? `${draftFortuneLabel || "已选择气运"}（${draftFortuneId}）` : "未配置，玩家进入 k_受精_7 时只保留怀孕阶段本身"}
          </Text>
          <div style={{ display: "grid", gap: 6 }}>
            <Text style={{ color: "#a09880", fontSize: 12 }}>
              发放规则：同一轮孕育周期内，首次进入 `k_受精_7` 时尝试发放 1 次。
            </Text>
            <Text style={{ color: "#a09880", fontSize: 12 }}>
              容错规则：若这里留空，或填入的气运 ID 无效，系统会跳过发放，但不会阻塞 `k_受精_7` 阶段推进。
            </Text>
            <Text style={{ color: "#a09880", fontSize: 12 }}>
              展示口径：主页、资料卡、双修摘要继续统一读取宿主 `pregnancyDisplayStatus`，不会受这里的编辑方式影响。
            </Text>
          </div>
        </Space>
      </Card>
    </Space>
  );
}

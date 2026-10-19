"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  App,
  Button,
  Card,
  Col,
  Collapse,
  Input,
  Row,
  Space,
  Switch,
  Tabs,
  Typography,
  Upload,
} from "antd";
import { DownloadOutlined, ReloadOutlined, SaveOutlined, UploadOutlined } from "@ant-design/icons";
import type { AdminFieldConfig, AdminJsonSchema } from "@/modules/admin/services/admin-ui-config";
import AdminEntityManager from "@/modules/admin/ui/components/AdminEntityManager";
import JsonFieldEditor from "@/modules/admin/ui/components/JsonFieldEditor";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import {
  FEATURE_SWITCH_CONFIG_KEYS,
  LLM_CONFIG_SECTIONS,
  LLM_OPTIONAL_OVERRIDE_CONFIG_KEYS,
  SYSTEM_CONFIG_ITEMS,
  type SystemConfigGroup,
  type SystemConfigItem,
} from "@/modules/system/services/system-config-keys";

const { Text } = Typography;
const { TextArea } = Input;

const CONFIG_GROUPS: SystemConfigGroup[] = ["llm", "oauth", "game", "prompt", "plugin"];

const CONFIG_GROUP_LABELS: Record<SystemConfigGroup, string> = {
  llm: "LLM",
  oauth: "OAuth",
  game: "游戏",
  prompt: "提示词",
  plugin: "插件",
};

const BOOLEAN_CONFIG_KEYS = new Set<string>(FEATURE_SWITCH_CONFIG_KEYS);
const OPTIONAL_EMPTY_CONFIG_KEYS = new Set<string>(LLM_OPTIONAL_OVERRIDE_CONFIG_KEYS);
const PROMPT_VARIABLE_HELP: Record<string, Array<{ variable: string; meaning: string }>> = {
  NPC_QUEST_REPLY_PROMPT: [
    { variable: "npcPersonality", meaning: "NPC 人设文本" },
    { variable: "npcIdentityContext", meaning: "NPC 身份档案文本" },
    { variable: "worldContext", meaning: "当前世界上下文" },
    { variable: "linZhaoweiRule", meaning: "林昭微专属语气规则" },
  ],
  NPC_TOOL_CHAT_PROMPT: [
    { variable: "npcPersonality", meaning: "NPC 人设文本" },
    { variable: "npcIdentityContext", meaning: "NPC 身份档案文本" },
    { variable: "worldContext", meaning: "当前世界上下文" },
    { variable: "memorySummarySection", meaning: "历史记忆摘要段落" },
    { variable: "linZhaoweiRule", meaning: "林昭微专属语气规则" },
  ],
  NPC_SUMMARY_PROMPT: [
    { variable: "npcName", meaning: "NPC 名称" },
  ],
};

interface SystemConfigRow {
  id: string;
  key: string;
  value: string;
  group: string;
  isSecret: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SystemConfigExportRow {
  key: string;
  value: string;
  group: string;
  isSecret: boolean;
  description: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface SystemConfigMutationResponse {
  success: boolean;
  error?: string;
}

interface SystemConfigImportResponse {
  success: boolean;
  data?: {
    total: number;
    created: number;
    updated: number;
  };
  error?: string;
}

interface SystemConfigItemsResponse {
  success: boolean;
  data?: {
    items: SystemConfigItem[];
  };
  error?: string;
}

function parseBooleanConfigValue(value: string) {
  return value.trim().toLowerCase() === "true";
}

function isJsonConfigKey(key: string) {
  return key.endsWith("_JSON");
}

function isMultilineConfigKey(key: string) {
  return isJsonConfigKey(key) || key.endsWith("_PROMPT");
}

function validateJsonConfigValue(key: string, value: string) {
  if (!isJsonConfigKey(key)) {
    return;
  }
  const raw = value.trim();
  if (!raw) {
    return;
  }
  try {
    JSON.parse(raw);
  } catch {
    throw new Error(`${key} JSON 格式错误`);
  }
}

function toConfigInputValue(key: string, value: string) {
  if (BOOLEAN_CONFIG_KEYS.has(key)) {
    return parseBooleanConfigValue(value);
  }
  return value;
}

function toConfigPersistedValue(key: string, value: string | boolean | undefined) {
  if (BOOLEAN_CONFIG_KEYS.has(key)) {
    return value === true ? "true" : "false";
  }
  return String(value ?? "");
}

export default function SystemConfigManager() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [savingGroup, setSavingGroup] = useState<SystemConfigGroup | null>(null);
  const [importing, setImporting] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(CONFIG_GROUPS[0]);
  const [configItems, setConfigItems] = useState<SystemConfigItem[]>([...SYSTEM_CONFIG_ITEMS]);
  const [rowsByKey, setRowsByKey] = useState<Record<string, SystemConfigRow>>({});
  const [draftValues, setDraftValues] = useState<Record<string, string | boolean>>({});

  const groupedItems = useMemo(() => {
    return CONFIG_GROUPS.reduce<Record<SystemConfigGroup, SystemConfigItem[]>>((acc, group) => {
      acc[group] = configItems.filter((item) => item.group === group);
      return acc;
    }, {
      llm: [],
      oauth: [],
      game: [],
      prompt: [],
      plugin: [],
    });
  }, [configItems]);

  const pluginGroupedItems = useMemo(() => {
    const groups = new Map<string, { pluginId: string; pluginName: string; items: SystemConfigItem[] }>();
    for (const item of groupedItems.plugin) {
      const pluginId = String(item.pluginId || "").trim() || "unknown-plugin";
      const pluginName = String(item.pluginName || item.pluginId || pluginId).trim() || pluginId;
      const current = groups.get(pluginId) || { pluginId, pluginName, items: [] };
      current.items.push(item);
      groups.set(pluginId, current);
    }
    return Array.from(groups.values()).sort((a, b) => a.pluginName.localeCompare(b.pluginName, "zh-CN"));
  }, [groupedItems]);

  const unknownConfigCount = useMemo(() => {
    const knownKeys = new Set(configItems.map((item) => item.key));
    return Object.keys(rowsByKey).filter((key) => !knownKeys.has(key)).length;
  }, [configItems, rowsByKey]);

  const loadConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const [itemRes, valueRes] = await Promise.all([
        fetch("/api/admin/system-config-items", { method: "GET", cache: "no-store" }),
        fetch("/api/admin/system-configs/export", { method: "GET", cache: "no-store" }),
      ]);
      const itemResult = await itemRes.json() as SystemConfigItemsResponse;
      const valueResult = await valueRes.json() as SystemConfigExportRow[] | { success?: boolean; error?: string };

      if (!valueRes.ok || !Array.isArray(valueResult)) {
        const errorMessage = !Array.isArray(valueResult) && typeof valueResult?.error === "string"
          ? valueResult.error
          : "读取系统配置失败";
        throw new Error(errorMessage);
      }

      const nextRowsByKey: Record<string, SystemConfigRow> = {};
      for (const row of valueResult) {
        if (typeof row.key === "string" && row.key.trim()) {
          nextRowsByKey[row.key] = {
            id: row.key,
            key: row.key,
            value: row.value,
            group: row.group,
            isSecret: row.isSecret,
            description: row.description,
            createdAt: row.createdAt || "",
            updatedAt: row.updatedAt || "",
          };
        }
      }

      const itemCandidates = Array.isArray(itemResult.data?.items) && itemResult.success
        ? itemResult.data.items
        : [...SYSTEM_CONFIG_ITEMS];
      const dedupeKeySet = new Set<string>();
      const nextConfigItems: SystemConfigItem[] = itemCandidates
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          key: String(item.key || "").trim(),
          group: item.group,
          isSecret: Boolean(item.isSecret),
          description: String(item.description || "").trim(),
          defaultValue: item.defaultValue,
          jsonSchema: item.jsonSchema,
          pluginId: typeof item.pluginId === "string" ? item.pluginId : undefined,
          pluginName: typeof item.pluginName === "string" ? item.pluginName : undefined,
          hiddenInSystemConfigPage: Boolean(item.hiddenInSystemConfigPage),
        }))
        .filter((item) => {
          if (!item.key || !item.description || item.hiddenInSystemConfigPage || dedupeKeySet.has(item.key)) {
            return false;
          }
          dedupeKeySet.add(item.key);
          return true;
        });

      const nextDraftValues: Record<string, string | boolean> = {};
      for (const item of nextConfigItems) {
        const currentValue = nextRowsByKey[item.key]?.value ?? item.defaultValue ?? "";
        nextDraftValues[item.key] = toConfigInputValue(item.key, currentValue);
      }

      setConfigItems(nextConfigItems);
      setRowsByKey(nextRowsByKey);
      setDraftValues(nextDraftValues);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "读取系统配置失败";
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  const patchDraftValue = useCallback((key: string, value: string | boolean) => {
    setDraftValues((previous) => ({
      ...previous,
      [key]: value,
    }));
  }, []);

  const handleSaveItems = useCallback(async (
    items: SystemConfigItem[],
    successLabel: string,
    savingKey: SystemConfigGroup,
  ) => {
    if (!items.length) {
      return;
    }

    setSavingGroup(savingKey);
    try {
      for (const item of items) {
        const persistedValue = toConfigPersistedValue(item.key, draftValues[item.key]);
        validateJsonConfigValue(item.key, persistedValue);
        const allowEmpty = OPTIONAL_EMPTY_CONFIG_KEYS.has(item.key);
        const existed = Boolean(rowsByKey[item.key]);
        if (!allowEmpty && !persistedValue.trim()) {
          throw new Error(`${item.key} 不能为空`);
        }
        if (allowEmpty && !persistedValue.trim() && !existed) {
          continue;
        }

        const payload = {
          value: persistedValue,
          group: item.group,
          isSecret: item.isSecret,
          description: item.description,
        };

        const response = await fetch("/api/admin/systemConfigs", {
          method: existed ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(existed
            ? { id: item.key, ...payload }
            : { key: item.key, ...payload }),
        });

        const result = await response.json() as SystemConfigMutationResponse;
        if (!result.success) {
          throw new Error(result.error || `${item.key} 保存失败`);
        }
      }

      message.success(`${successLabel}已保存`);
      await loadConfigs();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "保存失败";
      message.error(errorMessage);
    } finally {
      setSavingGroup(null);
    }
  }, [draftValues, loadConfigs, message, rowsByKey]);

  const handleSaveGroup = useCallback(async (group: SystemConfigGroup) => {
    await handleSaveItems(groupedItems[group], `${CONFIG_GROUP_LABELS[group]}配置`, group);
  }, [groupedItems, handleSaveItems]);

  const handleExportSystemConfigs = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/system-configs/export");
      if (!res.ok) {
        const data = await res.json();
        message.error(data.error || "导出失败");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const disposition = res.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="(.+?)"/);
      const filename = filenameMatch?.[1] || "system-configs.json";

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      message.success("导出成功");
    } catch {
      message.error("导出失败");
    }
  }, [message]);

  const handleImportSystemConfigs = useCallback(async (file: File) => {
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

      if (!Array.isArray(data)) {
        message.error("JSON 内容必须是数组格式");
        return;
      }

      const res = await fetch("/api/admin/system-configs/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json() as SystemConfigImportResponse;

      if (!result.success || !result.data) {
        message.error(result.error || "导入失败");
        return;
      }

      message.success(`导入成功：共 ${result.data.total} 项，新增 ${result.data.created} 项，更新 ${result.data.updated} 项`);
      await loadConfigs();
    } catch {
      message.error("导入失败");
    } finally {
      setImporting(false);
    }
  }, [loadConfigs, message]);

  const renderConfigItemGrid = useCallback((items: SystemConfigItem[]) => (
    <Row gutter={[12, 12]}>
      {items.map((item) => {
        const existed = Boolean(rowsByKey[item.key]);
        const value = draftValues[item.key];
        const multiline = isMultilineConfigKey(item.key);
        const promptVariableHelp = PROMPT_VARIABLE_HELP[item.key] || [];
        const optionalEmpty = OPTIONAL_EMPTY_CONFIG_KEYS.has(item.key);

        return (
          <Col key={item.key} xs={24} lg={12}>
            <Card
              size="small"
              title={(
                <Space wrap>
                  <Text code>{item.key}</Text>
                  <DarkTag color={existed ? "green" : "gold"}>{existed ? "已存在" : "将创建"}</DarkTag>
                  {item.isSecret && <DarkTag color="red">敏感</DarkTag>}
                  {optionalEmpty && <DarkTag color="blue">可留空</DarkTag>}
                </Space>
              )}
            >
              <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                <Text style={{ color: "#a09880" }}>{item.description}</Text>
                {promptVariableHelp.length > 0 && (
                  <Text style={{ color: "#6b6355" }}>
                    可用变量：{promptVariableHelp.map((entry) => `{{${entry.variable}}}=${entry.meaning}`).join("；")}
                  </Text>
                )}

                {BOOLEAN_CONFIG_KEYS.has(item.key) ? (
                  <Switch
                    checked={Boolean(value)}
                    checkedChildren="true"
                    unCheckedChildren="false"
                    onChange={(checked) => patchDraftValue(item.key, checked)}
                  />
                ) : isJsonConfigKey(item.key) ? (
                  <JsonFieldEditor
                    field={{
                      key: item.key,
                      label: item.key,
                      type: "json",
                      placeholder: `请输入 ${item.key}`,
                      jsonSchema: item.jsonSchema as AdminJsonSchema | undefined,
                    } as AdminFieldConfig}
                    value={String(value ?? "")}
                    onChange={(nextValue) => patchDraftValue(item.key, nextValue)}
                  />
                ) : multiline ? (
                  <TextArea
                    rows={4}
                    value={String(value ?? "")}
                    placeholder={`请输入 ${item.key}`}
                    onChange={(event) => patchDraftValue(item.key, event.target.value)}
                  />
                ) : item.isSecret ? (
                  <Input.Password
                    value={String(value ?? "")}
                    placeholder={`请输入 ${item.key}`}
                    onChange={(event) => patchDraftValue(item.key, event.target.value)}
                  />
                ) : (
                  <Input
                    value={String(value ?? "")}
                    placeholder={`请输入 ${item.key}`}
                    onChange={(event) => patchDraftValue(item.key, event.target.value)}
                  />
                )}
              </Space>
            </Card>
          </Col>
        );
      })}
    </Row>
  ), [draftValues, patchDraftValue, rowsByKey]);

  const tabItems = useMemo(() => {
    const visualTabs: Array<{ key: string; label: string; children: ReactNode }> = CONFIG_GROUPS.map((group) => ({
      key: group,
      label: CONFIG_GROUP_LABELS[group],
      children: (
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Card
            loading={loading}
            title={`${CONFIG_GROUP_LABELS[group]} 配置`}
            extra={(
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={savingGroup === group}
                onClick={() => void handleSaveGroup(group)}
              >
                保存本组
              </Button>
            )}
          >
            {group === "llm" ? (
              <Space orientation="vertical" size={10} style={{ width: "100%" }}>
                {LLM_CONFIG_SECTIONS.map((section) => {
                  const sectionItems = section.keys
                    .map((key) => groupedItems.llm.find((item) => item.key === key))
                    .filter((item): item is SystemConfigItem => Boolean(item));
                  if (!sectionItems.length) {
                    return null;
                  }
                  return (
                    <Card key={section.id} size="small" title={section.title}>
                      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                        <Text style={{ color: "#a09880" }}>{section.description}</Text>
                        {section.allowEmptyValues && (
                          <Text style={{ color: "#6b6355" }}>本区留空会回退到通用模型默认配置。</Text>
                        )}
                        {renderConfigItemGrid(sectionItems)}
                      </Space>
                    </Card>
                  );
                })}
              </Space>
            ) : group === "plugin" ? (
              <Collapse
                defaultActiveKey={pluginGroupedItems.map((item) => item.pluginId)}
                items={pluginGroupedItems.map((pluginGroup) => ({
                  key: pluginGroup.pluginId,
                  label: `${pluginGroup.pluginName} (${pluginGroup.items.length})`,
                  children: (
                    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <Button
                          type="primary"
                          icon={<SaveOutlined />}
                          loading={savingGroup === group}
                          onClick={() => void handleSaveItems(pluginGroup.items, `${pluginGroup.pluginName}配置`, group)}
                        >
                          保存当前插件
                        </Button>
                      </div>
                      {renderConfigItemGrid(pluginGroup.items)}
                    </Space>
                  ),
                }))}
              />
            ) : (
              renderConfigItemGrid(groupedItems[group])
            )}
          </Card>
        </Space>
      ),
    }));

    return [
      ...visualTabs,
      {
        key: "table-overview",
        label: "表格总览",
        children: <AdminEntityManager entity="systemConfigs" />,
      },
    ];
  }, [groupedItems, handleSaveGroup, handleSaveItems, loading, pluginGroupedItems, renderConfigItemGrid, savingGroup]);

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Card>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void loadConfigs()} loading={loading}>
            刷新配置
          </Button>
          <Button icon={<DownloadOutlined />} onClick={() => void handleExportSystemConfigs()}>
            导出配置
          </Button>
          <Upload
            accept=".json"
            showUploadList={false}
            beforeUpload={(file) => {
              void handleImportSystemConfigs(file);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />} loading={importing}>
              导入配置
            </Button>
          </Upload>
          {unknownConfigCount > 0 && (
            <Text style={{ color: "#a09880" }}>
              检测到 {unknownConfigCount} 个非标准配置项，仅在“表格总览”可编辑
            </Text>
          )}
        </Space>
      </Card>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </Space>
  );
}

"use client";

import { useState } from "react";
import { App, Button, Card, Form, Input, Select, Space, Typography } from "antd";
import ReferenceSelect from "@/modules/admin/ui/components/ReferenceSelect";
import JsonFieldEditor from "@/modules/admin/ui/components/JsonFieldEditor";
import type { AdminFieldConfig } from "@/modules/admin/services/admin-ui-config";

const { Text } = Typography;
const { TextArea } = Input;

type TargetType = "all" | "custom";

type SendResponse = {
  success: boolean;
  error?: string;
  data?: {
    sentCount: number;
    unmatchedRecipients: string[];
  };
};

const MAIL_REWARD_FIELD: AdminFieldConfig = {
  key: "rewardText",
  label: "奖励",
  type: "json",
  placeholder: "{\"gold\":100,\"xp\":50,\"items\":[{\"itemId\":\"item_healing_pill_low\",\"quantity\":2}]}",
  jsonSchema: {
    kind: "reward-object",
  },
};

function parseRecipientTokens(input: unknown) {
  if (typeof input !== "string") {
    return [] as string[];
  }

  return input
    .split(/\r?\n|,|，/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export default function AdminMailSend() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [sending, setSending] = useState(false);
  const [playerPickerValue, setPlayerPickerValue] = useState<string | undefined>(undefined);
  const [lastResult, setLastResult] = useState<{ sentCount: number; unmatchedRecipients: string[] } | null>(null);

  const targetType = Form.useWatch("targetType", form) as TargetType | undefined;

  async function handleSubmit() {
    try {
      const values = await form.validateFields();
      const target = (values.targetType || "all") as TargetType;
      const rewardText = typeof values.rewardText === "string" ? values.rewardText.trim() : "";
      let reward: Record<string, unknown> = {};

      if (rewardText) {
        try {
          const parsed = JSON.parse(rewardText) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            message.error("奖励 JSON 必须是对象格式");
            return;
          }
          reward = parsed as Record<string, unknown>;
        } catch {
          message.error("奖励 JSON 格式错误");
          return;
        }
      }

      if (target === "custom") {
        const recipients = typeof values.recipients === "string" ? values.recipients.trim() : "";
        if (!recipients) {
          message.error("请填写收件角色");
          return;
        }
      }

      setSending(true);
      const res = await fetch("/api/admin/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: target,
          recipients: values.recipients || "",
          title: values.title,
          content: values.content || "",
          reward,
        }),
      });

      const json = await res.json() as SendResponse;
      if (!json.success || !json.data) {
        message.error(json.error || "发送失败");
        return;
      }

      setLastResult(json.data);
      message.success(`发送完成，共 ${json.data.sentCount} 封`);
      if (json.data.unmatchedRecipients.length > 0) {
        message.warning(`有 ${json.data.unmatchedRecipients.length} 个收件项未匹配角色`);
      }
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) {
        return;
      }
      message.error("发送失败");
    } finally {
      setSending(false);
    }
  }

  function handleReset() {
    form.resetFields();
    form.setFieldsValue({
      targetType: "all",
      rewardText: "{}",
      content: "",
      recipients: "",
    });
    setPlayerPickerValue(undefined);
  }

  function appendRecipient(token?: string) {
    const text = (token || "").trim();
    if (!text) {
      return;
    }

    const currentRecipients = parseRecipientTokens(form.getFieldValue("recipients"));
    if (!currentRecipients.includes(text)) {
      currentRecipients.push(text);
      form.setFieldsValue({ recipients: currentRecipients.join("\n") });
    }
  }

  return (
    <Card
      title="邮件发送"
      extra={(
        <Space>
          <Button onClick={handleReset}>重置</Button>
          <Button type="primary" loading={sending} onClick={() => void handleSubmit()}>
            发送邮件
          </Button>
        </Space>
      )}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          targetType: "all",
          rewardText: "{}",
          content: "",
          recipients: "",
        }}
      >
        <Form.Item label="发送范围" name="targetType" rules={[{ required: true, message: "请选择发送范围" }]}>
          <Select
            options={[
              { label: "全服角色", value: "all" },
              { label: "指定角色", value: "custom" },
            ]}
          />
        </Form.Item>

        {targetType === "custom" && (
          <>
            <Form.Item label="选择角色（选择后自动加入下方输入框）">
              <ReferenceSelect
                value={playerPickerValue}
                entity="players"
                labelKey="name"
                allowClear
                placeholder="搜索角色名并选择"
                onChange={(value) => setPlayerPickerValue(value)}
                onSelectOption={(_, option) => {
                  appendRecipient(option?.rawLabel);
                  setPlayerPickerValue(undefined);
                }}
              />
            </Form.Item>

            <Form.Item
              label="收件角色（每行一个角色ID或角色名，也支持逗号分隔）"
              name="recipients"
              rules={[{ required: true, message: "请输入收件角色" }]}
            >
              <TextArea
                rows={5}
                placeholder={"player_id_1\nplayer_id_2\n角色名A,角色名B"}
              />
            </Form.Item>
          </>
        )}

        <Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]}>
          <Input maxLength={100} placeholder="输入邮件标题" />
        </Form.Item>

        <Form.Item label="正文" name="content">
          <TextArea rows={4} maxLength={2000} placeholder="输入邮件正文（可为空）" />
        </Form.Item>

        <Form.Item label="奖励 JSON" name="rewardText" rules={[{ required: true, message: "请输入奖励 JSON" }]}>
          <JsonFieldEditor field={MAIL_REWARD_FIELD} />
        </Form.Item>
      </Form>

      {lastResult && (
        <div style={{ marginTop: 12 }}>
          <Text style={{ color: "#a09880", display: "block" }}>
            最近一次发送：共 {lastResult.sentCount} 封
          </Text>
          {lastResult.unmatchedRecipients.length > 0 && (
            <Text style={{ color: "#d4545d", display: "block", marginTop: 4 }}>
              未匹配：{lastResult.unmatchedRecipients.join("、")}
            </Text>
          )}
        </div>
      )}
    </Card>
  );
}

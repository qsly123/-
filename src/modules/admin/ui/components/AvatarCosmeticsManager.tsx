"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Typography, Upload } from "antd";
import { PlusOutlined, UploadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import GameImage from "@/modules/shared/ui/components/GameImage";

const { Text } = Typography;

type AssetKind = "avatar" | "avatar-frame";

interface BaseAssetRow {
  id: string;
  name: string;
  imageUrl: string;
  isPublic: boolean;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface AvatarAssetRow extends BaseAssetRow {
  gender: "男" | "女";
}

type AvatarFrameAssetRow = BaseAssetRow;

interface AssetListResponse<T> {
  success: boolean;
  error?: string;
  data?: {
    list: T[];
  };
}

interface UploadResponse {
  success: boolean;
  error?: string;
  data?: {
    imageUrl: string;
  };
}

interface EditState {
  kind: AssetKind;
  rowId: string | null;
}

function buildAssetEndpoint(kind: AssetKind) {
  return kind === "avatar" ? "/api/admin/avatar-assets" : "/api/admin/avatar-frame-assets";
}

function buildUploadCategory(kind: AssetKind) {
  return kind === "avatar" ? "avatar" : "avatar-frame";
}

function normalizeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.floor(parsed);
}

export default function AvatarCosmeticsManager() {
  const { message } = App.useApp();
  const [tabKey, setTabKey] = useState<AssetKind>("avatar");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [avatarRows, setAvatarRows] = useState<AvatarAssetRow[]>([]);
  const [avatarFrameRows, setAvatarFrameRows] = useState<AvatarFrameAssetRow[]>([]);
  const [form] = Form.useForm();

  const currentKind: AssetKind = editState?.kind || tabKey;

  const fetchAvatars = useCallback(async () => {
    const res = await fetch("/api/admin/avatar-assets?page=1&pageSize=500", { cache: "no-store" });
    const json = await res.json() as AssetListResponse<AvatarAssetRow>;
    if (!json.success || !json.data) {
      throw new Error(json.error || "加载头像资源失败");
    }
    setAvatarRows(json.data.list || []);
  }, []);

  const fetchAvatarFrames = useCallback(async () => {
    const res = await fetch("/api/admin/avatar-frame-assets?page=1&pageSize=500", { cache: "no-store" });
    const json = await res.json() as AssetListResponse<AvatarFrameAssetRow>;
    if (!json.success || !json.data) {
      throw new Error(json.error || "加载头像框资源失败");
    }
    setAvatarFrameRows(json.data.list || []);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchAvatars(), fetchAvatarFrames()]);
    } catch (error) {
      const text = error instanceof Error ? error.message : "加载装扮资源失败";
      message.error(text);
    } finally {
      setLoading(false);
    }
  }, [fetchAvatarFrames, fetchAvatars, message]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const openCreateModal = (kind: AssetKind) => {
    setEditState({ kind, rowId: null });
    form.setFieldsValue({
      id: "",
      name: "",
      imageUrl: "",
      gender: "男",
      isPublic: true,
      enabled: true,
      sortOrder: 0,
    });
    setModalOpen(true);
  };

  const openEditModal = (kind: AssetKind, row: BaseAssetRow | AvatarAssetRow) => {
    setEditState({ kind, rowId: row.id });
    form.setFieldsValue({
      id: row.id,
      name: row.name,
      imageUrl: row.imageUrl,
      gender: (row as AvatarAssetRow).gender || "男",
      isPublic: row.isPublic,
      enabled: row.enabled,
      sortOrder: row.sortOrder,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditState(null);
    form.resetFields();
  };

  const handleDelete = async (kind: AssetKind, id: string) => {
    try {
      const res = await fetch(buildAssetEndpoint(kind), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) {
        throw new Error(json.error || "删除失败");
      }
      message.success("删除成功");
      await fetchAll();
    } catch (error) {
      const text = error instanceof Error ? error.message : "删除失败";
      message.error(text);
    }
  };

  const handleUpload = async (file: File, kind: AssetKind) => {
    setUploading(true);
    try {
      const data = new FormData();
      data.set("file", file);
      data.set("category", buildUploadCategory(kind));
      const res = await fetch("/api/admin/cosmetics/upload", {
        method: "POST",
        body: data,
      });
      const json = await res.json() as UploadResponse;
      if (!json.success || !json.data?.imageUrl) {
        throw new Error(json.error || "上传失败");
      }
      form.setFieldValue("imageUrl", json.data.imageUrl);
      message.success("上传成功");
    } catch (error) {
      const text = error instanceof Error ? error.message : "上传失败";
      message.error(text);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!editState) {
      return;
    }

    setSaving(true);
    try {
      const values = await form.validateFields();
      const payload: Record<string, unknown> = {
        id: typeof values.id === "string" ? values.id.trim() : "",
        name: typeof values.name === "string" ? values.name.trim() : "",
        imageUrl: typeof values.imageUrl === "string" ? values.imageUrl.trim() : "",
        isPublic: Boolean(values.isPublic),
        enabled: Boolean(values.enabled),
        sortOrder: normalizeNumber(values.sortOrder, 0),
      };

      if (!payload.name) {
        throw new Error("名称不能为空");
      }
      if (!payload.imageUrl) {
        throw new Error("图片地址不能为空");
      }

      if (editState.kind === "avatar") {
        payload.gender = values.gender;
      }

      if (!payload.id) {
        delete payload.id;
      }

      const isCreate = !editState.rowId;
      const response = await fetch(buildAssetEndpoint(editState.kind), {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isCreate ? payload : { ...payload, id: editState.rowId }),
        }),
      });
      const result = await response.json() as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || "保存失败");
      }

      message.success(isCreate ? "创建成功" : "保存成功");
      closeModal();
      await fetchAll();
    } catch (error) {
      const text = error instanceof Error ? error.message : "保存失败";
      message.error(text);
    } finally {
      setSaving(false);
    }
  };

  const avatarColumns: ColumnsType<AvatarAssetRow> = [
    { title: "ID", dataIndex: "id", width: 220 },
    { title: "名称", dataIndex: "name", width: 140 },
    { title: "性别", dataIndex: "gender", width: 80 },
    {
      title: "图片",
      dataIndex: "imageUrl",
      render: (value: string) => (
        <Space>
          <GameImage
            src={value}
            alt=""
            width={40}
            height={40}
            style={{ objectFit: "cover", borderRadius: 4, border: "1px solid #2a2520" }}
          />
          <Text style={{ maxWidth: 220 }} ellipsis={{ tooltip: value }}>{value}</Text>
        </Space>
      ),
    },
    { title: "公开", dataIndex: "isPublic", width: 80, render: (value: boolean) => (value ? "是" : "否") },
    { title: "启用", dataIndex: "enabled", width: 80, render: (value: boolean) => (value ? "是" : "否") },
    { title: "排序", dataIndex: "sortOrder", width: 80 },
    {
      title: "操作",
      width: 150,
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" onClick={() => openEditModal("avatar", row)}>编辑</Button>
          <Popconfirm
            title="确认删除该头像？"
            okText="确认"
            cancelText="取消"
            onConfirm={() => void handleDelete("avatar", row.id)}
          >
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const avatarFrameColumns: ColumnsType<AvatarFrameAssetRow> = [
    { title: "ID", dataIndex: "id", width: 220 },
    { title: "名称", dataIndex: "name", width: 160 },
    {
      title: "图片",
      dataIndex: "imageUrl",
      render: (value: string) => (
        <Space>
          <GameImage
            src={value}
            alt=""
            width={40}
            height={40}
            style={{ objectFit: "cover", borderRadius: 4, border: "1px solid #2a2520" }}
          />
          <Text style={{ maxWidth: 220 }} ellipsis={{ tooltip: value }}>{value}</Text>
        </Space>
      ),
    },
    { title: "公开", dataIndex: "isPublic", width: 80, render: (value: boolean) => (value ? "是" : "否") },
    { title: "启用", dataIndex: "enabled", width: 80, render: (value: boolean) => (value ? "是" : "否") },
    { title: "排序", dataIndex: "sortOrder", width: 80 },
    {
      title: "操作",
      width: 150,
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" onClick={() => openEditModal("avatar-frame", row)}>编辑</Button>
          <Popconfirm
            title="确认删除该头像框？"
            okText="确认"
            cancelText="取消"
            onConfirm={() => void handleDelete("avatar-frame", row.id)}
          >
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const modalTitle = editState
    ? `${editState.rowId ? "编辑" : "新建"}${editState.kind === "avatar" ? "头像" : "头像框"}`
    : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card
        size="small"
        title="头像与头像框管理"
        extra={
          <Space size={8}>
            <Button onClick={() => void fetchAll()} loading={loading}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreateModal(tabKey)}>
              新建{tabKey === "avatar" ? "头像" : "头像框"}
            </Button>
          </Space>
        }
      >
        <Tabs
          activeKey={tabKey}
          onChange={(key) => setTabKey(key as AssetKind)}
          items={[
            {
              key: "avatar",
              label: `头像 (${avatarRows.length})`,
              children: (
                <Table
                  rowKey="id"
                  size="small"
                  loading={loading}
                  columns={avatarColumns}
                  dataSource={avatarRows}
                  pagination={false}
                  scroll={{ x: 1100 }}
                />
              ),
            },
            {
              key: "avatar-frame",
              label: `头像框 (${avatarFrameRows.length})`,
              children: (
                <Table
                  rowKey="id"
                  size="small"
                  loading={loading}
                  columns={avatarFrameColumns}
                  dataSource={avatarFrameRows}
                  pagination={false}
                  scroll={{ x: 1000 }}
                />
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={modalOpen}
        title={modalTitle}
        onCancel={closeModal}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        forceRender
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            id: "",
            name: "",
            imageUrl: "",
            gender: "男",
            isPublic: true,
            enabled: true,
            sortOrder: 0,
          }}
        >
          <Form.Item label="ID（可选）" name="id">
            <Input placeholder="留空自动生成" />
          </Form.Item>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder={`请输入${currentKind === "avatar" ? "头像" : "头像框"}名称`} />
          </Form.Item>
          {currentKind === "avatar" && (
            <Form.Item label="性别" name="gender" rules={[{ required: true, message: "请选择性别" }]}>
              <Select
                options={[
                  { label: "男", value: "男" },
                  { label: "女", value: "女" },
                ]}
              />
            </Form.Item>
          )}
          <Form.Item label="图片地址" name="imageUrl" rules={[{ required: true, message: "请上传或填写图片地址" }]}>
            <Input placeholder="例如 /uploads/cosmetics/avatar/xxx.webp" />
          </Form.Item>
          <Form.Item>
            <Upload
              showUploadList={false}
              beforeUpload={(file) => {
                void handleUpload(file, currentKind);
                return false;
              }}
            >
              <Button icon={<UploadOutlined />} loading={uploading}>
                上传图片
              </Button>
            </Upload>
          </Form.Item>
          <Form.Item label="排序（越小越靠前）" name="sortOrder">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="公开可用" name="isPublic" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

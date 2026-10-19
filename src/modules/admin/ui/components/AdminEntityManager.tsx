"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type Key } from "react";
import {
  App,
  Button,
  Card,
  DatePicker,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Typography,
  Upload,
} from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import type { AdminEntity } from "@/modules/admin/services/admin-entities";
import { ADMIN_ENTITY_LABELS } from "@/modules/admin/services/admin-entities";
import {
  ADMIN_UI_CONFIG,
  getAdminFieldLabel,
  type AdminSelectOption,
  type AdminFieldConfig,
} from "@/modules/admin/services/admin-ui-config";
import JsonFieldEditor from "@/modules/admin/ui/components/JsonFieldEditor";
import MapTileGridEditor from "@/modules/admin/ui/components/MapTileGridEditor";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import MapPositionPicker from "@/modules/admin/ui/components/MapPositionPicker";
import MapEdgesGraphEditor from "@/modules/admin/ui/components/MapEdgesGraphEditor";
import ReferenceSelect from "@/modules/admin/ui/components/ReferenceSelect";

const { Search, TextArea } = Input;
const { Text } = Typography;

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const REALM_SELECT_FIELD_KEYS = new Set(["minRealm", "maxRealm"]);
const UUID_DISPLAY_PREFIX_LENGTH = 13;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NPC_IMAGE_FIELD_UPLOAD_CATEGORY: Record<"avatarImageUrl" | "portraitImageUrl", "npc-avatar" | "npc-portrait"> = {
  avatarImageUrl: "npc-avatar",
  portraitImageUrl: "npc-portrait",
};
const ITEM_ICON_UPLOAD_CATEGORY = "item";
const MONSTER_ICON_UPLOAD_CATEGORY = "monster";
const MAP_BACKGROUND_UPLOAD_CATEGORY = "map-background";
const EVENT_ILLUSTRATION_UPLOAD_CATEGORY = "event-illustration";
const EVENT_ICON_UPLOAD_CATEGORY = "event-icon";
const SKILL_EFFECT_UPLOAD_CATEGORY = "skill-effect";
const TABLE_IMAGE_FIELD_KEYS = new Set([
  "iconUrl",
  "imageUrl",
  "avatarImageUrl",
  "portraitImageUrl",
  "backgroundImageUrl",
  "iconImageUrl",
  "visualEffectSpriteUrl",
]);

type RowRecord = Record<string, unknown>;

type QuickFilterValue = Record<string, string | undefined>;

interface ListResponse {
  success: boolean;
  data?: {
    list: RowRecord[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
    };
    meta?: Record<string, unknown>;
  };
  error?: string;
}

interface GenerateCdkResponse {
  success: boolean;
  data?: {
    codes: string[];
  };
  error?: string;
}

interface DeleteResponse {
  success: boolean;
  data?: {
    deletedCount?: number;
  };
  error?: string;
}

interface AiItemStats {
  totalAiItems: number;
  todayCreatedCount: number;
  reclaimableCount: number;
  bySource: Record<string, number>;
  byRarity: Record<string, number>;
  byCleanupState: Record<string, number>;
}

interface AiItemCleanupPreviewResponse {
  success: boolean;
  data?: {
    stats: AiItemStats;
    preview: {
      totalMatched: number;
      candidateCount: number;
      protectedCount: number;
      legacyUnknownCount: number;
      sourceBreakdown: Record<string, number>;
      rarityBreakdown: Record<string, number>;
      topFrequencyBuckets: Array<{
        bucket: string;
        count: number;
      }>;
    };
  };
  error?: string;
}

interface AiItemCleanupExecuteResponse {
  success: boolean;
  data?: {
    totalMatched: number;
    candidateCount: number;
    protectedCount: number;
    legacyUnknownCount: number;
    sourceBreakdown: Record<string, number>;
    rarityBreakdown: Record<string, number>;
    topFrequencyBuckets: Array<{
      bucket: string;
      count: number;
    }>;
    deletedCount: number;
    deletedIds: string[];
  };
  error?: string;
}

interface ImageUploadResponse {
  success: boolean;
  error?: string;
  data?: {
    imageUrl?: string;
  };
}

interface RealmConfigResponse {
  success: boolean;
  data?: {
    majors: Array<{
      order: number;
      name: string;
      stages: Array<{
        minor: number;
        name: string;
        realm: number;
      }>;
    }>;
  };
}

interface PlayerRealmUpdateResponse {
  success: boolean;
  error?: string;
}

interface PlayerRealmCorrectionResponse {
  success: boolean;
  data?: {
    total: number;
    successCount: number;
    failedCount: number;
    failures: Array<{
      id: string;
      error: string;
    }>;
  };
  error?: string;
}

interface BossReviveResponse {
  success: boolean;
  error?: string;
}

interface AdminFortuneOption {
  id: string;
  name: string;
  grade: string;
  enabled: boolean;
}

interface PlayerFortuneRow {
  playerFortuneId: number;
  fortuneId: string;
  sourceType: string;
  sourceRef: string | null;
  status: string;
  acquiredAt: string;
  expiresAt: string | null;
  endedAt: string | null;
  fortuneName: string;
  fortuneGrade: string;
  fortuneEnabled: boolean;
}

interface AdminPlayerFortunesListResponse {
  success: boolean;
  error?: string;
  data?: {
    list: PlayerFortuneRow[];
  };
}

interface AdminPlayerFortunesGrantResponse {
  success: boolean;
  error?: string;
}

interface AdminFortunesListResponse {
  success: boolean;
  error?: string;
  data?: {
    list: AdminFortuneOption[];
  };
}

function isRealmSelectField(field: AdminFieldConfig) {
  return field.type === "number" && REALM_SELECT_FIELD_KEYS.has(field.key);
}

const BATCH_DELETE_ENTITIES = new Set<CrudAdminEntity>([
  "accounts",
  "cdkCodes",
  "players",
  "fortunes",
  "maps",
  "temporaryMaps",
  "npcs",
  "items",
  "monsters",
  "temporaryMonsters",
  "quests",
  "randomEvents",
  "skills",
]);

const CDK_GENERATE_REWARD_FIELD: AdminFieldConfig = {
  key: "rewardText",
  label: "奖励",
  type: "json",
  placeholder: "{\"gold\":100,\"xp\":50,\"items\":[{\"itemId\":\"item_healing_pill_low\",\"quantity\":2}]}",
  jsonSchema: {
    kind: "reward-object",
  },
};

function formatCell(value: unknown) {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "boolean") {
    return <DarkTag color={value ? "green" : "default"}>{value ? "是" : "否"}</DarkTag>;
  }
  if (typeof value === "object") {
    return (
      <Text style={{ fontFamily: "monospace" }} ellipsis={{ tooltip: JSON.stringify(value) }}>
        {JSON.stringify(value)}
      </Text>
    );
  }
  return String(value);
}

function formatIdForTableDisplay(value: string) {
  if (!UUID_PATTERN.test(value)) {
    return value;
  }
  return value.slice(0, UUID_DISPLAY_PREFIX_LENGTH);
}

function isTableImageField(field: string) {
  return TABLE_IMAGE_FIELD_KEYS.has(field);
}

function normalizeImageUrl(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function renderTableImageCell(value: unknown) {
  const imageUrl = normalizeImageUrl(value);
  if (!imageUrl) {
    return "-";
  }

  return (
    <Image
      src={imageUrl}
      alt=""
      width={32}
      height={32}
      preview={false}
      style={{ objectFit: "cover", borderRadius: 4, border: "1px solid #2a2520" }}
    />
  );
}

function toDatePickerValue(value: unknown): Dayjs | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return undefined;
  }
  return parsed;
}

function toIsoDateTime(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (dayjs.isDayjs(value)) {
    if (!value.isValid()) {
      return null;
    }
    return value.toDate().toISOString();
  }
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    return trimmed;
  }
  return new Date(timestamp).toISOString();
}

function mapFormValue(field: AdminFieldConfig, value: unknown): unknown {
  if (isRealmSelectField(field) && (value === undefined || value === null || value === "")) {
    return null;
  }

  if (value === undefined) {
    return undefined;
  }

  if (field.key === "expiresAt") {
    return toIsoDateTime(value);
  }

  if (field.type === "json") {
    if (typeof value === "string") {
      if (!value.trim()) return null;
      JSON.parse(value);
      return value;
    }
    return JSON.stringify(value);
  }

  if (field.type === "number") {
    if (value === null || value === "") {
      return 0;
    }
    return Number(value);
  }

  if (field.type === "boolean") {
    return Boolean(value);
  }

  if (field.relation) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    return String(value);
  }

  return value;
}

function validateJsonFields(fields: AdminFieldConfig[], values: Record<string, unknown>) {
  fields.forEach((field) => {
    if (field.type !== "json") {
      return;
    }

    const raw = values[field.key];
    if (typeof raw !== "string") {
      return;
    }
    if (!raw.trim()) {
      return;
    }

    JSON.parse(raw);
  });
}

function serializeRecordForForm(record: RowRecord, fields: AdminFieldConfig[]) {
  const result: Record<string, unknown> = {};
  fields.forEach((field) => {
    const value = record[field.key];
    if (field.key === "expiresAt") {
      result[field.key] = toDatePickerValue(value);
      return;
    }
    if (isRealmSelectField(field)) {
      result[field.key] = value === null || value === undefined ? undefined : String(value);
      return;
    }
    if (field.type === "json") {
      result[field.key] = value === null || value === undefined ? "" : JSON.stringify(value, null, 2);
      return;
    }
    if (field.relation) {
      result[field.key] = value === null || value === undefined ? undefined : String(value);
      return;
    }
    result[field.key] = value;
  });
  return result;
}

function buildCreateFormDefaults(fields: AdminFieldConfig[]) {
  const defaults: Record<string, unknown> = {};
  fields.forEach((field) => {
    if (field.type === "boolean") {
      defaults[field.key] = false;
    }
  });
  return defaults;
}

function toOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

type CrudAdminEntity = Exclude<AdminEntity, "mapEdges">;

function CrudAdminEntityManager({ entity }: { entity: CrudAdminEntity }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [generateForm] = Form.useForm();
  const [realmForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<RowRecord[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [queryKeyword, setQueryKeyword] = useState("");
  const [quickFilters, setQuickFilters] = useState<QuickFilterValue>({});
  const [appliedQuickFilters, setAppliedQuickFilters] = useState<QuickFilterValue>({});
  const [editingRow, setEditingRow] = useState<RowRecord | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [realmModalOpen, setRealmModalOpen] = useState(false);
  const [realmSubmitting, setRealmSubmitting] = useState(false);
  const [realmCorrecting, setRealmCorrecting] = useState(false);
  const [realmTargetPlayer, setRealmTargetPlayer] = useState<RowRecord | null>(null);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [realmOptions, setRealmOptions] = useState<AdminSelectOption[]>([]);
  const [revivingBossId, setRevivingBossId] = useState<string | null>(null);
  const [fortuneModalOpen, setFortuneModalOpen] = useState(false);
  const [fortuneTargetPlayer, setFortuneTargetPlayer] = useState<RowRecord | null>(null);
  const [playerFortunesLoading, setPlayerFortunesLoading] = useState(false);
  const [playerFortunes, setPlayerFortunes] = useState<PlayerFortuneRow[]>([]);
  const [fortuneOptions, setFortuneOptions] = useState<AdminFortuneOption[]>([]);
  const [grantFortuneIds, setGrantFortuneIds] = useState<string[]>([]);
  const [grantFortuneLoading, setGrantFortuneLoading] = useState(false);
  const [removingPlayerFortuneId, setRemovingPlayerFortuneId] = useState<number | null>(null);
  const [uploadingNpcImageField, setUploadingNpcImageField] = useState<"avatarImageUrl" | "portraitImageUrl" | null>(null);
  const [uploadingItemIcon, setUploadingItemIcon] = useState(false);
  const [uploadingMonsterIcon, setUploadingMonsterIcon] = useState(false);
  const [uploadingMapBackground, setUploadingMapBackground] = useState(false);
  const [uploadingEventIllustration, setUploadingEventIllustration] = useState(false);
  const [uploadingEventIcon, setUploadingEventIcon] = useState(false);
  const [uploadingSkillEffectSprite, setUploadingSkillEffectSprite] = useState(false);
  const [aiItemStats, setAiItemStats] = useState<AiItemStats | null>(null);
  const [aiCleanupModalOpen, setAiCleanupModalOpen] = useState(false);
  const [aiCleanupLoading, setAiCleanupLoading] = useState(false);
  const [aiCleanupExecuting, setAiCleanupExecuting] = useState(false);
  const [aiCleanupPreview, setAiCleanupPreview] = useState<AiItemCleanupPreviewResponse["data"] | null>(null);
  const [aiCleanupSourceType, setAiCleanupSourceType] = useState<string | undefined>(undefined);
  const [aiCleanupRarity, setAiCleanupRarity] = useState<string | undefined>(undefined);
  const [aiCleanupMinAgeHours, setAiCleanupMinAgeHours] = useState(6);
  const [aiCleanupDeleteLimit, setAiCleanupDeleteLimit] = useState(500);

  const watchedMapWidth = Form.useWatch("width", form);
  const watchedMapHeight = Form.useWatch("height", form);
  const watchedMapType = Form.useWatch("mapType", form);
  const watchedMapBackgroundImageUrl = Form.useWatch("backgroundImageUrl", form);
  const watchedNpcBountyEnabled = Form.useWatch("bountyEnabled", form);
  const watchedRandomEventType = Form.useWatch("eventType", form);

  const [importing, setImporting] = useState(false);

  const uiConfig = ADMIN_UI_CONFIG[entity];
  const resolvedMapType = useMemo(() => {
    if (typeof watchedMapType === "string" && watchedMapType.trim()) {
      return watchedMapType.trim();
    }
    const raw = editingRow?.mapType;
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
    return undefined;
  }, [editingRow?.mapType, watchedMapType]);
  const resolvedMapBackgroundImageUrl = useMemo(() => {
    if (typeof watchedMapBackgroundImageUrl === "string" && watchedMapBackgroundImageUrl.trim()) {
      return watchedMapBackgroundImageUrl.trim();
    }
    const raw = editingRow?.backgroundImageUrl;
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
    return undefined;
  }, [editingRow?.backgroundImageUrl, watchedMapBackgroundImageUrl]);
  const resolvedRandomEventType = useMemo(() => {
    if (typeof watchedRandomEventType === "string" && watchedRandomEventType.trim()) {
      return watchedRandomEventType.trim();
    }
    const raw = editingRow?.eventType;
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
    return undefined;
  }, [editingRow?.eventType, watchedRandomEventType]);
  const isCreateMode = !editingRow;
  const isCdkEntity = entity === "cdkCodes";
  const isPlayersEntity = entity === "players";
  const isMonstersEntity = entity === "monsters";
  const isMonsterLikeEntity = entity === "monsters" || entity === "temporaryMonsters";
  const isMapLikeEntity = entity === "maps" || entity === "temporaryMaps";
  const isSystemConfigEntity = entity === "systemConfigs";
  const isAiItemsEntity = entity === "aiItems";
  const canDelete = !uiConfig.disableDelete;
  const supportsBatchDelete = canDelete && BATCH_DELETE_ENTITIES.has(entity);
  const hasRealmSelectField = useMemo(
    () => uiConfig.formFields.some((field) => isRealmSelectField(field)),
    [uiConfig.formFields]
  );
  const shouldLoadRealmOptions = hasRealmSelectField || isPlayersEntity;

  useEffect(() => {
    if (!shouldLoadRealmOptions) {
      setRealmOptions([]);
      return;
    }

    let canceled = false;

    const fetchRealmOptions = async () => {
      try {
        const response = await fetch("/api/admin/realm-config");
        const result: RealmConfigResponse = await response.json();
        if (!result.success || !result.data) {
          throw new Error("读取境界选项失败");
        }

        const options: AdminSelectOption[] = [];
        for (const major of result.data.majors) {
          const majorName = typeof major.name === "string" ? major.name.trim() : "";
          if (!majorName) {
            continue;
          }

          for (const stage of major.stages || []) {
            const realm = Number(stage.realm);
            if (!Number.isInteger(realm) || realm < 1) {
              continue;
            }

            const stageName = typeof stage.name === "string" ? stage.name.trim() : "";
            const minor = Number(stage.minor);
            const fallbackStageName = Number.isInteger(minor) && minor > 0 ? `${minor}重` : "";
            options.push({
              label: `${majorName}${stageName || fallbackStageName}`,
              value: String(realm),
            });
          }
        }

        options.sort((a, b) => Number(a.value) - Number(b.value));
        if (!canceled) {
          setRealmOptions(options);
        }
      } catch {
        if (!canceled) {
          message.error("读取境界选项失败");
          setRealmOptions([]);
        }
      }
    };

    void fetchRealmOptions();
    return () => {
      canceled = true;
    };
  }, [message, shouldLoadRealmOptions]);

  const fetchList = useCallback(async (
    nextPage: number,
    nextPageSize: number,
    nextKeyword: string,
    nextFilters: QuickFilterValue,
  ) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(nextPageSize),
      });
      if (nextKeyword) {
        params.set("keyword", nextKeyword);
      }
      Object.entries(nextFilters).forEach(([key, value]) => {
        if (value) {
          params.set(key, value);
        }
      });

      const res = await fetch(`/api/admin/${entity}?${params.toString()}`);
      const data: ListResponse = await res.json();

      if (!data.success || !data.data) {
        message.error(data.error || "加载失败");
        return;
      }

      setList(data.data.list);
      setPage(data.data.pagination.page);
      setPageSize(data.data.pagination.pageSize);
      setTotal(data.data.pagination.total);
      setSelectedRowKeys([]);
      setAiItemStats(isAiItemsEntity ? (data.data.meta?.stats as AiItemStats | undefined) || null : null);
    } catch {
      message.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, [entity, isAiItemsEntity, message]);

  const handleDelete = useCallback(async (id: string | number) => {
    try {
      const res = await fetch(`/api/admin/${entity}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data: DeleteResponse = await res.json();
      if (!data.success) {
        message.error(data.error || "删除失败");
        return;
      }
      message.success("删除成功");
      setSelectedRowKeys([]);
      await fetchList(page, pageSize, queryKeyword, appliedQuickFilters);
    } catch {
      message.error("删除失败");
    }
  }, [appliedQuickFilters, entity, fetchList, message, page, pageSize, queryKeyword]);

  const handleBatchDelete = useCallback(async () => {
    if (!selectedRowKeys.length) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/${entity}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedRowKeys }),
      });
      const data: DeleteResponse = await res.json();
      if (!data.success) {
        message.error(data.error || "批量删除失败");
        return;
      }

      const deletedCount = data.data?.deletedCount || selectedRowKeys.length;
      message.success(`批量删除成功，共 ${deletedCount} 条`);
      setSelectedRowKeys([]);
      await fetchList(page, pageSize, queryKeyword, appliedQuickFilters);
    } catch {
      message.error("批量删除失败");
    }
  }, [appliedQuickFilters, entity, fetchList, message, page, pageSize, queryKeyword, selectedRowKeys]);

  const loadAiCleanupPreview = useCallback(async () => {
    if (!isAiItemsEntity) {
      return;
    }

    setAiCleanupLoading(true);
    try {
      const params = new URLSearchParams();
      if (aiCleanupSourceType) {
        params.set("sourceType", aiCleanupSourceType);
      }
      if (aiCleanupRarity) {
        params.set("rarity", aiCleanupRarity);
      }
      params.set("minAgeHours", String(aiCleanupMinAgeHours));
      const response = await fetch(`/api/admin/aiItems/cleanup?${params.toString()}`, { cache: "no-store" });
      const result = await response.json() as AiItemCleanupPreviewResponse;
      if (!result.success || !result.data) {
        message.error(result.error || "读取AI物品清理预览失败");
        return;
      }
      setAiCleanupPreview(result.data);
      setAiItemStats(result.data.stats);
    } catch {
      message.error("读取AI物品清理预览失败");
    } finally {
      setAiCleanupLoading(false);
    }
  }, [aiCleanupMinAgeHours, aiCleanupRarity, aiCleanupSourceType, isAiItemsEntity, message]);

  const openAiCleanupModal = useCallback(() => {
    setAiCleanupModalOpen(true);
    void loadAiCleanupPreview();
  }, [loadAiCleanupPreview]);

  const closeAiCleanupModal = useCallback(() => {
    setAiCleanupModalOpen(false);
    setAiCleanupPreview(null);
  }, []);

  const handleAiCleanup = useCallback(async (dryRun: boolean) => {
    if (!isAiItemsEntity) {
      return;
    }

    setAiCleanupExecuting(true);
    try {
      const response = await fetch("/api/admin/aiItems/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: aiCleanupSourceType || null,
          rarity: aiCleanupRarity || null,
          minAgeHours: aiCleanupMinAgeHours,
          deleteLimit: aiCleanupDeleteLimit,
          dryRun,
        }),
      });
      const result = await response.json() as AiItemCleanupExecuteResponse;
      if (!result.success || !result.data) {
        message.error(result.error || (dryRun ? "AI物品预览失败" : "AI物品清理失败"));
        return;
      }
      const cleanupData = result.data;

      if (dryRun) {
        setAiCleanupPreview((previous) => ({
          stats: previous?.stats || aiItemStats || {
            totalAiItems: 0,
            todayCreatedCount: 0,
            reclaimableCount: 0,
            bySource: {},
            byRarity: {},
            byCleanupState: {},
          },
          preview: {
            totalMatched: cleanupData.totalMatched,
            candidateCount: cleanupData.candidateCount,
            protectedCount: cleanupData.protectedCount,
            legacyUnknownCount: cleanupData.legacyUnknownCount,
            sourceBreakdown: cleanupData.sourceBreakdown,
            rarityBreakdown: cleanupData.rarityBreakdown,
            topFrequencyBuckets: cleanupData.topFrequencyBuckets,
          },
        }));
        message.success("AI物品预览已更新");
      } else {
        message.success(`AI物品清理完成，共删除 ${cleanupData.deletedCount} 条`);
        await fetchList(page, pageSize, queryKeyword, appliedQuickFilters);
        await loadAiCleanupPreview();
      }
    } catch {
      message.error(dryRun ? "AI物品预览失败" : "AI物品清理失败");
    } finally {
      setAiCleanupExecuting(false);
    }
  }, [
    aiCleanupDeleteLimit,
    aiCleanupMinAgeHours,
    aiCleanupRarity,
    aiCleanupSourceType,
    aiItemStats,
    appliedQuickFilters,
    fetchList,
    isAiItemsEntity,
    loadAiCleanupPreview,
    message,
    page,
    pageSize,
    queryKeyword,
  ]);

  const openEdit = useCallback((record: RowRecord) => {
    setEditingRow(record);
    form.setFieldsValue(serializeRecordForForm(record, uiConfig.formFields));
    setModalOpen(true);
  }, [form, uiConfig.formFields]);

  const openRealmModal = useCallback((record: RowRecord) => {
    setRealmTargetPlayer(record);
    const currentRealm = Number(record.realm);
    realmForm.setFieldsValue({
      targetRealm: Number.isInteger(currentRealm) && currentRealm > 0 ? String(currentRealm) : undefined,
    });
    setRealmModalOpen(true);
  }, [realmForm]);

  const handleReviveBoss = useCallback(async (rawId: string | number | undefined) => {
    const bossId = String(rawId || "").trim();
    if (!bossId) {
      message.error("Boss ID 不存在");
      return;
    }

    setRevivingBossId(bossId);
    try {
      const res = await fetch(`/api/admin/monsters/${encodeURIComponent(bossId)}/revive`, {
        method: "POST",
      });
      const data: BossReviveResponse = await res.json();
      if (!data.success) {
        message.error(data.error || "Boss复活失败");
        return;
      }

      message.success("Boss复活成功");
      await fetchList(page, pageSize, queryKeyword, appliedQuickFilters);
    } catch {
      message.error("Boss复活失败");
    } finally {
      setRevivingBossId((current) => (current === bossId ? null : current));
    }
  }, [appliedQuickFilters, fetchList, message, page, pageSize, queryKeyword]);

  const fetchFortuneOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/fortunes?page=1&pageSize=200");
      const data = await res.json() as AdminFortunesListResponse;
      if (!data.success || !data.data) {
        setFortuneOptions([]);
        return;
      }
      setFortuneOptions((data.data.list || []).map((item) => ({
        id: item.id,
        name: item.name,
        grade: item.grade,
        enabled: Boolean(item.enabled),
      })));
    } catch {
      setFortuneOptions([]);
    }
  }, []);

  const fetchPlayerFortunes = useCallback(async (playerId: string) => {
    setPlayerFortunesLoading(true);
    try {
      const res = await fetch(`/api/admin/players/${encodeURIComponent(playerId)}/fortunes`);
      const data = await res.json() as AdminPlayerFortunesListResponse;
      if (!data.success || !data.data) {
        message.error(data.error || "读取玩家气运失败");
        setPlayerFortunes([]);
        return;
      }
      setPlayerFortunes(data.data.list || []);
    } catch {
      message.error("读取玩家气运失败");
      setPlayerFortunes([]);
    } finally {
      setPlayerFortunesLoading(false);
    }
  }, [message]);

  const openFortuneModal = useCallback((record: RowRecord) => {
    const playerId = String(record.id || "").trim();
    if (!playerId) {
      message.error("玩家ID不存在");
      return;
    }
    setFortuneTargetPlayer(record);
    setFortuneModalOpen(true);
    setGrantFortuneIds([]);
    void Promise.all([
      fetchFortuneOptions(),
      fetchPlayerFortunes(playerId),
    ]);
  }, [fetchFortuneOptions, fetchPlayerFortunes, message]);

  const closeFortuneModal = useCallback(() => {
    setFortuneModalOpen(false);
    setFortuneTargetPlayer(null);
    setGrantFortuneIds([]);
    setPlayerFortunes([]);
    setRemovingPlayerFortuneId(null);
  }, []);

  const handleGrantFortunes = useCallback(async () => {
    const playerId = String(fortuneTargetPlayer?.id || "").trim();
    if (!playerId) {
      message.error("玩家ID不存在");
      return;
    }
    if (!grantFortuneIds.length) {
      message.error("请先选择要发放的气运");
      return;
    }

    setGrantFortuneLoading(true);
    try {
      const res = await fetch(`/api/admin/players/${encodeURIComponent(playerId)}/fortunes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fortuneIds: grantFortuneIds,
          sourceType: "admin",
        }),
      });
      const data = await res.json() as AdminPlayerFortunesGrantResponse;
      if (!data.success) {
        message.error(data.error || "发放气运失败");
        return;
      }
      message.success("发放完成");
      setGrantFortuneIds([]);
      await fetchPlayerFortunes(playerId);
    } catch {
      message.error("发放气运失败");
    } finally {
      setGrantFortuneLoading(false);
    }
  }, [fetchPlayerFortunes, fortuneTargetPlayer?.id, grantFortuneIds, message]);

  const handleRemovePlayerFortune = useCallback(async (playerFortuneId: number) => {
    const playerId = String(fortuneTargetPlayer?.id || "").trim();
    if (!playerId) {
      message.error("玩家ID不存在");
      return;
    }

    setRemovingPlayerFortuneId(playerFortuneId);
    try {
      const res = await fetch(`/api/admin/players/${encodeURIComponent(playerId)}/fortunes`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerFortuneId }),
      });
      const data = await res.json() as AdminPlayerFortunesGrantResponse;
      if (!data.success) {
        message.error(data.error || "移除气运失败");
        return;
      }
      message.success("已移除");
      await fetchPlayerFortunes(playerId);
    } catch {
      message.error("移除气运失败");
    } finally {
      setRemovingPlayerFortuneId((current) => (current === playerFortuneId ? null : current));
    }
  }, [fetchPlayerFortunes, fortuneTargetPlayer?.id, message]);

  const columns: ColumnsType<RowRecord> = useMemo(() => {
    const baseColumns = uiConfig.tableFields
      .map((field) => {
        const imageField = isTableImageField(field);
        return {
          title: getAdminFieldLabel(uiConfig, field),
          dataIndex: field,
          key: field,
          width: field === "id" ? 150 : imageField ? 96 : undefined,
          ellipsis: !imageField,
          render: (value: unknown) => {
            if (imageField) {
              return renderTableImageCell(value);
            }

            if (field === "id") {
              if (value === null || value === undefined || value === "") {
                return "-";
              }
              const text = String(value);
              const displayText = formatIdForTableDisplay(text);
              return (
                <Text
                  title={text}
                  style={{ fontFamily: "monospace" }}
                  copyable={{ text }}
                >
                  {displayText}
                </Text>
              );
            }
            return formatCell(value);
          },
        };
      });

    return [
      ...baseColumns,
      {
        title: "操作",
        key: "actions",
        fixed: "right",
        width: isPlayersEntity ? 360 : isMonsterLikeEntity ? (canDelete ? 260 : 190) : canDelete ? 150 : 80,
        render: (_, record) => (
          <Space>
            <Button size="small" onClick={() => openEdit(record)}>编辑</Button>
            {isPlayersEntity && (
              <>
                <Button size="small" onClick={() => openRealmModal(record)}>境界操作</Button>
                <Button size="small" onClick={() => openFortuneModal(record)}>气运操作</Button>
              </>
            )}
            {isMonstersEntity && String(record.monsterType || "") === "boss" && (
              <Button
                size="small"
                loading={revivingBossId === String(record.id || "")}
                onClick={() => void handleReviveBoss(record.id as string | number | undefined)}
              >
                复活Boss
              </Button>
            )}
            {canDelete && (
              <Popconfirm
                title="确认删除?"
                onConfirm={() => handleDelete((record.id as string | number) ?? "")}
                okText="删除"
                cancelText="取消"
              >
                <Button size="small" danger>删除</Button>
              </Popconfirm>
            )}
          </Space>
        ),
      },
    ];
  }, [
    canDelete,
    handleDelete,
    handleReviveBoss,
    isMonsterLikeEntity,
    isMonstersEntity,
    isPlayersEntity,
    openEdit,
    openFortuneModal,
    openRealmModal,
    revivingBossId,
    uiConfig,
  ]);

  useEffect(() => {
    const initialPageSize = PAGE_SIZE_OPTIONS[0];
    setQuickFilters({});
    setAppliedQuickFilters({});
    setQueryKeyword("");
    setKeyword("");
    setPage(1);
    setPageSize(initialPageSize);
    setGenerateModalOpen(false);
    setRealmModalOpen(false);
    setRealmTargetPlayer(null);
    setRealmCorrecting(false);
    setGeneratedCodes([]);
    setSelectedRowKeys([]);
    setRevivingBossId(null);
    setFortuneModalOpen(false);
    setFortuneTargetPlayer(null);
    setPlayerFortunes([]);
    setGrantFortuneIds([]);
    setGrantFortuneLoading(false);
    setRemovingPlayerFortuneId(null);
    setAiItemStats(null);
    setAiCleanupModalOpen(false);
    setAiCleanupLoading(false);
    setAiCleanupExecuting(false);
    setAiCleanupPreview(null);
    setAiCleanupSourceType(undefined);
    setAiCleanupRarity(undefined);
    setAiCleanupMinAgeHours(6);
    setAiCleanupDeleteLimit(500);
    if (isPlayersEntity) {
      realmForm.resetFields();
    }
    void fetchList(1, initialPageSize, "", {});
  }, [entity, fetchList, isPlayersEntity, realmForm]);

  useEffect(() => {
    if (!generateModalOpen) {
      return;
    }
    generateForm.setFieldsValue({
      count: 10,
      maxUses: 1,
      codePrefix: "",
      expiresAt: undefined,
      rewardText: "{\"gold\":100}",
    });
  }, [generateForm, generateModalOpen]);

  function openCreate() {
    setEditingRow(null);
    form.resetFields();
    form.setFieldsValue(buildCreateFormDefaults(uiConfig.formFields));
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingRow(null);
    form.resetFields();
  }

  function openGenerateModal() {
    setGeneratedCodes([]);
    setGenerateModalOpen(true);
  }

  function closeGenerateModal() {
    setGenerateModalOpen(false);
    setGeneratedCodes([]);
  }

  function closeRealmModal() {
    setRealmModalOpen(false);
    setRealmTargetPlayer(null);
    realmForm.resetFields();
  }

  async function copyGeneratedCodes() {
    if (!generatedCodes.length) {
      return;
    }

    try {
      await navigator.clipboard.writeText(generatedCodes.join("\n"));
      message.success("已复制全部CDK");
    } catch {
      message.error("复制失败");
    }
  }

  async function handleGenerateCdk() {
    try {
      const values = await generateForm.validateFields();
      let reward: unknown;

      try {
        reward = JSON.parse(values.rewardText as string);
      } catch {
        message.error("奖励 JSON 格式错误");
        return;
      }

      setGenerating(true);
      const normalizedExpiresAt = toIsoDateTime(values.expiresAt);
      const res = await fetch("/api/admin/cdk/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: values.count,
          maxUses: values.maxUses,
          codePrefix: values.codePrefix || undefined,
          expiresAt: normalizedExpiresAt ?? undefined,
          reward,
        }),
      });
      const data: GenerateCdkResponse = await res.json();

      if (!data.success) {
        message.error(data.error || "生成失败");
        return;
      }

      const codes = data.data?.codes || [];
      setGeneratedCodes(codes);
      message.success(`生成成功，共 ${codes.length} 条`);
      await fetchList(page, pageSize, queryKeyword, appliedQuickFilters);
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) {
        return;
      }
      message.error("生成失败");
    } finally {
      setGenerating(false);
    }
  }

  async function handleUpdatePlayerRealm() {
    try {
      if (!realmTargetPlayer?.id) {
        message.error("玩家ID不存在");
        return;
      }

      const values = await realmForm.validateFields();
      const targetRealm = Number(values.targetRealm);
      setRealmSubmitting(true);
      const res = await fetch(`/api/admin/players/${encodeURIComponent(String(realmTargetPlayer.id))}/realm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetRealm }),
      });
      const data: PlayerRealmUpdateResponse = await res.json();

      if (!data.success) {
        message.error(data.error || "境界操作失败");
        return;
      }

      message.success("境界已更新");
      closeRealmModal();
      await fetchList(page, pageSize, queryKeyword, appliedQuickFilters);
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) {
        return;
      }
      message.error("境界操作失败");
    } finally {
      setRealmSubmitting(false);
    }
  }

  const handleRealmCorrection = useCallback(async () => {
    try {
      setRealmCorrecting(true);
      const res = await fetch("/api/admin/players/realm-correction", {
        method: "POST",
      });
      const data: PlayerRealmCorrectionResponse = await res.json();

      if (!data.success || !data.data) {
        message.error(data.error || "境界矫正失败");
        return;
      }

      const { total, successCount, failedCount, failures } = data.data;
      if (failedCount > 0) {
        const firstFailure = failures[0];
        const firstFailureText = firstFailure ? `，示例失败：${firstFailure.id}（${firstFailure.error}）` : "";
        message.warning(`境界矫正完成：成功 ${successCount}/${total}，失败 ${failedCount}${firstFailureText}`);
      } else {
        message.success(`境界矫正完成：共 ${total} 名玩家`);
      }

      await fetchList(page, pageSize, queryKeyword, appliedQuickFilters);
    } catch {
      message.error("境界矫正失败");
    } finally {
      setRealmCorrecting(false);
    }
  }, [appliedQuickFilters, fetchList, message, page, pageSize, queryKeyword]);

  async function handleSubmit() {
    try {
      const values = await form.validateFields();
      validateJsonFields(uiConfig.formFields, values as Record<string, unknown>);
      const payload: Record<string, unknown> = {};

      uiConfig.formFields.forEach((field) => {
        if (isCreateMode || !field.readOnlyOnEdit) {
          payload[field.key] = mapFormValue(field, values[field.key]);
        }
      });

      if (entity === "randomEvents") {
        const eventType = typeof payload.eventType === "string"
          ? payload.eventType
          : (typeof editingRow?.eventType === "string" ? editingRow.eventType : "");
        if (eventType !== "opportunity") {
          payload.durationSeconds = null;
          payload.iconImageUrl = null;
        }
      }

      if (!isCreateMode && editingRow?.id !== undefined) {
        payload.id = editingRow.id;
      }

      setSaving(true);
      const res = await fetch(`/api/admin/${entity}`, {
        method: isCreateMode ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!data.success) {
        message.error(data.error || "保存失败");
        return;
      }

      message.success(isCreateMode ? "新增成功" : "更新成功");
      closeModal();
      await fetchList(page, pageSize, queryKeyword, appliedQuickFilters);
    } catch (error) {
      if (error instanceof SyntaxError) {
        message.error("JSON字段格式错误");
        return;
      }
      if ((error as { errorFields?: unknown }).errorFields) {
        return;
      }
      message.error("保存失败");
    } finally {
      setSaving(false);
    }
  }

  const handleNpcImageUpload = useCallback(async (fieldKey: "avatarImageUrl" | "portraitImageUrl", file: File) => {
    setUploadingNpcImageField(fieldKey);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("category", NPC_IMAGE_FIELD_UPLOAD_CATEGORY[fieldKey]);
      const res = await fetch("/api/admin/cosmetics/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json() as ImageUploadResponse;
      if (!data.success || !data.data?.imageUrl) {
        message.error(data.error || "上传失败");
        return;
      }
      form.setFieldValue(fieldKey, data.data.imageUrl);
      message.success("上传成功");
    } catch {
      message.error("上传失败");
    } finally {
      setUploadingNpcImageField(null);
    }
  }, [form, message]);

  const handleItemIconUpload = useCallback(async (file: File) => {
    setUploadingItemIcon(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("category", ITEM_ICON_UPLOAD_CATEGORY);
      const res = await fetch("/api/admin/cosmetics/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json() as ImageUploadResponse;
      if (!data.success || !data.data?.imageUrl) {
        message.error(data.error || "上传失败");
        return;
      }
      form.setFieldValue("iconUrl", data.data.imageUrl);
      message.success("上传成功");
    } catch {
      message.error("上传失败");
    } finally {
      setUploadingItemIcon(false);
    }
  }, [form, message]);

  const handleMonsterIconUpload = useCallback(async (file: File) => {
    setUploadingMonsterIcon(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("category", MONSTER_ICON_UPLOAD_CATEGORY);
      const res = await fetch("/api/admin/cosmetics/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json() as ImageUploadResponse;
      if (!data.success || !data.data?.imageUrl) {
        message.error(data.error || "上传失败");
        return;
      }
      form.setFieldValue("iconUrl", data.data.imageUrl);
      message.success("上传成功");
    } catch {
      message.error("上传失败");
    } finally {
      setUploadingMonsterIcon(false);
    }
  }, [form, message]);

  const handleMapBackgroundUpload = useCallback(async (file: File) => {
    setUploadingMapBackground(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("category", MAP_BACKGROUND_UPLOAD_CATEGORY);
      const res = await fetch("/api/admin/cosmetics/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json() as ImageUploadResponse;
      if (!data.success || !data.data?.imageUrl) {
        message.error(data.error || "上传失败");
        return;
      }
      form.setFieldValue("backgroundImageUrl", data.data.imageUrl);
      message.success("上传成功");
    } catch {
      message.error("上传失败");
    } finally {
      setUploadingMapBackground(false);
    }
  }, [form, message]);

  const handleEventIllustrationUpload = useCallback(async (file: File) => {
    setUploadingEventIllustration(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("category", EVENT_ILLUSTRATION_UPLOAD_CATEGORY);
      const res = await fetch("/api/admin/cosmetics/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json() as ImageUploadResponse;
      if (!data.success || !data.data?.imageUrl) {
        message.error(data.error || "上传失败");
        return;
      }

      const currentRaw = form.getFieldValue("imageUrls");
      let currentList: string[] = [];
      if (typeof currentRaw === "string" && currentRaw.trim()) {
        try {
          const parsed = JSON.parse(currentRaw) as unknown;
          if (Array.isArray(parsed)) {
            currentList = parsed.map((item) => String(item || "").trim()).filter(Boolean);
          }
        } catch {
          currentList = [];
        }
      }

      const nextList = [...currentList, data.data.imageUrl];
      form.setFieldValue("imageUrls", JSON.stringify(nextList, null, 2));
      message.success("上传成功");
    } catch {
      message.error("上传失败");
    } finally {
      setUploadingEventIllustration(false);
    }
  }, [form, message]);

  const handleEventIconUpload = useCallback(async (file: File) => {
    setUploadingEventIcon(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("category", EVENT_ICON_UPLOAD_CATEGORY);
      const res = await fetch("/api/admin/cosmetics/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json() as ImageUploadResponse;
      if (!data.success || !data.data?.imageUrl) {
        message.error(data.error || "上传失败");
        return;
      }

      form.setFieldValue("iconImageUrl", data.data.imageUrl);
      message.success("上传成功");
    } catch {
      message.error("上传失败");
    } finally {
      setUploadingEventIcon(false);
    }
  }, [form, message]);

  const handleSkillEffectSpriteUpload = useCallback(async (file: File) => {
    setUploadingSkillEffectSprite(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("category", SKILL_EFFECT_UPLOAD_CATEGORY);
      const res = await fetch("/api/admin/cosmetics/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json() as ImageUploadResponse;
      if (!data.success || !data.data?.imageUrl) {
        message.error(data.error || "上传失败");
        return;
      }

      form.setFieldValue("visualEffectSpriteUrl", data.data.imageUrl);
      message.success("上传成功");
    } catch {
      message.error("上传失败");
    } finally {
      setUploadingSkillEffectSprite(false);
    }
  }, [form, message]);

  function renderFormItem(field: AdminFieldConfig) {
    if (isCreateMode && field.key === "id") {
      return null;
    }
    if (entity === "npcs" && field.key === "bountyDailyLimit" && watchedNpcBountyEnabled !== true) {
      return null;
    }
    if (
      entity === "randomEvents"
      && (field.key === "durationSeconds" || field.key === "iconImageUrl")
      && resolvedRandomEventType !== "opportunity"
    ) {
      return null;
    }

    const resolvedFieldLabel = entity === "randomEvents" && field.key === "spawnIntervalSeconds"
      ? (
          resolvedRandomEventType === "encounter"
            ? "触发间隔(秒)"
            : resolvedRandomEventType === "opportunity"
              ? "刷新间隔(秒)"
              : field.label
        )
      : field.label;
    const resolvedPlaceholder = entity === "randomEvents" && field.key === "spawnIntervalSeconds"
      ? (
          resolvedRandomEventType === "encounter"
            ? "例如 300，表示同一玩家触发后 300 秒内不会再次触发该遭遇"
            : resolvedRandomEventType === "opportunity"
              ? "例如 600，表示该机缘每 600 秒刷新一次"
              : (field.placeholder || "")
        )
      : (field.placeholder || "");
    const disabled = !isCreateMode && field.readOnlyOnEdit;
    const requiredPrefix = field.type === "select" || isRealmSelectField(field) ? "请选择" : "请输入";
    const commonProps = {
      name: field.key,
      label: resolvedFieldLabel,
      rules: field.required ? [{ required: true, message: `${requiredPrefix}${resolvedFieldLabel}` }] : undefined,
    };

    if (entity === "npcs" && (field.key === "avatarImageUrl" || field.key === "portraitImageUrl")) {
      const fieldKey = field.key;
      return (
        <Form.Item key={field.key} {...commonProps}>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              disabled={disabled}
              placeholder={resolvedPlaceholder || `请输入${resolvedFieldLabel}`}
            />
            <Upload
              showUploadList={false}
              accept=".png,.jpg,.jpeg,.webp,.gif"
              disabled={disabled}
              beforeUpload={(file) => {
                void handleNpcImageUpload(fieldKey, file);
                return false;
              }}
            >
              <Button
                icon={<UploadOutlined />}
                loading={uploadingNpcImageField === fieldKey}
                disabled={disabled}
              >
                上传
              </Button>
            </Upload>
          </Space.Compact>
        </Form.Item>
      );
    }

    if ((entity === "items" || entity === "aiItems") && field.key === "iconUrl") {
      return (
        <Form.Item key={field.key} {...commonProps}>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              disabled={disabled}
              placeholder={resolvedPlaceholder || `请输入${resolvedFieldLabel}`}
            />
            <Upload
              showUploadList={false}
              accept=".png,.jpg,.jpeg,.webp,.gif"
              disabled={disabled}
              beforeUpload={(file) => {
                void handleItemIconUpload(file);
                return false;
              }}
            >
              <Button
                icon={<UploadOutlined />}
                loading={uploadingItemIcon}
                disabled={disabled}
              >
                上传
              </Button>
            </Upload>
          </Space.Compact>
        </Form.Item>
      );
    }

    if (isMonsterLikeEntity && field.key === "iconUrl") {
      return (
        <Form.Item key={field.key} {...commonProps}>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              disabled={disabled}
              placeholder={resolvedPlaceholder || `请输入${resolvedFieldLabel}`}
            />
            <Upload
              showUploadList={false}
              accept=".png,.jpg,.jpeg,.webp,.gif"
              disabled={disabled}
              beforeUpload={(file) => {
                void handleMonsterIconUpload(file);
                return false;
              }}
            >
              <Button
                icon={<UploadOutlined />}
                loading={uploadingMonsterIcon}
                disabled={disabled}
              >
                上传
              </Button>
            </Upload>
          </Space.Compact>
        </Form.Item>
      );
    }

    if (isMapLikeEntity && field.key === "backgroundImageUrl") {
      return (
        <Form.Item key={field.key} {...commonProps}>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              disabled={disabled}
              placeholder={resolvedPlaceholder || `请输入${resolvedFieldLabel}`}
            />
            <Upload
              showUploadList={false}
              accept=".png,.jpg,.jpeg,.webp,.gif"
              disabled={disabled}
              beforeUpload={(file) => {
                void handleMapBackgroundUpload(file);
                return false;
              }}
            >
              <Button
                icon={<UploadOutlined />}
                loading={uploadingMapBackground}
                disabled={disabled}
              >
                上传
              </Button>
            </Upload>
          </Space.Compact>
        </Form.Item>
      );
    }

    if (entity === "randomEvents" && field.key === "iconImageUrl") {
      return (
        <Form.Item key={field.key} {...commonProps}>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              disabled={disabled}
              placeholder={resolvedPlaceholder || `请输入${resolvedFieldLabel}`}
            />
            <Upload
              showUploadList={false}
              accept=".png,.jpg,.jpeg,.webp,.gif"
              disabled={disabled}
              beforeUpload={(file) => {
                void handleEventIconUpload(file);
                return false;
              }}
            >
              <Button
                icon={<UploadOutlined />}
                loading={uploadingEventIcon}
                disabled={disabled}
              >
                上传
              </Button>
            </Upload>
          </Space.Compact>
        </Form.Item>
      );
    }

    if (entity === "skills" && field.key === "visualEffectSpriteUrl") {
      return (
        <Form.Item key={field.key} {...commonProps}>
          <Space.Compact style={{ width: "100%" }}>
            <Input disabled={disabled} placeholder={field.placeholder} />
            <Upload
              showUploadList={false}
              accept=".png,.jpg,.jpeg,.webp,.gif"
              disabled={disabled}
              beforeUpload={(file) => {
                void handleSkillEffectSpriteUpload(file);
                return false;
              }}
            >
              <Button
                icon={<UploadOutlined />}
                loading={uploadingSkillEffectSprite}
                disabled={disabled}
              >
                上传
              </Button>
            </Upload>
          </Space.Compact>
        </Form.Item>
      );
    }

    if (field.type === "textarea") {
      return (
        <Form.Item key={field.key} {...commonProps}>
          <TextArea rows={4} disabled={disabled} placeholder={resolvedPlaceholder || `请输入${resolvedFieldLabel}`} />
        </Form.Item>
      );
    }

    if (field.type === "json") {
      if (entity === "randomEvents" && field.key === "imageUrls") {
        return (
          <Form.Item key={field.key} {...commonProps}>
            <Space orientation="vertical" style={{ width: "100%" }}>
              <JsonFieldEditor
                field={field}
                disabled={disabled}
                realmOptions={realmOptions}
              />
              <Upload
                showUploadList={false}
                accept=".png,.jpg,.jpeg,.webp,.gif"
                disabled={disabled}
                beforeUpload={(file) => {
                  void handleEventIllustrationUpload(file);
                  return false;
                }}
              >
                <Button
                  icon={<UploadOutlined />}
                  loading={uploadingEventIllustration}
                  disabled={disabled}
                >
                  上传插图
                </Button>
              </Upload>
              <Text style={{ color: "#a09880", fontSize: 12 }}>
                可绑定多张，事件触发时会随机选中一张展示。
              </Text>
            </Space>
          </Form.Item>
        );
      }

      if (isMapLikeEntity && field.key === "tilesData") {
        return (
          <Form.Item key={field.key} {...commonProps}>
            <MapTileGridEditor
              field={field}
              disabled={disabled}
              mapWidth={toOptionalNumber(watchedMapWidth)}
              mapHeight={toOptionalNumber(watchedMapHeight)}
              mapType={resolvedMapType}
              backgroundImageUrl={resolvedMapBackgroundImageUrl}
            />
          </Form.Item>
        );
      }

      return (
        <Form.Item key={field.key} {...commonProps}>
            <JsonFieldEditor
              field={field}
              disabled={disabled}
              realmOptions={realmOptions}
              allowNegativeRewardValue={entity === "randomEvents" && field.key === "rewards"}
            />
          </Form.Item>
        );
      }

    if (field.type === "number") {
      const disabledNumberInput = disabled || (field.key === "id" && isCreateMode);

      if (isRealmSelectField(field)) {
        return (
          <Form.Item key={field.key} {...commonProps}>
            <Select
              showSearch
              optionFilterProp="label"
              options={realmOptions}
              allowClear={!field.required}
              disabled={disabledNumberInput}
              placeholder={resolvedPlaceholder || `请选择${resolvedFieldLabel}`}
            />
          </Form.Item>
        );
      }

      if ((entity === "npcs" || entity === "temporaryMonsters" || entity === "monsters") && field.key === "positionY") {
        return (
          <Fragment key={`__position_group_${entity}_${field.key}`}>
            <Form.Item key={field.key} {...commonProps}>
              <InputNumber style={{ width: "100%" }} disabled={disabledNumberInput} />
            </Form.Item>
            <Form.Item key={`__map_position_picker_${entity}`} label="地块坐标编辑">
              <MapPositionPicker
                form={form}
                entity={entity}
                selfEntityId={!isCreateMode && editingRow?.id ? String(editingRow.id) : undefined}
                disabled={disabled}
              />
            </Form.Item>
          </Fragment>
        );
      }

      return (
        <Form.Item key={field.key} {...commonProps}>
          <InputNumber style={{ width: "100%" }} disabled={disabledNumberInput} placeholder={resolvedPlaceholder || `请输入${resolvedFieldLabel}`} />
        </Form.Item>
      );
    }

    if (field.type === "boolean") {
      return (
        <Form.Item key={field.key} {...commonProps} valuePropName="checked">
          <Switch disabled={disabled} />
        </Form.Item>
      );
    }

    if (field.type === "select") {
      return (
        <Form.Item key={field.key} {...commonProps}>
          <Select
            mode={field.multiple ? "multiple" : undefined}
            showSearch
            optionFilterProp="label"
          options={field.options || []}
          allowClear={!field.required}
          disabled={disabled}
          placeholder={resolvedPlaceholder || `请选择${resolvedFieldLabel}`}
        />
      </Form.Item>
      );
    }

    if (field.key === "expiresAt") {
      return (
        <Form.Item key={field.key} {...commonProps}>
          <DatePicker
            showTime
            format="YYYY-MM-DD HH:mm"
            style={{ width: "100%" }}
            disabled={disabled}
            placeholder="请选择过期时间"
          />
        </Form.Item>
      );
    }

    if (field.relation) {
      return (
        <Form.Item key={field.key} {...commonProps}>
          <ReferenceSelect
          entity={field.relation.entity}
          labelKey={field.relation.labelKey}
          disabled={disabled}
          allowClear={!field.required}
          placeholder={resolvedPlaceholder || `请选择${resolvedFieldLabel}`}
        />
      </Form.Item>
      );
    }

    if (field.key === "password") {
      return (
        <Form.Item key={field.key} {...commonProps}>
          <Input.Password disabled={disabled} autoComplete="new-password" placeholder={field.placeholder} />
        </Form.Item>
      );
    }

    return (
      <Form.Item key={field.key} {...commonProps}>
        <Input disabled={disabled} />
      </Form.Item>
    );
  }

  function resetView() {
    setQuickFilters({});
    setAppliedQuickFilters({});
    setKeyword("");
    setQueryKeyword("");
    setPage(1);
    setSelectedRowKeys([]);
    void fetchList(1, pageSize, "", {});
  }

  async function handleExportSystemConfigs() {
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
  }

  async function handleImportSystemConfigs(file: File) {
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
      const result = await res.json();

      if (!result.success) {
        message.error(result.error || "导入失败");
        return;
      }

      const { total, created, updated } = result.data;
      message.success(`导入成功：共 ${total} 项，新增 ${created} 项，更新 ${updated} 项`);
      await fetchList(page, pageSize, queryKeyword, appliedQuickFilters);
    } catch {
      message.error("导入失败");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card
      title={ADMIN_ENTITY_LABELS[entity]}
      extra={
        <Space wrap>
          <Search
            value={keyword}
            allowClear
            placeholder="输入关键词搜索"
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={(value) => {
              const nextKeyword = value.trim();
              setQueryKeyword(nextKeyword);
              setPage(1);
              void fetchList(1, pageSize, nextKeyword, appliedQuickFilters);
            }}
            style={{ width: 260 }}
          />

          {uiConfig.quickFilters?.map((filter) => (
            <Select
              key={filter.key}
              style={{ width: 180 }}
              showSearch
              optionFilterProp="label"
              allowClear
              placeholder={filter.label}
              value={quickFilters[filter.key]}
              options={filter.options}
              onChange={(value) => {
                setQuickFilters((prev) => ({
                  ...prev,
                  [filter.key]: value,
                }));
              }}
            />
          ))}

          {uiConfig.quickFilters && uiConfig.quickFilters.length > 0 && (
            <Button
              onClick={() => {
                const nextFilters: QuickFilterValue = {};
                uiConfig.quickFilters?.forEach((filter) => {
                  const value = quickFilters[filter.key];
                  if (value) {
                    nextFilters[filter.key] = value;
                  }
                });
                setAppliedQuickFilters(nextFilters);
                setPage(1);
                void fetchList(1, pageSize, queryKeyword, nextFilters);
              }}
            >
              应用筛选
            </Button>
          )}

          {isCdkEntity && (
            <Button type="primary" onClick={openGenerateModal}>
              批量生成CDK
            </Button>
          )}

          {isSystemConfigEntity && (
            <>
              <Button icon={<DownloadOutlined />} onClick={handleExportSystemConfigs}>
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
            </>
          )}

          {isPlayersEntity && (
            <Popconfirm
              title="确认执行全服境界矫正？"
              description="将按当前境界重算每个角色属性，保留修为并重置突破加成。"
              onConfirm={() => void handleRealmCorrection()}
              okText="执行"
              cancelText="取消"
            >
              <Button loading={realmCorrecting}>
                境界矫正
              </Button>
            </Popconfirm>
          )}

          {isAiItemsEntity && (
            <Button onClick={openAiCleanupModal}>AI清理</Button>
          )}

          {!uiConfig.disableCreate && (
            <Button type="primary" onClick={openCreate}>新增</Button>
          )}

          {supportsBatchDelete && (
            <Popconfirm
              title={`确认删除选中的 ${selectedRowKeys.length} 条记录？`}
              onConfirm={() => void handleBatchDelete()}
              okText="删除"
              cancelText="取消"
              disabled={!selectedRowKeys.length}
            >
              <Button danger disabled={!selectedRowKeys.length}>
                批量删除
              </Button>
            </Popconfirm>
          )}

          <Button onClick={() => fetchList(page, pageSize, queryKeyword, appliedQuickFilters)}>刷新</Button>
          <Button onClick={resetView}>重置视图</Button>
        </Space>
      }
      styles={{
        body: { paddingBottom: 8 },
      }}
    >
      {isAiItemsEntity && aiItemStats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <Card size="small" title="AI物品总量">
            <Text strong>{aiItemStats.totalAiItems}</Text>
          </Card>
          <Card size="small" title="今日新增">
            <Text strong>{aiItemStats.todayCreatedCount}</Text>
          </Card>
          <Card size="small" title="可回收候选">
            <Text strong>{aiItemStats.reclaimableCount}</Text>
          </Card>
          <Card size="small" title="来源分布">
            <Text>{Object.entries(aiItemStats.bySource).map(([key, value]) => `${key}:${value}`).join(" / ") || "-"}</Text>
          </Card>
        </div>
      )}

      <Table<RowRecord>
        rowKey={(record) => String(record.id)}
        columns={columns}
        dataSource={list}
        loading={loading}
        pagination={false}
        scroll={{ x: 1200 }}
        size="small"
        rowSelection={supportsBatchDelete
          ? {
            selectedRowKeys,
            onChange: (keys: Key[]) => setSelectedRowKeys(keys.map((key) => String(key))),
          }
          : undefined}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <Pagination
          current={page}
          pageSize={pageSize}
          total={total}
          pageSizeOptions={PAGE_SIZE_OPTIONS.map(String)}
          showSizeChanger
          showTotal={(count) => `共 ${count} 条`}
          onChange={(nextPage, nextPageSize) => {
            void fetchList(nextPage, nextPageSize, queryKeyword, appliedQuickFilters);
          }}
        />
      </div>

      <Modal
        title="AI物品清理"
        open={aiCleanupModalOpen}
        onCancel={closeAiCleanupModal}
        footer={[
          <Button key="close" onClick={closeAiCleanupModal}>
            关闭
          </Button>,
          <Button key="preview" loading={aiCleanupLoading || aiCleanupExecuting} onClick={() => void handleAiCleanup(true)}>
            Dry Run
          </Button>,
          <Button key="refresh" loading={aiCleanupLoading || aiCleanupExecuting} onClick={() => void loadAiCleanupPreview()}>
            刷新预览
          </Button>,
          <Button key="execute" type="primary" danger loading={aiCleanupExecuting} onClick={() => void handleAiCleanup(false)}>
            执行清理
          </Button>,
        ]}
        width={860}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space wrap style={{ width: "100%" }}>
            <Select
              allowClear
              placeholder="来源筛选"
              style={{ minWidth: 180 }}
              value={aiCleanupSourceType}
              options={uiConfig.quickFilters?.find((item) => item.key === "sourceType")?.options || []}
              onChange={(value) => setAiCleanupSourceType(value)}
            />
            <Select
              allowClear
              placeholder="品质筛选"
              style={{ minWidth: 160 }}
              value={aiCleanupRarity}
              options={uiConfig.quickFilters?.find((item) => item.key === "rarity")?.options || []}
              onChange={(value) => setAiCleanupRarity(value)}
            />
            <InputNumber
              min={1}
              style={{ width: 170 }}
              value={aiCleanupMinAgeHours}
              onChange={(value) => setAiCleanupMinAgeHours(Number(value || 6))}
              addonBefore="保留"
              addonAfter="小时"
            />
            <InputNumber
              min={1}
              max={1000}
              style={{ width: 180 }}
              value={aiCleanupDeleteLimit}
              onChange={(value) => setAiCleanupDeleteLimit(Number(value || 500))}
              addonBefore="单次上限"
            />
          </Space>

          {aiCleanupPreview?.stats && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              <Card size="small" title="AI总量">
                <Text strong>{aiCleanupPreview.stats.totalAiItems}</Text>
              </Card>
              <Card size="small" title="今日新增">
                <Text strong>{aiCleanupPreview.stats.todayCreatedCount}</Text>
              </Card>
              <Card size="small" title="可回收">
                <Text strong>{aiCleanupPreview.stats.reclaimableCount}</Text>
              </Card>
              <Card size="small" title="状态分布">
                <Text>{Object.entries(aiCleanupPreview.stats.byCleanupState).map(([key, value]) => `${key}:${value}`).join(" / ") || "-"}</Text>
              </Card>
            </div>
          )}

          {aiCleanupPreview?.preview && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              <Card size="small" title="预览结果">
                <Space direction="vertical" size={4}>
                  <Text>匹配总数：{aiCleanupPreview.preview.totalMatched}</Text>
                  <Text>可清理：{aiCleanupPreview.preview.candidateCount}</Text>
                  <Text>仍被引用：{aiCleanupPreview.preview.protectedCount}</Text>
                  <Text>历史待归档：{aiCleanupPreview.preview.legacyUnknownCount}</Text>
                </Space>
              </Card>
              <Card size="small" title="来源分布">
                <Text>{Object.entries(aiCleanupPreview.preview.sourceBreakdown).map(([key, value]) => `${key}:${value}`).join(" / ") || "-"}</Text>
              </Card>
              <Card size="small" title="品质分布">
                <Text>{Object.entries(aiCleanupPreview.preview.rarityBreakdown).map(([key, value]) => `${key}:${value}`).join(" / ") || "-"}</Text>
              </Card>
              <Card size="small" title="高频桶">
                <Text>{aiCleanupPreview.preview.topFrequencyBuckets.map((item) => `${item.bucket}:${item.count}`).join(" / ") || "-"}</Text>
              </Card>
            </div>
          )}
        </Space>
      </Modal>

      <Modal
        title={isCreateMode ? `新增${ADMIN_ENTITY_LABELS[entity]}` : `编辑${ADMIN_ENTITY_LABELS[entity]}`}
        open={modalOpen}
        forceRender
        onCancel={closeModal}
        onOk={handleSubmit}
        okText={isCreateMode ? "新增" : "保存"}
        cancelText="取消"
        confirmLoading={saving}
        width={860}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{}}
          onValuesChange={(changedValues: Record<string, unknown>) => {
            if (entity !== "npcs") {
              return;
            }
            if (changedValues.bountyEnabled === false) {
              form.setFieldValue("bountyDailyLimit", 0);
            }
          }}
        >
          {uiConfig.formFields.map((field) => renderFormItem(field))}
        </Form>
      </Modal>

      {isCdkEntity && (
        <Modal
          title="批量生成CDK"
          open={generateModalOpen}
          forceRender
          onCancel={closeGenerateModal}
          onOk={handleGenerateCdk}
          okText="生成"
          cancelText="取消"
          confirmLoading={generating}
          width={760}
        >
          <Form form={generateForm} layout="vertical" initialValues={{}}>
            <Form.Item
              label="生成数量"
              name="count"
              rules={[{ required: true, message: "请输入生成数量" }]}
            >
              <InputNumber style={{ width: "100%" }} min={1} max={500} />
            </Form.Item>

            <Form.Item
              label="单码总可用次数"
              name="maxUses"
              rules={[{ required: true, message: "请输入可用次数" }]}
            >
              <InputNumber style={{ width: "100%" }} min={1} />
            </Form.Item>

            <Form.Item label="前缀（可选）" name="codePrefix">
              <Input maxLength={12} placeholder="例如: NEWYEAR" />
            </Form.Item>

            <Form.Item label="过期时间（可选）" name="expiresAt">
              <DatePicker
                showTime
                format="YYYY-MM-DD HH:mm"
                style={{ width: "100%" }}
                placeholder="请选择过期时间"
              />
            </Form.Item>

            <Form.Item
              label="奖励 JSON"
              name="rewardText"
              rules={[{ required: true, message: "请输入奖励配置" }]}
            >
              <JsonFieldEditor field={CDK_GENERATE_REWARD_FIELD} />
            </Form.Item>
          </Form>

          {generatedCodes.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Space style={{ marginBottom: 8 }}>
                <Text style={{ color: "#a09880" }}>本次生成 {generatedCodes.length} 条</Text>
                <Button size="small" onClick={copyGeneratedCodes}>复制全部</Button>
              </Space>
              <TextArea
                value={generatedCodes.join("\n")}
                rows={8}
                readOnly
              />
            </div>
          )}
        </Modal>
      )}

      {isPlayersEntity && (
        <Modal
          title={`境界操作${realmTargetPlayer?.name ? ` - ${String(realmTargetPlayer.name)}` : ""}`}
          open={realmModalOpen}
          forceRender
          onCancel={closeRealmModal}
          onOk={handleUpdatePlayerRealm}
          okText="执行"
          cancelText="取消"
          confirmLoading={realmSubmitting}
          width={520}
        >
          <Form form={realmForm} layout="vertical" initialValues={{}}>
            <Form.Item
              name="targetRealm"
              label="目标境界"
              rules={[{ required: true, message: "请选择目标境界" }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={realmOptions}
                placeholder="请选择目标境界"
              />
            </Form.Item>
            <Text style={{ color: "#a09880" }}>
              将从最低境界按突破规则模拟到目标境界，并重算基础属性。
            </Text>
          </Form>
        </Modal>
      )}

      {isPlayersEntity && (
        <Modal
          title={`气运操作${fortuneTargetPlayer?.name ? ` - ${String(fortuneTargetPlayer.name)}` : ""}`}
          open={fortuneModalOpen}
          onCancel={closeFortuneModal}
          footer={null}
          width={780}
        >
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            <Card size="small" title="发放气运">
              <Space orientation="vertical" style={{ width: "100%" }}>
                <Select
                  mode="multiple"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择要发放的气运"
                  value={grantFortuneIds}
                  onChange={(values) => setGrantFortuneIds(values)}
                  options={fortuneOptions.map((item) => ({
                    value: item.id,
                    label: `${item.name} [${item.grade}]${item.enabled ? "" : " (已禁用)"}`,
                  }))}
                />
                <Button
                  type="primary"
                  loading={grantFortuneLoading}
                  onClick={() => void handleGrantFortunes()}
                >
                  发放
                </Button>
              </Space>
            </Card>

            <Card size="small" title="当前气运">
              {playerFortunesLoading ? (
                <Text style={{ color: "#a09880" }}>加载中...</Text>
              ) : playerFortunes.length === 0 ? (
                <Text style={{ color: "#6b6355" }}>暂无气运记录</Text>
              ) : (
                <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                  {playerFortunes.map((row) => (
                    <Card key={row.playerFortuneId} size="small">
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <div>
                          <Text style={{ display: "block", color: "#c9a84c" }}>
                            {row.fortuneName} [{row.fortuneGrade}]
                          </Text>
                          <Text style={{ display: "block", color: "#a09880", fontSize: 12 }}>
                            状态：{row.status} · 来源：{row.sourceType}
                          </Text>
                          <Text style={{ display: "block", color: "#6b6355", fontSize: 12 }}>
                            生效：{row.acquiredAt}
                          </Text>
                          <Text style={{ display: "block", color: "#6b6355", fontSize: 12 }}>
                            到期：{row.expiresAt || "永久"}
                          </Text>
                        </div>
                        <div>
                          <Button
                            danger
                            size="small"
                            disabled={row.status !== "active"}
                            loading={removingPlayerFortuneId === row.playerFortuneId}
                            onClick={() => void handleRemovePlayerFortune(row.playerFortuneId)}
                          >
                            移除
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </Space>
              )}
            </Card>
          </Space>
        </Modal>
      )}
    </Card>
  );
}

function AdminEntityManagerContent({ entity }: { entity: AdminEntity }) {
  if (entity === "mapEdges") {
    return <MapEdgesGraphEditor />;
  }

  return <CrudAdminEntityManager entity={entity} />;
}

export default function AdminEntityManager({ entity }: { entity: AdminEntity }) {
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  if (!hydrated) {
    return (
      <Card
        loading
        styles={{
          body: {
            minHeight: 320,
          },
        }}
      />
    );
  }

  return <AdminEntityManagerContent entity={entity} />;
}

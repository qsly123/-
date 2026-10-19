import { NextResponse } from "next/server";
import { db } from "@/db";
import { systemConfigs } from "@/db/schema";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import {
  OPEN_WORLD_LLM_CONFIG_KEYS,
  OPEN_WORLD_SYSTEM_CONFIG_KEYS,
} from "@/modules/system/services/system-config-keys";
import { invalidateSystemConfigCache } from "@/modules/system/services/system-config";
import {
  invalidateOpenWorldAiKeywordPoolCache,
  invalidateOpenWorldCustomNpcLibraryCache,
  invalidateOpenWorldPressureReliefRulesCache,
} from "@/modules/world/services/world-config";

type OpenWorldConfigSaveItem = {
  key: string;
  value: string;
  group: string;
  isSecret: boolean;
  description: string | null;
};

const OPEN_WORLD_EMPTY_ALLOWED_KEYS = new Set<string>([
  ...OPEN_WORLD_LLM_CONFIG_KEYS,
  "OPEN_WORLD_WORLDBOOK_JSON",
  "OPEN_WORLD_KEYWORD_POOL_JSON",
  "OPEN_WORLD_PRESSURE_RELIEF_RULES_JSON",
  "OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON",
]);

function normalizeSaveItem(raw: unknown): OpenWorldConfigSaveItem {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("开放世界配置项格式不正确");
  }

  const row = raw as Record<string, unknown>;
  const key = String(row.key || "").trim();
  const value = String(row.value ?? "");
  const group = String(row.group || "").trim();
  const isSecret = Boolean(row.isSecret);
  const description = typeof row.description === "string" && row.description.trim()
    ? row.description.trim()
    : null;

  if (!key) {
    throw new Error("存在缺少 key 的开放世界配置项");
  }
  if (!OPEN_WORLD_SYSTEM_CONFIG_KEYS.includes(key as typeof OPEN_WORLD_SYSTEM_CONFIG_KEYS[number])) {
    throw new Error(`不允许通过开放世界批量保存的配置项：${key}`);
  }
  if (!group) {
    throw new Error(`${key} 的 group 不能为空`);
  }
  if (!OPEN_WORLD_EMPTY_ALLOWED_KEYS.has(key) && !value.trim()) {
    throw new Error(`${key} 不能为空`);
  }

  return {
    key,
    value,
    group,
    isSecret,
    description,
  };
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json() as {
      items?: unknown[];
    };
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length <= 0) {
      return NextResponse.json({ success: false, error: "没有需要保存的开放世界配置" }, { status: 400 });
    }

    const normalizedItems = rawItems.map((item) => normalizeSaveItem(item));
    const now = new Date().toISOString();

    await db.transaction(async (tx) => {
      for (const item of normalizedItems) {
        await tx.insert(systemConfigs).values({
          key: item.key,
          value: item.value,
          group: item.group,
          isSecret: item.isSecret,
          description: item.description,
          createdAt: now,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: systemConfigs.key,
          set: {
            value: item.value,
            group: item.group,
            isSecret: item.isSecret,
            description: item.description,
            updatedAt: now,
          },
        }).run();
      }
    });

    invalidateSystemConfigCache(normalizedItems.map((item) => item.key));
    const savedKeySet = new Set(normalizedItems.map((item) => item.key));
    if (savedKeySet.has("OPEN_WORLD_KEYWORD_POOL_JSON")) {
      invalidateOpenWorldAiKeywordPoolCache();
    }
    if (savedKeySet.has("OPEN_WORLD_PRESSURE_RELIEF_RULES_JSON")) {
      invalidateOpenWorldPressureReliefRulesCache();
    }
    if (savedKeySet.has("OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON")) {
      invalidateOpenWorldCustomNpcLibraryCache();
    }

    return NextResponse.json({
      success: true,
      data: {
        savedCount: normalizedItems.length,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "保存开放世界配置失败";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 400 });
  }
}

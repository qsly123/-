import { NextResponse } from "next/server";
import { customAlphabet } from "nanoid";
import { db } from "@/db";
import { cdkCodes } from "@/db/schema";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import { hasRewardValue, normalizeCdkReward } from "@/modules/character/services/reward-service";

const MIN_COUNT = 1;
const MAX_COUNT = 500;
const CODE_SEGMENT_LENGTH = 12;
const CODE_SEGMENT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const randomCodeSegment = customAlphabet(CODE_SEGMENT_ALPHABET, CODE_SEGMENT_LENGTH);

function parsePositiveInt(value: unknown, fieldName: string, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} 必须是数字`);
  }
  const intValue = Math.floor(parsed);
  if (intValue < min || intValue > max) {
    throw new Error(`${fieldName} 取值范围为 ${min} ~ ${max}`);
  }
  return intValue;
}

function normalizeCodePrefix(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

function normalizeExpiresAt(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("expiresAt 必须是字符串");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    throw new Error("expiresAt 时间格式错误");
  }

  return new Date(timestamp).toISOString();
}

function buildCode(prefix: string) {
  const segment = randomCodeSegment();
  return prefix ? `${prefix}-${segment}` : segment;
}

function isDuplicateCodeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("cdk_codes_code_unique")
    || error.message.toLowerCase().includes("duplicate key");
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json();

    const count = parsePositiveInt(body.count, "count", MIN_COUNT, MAX_COUNT);
    const maxUses = parsePositiveInt(body.maxUses, "maxUses", 1, 9999999);
    const expiresAt = normalizeExpiresAt(body.expiresAt);
    const reward = normalizeCdkReward(body.reward);
    if (!hasRewardValue(reward)) {
      return NextResponse.json({ success: false, error: "reward 至少需要一种奖励" }, { status: 400 });
    }

    const prefix = normalizeCodePrefix(body.codePrefix);
    const createdCodes: string[] = [];

    for (let i = 0; i < count; i += 1) {
      let created = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const code = buildCode(prefix);

        try {
          await db.insert(cdkCodes).values({
            code,
            reward,
            maxUses,
            usedCount: 0,
            expiresAt,
            enabled: true,
            createdBy: auth.admin.id,
          }).run();

          createdCodes.push(code);
          created = true;
          break;
        } catch (error) {
          if (!isDuplicateCodeError(error)) {
            throw error;
          }
        }
      }

      if (!created) {
        throw new Error("生成 CDK 失败，请重试");
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        codes: createdCodes,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

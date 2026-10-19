import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { resolveCookieSecureFlag } from "@/modules/shared/services/cookie-security";
import {
  createUterusExpelTicket,
  parseUterusExpelTicket,
  resolveUterusExpelPercent,
  resolveUterusExpelReadyAt,
  UTERUS_EXPEL_COOKIE,
  UTERUS_EXPEL_COOKIE_MAX_AGE_SECONDS,
  UTERUS_EXPEL_DURATION_MS,
} from "@/modules/character/services/uterus-expel-service";
import { executeUterusExpelHostCommand } from "@/modules/world/services/double-cultivation-actions";
import { getBuiltinDoubleCultivationSupplementalStats } from "@/modules/world/services/double-cultivation-profile-stats";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

type UterusExpelAction = "start" | "claim" | "cancel";

async function buildExpelCookieOptions() {
  return {
    httpOnly: true,
    secure: await resolveCookieSecureFlag(),
    sameSite: "lax" as const,
    maxAge: UTERUS_EXPEL_COOKIE_MAX_AGE_SECONDS,
    path: "/api/game/uterus-expel",
  };
}

async function clearExpelCookie(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  cookieStore.set(UTERUS_EXPEL_COOKIE, "", {
    ...(await buildExpelCookieOptions()),
    maxAge: 0,
  });
}

function parseAction(raw: unknown): UterusExpelAction | null {
  if (raw === "start" || raw === "claim" || raw === "cancel") {
    return raw;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, {
        status: 401,
        headers: NO_STORE_HEADERS,
      });
    }
    if (player.gender !== "女") {
      return NextResponse.json({ success: false, error: "只有女修可以排精" }, {
        status: 400,
        headers: NO_STORE_HEADERS,
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = parseAction(body?.action);
    if (!action) {
      return NextResponse.json({ success: false, error: "无效的排精操作" }, {
        status: 400,
        headers: NO_STORE_HEADERS,
      });
    }

    const cookieStore = await cookies();
    if (action === "start") {
      const stats = await getBuiltinDoubleCultivationSupplementalStats({
        playerId: player.id,
        gender: player.gender,
      });
      const uterusStorageMl = Math.max(0, Math.floor(Number(stats.uterusStorageMl || 0)));
      const uterusCapacityMl = Math.max(1, Math.floor(Number(stats.uterusCapacityMl || 120)));
      if (uterusStorageMl <= 0) {
        return NextResponse.json({ success: false, error: "当前子宫内没有可排出的精液" }, {
          status: 400,
          headers: NO_STORE_HEADERS,
        });
      }

      const startedAt = new Date().toISOString();
      const ticket = createUterusExpelTicket({
        playerId: player.id,
        startedAt,
      });
      cookieStore.set(UTERUS_EXPEL_COOKIE, ticket, await buildExpelCookieOptions());

      return NextResponse.json({
        success: true,
        data: {
          startedAt,
          readyAt: resolveUterusExpelReadyAt(startedAt),
          durationMs: UTERUS_EXPEL_DURATION_MS,
          uterusStorageMl,
          uterusCapacityMl,
        },
      }, {
        headers: NO_STORE_HEADERS,
      });
    }

    if (action === "cancel") {
      await clearExpelCookie(cookieStore);
      return NextResponse.json({ success: true }, {
        headers: NO_STORE_HEADERS,
      });
    }

    const ticket = cookieStore.get(UTERUS_EXPEL_COOKIE)?.value || "";
    const payload = parseUterusExpelTicket(ticket, player.id);
    if (!payload) {
      await clearExpelCookie(cookieStore);
      return NextResponse.json({ success: false, error: "排精状态已失效，请重新开始" }, {
        status: 400,
        headers: NO_STORE_HEADERS,
      });
    }

    const percent = resolveUterusExpelPercent(payload.startedAt);
    if (percent < 100) {
      return NextResponse.json({ success: false, error: "排精尚未完成，请稍候再收束" }, {
        status: 400,
        headers: NO_STORE_HEADERS,
      });
    }

    const result = await executeUterusExpelHostCommand({ playerId: player.id });
    await clearExpelCookie(cookieStore);

    return NextResponse.json({
      success: true,
      data: {
        percent,
        expelledMl: result.expelledMl,
        uterusStorageMl: result.uterusStorageMl,
        uterusCapacityMl: result.uterusCapacityMl,
        reward: result.reward,
      },
    }, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("Uterus expel route error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "排精失败" }, {
      status: 500,
      headers: NO_STORE_HEADERS,
    });
  }
}

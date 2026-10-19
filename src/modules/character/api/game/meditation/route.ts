import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { players } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import {
  MEDITATION_COOKIE,
  MEDITATION_COOKIE_MAX_AGE_SECONDS,
  MEDITATION_DURATION_MS,
  calcMeditationRecovery,
  createMeditationTicket,
  parseMeditationTicket,
  resolveMeditationPercent,
  resolveMeditationReadyAt,
} from "@/modules/character/services/meditation-service";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";
import { resolveCookieSecureFlag } from "@/modules/shared/services/cookie-security";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

type MeditationAction = "start" | "claim" | "cancel";

async function buildMeditationCookieOptions() {
  return {
    httpOnly: true,
    secure: await resolveCookieSecureFlag(),
    sameSite: "lax" as const,
    maxAge: MEDITATION_COOKIE_MAX_AGE_SECONDS,
    path: "/api/game/meditation",
  };
}

async function clearMeditationCookie(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  cookieStore.set(MEDITATION_COOKIE, "", {
    ...(await buildMeditationCookieOptions()),
    maxAge: 0,
  });
}

function parseAction(raw: unknown): MeditationAction | null {
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

    const body = await req.json().catch(() => ({}));
    const action = parseAction(body?.action);
    if (!action) {
      return NextResponse.json({ success: false, error: "无效的打坐操作" }, {
        status: 400,
        headers: NO_STORE_HEADERS,
      });
    }

    const snapshot = await buildPlayerStatsSnapshot(player);
    const currentHp = Math.max(0, Math.min(player.hp, snapshot.total.maxHp));
    const currentMp = Math.max(0, Math.min(player.mp, snapshot.total.maxMp));

    const cookieStore = await cookies();

    if (action === "start") {
      if (currentHp >= snapshot.total.maxHp && currentMp >= snapshot.total.maxMp) {
        return NextResponse.json({ success: false, error: "当前气血和灵力已满，无需打坐" }, {
          status: 400,
          headers: NO_STORE_HEADERS,
        });
      }

      const startedAt = new Date().toISOString();
      const ticket = createMeditationTicket({
        playerId: player.id,
        startedAt,
      });

      cookieStore.set(MEDITATION_COOKIE, ticket, await buildMeditationCookieOptions());

      return NextResponse.json({
        success: true,
        data: {
          startedAt,
          readyAt: resolveMeditationReadyAt(startedAt),
          durationMs: MEDITATION_DURATION_MS,
          hp: currentHp,
          maxHp: snapshot.total.maxHp,
          mp: currentMp,
          maxMp: snapshot.total.maxMp,
        },
      }, {
        headers: NO_STORE_HEADERS,
      });
    }

    if (action === "cancel") {
      await clearMeditationCookie(cookieStore);
      return NextResponse.json({
        success: true,
      }, {
        headers: NO_STORE_HEADERS,
      });
    }

    const ticket = cookieStore.get(MEDITATION_COOKIE)?.value || "";
    const payload = parseMeditationTicket(ticket, player.id);
    if (!payload) {
      await clearMeditationCookie(cookieStore);
      return NextResponse.json({ success: false, error: "打坐状态已失效，请重新开始" }, {
        status: 400,
        headers: NO_STORE_HEADERS,
      });
    }

    const percent = resolveMeditationPercent(payload.startedAt);
    if (percent <= 0) {
      return NextResponse.json({ success: false, error: "打坐尚未凝聚灵息，请稍候再收功" }, {
        status: 400,
        headers: NO_STORE_HEADERS,
      });
    }

    const hpResult = calcMeditationRecovery(currentHp, snapshot.total.maxHp, percent);
    const mpResult = calcMeditationRecovery(currentMp, snapshot.total.maxMp, percent);

    if (hpResult.next !== currentHp || mpResult.next !== currentMp) {
      await db.update(players).set({
        hp: hpResult.next,
        mp: mpResult.next,
      }).where(eq(players.id, player.id)).run();
    }

    await clearMeditationCookie(cookieStore);

    return NextResponse.json({
      success: true,
      data: {
        percent,
        recoveredHp: hpResult.recovered,
        recoveredMp: mpResult.recovered,
        hp: hpResult.next,
        maxHp: snapshot.total.maxHp,
        mp: mpResult.next,
        maxMp: snapshot.total.maxMp,
      },
    }, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("Meditation route error:", error);
    return NextResponse.json({ success: false, error: "打坐失败" }, {
      status: 500,
      headers: NO_STORE_HEADERS,
    });
  }
}

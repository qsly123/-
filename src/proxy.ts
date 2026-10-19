import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ACTIVE_PLAYER_COOKIE, SESSION_COOKIE } from "@/modules/shared/constants";

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/bind-email",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/bind-email",
  "/api/auth/options",
  "/api/auth/linuxdo",
  "/api/game/recharge/notify",
  "/api/system/health",
  "/api/system/maintenance-status",
];

type MaintenanceStatusResponse = {
  success?: boolean;
  data?: {
    enabled?: boolean;
    message?: string;
  };
};

const DEFAULT_MAINTENANCE_MESSAGE = "服务器维护中，请稍后再入世。维护期间将暂时无法进入游戏。";

function shouldCheckMaintenance(pathname: string) {
  return pathname.startsWith("/game")
    || pathname.startsWith("/api/game")
    || pathname === "/api/character/create"
    || pathname === "/api/character/select"
    || pathname === "/api/auth/me";
}

async function fetchMaintenanceStatus(request: NextRequest) {
  try {
    const url = new URL("/api/system/maintenance-status", request.url);
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "x-lingxu-maintenance-probe": "1",
      },
    });
    if (!response.ok) {
      return { enabled: false, message: DEFAULT_MAINTENANCE_MESSAGE };
    }

    const payload = await response.json() as MaintenanceStatusResponse;
    const enabled = payload?.data?.enabled === true;
    const message = String(payload?.data?.message || "").trim() || DEFAULT_MAINTENANCE_MESSAGE;
    return { enabled, message };
  } catch {
    return { enabled: false, message: DEFAULT_MAINTENANCE_MESSAGE };
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 公开路径直接放行
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 静态资源放行
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.includes(".")) {
    return NextResponse.next();
  }

  // 检查 session cookie
  const session = request.cookies.get(SESSION_COOKIE);
  if (!session?.value) {
    // API 路由返回 401
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    // 页面重定向到登录
    const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl);
  }

  // 进入游戏相关路由时必须已选择角色
  if (pathname.startsWith("/game") || pathname.startsWith("/api/game")) {
    const activePlayer = request.cookies.get(ACTIVE_PLAYER_COOKIE);
    if (!activePlayer?.value) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ success: false, error: "未选择角色" }, { status: 409 });
      }
      return NextResponse.redirect(new URL("/select-character", request.url));
    }
  }

  if (shouldCheckMaintenance(pathname)) {
    const maintenance = await fetchMaintenanceStatus(request);
    if (maintenance.enabled) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({
          success: false,
          error: maintenance.message,
          maintenance: true,
        }, { status: 503 });
      }

      const redirectUrl = new URL("/create-character", request.url);
      redirectUrl.searchParams.set("maintenance", "1");
      return NextResponse.redirect(redirectUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

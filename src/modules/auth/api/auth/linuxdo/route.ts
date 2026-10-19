import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getLinuxDoAuthorizeUrl, getLinuxDoRedirectOrigin } from "@/modules/auth/services/auth";
import { getLinuxDoLoginEnabled } from "@/modules/system/services/feature-switch";
import { LINUXDO_OAUTH_NEXT_COOKIE, LINUXDO_OAUTH_STATE_MAX_AGE } from "@/modules/shared/constants";
import { resolveCookieSecureFlag } from "@/modules/shared/services/cookie-security";

function getRedirectTarget(rawNext: string | null): string | null {
  if (!rawNext) return null;
  if (!rawNext.startsWith("/")) return null;
  if (rawNext.startsWith("//")) return null;
  return rawNext;
}

export async function GET(request: Request) {
  const linuxDoLoginEnabled = await getLinuxDoLoginEnabled();
  if (!linuxDoLoginEnabled) {
    try {
      const baseUrl = await getLinuxDoRedirectOrigin();
      return NextResponse.redirect(new URL("/login?error=linuxdo_disabled", baseUrl));
    } catch {
      return NextResponse.redirect(new URL("/login?error=linuxdo_disabled", request.url));
    }
  }

  try {
    const url = new URL(request.url);
    const next = getRedirectTarget(url.searchParams.get("next"));
    const cookieStore = await cookies();
    if (next) {
      cookieStore.set(LINUXDO_OAUTH_NEXT_COOKIE, next, {
        httpOnly: true,
        secure: await resolveCookieSecureFlag(),
        sameSite: "lax",
        maxAge: LINUXDO_OAUTH_STATE_MAX_AGE / 1000,
        path: "/",
      });
    } else {
      cookieStore.delete(LINUXDO_OAUTH_NEXT_COOKIE);
    }

    const authorizeUrl = await getLinuxDoAuthorizeUrl();
    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    console.error("Linux.do authorize error:", error);
    try {
      const baseUrl = await getLinuxDoRedirectOrigin();
      return NextResponse.redirect(new URL("/login?error=linuxdo_authorize_failed", baseUrl));
    } catch {
      return NextResponse.redirect(new URL("/login?error=linuxdo_authorize_failed", request.url));
    }
  }
}

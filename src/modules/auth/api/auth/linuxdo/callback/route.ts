import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getLinuxDoRedirectOrigin, loginByLinuxDo } from "@/modules/auth/services/auth";
import { getLinuxDoLoginEnabled } from "@/modules/system/services/feature-switch";
import { LINUXDO_OAUTH_NEXT_COOKIE } from "@/modules/shared/constants";

function getRedirectTarget(rawNext: string | null): string | null {
  if (!rawNext) return null;
  if (!rawNext.startsWith("/")) return null;
  if (rawNext.startsWith("//")) return null;
  return rawNext;
}

async function getRedirectBaseUrl(request: Request) {
  try {
    return await getLinuxDoRedirectOrigin();
  } catch {
    return request.url;
  }
}

export async function GET(request: Request) {
  const baseUrl = await getRedirectBaseUrl(request);
  const linuxDoLoginEnabled = await getLinuxDoLoginEnabled();
  if (!linuxDoLoginEnabled) {
    return NextResponse.redirect(new URL("/login?error=linuxdo_disabled", baseUrl));
  }

  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const oauthError = searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(oauthError)}`, baseUrl));
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?error=linuxdo_missing_code", baseUrl));
  }

  try {
    await loginByLinuxDo(code, state);
    const cookieStore = await cookies();
    const next = getRedirectTarget(cookieStore.get(LINUXDO_OAUTH_NEXT_COOKIE)?.value ?? null);
    cookieStore.delete(LINUXDO_OAUTH_NEXT_COOKIE);
    return NextResponse.redirect(new URL(next || "/", baseUrl));
  } catch (error) {
    console.error("Linux.do callback error:", error);
    return NextResponse.redirect(new URL("/login?error=linuxdo_callback_failed", baseUrl));
  }
}

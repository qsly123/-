import { headers } from "next/headers";

/**
 * 判定 Set-Cookie 是否应当带 `Secure` 属性。
 *
 * 不能只看 NODE_ENV：生产环境若跑在 HTTP（如内网 / 未配证书的裸 IP）上，
 * 下发 Secure cookie 会被浏览器按规范静默丢弃，表现为「登录成功却立刻掉线」。
 * 因此判定优先级为：
 *   1. 显式开关 `SESSION_COOKIE_SECURE=true|false`（部署级强制覆盖）
 *   2. 真实请求协议 `x-forwarded-proto`（反代场景的唯一可信来源）
 *   3. 兜底 `NODE_ENV === "production"`
 */
export async function resolveCookieSecureFlag(): Promise<boolean> {
  const explicit = normalizeFlag(process.env.SESSION_COOKIE_SECURE);
  if (explicit !== null) {
    return explicit;
  }

  try {
    const headerBag = await headers();
    const forwardedProto = headerBag.get("x-forwarded-proto") ?? "";
    const proto = forwardedProto.split(",")[0]?.trim().toLowerCase() ?? "";
    if (proto === "http" || proto === "https") {
      return proto === "https";
    }
  } catch {
    // 非请求上下文（脚本、任务、测试）无法读取 headers，走兜底分支。
  }

  return process.env.NODE_ENV === "production";
}

function normalizeFlag(raw: string | undefined): boolean | null {
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  return null;
}

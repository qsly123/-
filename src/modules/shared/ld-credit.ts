import { createHash } from "crypto";
import { nanoid } from "nanoid";
import { getSystemConfigMap } from "@/modules/system/services/system-config";
import { LD_CREDIT_CONFIG_KEYS } from "@/modules/system/services/system-config-keys";

export const LD_CREDIT_GATEWAY_BASE = "https://credit.linux.do/epay";
const SIGN_IGNORED_KEYS = new Set(["sign", "sign_type"]);

export type LdCreditConfig = {
  pid: string;
  key: string;
};

function md5(message: string): string {
  return createHash("md5").update(message).digest("hex");
}

export async function getLdCreditConfig(): Promise<LdCreditConfig | null> {
  const configMap = await getSystemConfigMap(LD_CREDIT_CONFIG_KEYS);
  const pid = configMap.LINGXU_LD_CREDIT_PID?.trim() || "";
  const key = configMap.LINGXU_LD_CREDIT_KEY?.trim() || "";
  if (!pid || !key) {
    return null;
  }
  return { pid, key };
}

export function createLdCreditSign(fields: Record<string, string>, secret: string): string {
  const pairs = Object.entries(fields)
    .filter(([key, value]) => !SIGN_IGNORED_KEYS.has(key) && value !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const payload = pairs.map(([key, value]) => `${key}=${value}`).join("&");
  return md5(`${payload}${secret}`).toLowerCase();
}

export function verifyLdCreditSign(fields: Record<string, string>, secret: string): boolean {
  const receivedSign = String(fields.sign || "").trim().toLowerCase();
  if (!receivedSign) {
    return false;
  }
  const expected = createLdCreditSign(fields, secret);
  return expected === receivedSign;
}

export function buildRechargeOutTradeNo(): string {
  return `LY${Date.now()}${nanoid(6).toUpperCase()}`;
}

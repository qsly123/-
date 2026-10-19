import { getSystemConfigMap } from "@/modules/system/services/system-config";
import { FEATURE_SWITCH_CONFIG_KEYS } from "@/modules/system/services/system-config-keys";

const TRUE_VALUES = new Set(["1", "true", "on", "yes"]);
const FALSE_VALUES = new Set(["0", "false", "off", "no"]);

function parseBooleanSwitch(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  return fallback;
}

export interface FeatureSwitchConfig {
  linuxDoLoginEnabled: boolean;
  ldcRechargeEnabled: boolean;
}

export async function getFeatureSwitchConfig(): Promise<FeatureSwitchConfig> {
  const map = await getSystemConfigMap(FEATURE_SWITCH_CONFIG_KEYS);

  return {
    linuxDoLoginEnabled: parseBooleanSwitch(map.LINUXDO_LOGIN_ENABLED, false),
    ldcRechargeEnabled: false,
  };
}

export async function getLinuxDoLoginEnabled() {
  const config = await getFeatureSwitchConfig();
  return config.linuxDoLoginEnabled;
}

export async function getLdcRechargeEnabled() {
  const config = await getFeatureSwitchConfig();
  return config.ldcRechargeEnabled;
}

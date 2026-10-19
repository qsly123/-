import { getSystemConfigValue } from "@/modules/system/services/system-config";

export const DEFAULT_GAME_MAINTENANCE_MESSAGE = "服务器维护中，请稍后再入世。维护期间将暂时无法进入游戏。";

export type GameMaintenanceStatus = {
  enabled: boolean;
  message: string;
};

function parseBooleanValue(value: string | null) {
  return String(value || "").trim().toLowerCase() === "true";
}

export async function getGameMaintenanceStatus(): Promise<GameMaintenanceStatus> {
  const [rawEnabled, rawMessage] = await Promise.all([
    getSystemConfigValue("GAME_MAINTENANCE_ENABLED"),
    getSystemConfigValue("GAME_MAINTENANCE_MESSAGE"),
  ]);

  const message = String(rawMessage || "").trim() || DEFAULT_GAME_MAINTENANCE_MESSAGE;

  return {
    enabled: parseBooleanValue(rawEnabled),
    message,
  };
}

export async function isGameMaintenanceEnabled() {
  const status = await getGameMaintenanceStatus();
  return status.enabled;
}

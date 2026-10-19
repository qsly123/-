import { GAME_ROOM_NAMES } from "@immortality/shared-protocol";

function parsePort(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadGameServerConfig() {
  return {
    host: process.env.GAME_SERVER_HOST || "0.0.0.0",
    port: parsePort(process.env.GAME_SERVER_PORT || process.env.PORT, 3201),
    publicAddress: process.env.GAME_SERVER_PUBLIC_ADDRESS || undefined,
    redisUrl: String(process.env.REDIS_URL || "").trim() || undefined,
    processId: process.env.GAME_SERVER_PROCESS_ID || `${process.pid}`,
    rooms: Object.values(GAME_ROOM_NAMES),
  };
}

export type GameServerConfig = ReturnType<typeof loadGameServerConfig>;

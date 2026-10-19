import { CombatRealtimeRoom } from "./combat-realtime-room";

export class BossRoom extends CombatRealtimeRoom {
  readonly roomKind = "boss";
  protected battleMode = "boss" as const;

  private runtimeRefreshTimer: ReturnType<typeof setInterval> | null = null;

  onCreate(options: Parameters<CombatRealtimeRoom["onCreate"]>[0]) {
    super.onCreate(options);
    this.runtimeRefreshTimer = setInterval(() => {
      void this.refreshRuntimeAndBroadcastIfChanged({
        commandType: "boss_runtime_refresh",
        settlementWhenDefeated: true,
      }).catch((error) => {
        console.error("[game-server] boss runtime refresh broadcast failed", {
          logCategory: "game-server.room.runtime_refresh_failed",
          roomId: this.roomId,
          roomKind: this.roomKind,
          mapId: this.state.mapId,
          shardId: this.state.shardId,
          reason: "boss_runtime_refresh_failed",
          error,
        });
      });
    }, 1_500);
  }

  async onDispose() {
    if (this.runtimeRefreshTimer) {
      clearInterval(this.runtimeRefreshTimer);
      this.runtimeRefreshTimer = null;
    }
    await super.onDispose();
  }
}

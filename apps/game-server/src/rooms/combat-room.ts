import { CombatRealtimeRoom } from "./combat-realtime-room";
import { GameEntityState } from "../state";
import type { JoinRoomOptions } from "@immortality/shared-protocol";

export class CombatRoom extends CombatRealtimeRoom {
  readonly roomKind = "combat";
  protected battleMode: "solo" | "party" = "solo";

  onCreate(options: JoinRoomOptions) {
    this.battleMode = options.partyId ? "party" : "solo";
    super.onCreate(options);
  }

  async onJoin(
    client: Parameters<CombatRealtimeRoom["onJoin"]>[0],
    options: Parameters<CombatRealtimeRoom["onJoin"]>[1],
    auth?: Parameters<CombatRealtimeRoom["onJoin"]>[2],
  ) {
    await super.onJoin(client, options, auth);
    if (this.battleMode !== "party") {
      return;
    }
    if (this.getRuntimeSourceForClient(client) !== "fallback") {
      return;
    }

    const partyEnemySessionId = "party-enemy";
    if (!this.state.entities.has(partyEnemySessionId)) {
      const enemy = new GameEntityState();
      enemy.id = `party-enemy:${String(options.combatId || options.partyId || this.roomId)}`;
      enemy.kind = "combatant";
      enemy.name = "组队战目标";
      enemy.x = 52;
      enemy.y = 24;
      enemy.updatedAt = Date.now();
      this.state.entities.set(partyEnemySessionId, enemy);
    }

    const partyMembers = [...this.state.entities.values()]
      .filter((entity) => entity.kind === "combatant" && !entity.id.startsWith("party-enemy:"));
    partyMembers.forEach((entity, index) => {
      entity.x = 42 + (index * 8);
      entity.y = 76;
      entity.updatedAt = Date.now();
    });
    this.state.snapshotVersion += 1;
    this.updateRoomEntityCount();
  }
}

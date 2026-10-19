import { CombatRealtimeRoom } from "./combat-realtime-room";

export class PvpRoom extends CombatRealtimeRoom {
  readonly roomKind = "pvp";
  protected battleMode = "pvp" as const;
}

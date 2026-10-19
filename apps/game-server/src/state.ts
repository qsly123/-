import { defineTypes, MapSchema, Schema } from "@colyseus/schema";

export class GameEntityState extends Schema {
  id = "";
  kind = "player";
  name = "";
  x = 0;
  y = 0;
  velocityX = 0;
  velocityY = 0;
  updatedAt = 0;
}

export class GameRoomState extends Schema {
  roomKind = "";
  mapId = "";
  mapName = "";
  mapRuntimeSource = "";
  mapWidth = 0;
  mapHeight = 0;
  shardId = "";
  serverTick = 0;
  snapshotVersion = 0;
  declare entities: MapSchema<GameEntityState>;

  constructor() {
    super();
    this.entities = new MapSchema<GameEntityState>();
  }
}

defineTypes(GameEntityState, {
  id: "string",
  kind: "string",
  name: "string",
  x: "number",
  y: "number",
  velocityX: "number",
  velocityY: "number",
  updatedAt: "number",
});

defineTypes(GameRoomState, {
  roomKind: "string",
  mapId: "string",
  mapName: "string",
  mapRuntimeSource: "string",
  mapWidth: "number",
  mapHeight: "number",
  shardId: "string",
  serverTick: "number",
  snapshotVersion: "number",
  entities: { map: GameEntityState },
});

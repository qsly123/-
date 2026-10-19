import {
  createRealtimeInputAck,
  GAME_ROOM_NAMES,
  type RealtimeClientInput,
  type RealtimeInputAck,
} from "@immortality/shared-protocol";
import {
  joinGameRoom,
  type GameColyseusLikeClient,
  type GameColyseusLikeRoom,
} from "@/modules/shared/services/colyseus-game-client";

class FakeRoom implements GameColyseusLikeRoom {
  id = "fake-room";
  sessionId = "fake-session";
  state = {};
  sentInputs: RealtimeClientInput[] = [];
  private messageHandlers = new Map<string, Array<(message: unknown) => void>>();

  send(type: "input", message: RealtimeClientInput) {
    if (type === "input") {
      this.sentInputs.push(message);
    }
  }

  leave() {
    return undefined;
  }

  onMessage<TMessage = unknown>(type: string, callback: (message: TMessage) => void) {
    const handlers = this.messageHandlers.get(type) || [];
    handlers.push(callback as (message: unknown) => void);
    this.messageHandlers.set(type, handlers);
    return () => {
      const nextHandlers = (this.messageHandlers.get(type) || [])
        .filter((handler) => handler !== callback);
      this.messageHandlers.set(type, nextHandlers);
    };
  }

  emitAck(ack: RealtimeInputAck) {
    for (const handler of this.messageHandlers.get("ack") || []) {
      handler(ack);
    }
  }
}

class FakeClient implements GameColyseusLikeClient {
  constructor(private readonly room: FakeRoom) {}

  async joinOrCreate<TState = unknown>() {
    return this.room as unknown as GameColyseusLikeRoom<TState>;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const room = new FakeRoom();
const connection = await joinGameRoom({
  client: new FakeClient(room),
  roomName: GAME_ROOM_NAMES.combat,
  options: {
    combatId: "regression-combat",
    playerId: "regression-player",
  },
});

let resolvedInputType = "";
const commandAckPromise = connection.sendInputAndWaitForAck(
  "command",
  { commandType: "basicAttack", targetId: "target" },
  {
    clientSequence: 1,
    clientSceneTick: 0,
    actionId: "regression-command-1",
    clientSentAt: 1,
    timeoutMs: 1000,
  },
).then((result) => {
  resolvedInputType = result.ack.inputType;
  return result;
});

room.emitAck(createRealtimeInputAck({
  accepted: true,
  inputType: "repair",
  acceptedSequence: 1,
  serverTick: 1,
}));

await sleep(25);
if (resolvedInputType === "repair") {
  throw new Error("command ACK promise was resolved by a repair ACK with the same sequence");
}

room.emitAck(createRealtimeInputAck({
  accepted: true,
  inputType: "command",
  acceptedSequence: 1,
  serverTick: 2,
  authoritativeState: {
    state: { status: "ongoing" },
  },
}));

const commandResult = await commandAckPromise;
if (commandResult.ack.inputType !== "command") {
  throw new Error(`expected command ACK, got ${commandResult.ack.inputType}`);
}

await connection.leave(true);

const combatRoomSource = await Bun.file("apps/game-server/src/rooms/combat-realtime-room.ts").text();
const combatColyseusRoomSource = await Bun.file("src/modules/combat/ui/hooks/useCombatColyseusRoom.ts").text();
const combatSceneControllerSource = await Bun.file("src/modules/combat/ui/hooks/useCombatSceneController.ts").text();
const combatPageSource = await Bun.file("src/modules/combat/ui/pages/game/combat/[id]/page.tsx").text();
if (!combatRoomSource.includes("solo combat realtime input rejected without pending runtime")) {
  throw new Error("solo combat missing-runtime branch must emit structured logs");
}
if (!combatRoomSource.includes("acceptedSequence: params.input.clientSequence")) {
  throw new Error("solo combat reject ACK must resolve the current clientSequence");
}
if (!combatRoomSource.includes("SOLO_RUNTIME_CLIENT_SCENE_TICK_DRIFT_LIMIT")) {
  throw new Error("solo combat runtime must use a named drift window for clientSceneTick checks");
}
const soloRuntimeSource = combatRoomSource.slice(
  combatRoomSource.indexOf("private async tryHandleSoloRuntimeMovement"),
  combatRoomSource.indexOf("private async tryHandlePvpRuntimeCommand"),
);
if (soloRuntimeSource.includes("serverSceneTick - input.clientSceneTick > 5")) {
  throw new Error("solo combat runtime must not reject normal background scene tick drift with a five-tick window");
}
if (
  combatRoomSource.includes("const pendingCombat = getPendingCombatSession(playerId, combatId);\n    if (!pendingCombat) {\n      return false;\n    }")
  || combatRoomSource.includes("let pendingCombat = getPendingCombatSession(playerId, combatId);\n    if (!pendingCombat) {\n      return false;\n    }")
) {
  throw new Error("solo combat commands must not fall through when pending runtime is missing");
}
if (!combatColyseusRoomSource.includes("resolveCombatSceneInputTick")) {
  throw new Error("combat Colyseus client must send battle scene tick, not only room serverTick");
}
if (!combatColyseusRoomSource.includes("authoritativeState?.sceneSnapshot?.tick")) {
  throw new Error("combat Colyseus client must derive clientSceneTick from authoritative battle scene snapshot");
}
if (!combatSceneControllerSource.includes("const latestSceneTick = sceneSnapshotRef.current?.tick ?? 0")) {
  throw new Error("combat action meta must read latest scene tick from ref, not stale React state");
}
if (!combatSceneControllerSource.includes("acceptedClientSequence: authoritativeState?.acceptedClientSequence ?? ack.acceptedSequence")) {
  throw new Error("combat scene controller must preserve authoritative acceptedClientSequence from reject ACKs");
}
if (!combatPageSource.includes("acceptedClientSequence: authoritativeState?.acceptedClientSequence ?? ack.acceptedSequence")) {
  throw new Error("combat page ACK adapter must preserve authoritative acceptedClientSequence from reject ACKs");
}
if (/send(?:Movement|Command)AndWaitForAck\([\s\S]*?\}, \{\s*clientSequence: actionMeta\.clientSequence,\s*clientSceneTick: actionMeta\.clientSceneTick/.test(combatSceneControllerSource)) {
  throw new Error("combat controller Colyseus calls must let room hook resolve latest battle scene tick");
}
if (/sendCombatCommandAndWaitForAck\([\s\S]*?\}, \{\s*clientSequence: params\.actionMeta\.clientSequence,\s*clientSceneTick: params\.actionMeta\.clientSceneTick/.test(combatPageSource)) {
  throw new Error("combat page Colyseus action must let room hook resolve latest battle scene tick");
}

console.log("[regression-colyseus-ack-key] passed");

import type { BattleCommand, BattleCommandResult, BattleCommandType, BattleMode, BattleRuntime, BattleViewState } from "@/types/game";

export function createBattleCommand(params: {
  runtimeId: string;
  mode: BattleMode;
  type: BattleCommandType;
  actorId?: string | null;
  targetId?: string | null;
  payload?: Record<string, unknown> | null;
  actionId?: string | null;
  clientSentAt?: number;
  clientSequence?: number;
  clientSceneTick?: number;
}): BattleCommand {
  return {
    runtimeId: params.runtimeId,
    mode: params.mode,
    type: params.type,
    actorId: params.actorId ?? null,
    targetId: params.targetId ?? null,
    payload: params.payload || null,
    actionId: params.actionId ?? null,
    ...(typeof params.clientSentAt === "number" ? { clientSentAt: params.clientSentAt } : {}),
    ...(typeof params.clientSequence === "number" ? { clientSequence: params.clientSequence } : {}),
    ...(typeof params.clientSceneTick === "number" ? { clientSceneTick: params.clientSceneTick } : {}),
  };
}

export function mapCombatActionToBattleCommandType(action: "skill" | "item" | "flee" | "surrender"): BattleCommandType {
  if (action === "skill") {
    return "cast_skill";
  }
  if (action === "item") {
    return "use_item";
  }
  if (action === "surrender") {
    return "surrender";
  }
  return "flee";
}

export function buildBattleCommandResult(params: {
  accepted: boolean;
  runtimeId: string;
  mode: BattleMode;
  command?: BattleCommand | null;
  battleRuntime?: BattleRuntime | null;
  battleView?: BattleViewState | null;
  acceptedClientSequence?: number;
  serverSceneTick?: number;
  errorCode?: string;
  message?: string;
  payload?: Record<string, unknown> | null;
}): BattleCommandResult {
  return {
    accepted: params.accepted,
    runtimeId: params.runtimeId,
    mode: params.mode,
    command: params.command || null,
    battleRuntime: params.battleRuntime || null,
    battleView: params.battleView || params.battleRuntime?.battleView || null,
    ...(typeof params.acceptedClientSequence === "number" ? { acceptedClientSequence: params.acceptedClientSequence } : {}),
    ...(typeof params.serverSceneTick === "number" ? { serverSceneTick: params.serverSceneTick } : {}),
    ...(params.errorCode ? { errorCode: params.errorCode } : {}),
    ...(params.message ? { message: params.message } : {}),
    payload: params.payload || null,
  };
}

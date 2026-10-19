import { NextResponse } from "next/server";
import type {
  BattleCommandType,
  BattleMode,
  BattleRuntime,
  BattleViewState,
  CombatState,
  CombatTurnState,
} from "@/types/game";
import type { BattleSceneSnapshot } from "@/modules/combat/services/battle-scene-state";
import {
  buildBattleCommandResult,
  createBattleCommand,
  mapCombatActionToBattleCommandType,
} from "@/modules/combat/services/battle-command";
import { battleRulesetSupportsCommand } from "@/modules/combat/services/battle-ruleset";
import { publishCombatRefreshFrames } from "@/modules/combat/services/combat-state-refresh-publish";
import type { AnyStateRefreshEnvelope } from "@immortality/shared-protocol";

export type CombatActionType = "skill" | "item" | "flee" | "surrender";

export type BattleCommandRouteData = {
  state: CombatState | null;
  battleView: BattleViewState;
  battleRuntime: BattleRuntime;
  sceneSnapshot: BattleSceneSnapshot | null;
  turnState?: CombatTurnState | null;
  settlement?: Record<string, unknown> | null;
};

export type BattleActionRouteData = BattleCommandRouteData;

export type BattleCommandExecuteResult =
  | {
    success: true;
    data: BattleCommandRouteData;
    payload?: Record<string, unknown> | null;
  }
  | {
    success: false;
    error: string;
    status?: number;
    errorCode?: string;
    acknowledgeSequence?: boolean;
    data?: BattleCommandRouteData | null;
  };

type BattleCommandRoutePrecheckResult =
  | {
    status?: number;
    error: string;
    errorCode?: string;
    acknowledgeSequence?: boolean;
    data?: BattleCommandRouteData | null;
    payload?: Record<string, unknown> | null;
  }
  | null
  | void;

export function validateBattleCommandRouteSync(params: {
  clientSequence?: number;
  clientSceneTick?: number;
  serverSceneTick: number;
  lastAcceptedClientSequence: number;
  maxClientSceneTickLag?: number;
  missingClientSequenceError?: string;
  missingClientSceneTickError?: string;
  expiredSequenceError?: string;
  jumpedSequenceError?: string;
  futureSceneTickError?: string;
  staleSceneTickError?: string;
}) {
  if (typeof params.clientSequence !== "number") {
    return {
      status: 400,
      error: params.missingClientSequenceError || "缺少客户端动作序列，请刷新页面后重试",
    } satisfies Exclude<BattleCommandRoutePrecheckResult, null | void>;
  }

  if (typeof params.clientSceneTick !== "number") {
    return {
      status: 400,
      error: params.missingClientSceneTickError || "缺少场景同步帧序号，请等待同步后重试",
    } satisfies Exclude<BattleCommandRoutePrecheckResult, null | void>;
  }

  if (params.clientSequence <= params.lastAcceptedClientSequence) {
    return {
      status: 409,
      error: params.expiredSequenceError || "动作序列已过期，重复或乱序请求已被拦截",
    } satisfies Exclude<BattleCommandRoutePrecheckResult, null | void>;
  }

  if (params.clientSequence > params.lastAcceptedClientSequence + 1) {
    return {
      status: 409,
      error: params.jumpedSequenceError || "动作序号跳帧，请等待上一帧确认后再继续出手",
    } satisfies Exclude<BattleCommandRoutePrecheckResult, null | void>;
  }

  if (params.clientSceneTick > params.serverSceneTick) {
    return {
      status: 409,
      error: params.futureSceneTickError || "客户端场景时间异常，请刷新页面后重试",
      errorCode: "ACTION_REQUEST_TIME_SKEW",
    } satisfies Exclude<BattleCommandRoutePrecheckResult, null | void>;
  }

  const maxClientSceneTickLag = params.maxClientSceneTickLag ?? 5;
  if (params.serverSceneTick - params.clientSceneTick > maxClientSceneTickLag) {
    return {
      status: 409,
      error: params.staleSceneTickError || "战斗状态已更新，请等待场景同步后再出手",
      errorCode: "COMBAT_SCENE_STALE",
    } satisfies Exclude<BattleCommandRoutePrecheckResult, null | void>;
  }

  return null;
}

export async function executeBattleCommandRoute(params: {
  runtimeId: string;
  mode: BattleMode;
  actorId: string;
  commandType: BattleCommandType;
  commandPayload?: Record<string, unknown> | null;
  actionId?: string | null;
  clientSentAt?: number;
  clientSequence: number;
  clientSceneTick: number;
  serverSceneTick: number;
  lastAcceptedClientSequence: number;
  maxClientSceneTickLag?: number;
  buildCurrentData: () => BattleCommandRouteData;
  commitAcceptedClientSequence?: (clientSequence: number) => Promise<void> | void;
  isFinished: () => boolean;
  finishedError?: string;
  finishedErrorCode?: string;
  isActorTurn?: () => boolean;
  turnError?: string;
  precheck?: () => Promise<BattleCommandRoutePrecheckResult> | BattleCommandRoutePrecheckResult;
  perform: () => Promise<BattleCommandExecuteResult>;
}) {
  const command = createBattleCommand({
    runtimeId: params.runtimeId,
    mode: params.mode,
    type: params.commandType,
    actorId: params.actorId,
    payload: params.commandPayload || {},
    actionId: params.actionId || null,
    clientSentAt: params.clientSentAt,
    clientSequence: params.clientSequence,
    clientSceneTick: params.clientSceneTick,
  });
  const maxClientSceneTickLag = params.maxClientSceneTickLag ?? 5;

  const buildResponse = (response: {
    success: boolean;
    status?: number;
    error?: string;
    errorCode?: string;
    data?: BattleActionRouteData | null;
    acceptedClientSequence?: number;
    payload?: Record<string, unknown> | null;
    refreshFrames?: readonly AnyStateRefreshEnvelope[];
  }) => {
    const routeData = response.data || params.buildCurrentData();
    const serverSceneTick = routeData.sceneSnapshot?.tick || params.serverSceneTick;

    return buildBattleCommandRouteResponse({
      success: response.success,
      status: response.status,
      error: response.error,
      errorCode: response.errorCode,
      runtimeId: params.runtimeId,
      mode: params.mode,
      command,
      routeData,
      acceptedClientSequence: response.acceptedClientSequence,
      serverSceneTick,
      payload: response.payload || null,
      refreshFrames: response.refreshFrames || [],
    });
  };

  if (!battleRulesetSupportsCommand(params.mode, params.commandType)) {
    return buildResponse({
      success: false,
      status: 400,
      error: "当前战斗模式不支持该动作",
      errorCode: "BATTLE_COMMAND_UNSUPPORTED",
      acceptedClientSequence: params.lastAcceptedClientSequence,
    });
  }

  const syncValidation = validateBattleCommandRouteSync({
    clientSequence: params.clientSequence,
    clientSceneTick: params.clientSceneTick,
    serverSceneTick: params.serverSceneTick,
    lastAcceptedClientSequence: params.lastAcceptedClientSequence,
    maxClientSceneTickLag,
  });
  if (syncValidation) {
    return buildResponse({
      success: false,
      status: syncValidation.status,
      error: syncValidation.error,
      errorCode: syncValidation.errorCode,
      acceptedClientSequence: params.lastAcceptedClientSequence,
    });
  }

  if (params.isFinished()) {
    return buildResponse({
      success: false,
      status: 400,
      error: params.finishedError || "战斗已结束",
      errorCode: params.finishedErrorCode || "COMBAT_SESSION_FINISHED",
      acceptedClientSequence: params.lastAcceptedClientSequence,
    });
  }

  if (params.isActorTurn && !params.isActorTurn()) {
    return buildResponse({
      success: false,
      status: 400,
      error: params.turnError || "当前还未轮到你出手",
      acceptedClientSequence: params.lastAcceptedClientSequence,
    });
  }

  const precheckResult = await params.precheck?.();
  if (precheckResult?.error) {
    const acceptedClientSequence = precheckResult.acknowledgeSequence
      ? params.clientSequence
      : params.lastAcceptedClientSequence;
    if (precheckResult.acknowledgeSequence) {
      await params.commitAcceptedClientSequence?.(params.clientSequence);
    }
    return buildResponse({
      success: false,
      status: precheckResult.status || 400,
      error: precheckResult.error,
      errorCode: precheckResult.errorCode,
      data: precheckResult.data,
      acceptedClientSequence,
      payload: precheckResult.payload || null,
    });
  }

  const result = await params.perform();
  if (!result.success) {
    const acceptedClientSequence = result.acknowledgeSequence
      ? params.clientSequence
      : params.lastAcceptedClientSequence;
    if (result.acknowledgeSequence) {
      await params.commitAcceptedClientSequence?.(params.clientSequence);
    }
    return buildResponse({
      success: false,
      status: result.status || 400,
      error: result.error,
      errorCode: result.errorCode,
      data: result.data,
      acceptedClientSequence,
    });
  }

  await params.commitAcceptedClientSequence?.(params.clientSequence);
  // 事务成功后发生了入库变更：丹药消耗补发背包帧，战斗结算补发资产 / 进度帧。
  const refreshFrames = await publishCombatRefreshFrames({
    playerId: params.actorId,
    roomId: params.runtimeId,
    serverTick: result.data.sceneSnapshot?.tick || params.serverSceneTick,
    consumedItemIds: typeof result.payload?.itemId === "string" ? [result.payload.itemId] : [],
    settled: Boolean(result.data.state && result.data.state.status !== "ongoing"),
  });
  return buildResponse({
    success: true,
    data: result.data,
    acceptedClientSequence: params.clientSequence,
    payload: result.payload || null,
    refreshFrames,
  });
}

export async function executeBattleCommandRouteAction(params: {
  runtimeId: string;
  mode: BattleMode;
  actorId: string;
  action: CombatActionType;
  normalizedAction?: CombatActionType;
  skillId?: string;
  itemId?: string;
  actionId?: string | null;
  clientSentAt?: number;
  clientSequence: number;
  clientSceneTick: number;
  serverSceneTick: number;
  lastAcceptedClientSequence: number;
  maxClientSceneTickLag?: number;
  buildCurrentData: () => BattleCommandRouteData;
  commitAcceptedClientSequence?: (clientSequence: number) => Promise<void> | void;
  isFinished: () => boolean;
  finishedError?: string;
  finishedErrorCode?: string;
  isActorTurn?: () => boolean;
  turnError?: string;
  precheck?: () => Promise<BattleCommandRoutePrecheckResult> | BattleCommandRoutePrecheckResult;
  perform: () => Promise<BattleCommandExecuteResult>;
}) {
  const normalizedAction = params.normalizedAction || params.action;
  const commandType = mapCombatActionToBattleCommandType(normalizedAction);
  return executeBattleCommandRoute({
    runtimeId: params.runtimeId,
    mode: params.mode,
    actorId: params.actorId,
    commandType,
    commandPayload: {
      ...(params.skillId ? { skillId: params.skillId } : {}),
      ...(params.itemId ? { itemId: params.itemId } : {}),
    },
    actionId: params.actionId,
    clientSentAt: params.clientSentAt,
    clientSequence: params.clientSequence,
    clientSceneTick: params.clientSceneTick,
    serverSceneTick: params.serverSceneTick,
    lastAcceptedClientSequence: params.lastAcceptedClientSequence,
    maxClientSceneTickLag: params.maxClientSceneTickLag,
    buildCurrentData: params.buildCurrentData,
    commitAcceptedClientSequence: params.commitAcceptedClientSequence,
    isFinished: params.isFinished,
    finishedError: params.finishedError,
    finishedErrorCode: params.finishedErrorCode,
    isActorTurn: params.isActorTurn,
    turnError: params.turnError,
    precheck: params.precheck,
    perform: params.perform,
  });
}

export function buildBattleCommandRouteResponse(params: {
  success: boolean;
  status?: number;
  error?: string;
  errorCode?: string;
  runtimeId: string;
  mode: BattleMode;
  routeData: BattleCommandRouteData;
  command?: ReturnType<typeof createBattleCommand> | null;
  acceptedClientSequence?: number;
  serverSceneTick?: number;
  payload?: Record<string, unknown> | null;
  refreshFrames?: readonly AnyStateRefreshEnvelope[];
}) {
  const serverSceneTick = params.serverSceneTick ?? params.routeData.sceneSnapshot?.tick ?? 0;
  return NextResponse.json({
    success: params.success,
    refreshFrames: params.refreshFrames ? [...params.refreshFrames] : [],
    ...(params.error ? { error: params.error } : {}),
    ...(params.errorCode ? { errorCode: params.errorCode } : {}),
    data: {
      state: params.routeData.state,
      battleView: params.routeData.battleView,
      battleRuntime: params.routeData.battleRuntime,
      sceneSnapshot: params.routeData.sceneSnapshot,
      ...(typeof params.routeData.turnState !== "undefined" ? { turnState: params.routeData.turnState } : {}),
      ...(typeof params.routeData.settlement !== "undefined" ? { settlement: params.routeData.settlement } : {}),
      ...(params.payload || {}),
      commandResult: buildBattleCommandResult({
        accepted: params.success,
        runtimeId: params.runtimeId,
        mode: params.mode,
        command: params.command || null,
        battleRuntime: params.routeData.battleRuntime,
        battleView: params.routeData.battleView,
        acceptedClientSequence: params.acceptedClientSequence,
        serverSceneTick,
        errorCode: params.errorCode,
        message: params.error,
        payload: params.payload || null,
      }),
      acceptedClientSequence: params.acceptedClientSequence,
      serverSceneTick,
    },
  }, { status: params.status || 200 });
}

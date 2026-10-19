import type { AnyStateRefreshEnvelope } from "@immortality/shared-protocol";
import {
  pushStateRefreshFrames,
  type StateRefreshPushOutcome,
} from "@/modules/shared/services/state-refresh-push";

/**
 * 宗门域状态变更刷新帧推送。
 *
 * 铁律：宗门事务只要发生入库变更（仓库存取、资源增减、任命 / 权限变化），
 * 就必须下发对应刷新帧，不允许只回 ACK。客户端是纯渲染端，漏推就停在旧值。
 *
 * - 仓库存取 / 捐献：背包(10302) + 资产(10510)
 * - 任命 / 权限 / 审批 / 退出：进度(12742) 且 scopes 必须含 "sect"
 */

export interface SectRefreshPushReport {
  outcomes: StateRefreshPushOutcome[];
  actorFrames: AnyStateRefreshEnvelope[];
  delivered: boolean;
}

function uniquePlayerIds(playerIds: readonly string[]) {
  return Array.from(new Set(
    playerIds
      .map((playerId) => String(playerId || "").trim())
      .filter(Boolean),
  ));
}

/** 宗门仓库 / 资源变更：背包 10302 + 资产 10510。 */
export async function pushSectStorageRefresh(params: {
  playerId: string;
  reason: string;
  roomId?: string;
  changedItemIds?: string[];
  currencies?: Record<string, number>;
}): Promise<SectRefreshPushReport> {
  const outcome = await pushStateRefreshFrames({
    playerId: params.playerId,
    ...(params.roomId ? { roomId: params.roomId } : {}),
    reason: params.reason,
    inventory: {
      ...(params.changedItemIds ? { changedItemIds: params.changedItemIds } : {}),
    },
    asset: {
      ...(params.currencies ? { currencies: params.currencies } : {}),
    },
  });
  return {
    outcomes: [outcome],
    actorFrames: outcome.frames,
    delivered: outcome.delivered,
  };
}

/**
 * 宗门任命 / 权限 / 进度变化：进度 12742，scopes 含 sect。
 *
 * 任命不只影响操作者本人：其他在线成员也要看到职阶变化，因此对所有
 * 宗门成员各推一份，而不是只推操作者。
 */
export async function pushSectProgressRefresh(params: {
  actorPlayerId: string;
  memberPlayerIds?: readonly string[];
  reason: string;
  roomId?: string;
}): Promise<SectRefreshPushReport> {
  const targets = uniquePlayerIds([params.actorPlayerId, ...(params.memberPlayerIds || [])]);
  const outcomes: StateRefreshPushOutcome[] = [];
  let actorFrames: AnyStateRefreshEnvelope[] = [];
  let delivered = false;

  for (const playerId of targets) {
    const outcome = await pushStateRefreshFrames({
      playerId,
      ...(params.roomId ? { roomId: params.roomId } : {}),
      reason: params.reason,
      progress: {
        scopes: ["sect"],
      },
    });
    outcomes.push(outcome);
    if (playerId === params.actorPlayerId) {
      actorFrames = outcome.frames;
      delivered = outcome.delivered;
    }
  }

  return { outcomes, actorFrames, delivered };
}

/** 宗门资源变更（扩建 / 建筑 / 捐献）同时影响资产与进度时的组合推送。 */
export async function pushSectAssetAndProgressRefresh(params: {
  actorPlayerId: string;
  memberPlayerIds?: readonly string[];
  reason: string;
  roomId?: string;
  currencies?: Record<string, number>;
}): Promise<SectRefreshPushReport> {
  const assetReport = await pushSectStorageRefresh({
    playerId: params.actorPlayerId,
    reason: params.reason,
    ...(params.roomId ? { roomId: params.roomId } : {}),
    ...(params.currencies ? { currencies: params.currencies } : {}),
  });
  const progressReport = await pushSectProgressRefresh({
    actorPlayerId: params.actorPlayerId,
    ...(params.memberPlayerIds ? { memberPlayerIds: params.memberPlayerIds } : {}),
    reason: params.reason,
    ...(params.roomId ? { roomId: params.roomId } : {}),
  });
  return {
    outcomes: [...assetReport.outcomes, ...progressReport.outcomes],
    actorFrames: [...assetReport.actorFrames, ...progressReport.actorFrames],
    delivered: assetReport.delivered || progressReport.delivered,
  };
}

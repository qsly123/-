import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import {
  buildPartyCombatViewState,
  getPartyCombatEncounterRuntime,
} from "@/modules/combat/services/party-combat-service";
import { buildCombatBattleViewState } from "@/modules/combat/services/battle-view";
import {
  getPendingCombatSession,
  getPendingCombatSceneSnapshot,
  getSettledCombatSessionResult,
  syncPendingCombatSessionRuntime,
} from "@/modules/combat/services/pending-combat-session";
import { buildPvpViewerSceneData, syncPvpCombatRuntime } from "@/modules/combat/services/pvp-runtime-service";
import { buildBattleRuntimeFromBattleView } from "@/modules/combat/services/battle-runtime";
import { closePartyEncounter } from "@/modules/social/infrastructure/party-service";

export async function GET(request: Request) {
  const player = await getCurrentPlayer();
  if (!player) {
    return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const pvpCombatId = searchParams.get("pvpCombatId")?.trim() || "";
  if (pvpCombatId) {
    await syncPvpCombatRuntime(pvpCombatId);
    const viewerData = buildPvpViewerSceneData(pvpCombatId, player.id);
    if (!viewerData) {
      return NextResponse.json({
        success: false,
        error: "论道场景不存在",
        errorCode: "COMBAT_SCENE_MISSING",
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        snapshot: viewerData.sceneSnapshot,
        sceneSnapshot: viewerData.sceneSnapshot,
        state: viewerData.state,
        battleView: viewerData.battleView,
        battleRuntime: viewerData.battleRuntime,
        turnState: viewerData.turnState,
        settlement: viewerData.settlement,
      },
    });
  }

  const partyCombatId = searchParams.get("partyCombatId")?.trim() || "";
  if (partyCombatId) {
    const runtime = await getPartyCombatEncounterRuntime({
      encounterId: partyCombatId,
      allowStatuses: ["ongoing", "resolved"],
    });
    if (!runtime) {
      await closePartyEncounter({
        encounterId: partyCombatId,
        status: "abandoned",
      }).catch(() => null);
      return NextResponse.json({
        success: false,
        error: "组队战斗不存在",
        errorCode: "COMBAT_SCENE_MISSING",
      }, { status: 404 });
    }
    if (!runtime.turnState.eligibleMemberIds?.includes(player.id)) {
      return NextResponse.json({
        success: false,
        error: "你不在本次组队战名单中",
        errorCode: "COMBAT_SCENE_MISSING",
      }, { status: 403 });
    }

    const state = buildPartyCombatViewState(runtime.state, player.id);
    const battleView = buildCombatBattleViewState({
      runtimeId: runtime.encounter.id,
      mode: "party",
      state,
      sceneSnapshot: runtime.sceneSnapshot,
      turnState: runtime.turnState,
      viewerPlayerId: player.id,
    });

    return NextResponse.json({
      success: true,
      data: {
        snapshot: runtime.sceneSnapshot,
        sceneSnapshot: runtime.sceneSnapshot,
        state,
        battleView,
        battleRuntime: buildBattleRuntimeFromBattleView({
          battleView,
          sceneSnapshot: runtime.sceneSnapshot,
          turnState: runtime.turnState,
        }),
        turnState: runtime.turnState,
      },
    });
  }

  const combatId = searchParams.get("combatId")?.trim() || "";
  if (!combatId) {
    return NextResponse.json({ success: false, error: "缺少战斗 ID" }, { status: 400 });
  }

  await syncPendingCombatSessionRuntime(player.id, combatId);
  const pendingCombat = getPendingCombatSession(player.id, combatId);
  const snapshot = getPendingCombatSceneSnapshot(player.id, combatId);
  if (!snapshot || !pendingCombat) {
    const settledCombat = getSettledCombatSessionResult(player.id, combatId);
    if (settledCombat) {
      const battleView = buildCombatBattleViewState({
        runtimeId: combatId,
        mode: settledCombat.state.mode === "party" ? "party" : "solo",
        state: settledCombat.state,
        sceneSnapshot: settledCombat.sceneSnapshot,
        viewerPlayerId: player.id,
      });
      return NextResponse.json({
        success: true,
        data: {
          snapshot: settledCombat.sceneSnapshot,
          sceneSnapshot: settledCombat.sceneSnapshot,
          state: settledCombat.state,
          battleView,
          battleRuntime: buildBattleRuntimeFromBattleView({
            battleView,
            sceneSnapshot: settledCombat.sceneSnapshot,
          }),
        },
      });
    }
    return NextResponse.json({
      success: false,
      error: "战斗场景不存在",
      errorCode: "COMBAT_SCENE_MISSING",
    }, { status: 404 });
  }

  const battleView = buildCombatBattleViewState({
    runtimeId: combatId,
    mode: pendingCombat.state.mode === "party" ? "party" : "solo",
    state: pendingCombat.state,
    sceneSnapshot: snapshot,
    viewerPlayerId: player.id,
  });

  return NextResponse.json({
    success: true,
    data: {
      snapshot,
      sceneSnapshot: snapshot,
      state: pendingCombat.state,
      battleView,
      battleRuntime: buildBattleRuntimeFromBattleView({
        battleView,
        sceneSnapshot: snapshot,
      }),
    },
  });
}

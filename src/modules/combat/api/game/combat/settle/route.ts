import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { players, playerInventory, combatLogs, items, combatRewardClaims } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getPlayerByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { applyPlayerDefeatRespawn } from "@/modules/character/services/player-death-respawn";
import type { DropItem } from "@/types/game";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";
import { publishSystemAnnouncement } from "@/modules/chat/services/chat-service";
import { applyFortuneEventEffects, applyXpRateForPlayer } from "@/modules/character/services/fortune-service";
import { consumePlayerStaminaForReward, consumePlayerStaminaForRewardTx, STAMINA_REWARD_COST } from "@/modules/character/services/stamina-service";
import {
  consumePendingCombatSession,
  getPendingCombatSession,
  getPendingCombatSessionSettleSnapshot,
  getSettledCombatSessionResult,
  releasePendingCombatSessionLock,
  tryAcquirePendingCombatSessionLock,
  updatePendingCombatSessionSettleSnapshot,
} from "@/modules/combat/services/pending-combat-session";
import { incrementPlayerDeathCount } from "@/modules/combat/services/player-hidden-combat-stats";
import {
  releasePartyCombatEncounterLock,
  tryAcquirePartyCombatEncounterLock,
} from "@/modules/combat/services/party-combat-service";
import { trackRepeatKillGuard } from "@/modules/combat/services/repeat-kill-guard";
import { applyCombatXpGap } from "@/modules/combat/services/combat-reward-scaling";
import { getPartyEncounterById, updatePartyEncounter } from "@/modules/social/infrastructure/party-service";
import { grantSecretRealmMonsterPlayerRewards } from "@/modules/map/services/secret-realm-drop-generation-service";
import { publishMapRefresh } from "@/modules/map/services/map-presence";
import { getRuntimeMonsterById } from "@/modules/map/services/runtime-monster-store";
import {
  isWorldNpcMonsterId,
  resolveWorldNpcIdFromMonsterId,
  settleWorldNpcCombat,
  settleWorldNpcCombatVictoryCoreTx,
  runWorldNpcCombatVictoryPostTasks,
} from "@/modules/world/services/world-npc-service";
import { getSecretRealmContextByMonsterId, moveSecretRealmPlayerToReturnPoint } from "@/modules/map/services/secret-realm-instance-service";
import {
  ensureCombatRewardClaimSchema,
  getCombatRewardClaim,
  lockCombatRewardClaimForUpdateTx,
  readCombatRewardClaimSnapshot,
} from "@/modules/combat/services/combat-reward-claim-service";
import { runCombatSideEffectOnce } from "@/modules/combat/services/combat-side-effect-claim-service";
import { runCombatKillQuestProgressIntent } from "@/modules/combat/services/combat-quest-side-effect-intent";
import type { CombatRepeatGuardPayload, CombatRewardDrop, CombatSettleResultSnapshot, CombatState, CombatTurnState } from "@/types/game";

type RewardTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type WorldNpcVictoryRewardMeta = {
  npcName: string;
  drops: CombatRewardDrop[];
  mapId: string | null;
  districtName: string | null;
  sourceFaction: string | null;
  sourcePositionX: number;
  sourcePositionY: number;
};

function normalizeRatio(current: number, max: number) {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, current / max));
}

function projectCurrentValueByRatio(current: number, currentMax: number, latestMax: number, fallback: number) {
  if (!Number.isFinite(latestMax) || latestMax <= 0) {
    return Math.max(0, Math.floor(fallback));
  }

  const ratio = normalizeRatio(current, currentMax);
  if (ratio <= 0) {
    return Math.max(0, Math.min(Math.floor(latestMax), Math.floor(fallback)));
  }
  if (ratio >= 0.9999) {
    return Math.floor(latestMax);
  }
  return Math.max(0, Math.min(Math.floor(latestMax), Math.floor(latestMax * ratio)));
}

function buildRewardResponseData(params: {
  xp: number;
  gold: number;
  drops: CombatRewardDrop[];
  stamina?: number;
  noRewardReason?: "stamina_empty" | "repeat_guard_blocked";
  antiRepeatGuard?: CombatRepeatGuardPayload | null;
}) {
  return {
    xp: params.xp,
    gold: params.gold,
    drops: params.drops,
    ...(typeof params.stamina === "number" ? { stamina: params.stamina } : {}),
    ...(params.noRewardReason ? { noRewardReason: params.noRewardReason } : {}),
    ...(params.antiRepeatGuard ? { antiRepeatGuard: params.antiRepeatGuard } : {}),
  };
}

async function upsertPlayerInventoryItemTx(params: {
  tx: RewardTx;
  playerId: string;
  itemId: string;
  quantity: number;
}) {
  const existing = await params.tx.select().from(playerInventory)
    .where(and(eq(playerInventory.playerId, params.playerId), eq(playerInventory.itemId, params.itemId)))
    .get();
  if (existing) {
    await params.tx.update(playerInventory)
      .set({ quantity: existing.quantity + params.quantity })
      .where(and(eq(playerInventory.playerId, params.playerId), eq(playerInventory.itemId, params.itemId)))
      .run();
    return;
  }

  await params.tx.insert(playerInventory).values({
    playerId: params.playerId,
    itemId: params.itemId,
    quantity: params.quantity,
  }).run();
}

async function settleCombatRewardClaim<T extends CombatSettleResultSnapshot>(params: {
  combatId: string;
  playerId: string;
  opponentType: string;
  opponentId?: string | null;
  buildSnapshot: (tx: RewardTx) => Promise<T>;
}) {
  const schemaReady = await ensureCombatRewardClaimSchema();
  if (!schemaReady) {
    return db.transaction(async (tx) => params.buildSnapshot(tx));
  }

  return db.transaction(async (tx) => {
    const nowIso = new Date().toISOString();
    await tx.insert(combatRewardClaims).values({
      combatId: params.combatId,
      playerId: params.playerId,
      opponentType: params.opponentType,
      opponentId: params.opponentId || null,
      status: "pending",
      rewardSnapshot: {},
      createdAt: nowIso,
      updatedAt: nowIso,
    }).onConflictDoNothing().run();

    const lockedClaim = await lockCombatRewardClaimForUpdateTx({
      tx,
      combatId: params.combatId,
      playerId: params.playerId,
    });
    const lockedSnapshot = readCombatRewardClaimSnapshot(lockedClaim);
    if (lockedClaim && lockedClaim.status !== "pending" && lockedSnapshot) {
      return lockedSnapshot as T;
    }
    if (!lockedClaim) {
      throw new Error("战斗奖励 claim 占位失败");
    }

    const snapshot = await params.buildSnapshot(tx);
    await tx.update(combatRewardClaims).set({
      opponentType: params.opponentType,
      opponentId: params.opponentId || null,
      status: snapshot.noRewardReason ? "no_reward" : "claimed",
      rewardSnapshot: snapshot,
      claimedAt: nowIso,
      updatedAt: nowIso,
    }).where(eq(combatRewardClaims.id, lockedClaim.id)).run();
    return snapshot;
  });
}

function buildPartyCombatTurnState(turnState: CombatTurnState | null): CombatTurnState {
  return turnState || {
    turnOrder: [],
    currentTurnPlayerId: null,
    turnIndex: 0,
    turnDeadlineAt: null,
  };
}

async function runNonBlockingSettleTasks(
  label: string,
  tasks: Array<Promise<unknown>>,
) {
  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`[combat][settle] ${label}失败`, result.reason);
    }
  }
}

async function runMonsterDefeatMapRefreshOnce(params: {
  combatId: string;
  mapId: string | null | undefined;
  playerId?: string | null;
}) {
  const mapId = String(params.mapId || "").trim();
  if (!mapId) {
    return;
  }

  await runCombatSideEffectOnce({
    effectKey: `combat-monster-defeat-refresh:${params.combatId}`,
    combatId: params.combatId,
    playerId: params.playerId || null,
    effectType: "monster_defeat_map_refresh",
    task: async () => {
      publishMapRefresh({
        mapId,
        reason: "monster_defeat",
      });
    },
  });
}

function buildPartyCombatSafeExitSnapshot(status: CombatState["status"]): CombatSettleResultSnapshot {
  return {
    died: false,
    ...(status === "fled" ? { fled: true } : {}),
    message: status === "fled"
      ? "队伍已成功撤离战场。"
      : "队伍战斗结束，你已安全退出战场。",
  };
}

function buildPartyCombatDefeatSnapshot(params: {
  newRealm: number;
  secretRealmExit: boolean;
  respawnTarget?: {
    mode?: string | null;
  } | null;
}): CombatSettleResultSnapshot {
  const destination = params.respawnTarget?.mode === "sect" ? "宗门" : "出生点";
  return {
    died: true,
    newRealm: params.newRealm,
    message: params.secretRealmExit
      ? "队伍战斗失利，你的气血与灵力均降至 1 点，并已被传出秘境。"
      : `队伍战斗失利，你的气血与灵力均降至 1 点，并已被送回${destination}。`,
  };
}

function buildPartyCombatDefeatAnnouncement(params: {
  playerName?: string | null;
  snapshot: CombatSettleResultSnapshot;
}) {
  const playerName = (params.playerName || "无名修士").trim() || "无名修士";
  const announcementTail = params.snapshot.message?.startsWith("队伍战斗失利，")
    ? params.snapshot.message.slice("队伍战斗失利，".length)
    : "在组队历练中不敌妖兽，气血与灵力均跌至 1 点。";
  return `【队伍折损】${playerName} ${announcementTail}`;
}

function isRewardReplaySnapshot(snapshot: CombatSettleResultSnapshot) {
  return !snapshot.died
    && !snapshot.fled
    && !snapshot.noRewardReason
    && (
      typeof snapshot.xp === "number"
      || typeof snapshot.gold === "number"
      || Array.isArray(snapshot.drops)
    );
}

async function runPartyCombatVictorySideEffects(params: {
  combatId: string;
  playerId: string;
  monsterId: string;
  mapId?: string | null;
}) {
  await runNonBlockingSettleTasks("组队战胜利副作用补偿", [
    runMonsterDefeatMapRefreshOnce({
      combatId: params.combatId,
      playerId: params.playerId,
      mapId: params.mapId,
    }),
    runCombatKillQuestProgressIntent({
      effectKeyPrefix: "party-combat-kill-quest",
      combatId: params.combatId,
      effectType: "party_combat_kill_quest",
      playerId: params.playerId,
      monsterId: params.monsterId,
    }),
    runCombatSideEffectOnce({
      effectKey: `party-combat-kill-fortune:${params.combatId}:${params.playerId}`,
      combatId: params.combatId,
      effectType: "party_combat_kill_fortune",
      playerId: params.playerId,
      task: () => applyFortuneEventEffects({
        playerId: params.playerId,
        trigger: "kill_monster",
      }),
    }),
  ]);
}

async function runPartyCombatDefeatSideEffects(params: {
  combatId: string;
  playerId: string;
  playerName?: string | null;
  snapshot: CombatSettleResultSnapshot;
}) {
  if (!params.snapshot.died) {
    return;
  }

  await runNonBlockingSettleTasks("组队战战败副作用补偿", [
    runCombatSideEffectOnce({
      effectKey: `party-combat-defeat-fortune:${params.combatId}:${params.playerId}`,
      combatId: params.combatId,
      effectType: "party_combat_defeat_fortune",
      playerId: params.playerId,
      task: () => applyFortuneEventEffects({
        playerId: params.playerId,
        trigger: "self_death",
      }),
    }),
    runCombatSideEffectOnce({
      effectKey: `party-combat-defeat-announce:${params.combatId}:${params.playerId}`,
      combatId: params.combatId,
      effectType: "party_combat_defeat_announcement",
      playerId: params.playerId,
      task: () => publishSystemAnnouncement(buildPartyCombatDefeatAnnouncement({
        playerName: params.playerName,
        snapshot: params.snapshot,
      })),
    }),
  ]);
}

async function settlePartyCombatForPlayer(params: {
  player: NonNullable<Awaited<ReturnType<typeof getCurrentPlayer>>>;
  partyCombatId: string;
}) {
  const encounter = await getPartyEncounterById(params.partyCombatId);
  if (!encounter) {
    return NextResponse.json({ success: false, error: "组队战斗不存在" }, { status: 404 });
  }

  if (!tryAcquirePartyCombatEncounterLock(params.partyCombatId)) {
    return NextResponse.json({ success: false, error: "组队战斗正在结算，请稍后重试" }, { status: 409 });
  }

  try {
    const lockedEncounter = await getPartyEncounterById(params.partyCombatId);
    if (!lockedEncounter) {
      return NextResponse.json({ success: false, error: "组队战斗不存在" }, { status: 404 });
    }

    const state = lockedEncounter.stateJson as CombatState | null;
    const turnState = (lockedEncounter.turnStateJson || null) as CombatTurnState | null;
    if (!state) {
      return NextResponse.json({ success: false, error: "组队战斗状态缺失" }, { status: 400 });
    }

    const eligibleMemberIds = Array.isArray(lockedEncounter.eligibleMemberIdsJson) ? lockedEncounter.eligibleMemberIdsJson : [];
    if (!eligibleMemberIds.includes(params.player.id)) {
      return NextResponse.json({ success: false, error: "你不在本次组队战名单中" }, { status: 403 });
    }
    if (state.status === "ongoing") {
      return NextResponse.json({ success: false, error: "战斗尚未结束" }, { status: 400 });
    }

    const participant = state.participants?.find((unit) => unit.id === params.player.id) || state.player;
    const monster = await getRuntimeMonsterById(lockedEncounter.monsterId);
    if (state.status === "player_win" && (!monster || monster.monsterType === "boss")) {
      return NextResponse.json({ success: false, error: "怪物不存在或不可结算" }, { status: 400 });
    }

    const latestPlayer = await getPlayerByIdCompat(params.player.id) || params.player;
    const latestStats = await buildPlayerStatsSnapshot(latestPlayer);
    const settledHpFallback = Math.max(0, Math.min(latestStats.total.maxHp, Math.floor(participant.hp)));
    const settledMpFallback = Math.max(0, Math.min(latestStats.total.maxMp, Math.floor(participant.mp)));
    const projectedSettledHp = projectCurrentValueByRatio(
      participant.hp,
      participant.maxHp,
      latestStats.total.maxHp,
      settledHpFallback,
    );
    const projectedSettledMp = projectCurrentValueByRatio(
      participant.mp,
      participant.maxMp,
      latestStats.total.maxMp,
      settledMpFallback,
    );
    const persistProjectedResources = async (overrides?: Partial<{ hp: number; mp: number }>) => {
      await db.update(players).set({
        hp: projectedSettledHp,
        mp: projectedSettledMp,
        ...overrides,
        updatedAt: new Date().toISOString(),
      }).where(eq(players.id, params.player.id)).run();
    };
    const markPlayerSettled = () => {
      const settledPlayerIds = Array.isArray(state.settledPlayerIds)
        ? state.settledPlayerIds.filter((playerId): playerId is string => typeof playerId === "string" && playerId.trim().length > 0)
        : [];
      if (settledPlayerIds.includes(params.player.id)) {
        return;
      }
      state.settledPlayerIds = [...settledPlayerIds, params.player.id];
    };
    const syncEncounterState = async () => {
      await updatePartyEncounter({
        encounterId: lockedEncounter.id,
        state,
        turnState: buildPartyCombatTurnState(turnState),
        status: lockedEncounter.status as "ongoing" | "resolved" | "abandoned",
      });
    };
    const setPlayerSettleReplaySnapshot = (snapshot: CombatSettleResultSnapshot) => {
      state.settleResultsByPlayerId = {
        ...(state.settleResultsByPlayerId || {}),
        [params.player.id]: snapshot,
      };
      return snapshot;
    };
    const getExistingSettleReplaySnapshot = () => {
      const existingSnapshot = state.settleResultsByPlayerId?.[params.player.id];
      if (existingSnapshot) {
        return existingSnapshot;
      }
      if (!Array.isArray(state.settledPlayerIds) || !state.settledPlayerIds.includes(params.player.id)) {
        return null;
      }
      if (state.status === "player_win") {
        return null;
      }
      if (participant.hp > 0) {
        return buildPartyCombatSafeExitSnapshot(state.status);
      }
      return buildPartyCombatDefeatSnapshot({
        newRealm: latestPlayer.realm,
        secretRealmExit: false,
        respawnTarget: null,
      });
    };

    const replaySnapshot = getExistingSettleReplaySnapshot();
    if (replaySnapshot) {
      if (state.status === "player_win" && monster && isRewardReplaySnapshot(replaySnapshot)) {
        await runPartyCombatVictorySideEffects({
          combatId: lockedEncounter.id,
          playerId: params.player.id,
          monsterId: monster.id,
          mapId: monster.mapId,
        });
      } else if (replaySnapshot.died) {
        await runPartyCombatDefeatSideEffects({
          combatId: lockedEncounter.id,
          playerId: params.player.id,
          playerName: params.player.name,
          snapshot: replaySnapshot,
        });
      }
      return NextResponse.json({
        success: true,
        data: replaySnapshot,
      });
    }

    if (state.status === "player_win") {
      const rewardMonster = monster!;
      const existingReward = Array.isArray(state.rewards)
        ? state.rewards.find((reward) => reward.playerId === params.player.id)
        : null;
      if (existingReward) {
        const responseData = setPlayerSettleReplaySnapshot(buildRewardResponseData({
          xp: existingReward.xp,
          gold: existingReward.gold,
          drops: existingReward.drops || [],
          noRewardReason: existingReward.noRewardReason,
          antiRepeatGuard: existingReward.antiRepeatGuard,
        }));
        if (!Array.isArray(state.settledPlayerIds) || !state.settledPlayerIds.includes(params.player.id)) {
          markPlayerSettled();
          await syncEncounterState();
        }
        if (isRewardReplaySnapshot(responseData)) {
          await runPartyCombatVictorySideEffects({
            combatId: lockedEncounter.id,
            playerId: params.player.id,
            monsterId: rewardMonster.id,
            mapId: rewardMonster.mapId,
          });
        }
        return NextResponse.json({
          success: true,
          data: responseData,
        });
      }

      const existingRewardClaim = readCombatRewardClaimSnapshot(await getCombatRewardClaim({
        combatId: lockedEncounter.id,
        playerId: params.player.id,
      }));
      if (existingRewardClaim) {
        setPlayerSettleReplaySnapshot(existingRewardClaim);
        markPlayerSettled();
        await syncEncounterState();
        if (isRewardReplaySnapshot(existingRewardClaim)) {
          await runPartyCombatVictorySideEffects({
            combatId: lockedEncounter.id,
            playerId: params.player.id,
            monsterId: rewardMonster.id,
            mapId: rewardMonster.mapId,
          });
        }
        return NextResponse.json({
          success: true,
          data: existingRewardClaim,
        });
      }

      const antiRepeatGuard = trackRepeatKillGuard({
        playerId: params.player.id,
        monsterId: rewardMonster.id,
        mapId: latestPlayer.currentMapId,
      });
      if (antiRepeatGuard?.status === "reward_blocked") {
        await db.insert(combatLogs).values({
          playerId: params.player.id,
          opponentType: "monster",
          opponentId: rewardMonster.id,
          result: "win",
          details: {
            xp: 0,
            gold: 0,
            drops: [],
            noRewardReason: "repeat_guard_blocked",
            antiRepeatGuard,
            partyCombatId: lockedEncounter.id,
          },
        }).run().catch((error) => {
          console.error("[combat][party-settle] 反复击杀日志写入失败", error);
        });
        const secretRealmReward = await grantSecretRealmMonsterPlayerRewards({
          monsterId: rewardMonster.id,
          playerId: params.player.id,
          xp: 0,
          gold: 0,
          noRewardReason: "repeat_guard_blocked",
          projectedResources: {
            hp: projectedSettledHp,
            mp: projectedSettledMp,
          },
        });
        const responseData = secretRealmReward
          ? buildRewardResponseData({
            xp: 0,
            gold: 0,
            drops: [],
            noRewardReason: "repeat_guard_blocked",
            antiRepeatGuard,
          })
          : await settleCombatRewardClaim({
            combatId: lockedEncounter.id,
            playerId: params.player.id,
            opponentType: "monster",
            opponentId: rewardMonster.id,
            buildSnapshot: async (tx) => {
              await tx.update(players).set({
                hp: projectedSettledHp,
                mp: projectedSettledMp,
                updatedAt: new Date().toISOString(),
              }).where(eq(players.id, params.player.id)).run();
              return buildRewardResponseData({
                xp: 0,
                gold: 0,
                drops: [],
                noRewardReason: "repeat_guard_blocked",
                antiRepeatGuard,
              });
            },
          });
        setPlayerSettleReplaySnapshot(responseData);

        const partyRewards = Array.isArray(state.rewards) ? state.rewards : [];
        state.rewards = [
          ...partyRewards,
          {
            playerId: params.player.id,
            playerName: params.player.name || "无名修士",
            xp: 0,
            gold: 0,
            isLastHit: false,
            noRewardReason: "repeat_guard_blocked",
            antiRepeatGuard,
            drops: [],
          },
        ];
        markPlayerSettled();
        await syncEncounterState();

        return NextResponse.json({
          success: true,
          data: responseData,
        });
      }

      const secretRealmRewardContext = await getSecretRealmContextByMonsterId(rewardMonster.id);
      const staminaConsumeResult = secretRealmRewardContext
        ? await consumePlayerStaminaForReward(params.player.id, STAMINA_REWARD_COST)
        : null;
      if (staminaConsumeResult && !staminaConsumeResult.consumed) {
        const secretRealmReward = await grantSecretRealmMonsterPlayerRewards({
          monsterId: rewardMonster.id,
          playerId: params.player.id,
          xp: 0,
          gold: 0,
          noRewardReason: "stamina_empty",
          projectedResources: {
            hp: projectedSettledHp,
            mp: projectedSettledMp,
          },
        });
        const responseData = secretRealmReward
          ? buildRewardResponseData({
            xp: 0,
            gold: 0,
            drops: [],
            noRewardReason: "stamina_empty",
            stamina: staminaConsumeResult.stamina,
            antiRepeatGuard,
          })
          : await settleCombatRewardClaim({
            combatId: lockedEncounter.id,
            playerId: params.player.id,
            opponentType: "monster",
            opponentId: rewardMonster.id,
            buildSnapshot: async (tx) => {
              await tx.update(players).set({
                hp: projectedSettledHp,
                mp: projectedSettledMp,
                updatedAt: new Date().toISOString(),
              }).where(eq(players.id, params.player.id)).run();
              return buildRewardResponseData({
                xp: 0,
                gold: 0,
                drops: [],
                noRewardReason: "stamina_empty",
                stamina: staminaConsumeResult.stamina,
                antiRepeatGuard,
              });
            },
          });
        setPlayerSettleReplaySnapshot(responseData);
        const partyRewards = Array.isArray(state.rewards) ? state.rewards : [];
        state.rewards = [
          ...partyRewards,
          {
            playerId: params.player.id,
            playerName: params.player.name || "无名修士",
            xp: 0,
            gold: 0,
            isLastHit: false,
            noRewardReason: "stamina_empty",
            antiRepeatGuard: antiRepeatGuard || undefined,
            drops: [],
          },
        ];
        markPlayerSettled();
        await syncEncounterState();
        return NextResponse.json({
          success: true,
          data: responseData,
        });
      }

      const baseXp = Math.max(0, Math.floor(Number(rewardMonster.xpReward || 0)));
      const finalXp = baseXp > 0
        ? (await applyCombatXpGap(
          await applyXpRateForPlayer({
            playerId: params.player.id,
            baseXp,
            channel: "combat",
          }),
          Number(params.player.realm ?? 0),
          Number(rewardMonster.level ?? 0),
        )).xp
        : 0;
      const finalGold = Math.max(0, Math.floor(Number(rewardMonster.goldReward || 0)));
      const secretRealmReward = secretRealmRewardContext
        ? await grantSecretRealmMonsterPlayerRewards({
          monsterId: rewardMonster.id,
          playerId: params.player.id,
          xp: finalXp,
          gold: finalGold,
          projectedResources: {
            hp: projectedSettledHp,
            mp: projectedSettledMp,
          },
        })
        : null;
      const responseData = secretRealmReward
        ? buildRewardResponseData({
          xp: finalXp,
          gold: finalGold,
          drops: secretRealmReward.drops,
          stamina: staminaConsumeResult?.stamina,
          antiRepeatGuard,
        })
        : await settleCombatRewardClaim({
          combatId: lockedEncounter.id,
          playerId: params.player.id,
          opponentType: "monster",
          opponentId: rewardMonster.id,
          buildSnapshot: async (tx) => {
            const settledStaminaConsumeResult = await consumePlayerStaminaForRewardTx(tx, params.player.id, STAMINA_REWARD_COST);
            if (!settledStaminaConsumeResult.consumed) {
              await tx.update(players).set({
                hp: projectedSettledHp,
                mp: projectedSettledMp,
                updatedAt: new Date().toISOString(),
              }).where(eq(players.id, params.player.id)).run();
              return buildRewardResponseData({
                xp: 0,
                gold: 0,
                drops: [],
                noRewardReason: "stamina_empty",
                stamina: settledStaminaConsumeResult.stamina,
                antiRepeatGuard,
              });
            }

            const droppedItems: CombatRewardDrop[] = [];
            const monsterDrops = Array.isArray(rewardMonster.drops) ? (rewardMonster.drops as DropItem[]) : [];
            const latestRewardPlayer = await tx.select({
              cultivationXp: players.cultivationXp,
              gold: players.gold,
            }).from(players).where(eq(players.id, params.player.id)).get();

            await tx.update(players).set({
              cultivationXp: Number(latestRewardPlayer?.cultivationXp || 0) + finalXp,
              gold: Number(latestRewardPlayer?.gold || 0) + finalGold,
              hp: projectedSettledHp,
              mp: projectedSettledMp,
              updatedAt: new Date().toISOString(),
            }).where(eq(players.id, params.player.id)).run();

            for (const drop of monsterDrops) {
              if (Math.random() < drop.chance) {
                const qty = drop.minQuantity + Math.floor(Math.random() * (drop.maxQuantity - drop.minQuantity + 1));
                await upsertPlayerInventoryItemTx({
                  tx,
                  playerId: params.player.id,
                  itemId: drop.itemId,
                  quantity: qty,
                });
                const item = await tx.select({
                  name: items.name,
                  iconUrl: items.iconUrl,
                  rarity: items.rarity,
                }).from(items).where(eq(items.id, drop.itemId)).get();
                droppedItems.push({
                  itemId: drop.itemId,
                  quantity: qty,
                  itemName: item?.name || drop.itemId,
                  itemIconUrl: item?.iconUrl || null,
                  itemRarity: item?.rarity || null,
                });
              }
            }

            return buildRewardResponseData({
              xp: finalXp,
              gold: finalGold,
              drops: droppedItems,
              stamina: settledStaminaConsumeResult.stamina,
              antiRepeatGuard,
            });
          },
        });
      setPlayerSettleReplaySnapshot(responseData);

      const partyRewards = Array.isArray(state.rewards) ? state.rewards : [];
      state.rewards = [
        ...partyRewards,
        {
          playerId: params.player.id,
          playerName: params.player.name || "无名修士",
          xp: Number(responseData.xp || 0),
          gold: Number(responseData.gold || 0),
          isLastHit: false,
          noRewardReason: responseData.noRewardReason,
          antiRepeatGuard: antiRepeatGuard || undefined,
          drops: responseData.drops || [],
        },
      ];
      markPlayerSettled();
      await syncEncounterState();

      await runPartyCombatVictorySideEffects({
        combatId: lockedEncounter.id,
        playerId: params.player.id,
        monsterId: rewardMonster.id,
        mapId: rewardMonster.mapId,
      });
      const postSettleTasks = await Promise.allSettled([
        db.insert(combatLogs).values({
          playerId: params.player.id,
          opponentType: "monster",
          opponentId: rewardMonster.id,
          result: "win",
          details: {
            xp: Number(responseData.xp || 0),
            gold: Number(responseData.gold || 0),
            drops: responseData.drops || [],
            ...(responseData.noRewardReason ? { noRewardReason: responseData.noRewardReason } : {}),
            staminaCost: STAMINA_REWARD_COST,
            staminaAfter: responseData.stamina,
            partyCombatId: lockedEncounter.id,
          },
        }).run(),
      ]);
      for (const task of postSettleTasks) {
        if (task.status === "rejected") {
          console.error("[combat][party-settle] 胜利后处理失败", task.reason);
        }
      }

      return NextResponse.json({
        success: true,
        data: responseData,
      });
    }

    if (participant.hp > 0) {
      await persistProjectedResources();
      const responseData = setPlayerSettleReplaySnapshot(buildPartyCombatSafeExitSnapshot(state.status));
      markPlayerSettled();
      await syncEncounterState();
      return NextResponse.json({
        success: true,
        data: responseData,
      });
    }

    await incrementPlayerDeathCount(params.player.id);
    const nowIso = new Date().toISOString();
    const secretRealmExit = await moveSecretRealmPlayerToReturnPoint({
      playerId: params.player.id,
      hp: 1,
      mp: 1,
      nowIso,
    });
    const respawnTarget = !secretRealmExit
      ? await applyPlayerDefeatRespawn({
        playerId: params.player.id,
        hp: 1,
        mp: 1,
        nowIso,
        prevMapId: params.player.currentMapId,
        presencePlayer: {
          id: params.player.id,
          name: params.player.name,
          gender: params.player.gender,
          realm: params.player.realm,
          realmMajor: params.player.realmMajor,
          realmMinor: params.player.realmMinor,
          realmName: params.player.realmName,
        },
      })
      : null;
    if (!secretRealmExit) {
    }
    const responseData = setPlayerSettleReplaySnapshot(buildPartyCombatDefeatSnapshot({
      newRealm: latestPlayer.realm,
      secretRealmExit: Boolean(secretRealmExit),
      respawnTarget,
    }));
    markPlayerSettled();
    await syncEncounterState();
    await runPartyCombatDefeatSideEffects({
      combatId: lockedEncounter.id,
      playerId: params.player.id,
      playerName: params.player.name,
      snapshot: responseData,
    });

    return NextResponse.json({
      success: true,
      data: responseData,
    });
  } finally {
    releasePartyCombatEncounterLock(params.partyCombatId);
  }
}

export async function POST(request: Request) {
  let lockedCombatPlayerId: string | null = null;
  let lockedCombatId: string | null = null;
  let combatSessionConsumed = false;

  try {
    const player = await getCurrentPlayer();
    if (!player) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    const playerDisplayName = (player.name || "无名修士").trim() || "无名修士";

    const body = await request.json() as { combatId?: unknown; partyCombatId?: unknown };
    const combatId = typeof body.combatId === "string" ? body.combatId.trim() : "";
    const partyCombatId = typeof body.partyCombatId === "string" ? body.partyCombatId.trim() : "";
    if (partyCombatId) {
      return settlePartyCombatForPlayer({
        player,
        partyCombatId,
      });
    }
    if (!combatId) {
      return NextResponse.json({ success: false, error: "缺少战斗ID" }, { status: 400 });
    }

    const pendingCombat = getPendingCombatSession(player.id, combatId);
    if (!pendingCombat) {
      const settledCombat = getSettledCombatSessionResult(player.id, combatId);
      if (settledCombat?.settleSnapshot?.data) {
        return NextResponse.json({
          success: true,
          data: settledCombat.settleSnapshot.data,
        });
      }
      const existingRewardClaim = readCombatRewardClaimSnapshot(await getCombatRewardClaim({
        combatId,
        playerId: player.id,
      }));
      if (existingRewardClaim) {
        return NextResponse.json({
          success: true,
          data: existingRewardClaim,
        });
      }
      return NextResponse.json({ success: false, error: "战斗会话不存在或已结算" }, { status: 400 });
    }
    if (pendingCombat.state.status === "ongoing") {
      return NextResponse.json({ success: false, error: "战斗尚未结束" }, { status: 400 });
    }

    if (!tryAcquirePendingCombatSessionLock(player.id, combatId)) {
      return NextResponse.json({ success: false, error: "战斗正在结算，请稍后重试" }, { status: 409 });
    }
    lockedCombatPlayerId = player.id;
    lockedCombatId = combatId;

    const settledCombat = getPendingCombatSession(player.id, combatId);
    if (!settledCombat) {
      const existingRewardClaim = readCombatRewardClaimSnapshot(await getCombatRewardClaim({
        combatId,
        playerId: player.id,
      }));
      if (existingRewardClaim) {
        return NextResponse.json({
          success: true,
          data: existingRewardClaim,
        });
      }
      return NextResponse.json({ success: false, error: "战斗会话不存在或已结算" }, { status: 400 });
    }
    if (settledCombat.state.status === "ongoing") {
      return NextResponse.json({ success: false, error: "战斗尚未结束" }, { status: 400 });
    }
    const result = settledCombat.state.status;
    const existingSettleSnapshot = getPendingCombatSessionSettleSnapshot(player.id, combatId);
    const finalizeCombatSettleSuccess = <T extends object>(data: T) => {
      consumePendingCombatSession(player.id, combatId);
      combatSessionConsumed = true;
      return NextResponse.json({
        success: true,
        data,
      });
    };
    const stageCombatSettleSuccess = <T extends object>(data: T) => {
      updatePendingCombatSessionSettleSnapshot(player.id, combatId, data as Record<string, unknown>);
      return data;
    };

    if (existingSettleSnapshot?.data) {
      return finalizeCombatSettleSuccess(existingSettleSnapshot.data);
    }

    if (isWorldNpcMonsterId(settledCombat.monsterId)) {
      const worldNpcId = resolveWorldNpcIdFromMonsterId(settledCombat.monsterId);
      const latestPlayer = await getPlayerByIdCompat(player.id) || player;
      const latestStats = await buildPlayerStatsSnapshot(latestPlayer);
      const clampStat = (value: unknown, min: number, max: number, fallback: number) => {
        if (typeof value !== "number" || Number.isNaN(value)) return fallback;
        const n = Math.floor(value);
        return Math.max(min, Math.min(max, n));
      };
      const settledHpFallback = clampStat(
        settledCombat.state.player.hp,
        0,
        latestStats.total.maxHp,
        latestStats.total.hp,
      );
      const settledMpFallback = clampStat(
        settledCombat.state.player.mp,
        0,
        latestStats.total.maxMp,
        latestStats.total.mp,
      );
      const projectedSettledHp = projectCurrentValueByRatio(
        settledCombat.state.player.hp,
        settledCombat.state.player.maxHp,
        latestStats.total.maxHp,
        settledHpFallback,
      );
      const projectedSettledMp = projectCurrentValueByRatio(
        settledCombat.state.player.mp,
        settledCombat.state.player.maxMp,
        latestStats.total.maxMp,
        settledMpFallback,
      );

      if (result === "player_win") {
        const existingRewardClaim = readCombatRewardClaimSnapshot(await getCombatRewardClaim({
          combatId,
          playerId: player.id,
        }));
        if (existingRewardClaim) {
          return finalizeCombatSettleSuccess(stageCombatSettleSuccess(existingRewardClaim));
        }

        const worldRewardMetaBox: { current: WorldNpcVictoryRewardMeta | null } = { current: null };
        const responseData = await settleCombatRewardClaim({
          combatId,
          playerId: player.id,
          opponentType: "world_npc",
          opponentId: worldNpcId,
          buildSnapshot: async (tx) => {
            await tx.update(players).set({
              hp: projectedSettledHp,
              mp: projectedSettledMp,
              updatedAt: new Date().toISOString(),
            }).where(eq(players.id, player.id)).run();
            worldRewardMetaBox.current = await settleWorldNpcCombatVictoryCoreTx({
              tx,
              playerId: player.id,
              npcId: worldNpcId,
              combatId,
              playerDisplayName,
            });
            return buildRewardResponseData({
              xp: 0,
              gold: 0,
              drops: worldRewardMetaBox.current.drops,
            });
          },
        });
        const stagedResponseData = stageCombatSettleSuccess(responseData);
        const settledWorldRewardMeta = worldRewardMetaBox.current as WorldNpcVictoryRewardMeta | null;
        if (settledWorldRewardMeta) {
          await runNonBlockingSettleTasks("世界 NPC 胜利后处理", [
            db.insert(combatLogs).values({
              playerId: player.id,
              opponentType: "world_npc",
              opponentId: worldNpcId,
              result: "win",
              details: {
                xp: 0,
                gold: 0,
                drops: stagedResponseData.drops || [],
              },
            }).run(),
            runWorldNpcCombatVictoryPostTasks({
              playerId: player.id,
              npcId: worldNpcId,
              npcName: settledWorldRewardMeta.npcName,
              mapId: settledWorldRewardMeta.mapId,
              districtName: settledWorldRewardMeta.districtName,
              sourceFaction: settledWorldRewardMeta.sourceFaction,
              sourcePositionX: settledWorldRewardMeta.sourcePositionX,
              sourcePositionY: settledWorldRewardMeta.sourcePositionY,
              drops: stagedResponseData.drops || [],
            }),
          ]);
        }
        return finalizeCombatSettleSuccess(stagedResponseData);
      }

      if (result === "enemy_win") {
        const worldReward = await settleWorldNpcCombat({
          playerId: player.id,
          npcId: worldNpcId,
          combatId,
          result: "enemy_win",
        });

        const deathCount = await incrementPlayerDeathCount(player.id);
        const nowIso = new Date().toISOString();
        const secretRealmExit = await moveSecretRealmPlayerToReturnPoint({
          playerId: player.id,
          hp: 1,
          mp: 1,
          nowIso,
        });
        const respawnTarget = !secretRealmExit
          ? await applyPlayerDefeatRespawn({
            playerId: player.id,
            hp: 1,
            mp: 1,
            nowIso,
            prevMapId: latestPlayer.currentMapId,
            presencePlayer: {
              id: player.id,
              name: player.name,
              gender: player.gender,
              realm: player.realm,
              realmMajor: player.realmMajor,
              realmMinor: player.realmMinor,
              realmName: player.realmName,
            },
          })
          : null;
        if (!secretRealmExit) {
        }

        const responseData = stageCombatSettleSuccess({
          died: true,
          newRealm: latestPlayer.realm,
          message: secretRealmExit
            ? `你在争夺${worldReward.npcName}遗宝时落败，气血与灵力均降至1点，并已被传出秘境。`
            : `你在争夺${worldReward.npcName}遗宝时落败，气血与灵力均降至1点，并已被送回${respawnTarget?.mode === "sect" ? "宗门" : "出生点"}。`,
        });
        await runNonBlockingSettleTasks("世界 NPC 战败后处理", [
          db.insert(combatLogs).values({
            playerId: player.id,
            opponentType: "world_npc",
            opponentId: worldNpcId,
            result: "lose",
            details: {
              hp: 1,
              mp: 1,
              returnedToSpawn: true,
              hiddenDeathCount: deathCount,
              hiddenWildDefeatCount: deathCount,
            },
          }).run(),
          applyFortuneEventEffects({
            playerId: player.id,
            trigger: "self_death",
          }),
        ]);
        void publishSystemAnnouncement(`【杀劫】${playerDisplayName}在争夺${worldReward.npcName}遗宝时失手，气血与灵力尽散，被送回了${respawnTarget?.mode === "sect" ? "宗门" : "出生点"}。`).catch((announcementError) => {
          console.error("World NPC death announcement error:", announcementError);
        });
        return finalizeCombatSettleSuccess(responseData);
      }

      if (result === "fled") {
        await settleWorldNpcCombat({
          playerId: player.id,
          npcId: worldNpcId,
          combatId,
          result: "fled",
        });

        await db.update(players).set({
          hp: Math.max(1, projectedSettledHp - Math.floor(latestStats.total.maxHp * 0.1)),
          mp: projectedSettledMp,
          updatedAt: new Date().toISOString(),
        }).where(eq(players.id, player.id)).run();

        const responseData = stageCombatSettleSuccess({
          fled: true,
          message: "你已成功退出这场遗宝争夺。",
        });
        await runNonBlockingSettleTasks("世界 NPC 逃离后处理", [
          db.insert(combatLogs).values({
            playerId: player.id,
            opponentType: "world_npc",
            opponentId: worldNpcId,
            result: "flee",
            details: {
              hp: Math.max(1, projectedSettledHp - Math.floor(latestStats.total.maxHp * 0.1)),
              mp: projectedSettledMp,
            },
          }).run(),
        ]);
        return finalizeCombatSettleSuccess(responseData);
      }
    }

    const monster = await getRuntimeMonsterById(settledCombat.monsterId);
    if (!monster || monster.monsterType === "boss") {
      return NextResponse.json({ success: false, error: "怪物不存在或不可结算" }, { status: 400 });
    }

    const monsterId = monster.id;
    const monsterDisplayName = (monster.name || "妖兽").trim() || "妖兽";
    const monsterDrops = Array.isArray(monster.drops) ? (monster.drops as DropItem[]) : [];
    const latestPlayer = await getPlayerByIdCompat(player.id) || player;
    const latestStats = await buildPlayerStatsSnapshot(latestPlayer);
    const clampStat = (value: unknown, min: number, max: number, fallback: number) => {
      if (typeof value !== "number" || Number.isNaN(value)) return fallback;
      const n = Math.floor(value);
      return Math.max(min, Math.min(max, n));
    };
    const settledHpFallback = clampStat(
      settledCombat.state.player.hp,
      0,
      latestStats.total.maxHp,
      latestStats.total.hp,
    );
    const settledMpFallback = clampStat(
      settledCombat.state.player.mp,
      0,
      latestStats.total.maxMp,
      latestStats.total.mp,
    );
    const projectedSettledHp = projectCurrentValueByRatio(
      settledCombat.state.player.hp,
      settledCombat.state.player.maxHp,
      latestStats.total.maxHp,
      settledHpFallback,
    );
    const projectedSettledMp = projectCurrentValueByRatio(
      settledCombat.state.player.mp,
      settledCombat.state.player.maxMp,
      latestStats.total.maxMp,
      settledMpFallback,
    );
    if (result === "player_win") {
      const existingRewardClaim = readCombatRewardClaimSnapshot(await getCombatRewardClaim({
        combatId,
        playerId: player.id,
      }));
      if (existingRewardClaim) {
        await runMonsterDefeatMapRefreshOnce({
          combatId,
          playerId: player.id,
          mapId: monster.mapId,
        });
        return finalizeCombatSettleSuccess(stageCombatSettleSuccess(existingRewardClaim));
      }

      const antiRepeatGuard = trackRepeatKillGuard({
        playerId: player.id,
        monsterId: monsterId,
        mapId: latestPlayer.currentMapId,
      });
      if (antiRepeatGuard?.status === "reward_blocked") {
        const secretRealmReward = await grantSecretRealmMonsterPlayerRewards({
          monsterId,
          playerId: player.id,
          xp: 0,
          gold: 0,
          noRewardReason: "repeat_guard_blocked",
          projectedResources: {
            hp: projectedSettledHp,
            mp: projectedSettledMp,
          },
        });
        const responseData = secretRealmReward
          ? buildRewardResponseData({
            xp: 0,
            gold: 0,
            drops: [],
            noRewardReason: "repeat_guard_blocked",
            antiRepeatGuard,
          })
          : await settleCombatRewardClaim({
            combatId,
            playerId: player.id,
            opponentType: "monster",
            opponentId: monsterId,
            buildSnapshot: async (tx) => {
              await tx.update(players).set({
                hp: projectedSettledHp,
                mp: projectedSettledMp,
                updatedAt: new Date().toISOString(),
              }).where(eq(players.id, player.id)).run();
              return buildRewardResponseData({
                xp: 0,
                gold: 0,
                drops: [],
                noRewardReason: "repeat_guard_blocked",
                antiRepeatGuard,
              });
            },
          });
        const stagedResponseData = stageCombatSettleSuccess(responseData);
        await runNonBlockingSettleTasks("单人普通战反复击杀后处理", [
          runMonsterDefeatMapRefreshOnce({
            combatId,
            playerId: player.id,
            mapId: monster.mapId,
          }),
          db.insert(combatLogs).values({
            playerId: player.id,
            opponentType: "monster",
            opponentId: monsterId,
            result: "win",
            details: {
              xp: 0,
              gold: 0,
              drops: [],
              noRewardReason: "repeat_guard_blocked",
              antiRepeatGuard,
            },
          }).run(),
        ]);
        return finalizeCombatSettleSuccess(stagedResponseData);
      }

      const secretRealmRewardContext = await getSecretRealmContextByMonsterId(monsterId);
      const staminaConsumeResult = secretRealmRewardContext
        ? await consumePlayerStaminaForReward(player.id, STAMINA_REWARD_COST)
        : null;
      if (staminaConsumeResult && !staminaConsumeResult.consumed) {
        const secretRealmReward = await grantSecretRealmMonsterPlayerRewards({
          monsterId,
          playerId: player.id,
          xp: 0,
          gold: 0,
          noRewardReason: "stamina_empty",
          projectedResources: {
            hp: projectedSettledHp,
            mp: projectedSettledMp,
          },
        });
        const responseData = secretRealmReward
          ? buildRewardResponseData({
            xp: 0,
            gold: 0,
            drops: [],
            noRewardReason: "stamina_empty",
            stamina: staminaConsumeResult.stamina,
            antiRepeatGuard,
          })
          : await settleCombatRewardClaim({
            combatId,
            playerId: player.id,
            opponentType: "monster",
            opponentId: monsterId,
            buildSnapshot: async (tx) => {
              await tx.update(players).set({
                hp: projectedSettledHp,
                mp: projectedSettledMp,
                updatedAt: new Date().toISOString(),
              }).where(eq(players.id, player.id)).run();
              return buildRewardResponseData({
                xp: 0,
                gold: 0,
                drops: [],
                noRewardReason: "stamina_empty",
                stamina: staminaConsumeResult.stamina,
                antiRepeatGuard,
              });
            },
          });
        const stagedResponseData = stageCombatSettleSuccess(responseData);
        await runNonBlockingSettleTasks("单人普通战体力不足后处理", [
          runMonsterDefeatMapRefreshOnce({
            combatId,
            playerId: player.id,
            mapId: monster.mapId,
          }),
          db.insert(combatLogs).values({
            playerId: player.id,
            opponentType: "monster",
            opponentId: monsterId,
            result: "win",
            details: {
              xp: 0,
              gold: 0,
              drops: [],
              noRewardReason: "stamina_empty",
              ...(antiRepeatGuard ? { antiRepeatGuard } : {}),
            },
          }).run(),
        ]);
        return finalizeCombatSettleSuccess(stagedResponseData);
      }

      const baseXp = Math.max(0, Math.floor(Number(monster.xpReward || 0)));
      const finalXp = baseXp > 0
        ? (await applyCombatXpGap(
          await applyXpRateForPlayer({
            playerId: player.id,
            baseXp,
            channel: "combat",
          }),
          Number(player.realm ?? 0),
          Number(monster.level ?? 0),
        )).xp
        : 0;
      const finalGold = Math.max(0, Math.floor(Number(monster.goldReward || 0)));
      const secretRealmReward = secretRealmRewardContext
        ? await grantSecretRealmMonsterPlayerRewards({
          monsterId,
          playerId: player.id,
          xp: finalXp,
          gold: finalGold,
          projectedResources: {
          hp: projectedSettledHp,
          mp: projectedSettledMp,
        },
        })
        : null;
      const responseData = secretRealmReward
        ? buildRewardResponseData({
          xp: finalXp,
          gold: finalGold,
          drops: secretRealmReward.drops,
          stamina: staminaConsumeResult?.stamina,
          antiRepeatGuard,
        })
        : await settleCombatRewardClaim({
          combatId,
          playerId: player.id,
          opponentType: "monster",
          opponentId: monsterId,
          buildSnapshot: async (tx) => {
            const settledStaminaConsumeResult = await consumePlayerStaminaForRewardTx(tx, player.id, STAMINA_REWARD_COST);
            if (!settledStaminaConsumeResult.consumed) {
              await tx.update(players).set({
                hp: projectedSettledHp,
                mp: projectedSettledMp,
                updatedAt: new Date().toISOString(),
              }).where(eq(players.id, player.id)).run();
              return buildRewardResponseData({
                xp: 0,
                gold: 0,
                drops: [],
                noRewardReason: "stamina_empty",
                stamina: settledStaminaConsumeResult.stamina,
                antiRepeatGuard,
              });
            }

            const droppedItems: CombatRewardDrop[] = [];
            const latestRewardPlayer = await tx.select({
              cultivationXp: players.cultivationXp,
              gold: players.gold,
            }).from(players).where(eq(players.id, player.id)).get();

            await tx.update(players).set({
              cultivationXp: Number(latestRewardPlayer?.cultivationXp || 0) + finalXp,
              gold: Number(latestRewardPlayer?.gold || 0) + finalGold,
              hp: projectedSettledHp,
              mp: projectedSettledMp,
              updatedAt: new Date().toISOString(),
            }).where(eq(players.id, player.id)).run();

            for (const drop of monsterDrops) {
              if (Math.random() < drop.chance) {
                const qty = drop.minQuantity + Math.floor(Math.random() * (drop.maxQuantity - drop.minQuantity + 1));
                await upsertPlayerInventoryItemTx({
                  tx,
                  playerId: player.id,
                  itemId: drop.itemId,
                  quantity: qty,
                });
                const item = await tx.select({
                  name: items.name,
                  iconUrl: items.iconUrl,
                  rarity: items.rarity,
                }).from(items).where(eq(items.id, drop.itemId)).get();
                droppedItems.push({
                  itemId: drop.itemId,
                  quantity: qty,
                  itemName: item?.name || drop.itemId,
                  itemIconUrl: item?.iconUrl || null,
                  itemRarity: item?.rarity || null,
                });
              }
            }

            return buildRewardResponseData({
              xp: finalXp,
              gold: finalGold,
              drops: droppedItems,
              stamina: settledStaminaConsumeResult.stamina,
              antiRepeatGuard,
            });
          },
        });
      const stagedResponseData = stageCombatSettleSuccess(responseData);
      await runNonBlockingSettleTasks("单人普通战胜利后处理", [
        runMonsterDefeatMapRefreshOnce({
          combatId,
          playerId: player.id,
          mapId: monster.mapId,
        }),
        runCombatKillQuestProgressIntent({
          effectKeyPrefix: "solo-combat-kill-quest",
          combatId,
          effectType: "solo_combat_kill_quest",
          playerId: player.id,
          monsterId,
        }),
        applyFortuneEventEffects({
          playerId: player.id,
          trigger: "kill_monster",
        }),
        db.insert(combatLogs).values({
          playerId: player.id, opponentType: "monster", opponentId: monsterId,
          result: "win",
          details: {
            xp: Number(stagedResponseData.xp || 0),
            gold: Number(stagedResponseData.gold || 0),
            drops: stagedResponseData.drops || [],
            ...(stagedResponseData.noRewardReason ? { noRewardReason: stagedResponseData.noRewardReason } : {}),
            staminaCost: STAMINA_REWARD_COST,
            staminaAfter: stagedResponseData.stamina,
            ...(antiRepeatGuard ? { antiRepeatGuard } : {}),
          },
        }).run(),
      ]);
      return finalizeCombatSettleSuccess(stagedResponseData);
    } else if (result === "enemy_win") {
      const deathCount = await incrementPlayerDeathCount(player.id);
      const nowIso = new Date().toISOString();
      const secretRealmExit = await moveSecretRealmPlayerToReturnPoint({
        playerId: player.id,
        hp: 1,
        mp: 1,
        nowIso,
      });
      const respawnTarget = !secretRealmExit
        ? await applyPlayerDefeatRespawn({
          playerId: player.id,
          hp: 1,
          mp: 1,
          nowIso,
          prevMapId: latestPlayer.currentMapId,
          presencePlayer: {
            id: player.id,
            name: player.name,
            gender: player.gender,
            realm: player.realm,
            realmMajor: player.realmMajor,
            realmMinor: player.realmMinor,
            realmName: player.realmName,
          },
        })
        : null;
      if (!secretRealmExit) {
      }

      const responseData = stageCombatSettleSuccess({
        died: true,
        newRealm: latestPlayer.realm,
        message: secretRealmExit
          ? `你在历练中不敌${monsterDisplayName}，气血与灵力均降至1点，并已被传出秘境。`
          : `你在历练中不敌${monsterDisplayName}，气血与灵力均降至1点，并已被送回${respawnTarget?.mode === "sect" ? "宗门" : "出生点"}。`,
      });
      await runNonBlockingSettleTasks("单人普通战战败后处理", [
        db.insert(combatLogs).values({
          playerId: player.id, opponentType: "monster", opponentId: monsterId,
          result: "lose",
          details: {
            hp: 1,
            mp: 1,
            returnedToSpawn: true,
            hiddenDeathCount: deathCount,
            hiddenWildDefeatCount: deathCount,
          },
        }).run(),
        applyFortuneEventEffects({
          playerId: player.id,
          trigger: "self_death",
        }),
      ]);
      void publishSystemAnnouncement(`【历练受挫】${playerDisplayName} 在历练中不敌 ${monsterDisplayName}，气血与灵力均跌至 1 点，被送回了${respawnTarget?.mode === "sect" ? "宗门" : "出生点"}。`).catch((announcementError) => {
        console.error("Player death announcement error:", announcementError);
      });
      return finalizeCombatSettleSuccess(responseData);
    } else if (result === "fled") {
      // 逃跑 - 扣少量HP
      await db.update(players).set({
        hp: Math.max(1, projectedSettledHp - Math.floor(latestStats.total.maxHp * 0.1)),
        mp: projectedSettledMp,
        updatedAt: new Date().toISOString(),
      }).where(eq(players.id, player.id)).run();

      const responseData = stageCombatSettleSuccess({
        fled: true,
        message: `你已成功脱离与${monsterDisplayName}的战斗。`,
      });
      return finalizeCombatSettleSuccess(responseData);
    } else {
      return NextResponse.json({ success: false, error: "战斗状态非法" }, { status: 400 });
    }
  } catch (e) {
    console.error("Combat settle error:", e);
    return NextResponse.json({ success: false, error: "结算失败" }, { status: 500 });
  } finally {
    if (!combatSessionConsumed && lockedCombatPlayerId && lockedCombatId) {
      releasePendingCombatSessionLock(lockedCombatPlayerId, lockedCombatId);
    }
  }
}

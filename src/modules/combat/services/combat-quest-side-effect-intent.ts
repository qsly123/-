import { advanceKillQuestProgressTx, advanceTalkQuestProgressTx } from "@/modules/quest/services/quest-service";
import { runCombatSideEffectTransactionOnce } from "@/modules/combat/services/combat-side-effect-claim-service";

export async function runCombatKillQuestProgressIntent(params: {
  combatId: string;
  playerId: string;
  monsterId: string;
  effectType?: string;
  effectKeyPrefix?: string;
}) {
  const combatId = String(params.combatId || "").trim();
  const playerId = String(params.playerId || "").trim();
  const monsterId = String(params.monsterId || "").trim();
  if (!combatId || !playerId || !monsterId) {
    return { executed: false, replayed: true };
  }

  const effectType = params.effectType || "combat_kill_quest";
  const effectKeyPrefix = params.effectKeyPrefix || effectType;
  return await runCombatSideEffectTransactionOnce({
    effectKey: `${effectKeyPrefix}:${combatId}:${playerId}:${monsterId}`,
    combatId,
    effectType,
    playerId,
    task: (tx) => advanceKillQuestProgressTx(tx, playerId, monsterId),
  });
}

export async function runCombatTalkQuestProgressIntent(params: {
  combatId: string;
  playerId: string;
  npcId: string;
  effectType?: string;
  effectKeyPrefix?: string;
}) {
  const combatId = String(params.combatId || "").trim();
  const playerId = String(params.playerId || "").trim();
  const npcId = String(params.npcId || "").trim();
  if (!combatId || !playerId || !npcId) {
    return { executed: false, replayed: true };
  }

  const effectType = params.effectType || "combat_talk_quest";
  const effectKeyPrefix = params.effectKeyPrefix || effectType;
  return await runCombatSideEffectTransactionOnce({
    effectKey: `${effectKeyPrefix}:${combatId}:${playerId}:${npcId}`,
    combatId,
    effectType,
    playerId,
    task: (tx) => advanceTalkQuestProgressTx(tx, playerId, npcId),
  });
}

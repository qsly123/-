import {
  battleRuntimeRulesetSupportsCommand,
  getBattleRuntimeRuleset,
} from "@immortality/game-rules";
import type { BattleCommandType, BattleMode, BattleRuleset } from "@/types/game";

export function getBattleRuleset(mode: BattleMode): BattleRuleset {
  return getBattleRuntimeRuleset(mode) as BattleRuleset;
}

export function battleRulesetSupportsCommand(mode: BattleMode, commandType: BattleCommandType) {
  return battleRuntimeRulesetSupportsCommand(mode, commandType);
}

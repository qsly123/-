import {
  buildCombatDamageCalculator,
  DEFAULT_COMBAT_DAMAGE_FORMULA,
  normalizeCombatDamageFormula,
  type DamageCalculator,
  type DamageFormulaVariables,
} from "@immortality/game-rules";

export type { DamageCalculator, DamageFormulaVariables };
export { DEFAULT_COMBAT_DAMAGE_FORMULA };

export const COMBAT_DAMAGE_FORMULA_KEY = "COMBAT_DAMAGE_FORMULA";

const FORMULA_CACHE_TTL_MS = 30 * 1000;

let damageCalculatorCache: {
  expiresAt: number;
  calculator: DamageCalculator;
} | null = null;

const errorLogKeySet = new Set<string>();

function logErrorOnce(key: string, message: string, error?: unknown) {
  if (errorLogKeySet.has(key)) {
    return;
  }
  errorLogKeySet.add(key);
  if (error !== undefined) {
    console.error(message, error);
    return;
  }
  console.error(message);
}

function buildLoggedDamageCalculator(formula: string) {
  return buildCombatDamageCalculator(formula, {
    onCompileError: (failedFormula, error) => {
      logErrorOnce(
        `compile:${failedFormula}`,
        `[combat] 伤害公式编译失败，已回退默认公式: ${failedFormula}`,
        error,
      );
    },
    onRuntimeError: (failedFormula, error) => {
      logErrorOnce(
        `runtime:${failedFormula}`,
        `[combat] 伤害公式执行失败，已回退默认公式: ${failedFormula}`,
        error,
      );
    },
  });
}

export async function getCombatDamageCalculator(): Promise<DamageCalculator> {
  const now = Date.now();
  if (damageCalculatorCache && damageCalculatorCache.expiresAt > now) {
    return damageCalculatorCache.calculator;
  }

  let formula = DEFAULT_COMBAT_DAMAGE_FORMULA;
  if (process.env.DATABASE_URL) {
    try {
      const { getSystemConfigValue } = await import("@/modules/system/services/system-config");
      const configValue = await getSystemConfigValue(COMBAT_DAMAGE_FORMULA_KEY);
      formula = normalizeCombatDamageFormula(configValue);
    } catch (error) {
      logErrorOnce("load-config", "[combat] 读取伤害公式配置失败，已回退默认公式", error);
    }
  }

  const calculator = buildLoggedDamageCalculator(formula);
  damageCalculatorCache = {
    calculator,
    expiresAt: now + FORMULA_CACHE_TTL_MS,
  };
  return calculator;
}

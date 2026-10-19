import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getActiveFortunes } from "@/modules/character/services/fortune-service";
import { normalizeFortuneRateValue } from "@/modules/shared/services/fortune-effect";
import type { AttributeDelta } from "@/types/game";

const ZERO_ATTR: Required<AttributeDelta> = {
  hp: 0,
  maxHp: 0,
  mp: 0,
  maxMp: 0,
  attack: 0,
  defense: 0,
  speed: 0,
  luck: 0,
  spiritualSense: 0,
  armorPenetration: 0,
  block: 0,
  skillDamageBonus: 0,
  skillDamageReduction: 0,
  artifactDamageBonus: 0,
  artifactDamageReduction: 0,
};

type NumericSpecialEffects = {
  combatXpRate: number;
  adventureXpRate: number;
  questXpRate: number;
  pillXpRate: number;
  doubleCultivationXpRate: number;
  breakthroughSuccessRate: number;
  dongfuLingqiRate: number;
};

const ZERO_SPECIAL: NumericSpecialEffects = {
  combatXpRate: 0,
  adventureXpRate: 0,
  questXpRate: 0,
  pillXpRate: 0,
  doubleCultivationXpRate: 0,
  breakthroughSuccessRate: 0,
  dongfuLingqiRate: 0,
};

function toNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toInt(value: unknown) {
  return Math.floor(toNumber(value));
}

function parseExpiresAt(expiresAt: string | null) {
  if (!expiresAt) {
    return null;
  }
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return ms;
}

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const list = await getActiveFortunes({ playerId: player.id, includeHidden: false });
    const nowMs = Date.now();

    const summary = {
      attrEffects: { ...ZERO_ATTR },
      specialEffects: { ...ZERO_SPECIAL },
    };

    const normalized = list.map((fortune) => {
      const attr = fortune.attrEffects || {};
      const special = fortune.specialEffects || {};
      const normalizedSpecial: NumericSpecialEffects = {
        combatXpRate: normalizeFortuneRateValue(special.combatXpRate),
        adventureXpRate: normalizeFortuneRateValue(special.adventureXpRate),
        questXpRate: normalizeFortuneRateValue(special.questXpRate),
        pillXpRate: normalizeFortuneRateValue(special.pillXpRate),
        doubleCultivationXpRate: normalizeFortuneRateValue(special.doubleCultivationXpRate),
        breakthroughSuccessRate: normalizeFortuneRateValue(special.breakthroughSuccessRate),
        dongfuLingqiRate: normalizeFortuneRateValue(special.dongfuLingqiRate),
      };
      if (fortune.enabled) {
        summary.attrEffects.hp += toInt(attr.hp);
        summary.attrEffects.maxHp += toInt(attr.maxHp);
        summary.attrEffects.mp += toInt(attr.mp);
        summary.attrEffects.maxMp += toInt(attr.maxMp);
        summary.attrEffects.attack += toInt(attr.attack);
        summary.attrEffects.defense += toInt(attr.defense);
        summary.attrEffects.speed += toInt(attr.speed);
        summary.attrEffects.luck += toInt(attr.luck);
        summary.attrEffects.spiritualSense += toInt(attr.spiritualSense);
        summary.attrEffects.armorPenetration += toInt(attr.armorPenetration);
        summary.attrEffects.block += toInt(attr.block);
        summary.attrEffects.skillDamageBonus += toInt(attr.skillDamageBonus);
        summary.attrEffects.skillDamageReduction += toInt(attr.skillDamageReduction);
        summary.attrEffects.artifactDamageBonus += toInt(attr.artifactDamageBonus);
        summary.attrEffects.artifactDamageReduction += toInt(attr.artifactDamageReduction);

        summary.specialEffects.combatXpRate += normalizedSpecial.combatXpRate;
        summary.specialEffects.adventureXpRate += normalizedSpecial.adventureXpRate;
        summary.specialEffects.questXpRate += normalizedSpecial.questXpRate;
        summary.specialEffects.pillXpRate += normalizedSpecial.pillXpRate;
        summary.specialEffects.doubleCultivationXpRate += normalizedSpecial.doubleCultivationXpRate;
        summary.specialEffects.breakthroughSuccessRate += normalizedSpecial.breakthroughSuccessRate;
        summary.specialEffects.dongfuLingqiRate += normalizedSpecial.dongfuLingqiRate;
      }

      const expiresMs = parseExpiresAt(fortune.expiresAt);
      const remainingSeconds = expiresMs === null ? null : Math.max(0, Math.floor((expiresMs - nowMs) / 1000));

      return {
        ...fortune,
        specialEffects: normalizedSpecial,
        remainingSeconds,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        fortunes: normalized,
        summary,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取气运信息失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

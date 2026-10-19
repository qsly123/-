import {
  applyBreakthroughRewardToStats,
  formatBreakthroughRewardText,
  getBreakthroughRateByPosition,
  getBreakthroughXpByPosition,
  getNextRealmStage,
  getRealmFullNameByPosition,
  getRealmStageByMajorAndMinor,
  getRealmStatsByPosition,
  rollBreakthroughReward,
  toLinearRealm,
} from "@/modules/character/services/realm-service";
import {
  rollReversalOptions,
  type ReversalOption,
} from "@/modules/character/services/reversal-service";

interface AttemptBreakthroughInput {
  /** 传入玩家 id 后，突破成功会一并掷出「逆天改命」的三选一候选。 */
  playerId?: string;
  /** 用于按性别过滤天机词条。 */
  gender?: string | null;
  currentMajor: number;
  currentMinor: number;
  currentXp: number;
  bonusRate?: number;
  currentStats: {
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    attack: number;
    defense: number;
    speed: number;
    luck: number;
    spiritualSense?: number;
    armorPenetration?: number;
    block?: number;
    skillDamageBonus?: number;
    skillDamageReduction?: number;
    artifactDamageBonus?: number;
    artifactDamageReduction?: number;
  };
}

interface AttemptBreakthroughResult {
  success: boolean;
  newMajor: number;
  newMinor: number;
  newRealm: number;
  newRealmName: string;
  newXp: number;
  message: string;
  rewards: Partial<Record<"hp" | "mp" | "attack" | "defense" | "speed" | "luck", number>>;
  /** 突破成功时的「逆天改命」候选；未传 playerId 时为空数组。 */
  reversalOptions?: ReversalOption[];
  newStats: {
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    attack: number;
    defense: number;
    speed: number;
    luck: number;
    spiritualSense: number;
    armorPenetration: number;
    block: number;
    skillDamageBonus: number;
    skillDamageReduction: number;
    artifactDamageBonus: number;
    artifactDamageReduction: number;
  };
}

function normalizeBreakthroughStats(input: AttemptBreakthroughInput["currentStats"]): AttemptBreakthroughResult["newStats"] {
  return {
    hp: input.hp,
    maxHp: input.maxHp,
    mp: input.mp,
    maxMp: input.maxMp,
    attack: input.attack,
    defense: input.defense,
    speed: input.speed,
    luck: input.luck,
    spiritualSense: input.spiritualSense ?? 0,
    armorPenetration: input.armorPenetration ?? 0,
    block: input.block ?? 0,
    skillDamageBonus: input.skillDamageBonus ?? 0,
    skillDamageReduction: input.skillDamageReduction ?? 0,
    artifactDamageBonus: input.artifactDamageBonus ?? 0,
    artifactDamageReduction: input.artifactDamageReduction ?? 0,
  };
}

export async function attemptBreakthrough(input: AttemptBreakthroughInput): Promise<AttemptBreakthroughResult> {
  const { currentMajor, currentMinor, currentXp, bonusRate = 0, currentStats } = input;
  const normalizedCurrentStats = normalizeBreakthroughStats(currentStats);

  const currentStage = await getRealmStageByMajorAndMinor(currentMajor, currentMinor);
  if (!currentStage) {
    return {
      success: false,
      newMajor: currentMajor,
      newMinor: currentMinor,
      newRealm: await toLinearRealm(currentMajor, currentMinor),
      newRealmName: await getRealmFullNameByPosition(currentMajor, currentMinor),
      newXp: currentXp,
      rewards: {},
      newStats: normalizedCurrentStats,
      message: "当前境界配置无效，请联系管理员。",
    };
  }

  const nextStage = await getNextRealmStage(currentMajor, currentMinor);
  if (!nextStage) {
    return {
      success: false,
      newMajor: currentMajor,
      newMinor: currentMinor,
      newRealm: await toLinearRealm(currentMajor, currentMinor),
      newRealmName: await getRealmFullNameByPosition(currentMajor, currentMinor),
      newXp: currentXp,
      rewards: {},
      newStats: normalizedCurrentStats,
      message: "你已达到境界巅峰，无法继续突破。",
    };
  }

  const requiredXp = await getBreakthroughXpByPosition(currentMajor, currentMinor);
  if (currentXp < requiredXp) {
    return {
      success: false,
      newMajor: currentMajor,
      newMinor: currentMinor,
      newRealm: await toLinearRealm(currentMajor, currentMinor),
      newRealmName: await getRealmFullNameByPosition(currentMajor, currentMinor),
      newXp: currentXp,
      rewards: {},
      newStats: normalizedCurrentStats,
      message: `修为不足，需要 ${requiredXp} 修为才能尝试突破。当前修为：${currentXp}`,
    };
  }

  const baseRate = await getBreakthroughRateByPosition(currentMajor, currentMinor);
  const finalRate = Math.min(0.95, baseRate + bonusRate);

  if (Math.random() < finalRate) {
    const rewards = rollBreakthroughReward(currentStage.stage.rewardRules);
    const nextMajor = nextStage.major.order;
    const nextMinor = nextStage.stage.minor;
    const newRealmName = await getRealmFullNameByPosition(nextMajor, nextMinor);
    const nextStats = await getRealmStatsByPosition(nextMajor, nextMinor);
    const maxHp = Math.max(nextStats.hp, currentStats.maxHp);
    const maxMp = Math.max(nextStats.mp, currentStats.maxMp);
    const baseAppliedStats: AttemptBreakthroughResult["newStats"] = {
      hp: maxHp,
      maxHp,
      mp: maxMp,
      maxMp,
      attack: Math.max(nextStats.atk, currentStats.attack),
      defense: Math.max(nextStats.def, currentStats.defense),
      speed: currentStats.speed,
      luck: currentStats.luck,
      spiritualSense: Math.max(nextStats.spiritualSense || 0, currentStats.spiritualSense ?? 0),
      armorPenetration: currentStats.armorPenetration ?? 0,
      block: currentStats.block ?? 0,
      skillDamageBonus: currentStats.skillDamageBonus ?? 0,
      skillDamageReduction: currentStats.skillDamageReduction ?? 0,
      artifactDamageBonus: currentStats.artifactDamageBonus ?? 0,
      artifactDamageReduction: currentStats.artifactDamageReduction ?? 0,
    };
    const rewardText = formatBreakthroughRewardText(rewards);
    const messageSuffix = rewardText ? ` 奖励：${rewardText}` : "";

    const newRealmLinear = await toLinearRealm(nextMajor, nextMinor);

    // 逆天改命：突破成功时掷三道天机词条，供玩家择一承接
    let reversalOptions: ReversalOption[] = [];
    if (input.playerId) {
      try {
        reversalOptions = await rollReversalOptions({
          playerId: input.playerId,
          gender: input.gender ?? null,
        });
      } catch (error) {
        console.error(
          "[cultivation] 逆天改命候选生成失败：",
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return {
      success: true,
      newMajor: nextMajor,
      newMinor: nextMinor,
      newRealm: newRealmLinear,
      newRealmName,
      newXp: Math.max(0, currentXp - requiredXp),
      rewards,
      newStats: applyBreakthroughRewardToStats(rewards, baseAppliedStats),
      reversalOptions,
      message: `突破成功！你已踏入 ${newRealmName}。${messageSuffix}`,
    };
  }

  const lossRate = Math.min(1, Math.max(0, currentStage.stage.failXpLossRate));
  const xpLoss = Math.floor(currentXp * lossRate);

  return {
    success: false,
    newMajor: currentMajor,
    newMinor: currentMinor,
    newRealm: await toLinearRealm(currentMajor, currentMinor),
    newRealmName: await getRealmFullNameByPosition(currentMajor, currentMinor),
    newXp: currentXp - xpLoss,
    rewards: {},
    newStats: normalizedCurrentStats,
    message: `突破失败！灵力反噬，失去 ${xpLoss} 修为，受到重创。`,
  };
}

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cdkCodes, cdkRedeemLogs } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { grantRewardToPlayer, hasRewardValue, normalizeCdkReward } from "@/modules/character/services/reward-service";

class RedeemError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function normalizeCode(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
}

function isAlreadyRedeemedError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("cdk_redeem_logs_cdk_id_player_id_unique")
    || error.message.toLowerCase().includes("duplicate key");
}

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const code = normalizeCode(body.code);
    if (!code) {
      return NextResponse.json({ success: false, error: "请输入CDK" }, { status: 400 });
    }

    const grantedReward = await db.transaction(async (tx) => {
      const cdk = await tx.select().from(cdkCodes).where(eq(cdkCodes.code, code)).get();
      if (!cdk) {
        throw new RedeemError("CDK不存在");
      }
      if (!cdk.enabled) {
        throw new RedeemError("CDK已停用");
      }
      if (cdk.expiresAt) {
        const expiresAtTs = Date.parse(cdk.expiresAt);
        if (Number.isNaN(expiresAtTs)) {
          throw new RedeemError("CDK过期时间配置无效");
        }
        if (expiresAtTs <= Date.now()) {
          throw new RedeemError("CDK已过期");
        }
      }
      if (cdk.usedCount >= cdk.maxUses) {
        throw new RedeemError("CDK已兑完");
      }

      const existed = await tx.select({ id: cdkRedeemLogs.id })
        .from(cdkRedeemLogs)
        .where(and(
          eq(cdkRedeemLogs.cdkId, cdk.id),
          eq(cdkRedeemLogs.playerId, player.id),
        ))
        .get();
      if (existed) {
        throw new RedeemError("你已兑换过该CDK");
      }

      const reward = normalizeCdkReward(cdk.reward);
      if (!hasRewardValue(reward)) {
        throw new RedeemError("CDK奖励配置无效");
      }

      const granted = await grantRewardToPlayer({
        tx,
        playerId: player.id,
        reward,
      });

      await tx.insert(cdkRedeemLogs).values({
        code,
        cdkId: cdk.id,
        playerId: player.id,
        rewardSnapshot: reward,
      }).run();

      await tx.update(cdkCodes).set({
        usedCount: cdk.usedCount + 1,
        updatedAt: new Date().toISOString(),
      }).where(eq(cdkCodes.id, cdk.id)).run();

      return granted;
    });

    return NextResponse.json({
      success: true,
      data: {
        reward: grantedReward,
      },
    });
  } catch (error) {
    if (error instanceof RedeemError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    if (isAlreadyRedeemedError(error)) {
      return NextResponse.json({ success: false, error: "你已兑换过该CDK" }, { status: 400 });
    }

    console.error("CDK redeem error:", error);
    return NextResponse.json({ success: false, error: "兑换失败" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import {
  avatarAssets,
  avatarFrameAssets,
  players,
  playerUnlockedAvatars,
  playerUnlockedAvatarFrames,
} from "@/db/schema";
import { cleanupExpiredTemporaryCosmetics } from "@/modules/character/services/temporary-cosmetic-service";

function normalizeOptionalId(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function isValidGender(gender: string | null | undefined) {
  return gender === "男" || gender === "女";
}

export async function GET() {
  try {
    await cleanupExpiredTemporaryCosmetics();
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const avatarRows = isValidGender(player.gender)
      ? await db.select({
        id: avatarAssets.id,
        name: avatarAssets.name,
        imageUrl: avatarAssets.imageUrl,
        gender: avatarAssets.gender,
        isPublic: avatarAssets.isPublic,
        sortOrder: avatarAssets.sortOrder,
      }).from(avatarAssets)
        .where(and(
          eq(avatarAssets.enabled, true),
          eq(avatarAssets.gender, player.gender),
        ))
        .orderBy(asc(avatarAssets.sortOrder), asc(avatarAssets.createdAt))
        .all()
      : [];

    const avatarFrameRows = await db.select({
      id: avatarFrameAssets.id,
      name: avatarFrameAssets.name,
      imageUrl: avatarFrameAssets.imageUrl,
      isPublic: avatarFrameAssets.isPublic,
      sortOrder: avatarFrameAssets.sortOrder,
    }).from(avatarFrameAssets)
      .where(eq(avatarFrameAssets.enabled, true))
      .orderBy(asc(avatarFrameAssets.sortOrder), asc(avatarFrameAssets.createdAt))
      .all();

    const unlockedAvatarRows = await db.select({
      avatarId: playerUnlockedAvatars.avatarId,
    }).from(playerUnlockedAvatars)
      .where(eq(playerUnlockedAvatars.playerId, player.id))
      .all();

    const unlockedAvatarFrameRows = await db.select({
      avatarFrameId: playerUnlockedAvatarFrames.avatarFrameId,
    }).from(playerUnlockedAvatarFrames)
      .where(eq(playerUnlockedAvatarFrames.playerId, player.id))
      .all();

    const unlockedAvatarIdSet = new Set(unlockedAvatarRows.map((row) => row.avatarId));
    const unlockedAvatarFrameIdSet = new Set(unlockedAvatarFrameRows.map((row) => row.avatarFrameId));

    const avatars = avatarRows.map((row) => {
      const isUnlocked = row.isPublic || unlockedAvatarIdSet.has(row.id);
      return {
        ...row,
        isUnlocked,
      };
    });

    const avatarFrames = avatarFrameRows.map((row) => {
      const isUnlocked = row.isPublic || unlockedAvatarFrameIdSet.has(row.id);
      return {
        ...row,
        isUnlocked,
      };
    });

    const selectedAvatarId = avatars.some((row) => row.id === player.avatarId && row.isUnlocked)
      ? player.avatarId
      : null;
    const selectedAvatarFrameId = avatarFrames.some((row) => row.id === player.avatarFrameId && row.isUnlocked)
      ? player.avatarFrameId
      : null;

    return NextResponse.json({
      success: true,
      data: {
        selectedAvatarId,
        selectedAvatarFrameId,
        avatars,
        avatarFrames,
      },
    });
  } catch (error) {
    console.error("Get cosmetics error:", error);
    return NextResponse.json({ success: false, error: "获取装扮信息失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await cleanupExpiredTemporaryCosmetics();
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json() as {
      avatarId?: unknown;
      avatarFrameId?: unknown;
    };

    const avatarId = normalizeOptionalId(body.avatarId);
    const avatarFrameId = normalizeOptionalId(body.avatarFrameId);

    if (avatarId === undefined && avatarFrameId === undefined) {
      return NextResponse.json({ success: false, error: "缺少要更新的装扮字段" }, { status: 400 });
    }

    const updates: Partial<typeof players.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };

    if (avatarId !== undefined) {
      if (avatarId === null) {
        updates.avatarId = null;
      } else {
        if (!isValidGender(player.gender)) {
          return NextResponse.json({ success: false, error: "当前角色性别异常，无法设置头像" }, { status: 400 });
        }

        const avatar = await db.select({
          id: avatarAssets.id,
          gender: avatarAssets.gender,
          isPublic: avatarAssets.isPublic,
        }).from(avatarAssets)
          .where(and(
            eq(avatarAssets.id, avatarId),
            eq(avatarAssets.enabled, true),
          ))
          .get();
        if (!avatar) {
          return NextResponse.json({ success: false, error: "头像不存在或已禁用" }, { status: 400 });
        }
        if (avatar.gender !== player.gender) {
          return NextResponse.json({ success: false, error: "该头像与角色性别不匹配" }, { status: 400 });
        }

        if (!avatar.isPublic) {
          const unlocked = await db.select({
            avatarId: playerUnlockedAvatars.avatarId,
          }).from(playerUnlockedAvatars)
            .where(and(
              eq(playerUnlockedAvatars.playerId, player.id),
              eq(playerUnlockedAvatars.avatarId, avatar.id),
            ))
            .get();
          if (!unlocked) {
            return NextResponse.json({ success: false, error: "该头像尚未激活" }, { status: 400 });
          }
        }

        updates.avatarId = avatar.id;
      }
    }

    if (avatarFrameId !== undefined) {
      if (avatarFrameId === null) {
        updates.avatarFrameId = null;
      } else {
        const avatarFrame = await db.select({
          id: avatarFrameAssets.id,
          isPublic: avatarFrameAssets.isPublic,
        }).from(avatarFrameAssets)
          .where(and(
            eq(avatarFrameAssets.id, avatarFrameId),
            eq(avatarFrameAssets.enabled, true),
          ))
          .get();
        if (!avatarFrame) {
          return NextResponse.json({ success: false, error: "头像框不存在或已禁用" }, { status: 400 });
        }

        if (!avatarFrame.isPublic) {
          const unlocked = await db.select({
            avatarFrameId: playerUnlockedAvatarFrames.avatarFrameId,
          }).from(playerUnlockedAvatarFrames)
            .where(and(
              eq(playerUnlockedAvatarFrames.playerId, player.id),
              eq(playerUnlockedAvatarFrames.avatarFrameId, avatarFrame.id),
            ))
            .get();
          if (!unlocked) {
            return NextResponse.json({ success: false, error: "该头像框尚未激活" }, { status: 400 });
          }
        }

        updates.avatarFrameId = avatarFrame.id;
      }
    }

    await db.update(players).set(updates).where(eq(players.id, player.id)).run();

    return NextResponse.json({
      success: true,
      data: {
        avatarId: updates.avatarId === undefined ? player.avatarId : updates.avatarId,
        avatarFrameId: updates.avatarFrameId === undefined ? player.avatarFrameId : updates.avatarFrameId,
      },
    });
  } catch (error) {
    console.error("Update cosmetics error:", error);
    return NextResponse.json({ success: false, error: "保存装扮失败" }, { status: 500 });
  }
}

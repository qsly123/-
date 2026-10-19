import { NextResponse } from "next/server";
import { getCurrentAccount, setActivePlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { players, playerInventory, playerSkills, skills, items, maps, avatarAssets } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getInitialRealmStage, getRealmDisplayName, toLinearRealm } from "@/modules/character/services/realm-service";
import { getCurrentMainQuestIdForPlayer } from "@/modules/quest/services/quest-service";
import { getGameStartConfig } from "@/modules/character/services/game-start-config";
import { nanoid } from "nanoid";
import { publishSystemAnnouncement } from "@/modules/chat/services/chat-service";
import { buildInitialPlayerBaseStats } from "@/modules/character/services/player-initial-stats";
import {
  consumeCharacterPreviewSession,
  getCharacterPreviewSession,
} from "@/modules/character/services/character-create-preview";
import { grantFortunesToPlayer } from "@/modules/character/services/fortune-service";
import { getStaminaSettings } from "@/modules/character/services/stamina-service";
import { getGameMaintenanceStatus } from "@/modules/system/services/game-maintenance";
import { insertPlayerCompat } from "@/modules/character/services/pill-toxicity-schema-compat";

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeIdList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeOptionalId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function isValidGender(gender: string) {
  return gender === "男" || gender === "女";
}

export async function POST(request: Request) {
  try {
    const account = await getCurrentAccount();
    if (!account) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const maintenanceStatus = await getGameMaintenanceStatus();
    if (maintenanceStatus.enabled) {
      return NextResponse.json({
        success: false,
        error: maintenanceStatus.message,
        maintenance: true,
      }, { status: 503 });
    }

    const body = await request.json() as {
      name?: unknown;
      gender?: unknown;
      previewToken?: unknown;
      selectedStarterFortuneIds?: unknown;
      avatarId?: unknown;
    };

    const name = normalizeText(body.name);
    const gender = normalizeText(body.gender);
    const previewToken = normalizeText(body.previewToken);
    const selectedStarterFortuneIds = normalizeIdList(body.selectedStarterFortuneIds);
    const avatarId = normalizeOptionalId(body.avatarId);

    if (!name || !gender || !previewToken) {
      return NextResponse.json({ success: false, error: "请填写完整信息" }, { status: 400 });
    }
    if (name.length < 1 || name.length > 12) {
      return NextResponse.json({ success: false, error: "角色名需为 1-12 个字" }, { status: 400 });
    }
    if (!isValidGender(gender)) {
      return NextResponse.json({ success: false, error: "性别仅支持男/女" }, { status: 400 });
    }

    const previewSession = getCharacterPreviewSession({
      token: previewToken,
      accountId: account.id,
    });
    if (!previewSession) {
      return NextResponse.json({ success: false, error: "开局预览已失效，请重新觉醒灵根" }, { status: 400 });
    }
    if (previewSession.gender !== gender) {
      return NextResponse.json({ success: false, error: "性别与开局预览不一致，请重新觉醒灵根" }, { status: 400 });
    }

    let validatedAvatarId: string | null = null;
    if (avatarId) {
      const avatar = await db.select({
        id: avatarAssets.id,
        gender: avatarAssets.gender,
      }).from(avatarAssets)
        .where(and(
          eq(avatarAssets.id, avatarId),
          eq(avatarAssets.enabled, true),
          eq(avatarAssets.isPublic, true),
        ))
        .get();
      if (!avatar) {
        return NextResponse.json({ success: false, error: "头像不存在或不可用" }, { status: 400 });
      }
      if (avatar.gender !== gender) {
        return NextResponse.json({ success: false, error: "该头像与角色性别不匹配" }, { status: 400 });
      }
      validatedAvatarId = avatar.id;
    }

    const availableStarterIds = new Set(previewSession.starterOptions.map((item) => item.id));
    const requiredSelectCount = Math.min(3, previewSession.starterOptions.length);
    if (selectedStarterFortuneIds.length !== requiredSelectCount) {
      return NextResponse.json({
        success: false,
        error: `请选择 ${requiredSelectCount} 个开局气运`,
      }, { status: 400 });
    }
    if (selectedStarterFortuneIds.some((id) => !availableStarterIds.has(id))) {
      return NextResponse.json({ success: false, error: "所选气运不在候选列表中" }, { status: 400 });
    }

    const duplicated = await db.select({ id: players.id }).from(players).where(eq(players.name, name)).get();
    if (duplicated) {
      return NextResponse.json({ success: false, error: "该角色名已被占用，请更换名字后重试" }, { status: 400 });
    }

    const consumedPreviewSession = consumeCharacterPreviewSession({
      token: previewToken,
      accountId: account.id,
    });
    if (!consumedPreviewSession) {
      return NextResponse.json({ success: false, error: "开局预览已失效，请重新觉醒灵根" }, { status: 400 });
    }

    const initialStage = await getInitialRealmStage();
    if (!initialStage) {
      return NextResponse.json({ success: false, error: "境界配置缺失，请联系管理员" }, { status: 500 });
    }
    const gameStart = await getGameStartConfig();

    const spiritualRoot = consumedPreviewSession.spiritualRoot;
    // 灵根不再在基础属性里一次性折算，改由统一修饰层常驻生效（避免与修饰层重复加成）。
    const initialStats = await buildInitialPlayerBaseStats();
    const staminaSettings = await getStaminaSettings();

    const startMap = await db.select({ id: maps.id }).from(maps)
      .where(eq(maps.id, gameStart.mapId)).get();

    const playerId = nanoid(16);
    let initialSkillId = gameStart.baseSkillId;
    let fallbackSkillExists = false;

    await db.transaction(async (tx) => {
      const nowIso = new Date().toISOString();
      await insertPlayerCompat({
        id: playerId,
        accountId: account.id,
        name,
        gender,
        avatarId: validatedAvatarId,
        spiritualRoot,
        realm: await toLinearRealm(initialStage.major.order, initialStage.stage.minor),
        realmMajor: initialStage.major.order,
        realmMinor: initialStage.stage.minor,
        realmName: getRealmDisplayName(initialStage.major.name, initialStage.stage.name, initialStage.stage.minor),
        cultivationXp: 0,
        pillToxicity: 0,
        pillToxicityUpdatedAt: nowIso,
        dongfuLastClaimAt: nowIso,
        hp: initialStats.hp,
        maxHp: initialStats.maxHp,
        mp: initialStats.mp,
        maxMp: initialStats.maxMp,
        attack: initialStats.attack,
        defense: initialStats.defense,
        speed: initialStats.speed,
        luck: initialStats.luck,
        spiritualSense: initialStats.spiritualSense,
        armorPenetration: initialStats.armorPenetration,
        block: initialStats.block,
        skillDamageBonus: initialStats.skillDamageBonus,
        skillDamageReduction: initialStats.skillDamageReduction,
        artifactDamageBonus: initialStats.artifactDamageBonus,
        artifactDamageReduction: initialStats.artifactDamageReduction,
        breakthroughBonusRate: 0,
        gold: 100,
        lingYu: 0,
        stamina: staminaSettings.max,
        staminaUpdatedAt: nowIso,
        currentMapId: startMap ? gameStart.mapId : null,
        positionX: startMap ? gameStart.positionX : 0,
        positionY: startMap ? gameStart.positionY : 0,
        isAlive: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      }, tx);

      const configuredSkill = await tx.select({ id: skills.id }).from(skills)
        .where(eq(skills.id, initialSkillId)).get();
      if (!configuredSkill) {
        initialSkillId = "skill_basic_attack";
      }

      const fallbackSkill = await tx.select({ id: skills.id }).from(skills)
        .where(eq(skills.id, initialSkillId)).get();

      if (fallbackSkill) {
        fallbackSkillExists = true;
        await tx.insert(playerSkills).values({
          playerId,
          skillId: initialSkillId,
          level: 1,
        }).run();
      }

      for (const item of gameStart.initialInventory) {
        const itemExists = await tx.select({ id: items.id }).from(items)
          .where(eq(items.id, item.itemId)).get();
        if (itemExists) {
          await tx.insert(playerInventory).values({
            playerId,
            itemId: item.itemId,
            quantity: item.quantity,
            equipped: Boolean(item.equipped),
          }).run();
        }
      }

      if (selectedStarterFortuneIds.length > 0) {
        await grantFortunesToPlayer({
          playerId,
          fortuneIds: selectedStarterFortuneIds,
          sourceType: "starter",
          sourceRef: previewToken,
          tx,
        });
      }
    });

    await getCurrentMainQuestIdForPlayer(playerId);
    await setActivePlayer(playerId);

    void publishSystemAnnouncement(`【新秀入世】${name} 踏入修行之路。`).catch((announcementError) => {
      console.error("New player announcement error:", announcementError);
    });

    return NextResponse.json({
      success: true,
      data: {
        name,
        gender,
        spiritualRoot,
        stats: {
          hp: initialStats.hp,
          mp: initialStats.mp,
          attack: initialStats.attack,
          defense: initialStats.defense,
          speed: initialStats.speed,
          luck: initialStats.luck,
        },
        skills: fallbackSkillExists ? [initialSkillId] : [],
        selectedStarterFortuneIds,
      },
    });
  } catch (e) {
    console.error("Character creation error:", e);
    return NextResponse.json({ success: false, error: "创建角色失败" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { playerCombatSettings } from "@/db/schema";
import {
  getPlayerSkillLoadout,
} from "@/modules/character/services/player-active-skills";
import { MAX_EQUIPPED_SHENTONG_SKILLS } from "@/modules/shared/constants";
import { resolveSkillEffectsPayload } from "@/modules/shared/services/skill-visual-effect";

function normalizeRotation(raw: unknown) {
  if (!Array.isArray(raw)) {
    return { ok: false as const, value: [] as string[] };
  }

  const deduped = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") {
      return { ok: false as const, value: [] as string[] };
    }
    const trimmed = item.trim();
    if (!trimmed) {
      return { ok: false as const, value: [] as string[] };
    }
    deduped.add(trimmed);
  }

  return { ok: true as const, value: Array.from(deduped) };
}

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const loadout = await getPlayerSkillLoadout({
      playerId: player.id,
      realm: player.realm,
    });
    const learnedSkills = loadout.learnedSkills.map((skill) => {
      const resolved = resolveSkillEffectsPayload(skill.effects, skill);
      return {
        ...skill,
        effects: resolved.effects,
        visualEffect: resolved.visualEffect,
      };
    });
    const artifactSkills = loadout.artifactSkills.map((skill) => {
      const resolved = resolveSkillEffectsPayload(skill.effects, skill);
      return {
        ...skill,
        effects: resolved.effects,
        visualEffect: resolved.visualEffect,
      };
    });

    const skillList = loadout.activeSkills.map((skill) => {
      const resolved = resolveSkillEffectsPayload(skill.effects, skill);
      return {
        ...skill,
        effects: resolved.effects,
        visualEffect: resolved.visualEffect,
      };
    });

    const combatSetting = await db.select({
      updatedAt: playerCombatSettings.updatedAt,
    }).from(playerCombatSettings)
      .where(eq(playerCombatSettings.playerId, player.id))
      .get();

    return NextResponse.json({
      success: true,
      data: {
        learnedSkills,
        artifactSkills,
        skills: skillList,
        equippedSkillIds: loadout.equippedLearnedSkills.map((skill) => skill.id),
        skillRotation: loadout.skillRotation,
        skillRotationUpdatedAt: combatSetting?.updatedAt || null,
      },
    });
  } catch (error) {
    console.error("Skills error:", error);
    return NextResponse.json({ success: false, error: "获取神通失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json() as { skillRotation?: unknown };
    const normalized = normalizeRotation(body.skillRotation);
    if (!normalized.ok) {
      return NextResponse.json({ success: false, error: "skillRotation 非法" }, { status: 400 });
    }

    const loadout = await getPlayerSkillLoadout({
      playerId: player.id,
      realm: player.realm,
    });
    const learnedSkillSet = new Set(loadout.learnedSkills.map((skill) => skill.id));
    const artifactSkillSet = new Set(loadout.artifactSkills.map((skill) => skill.id));
    const hasUnavailableSkill = normalized.value.some((sid) => !learnedSkillSet.has(sid) && !artifactSkillSet.has(sid));
    if (hasUnavailableSkill) {
      return NextResponse.json({ success: false, error: "skillRotation 包含当前不可用技能" }, { status: 400 });
    }

    const equippedLearnedIds = normalized.value.filter((skillId) => learnedSkillSet.has(skillId));
    if (equippedLearnedIds.length > MAX_EQUIPPED_SHENTONG_SKILLS) {
      return NextResponse.json({ success: false, error: `最多只能携带 ${MAX_EQUIPPED_SHENTONG_SKILLS} 个神通` }, { status: 400 });
    }

    const nextSkillRotation = [...normalized.value];
    for (const artifactSkill of loadout.artifactSkills) {
      if (!nextSkillRotation.includes(artifactSkill.id)) {
        nextSkillRotation.push(artifactSkill.id);
      }
    }

    const now = new Date().toISOString();
    await db.insert(playerCombatSettings).values({
      playerId: player.id,
      skillRotation: nextSkillRotation,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: playerCombatSettings.playerId,
      set: {
        skillRotation: nextSkillRotation,
        updatedAt: now,
      },
    }).run();

    return NextResponse.json({
      success: true,
      data: {
        equippedSkillIds: equippedLearnedIds,
        skillRotation: nextSkillRotation,
        skillRotationUpdatedAt: now,
      },
    });
  } catch (error) {
    console.error("Save skills config error:", error);
    return NextResponse.json({ success: false, error: "保存神通配置失败" }, { status: 500 });
  }
}

import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { items, playerCombatSettings, playerInventory, playerSkills, skills } from "@/db/schema";
import type { ItemEffect } from "@/types/game";
import {
  ARTIFACT_EQUIP_SLOTS,
  MAX_EQUIPPED_SHENTONG_SKILLS,
  isArtifactEquipSlot,
  type ArtifactEquipSlot,
} from "@/modules/shared/constants";
import { getRealmFullNameByLinearRealm } from "@/modules/character/services/realm-service";

export type ActiveSkillEntry = typeof skills.$inferSelect & {
  level: number;
  sourceType: "learned" | "artifact";
  sourceItemId: string | null;
  sourceItemName: string | null;
  sourceSlot: ArtifactEquipSlot | null;
  minRealmName: string | null;
  maxRealmName: string | null;
};

export type PlayerSkillLoadout = {
  learnedSkills: ActiveSkillEntry[];
  equippedLearnedSkills: ActiveSkillEntry[];
  artifactSkills: ActiveSkillEntry[];
  activeSkills: ActiveSkillEntry[];
  skillRotation: string[];
  hasStoredSkillRotation: boolean;
};

interface GetPlayerActiveSkillEntriesArgs {
  playerId: string;
  realm: number;
}

const ARTIFACT_SLOT_ORDER = new Map<string, number>(
  ARTIFACT_EQUIP_SLOTS.map((slot, index) => [slot, index]),
);

function normalizeStoredSkillRotation(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [];
  }

  const deduped = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }

    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    deduped.add(trimmed);
  }

  return Array.from(deduped);
}

async function withRealmNames(entries: ActiveSkillEntry[]) {
  return await Promise.all(entries.map(async (entry) => ({
    ...entry,
    minRealmName: entry.minRealm === null ? null : await getRealmFullNameByLinearRealm(entry.minRealm),
    maxRealmName: entry.maxRealm === null ? null : await getRealmFullNameByLinearRealm(entry.maxRealm),
  })));
}

async function loadLearnedSkillEntries({
  playerId,
  realm,
}: GetPlayerActiveSkillEntriesArgs): Promise<ActiveSkillEntry[]> {
  const learnedRows = await db.select({
    level: playerSkills.level,
    skill: skills,
  }).from(playerSkills)
    .innerJoin(skills, eq(playerSkills.skillId, skills.id))
    .where(and(
      eq(playerSkills.playerId, playerId),
      or(isNull(skills.minRealm), lte(skills.minRealm, realm)),
      or(isNull(skills.maxRealm), gte(skills.maxRealm, realm)),
    ))
    .orderBy(asc(skills.createdAt), asc(skills.id))
    .all();

  return await withRealmNames(learnedRows.map((row) => ({
    ...row.skill,
    level: row.level,
    sourceType: "learned",
    sourceItemId: null,
    sourceItemName: null,
    sourceSlot: null,
    minRealmName: null,
    maxRealmName: null,
  })));
}

async function loadArtifactSkillEntries({
  playerId,
  realm,
}: GetPlayerActiveSkillEntriesArgs): Promise<ActiveSkillEntry[]> {
  const artifactRows = await db.select({
    itemId: items.id,
    itemName: items.name,
    effects: items.effects,
    equipSlot: playerInventory.equipSlot,
    affixes: playerInventory.affixes,
  }).from(playerInventory)
    .innerJoin(items, eq(playerInventory.itemId, items.id))
    .where(and(
      eq(playerInventory.playerId, playerId),
      eq(playerInventory.equipped, true),
      // 原本只取法宝；技能类词条会出现在任意部位的极品以上装备上，故放开部位限制
      or(isNull(items.minRealm), lte(items.minRealm, realm)),
      or(isNull(items.maxRealm), gte(items.maxRealm, realm)),
    ))
    .all();

  const artifactSkillSourceMap = new Map<string, {
    itemId: string;
    itemName: string;
    sourceSlot: ArtifactEquipSlot | null;
  }>();

  for (const row of artifactRows) {
    const effects = Array.isArray(row.effects) ? row.effects as ItemEffect[] : [];
    const sourceSlot = typeof row.equipSlot === "string" && isArtifactEquipSlot(row.equipSlot)
      ? row.equipSlot
      : null;

    for (const effect of effects) {
      if (effect.type !== "bind_skill" || typeof effect.skillId !== "string") {
        continue;
      }

      const skillId = effect.skillId.trim();
      if (!skillId || artifactSkillSourceMap.has(skillId)) {
        continue;
      }

      artifactSkillSourceMap.set(skillId, {
        itemId: row.itemId,
        itemName: row.itemName,
        sourceSlot,
      });
    }

    // 技能类词条：极品及以上装备才会掷出，词条绑定的技能同样进场可用
    const affixes = Array.isArray(row.affixes)
      ? row.affixes as Array<{ kind?: string; skillId?: string; label?: string }>
      : [];
    for (const affix of affixes) {
      if (affix?.kind !== "skill" || typeof affix.skillId !== "string") {
        continue;
      }
      const skillId = affix.skillId.trim();
      if (!skillId || artifactSkillSourceMap.has(skillId)) {
        continue;
      }
      artifactSkillSourceMap.set(skillId, {
        itemId: row.itemId,
        itemName: `${row.itemName}·${affix.label || "器灵"}`,
        sourceSlot,
      });
    }
  }

  const artifactSkillIds = Array.from(artifactSkillSourceMap.keys());
  if (artifactSkillIds.length === 0) {
    return [];
  }

  const artifactSkillRows = await db.select().from(skills)
    .where(and(
      inArray(skills.id, artifactSkillIds),
      or(isNull(skills.minRealm), lte(skills.minRealm, realm)),
      or(isNull(skills.maxRealm), gte(skills.maxRealm, realm)),
    ))
    .all();

  const orderedArtifactEntries = artifactSkillRows
    .flatMap((skill): ActiveSkillEntry[] => {
      const source = artifactSkillSourceMap.get(skill.id);
      if (!source) {
        return [];
      }

      return [{
        ...skill,
        level: 1,
        sourceType: "artifact" as const,
        sourceItemId: source.itemId,
        sourceItemName: source.itemName,
        sourceSlot: source.sourceSlot,
        minRealmName: null,
        maxRealmName: null,
      }];
    })
    .sort((left, right) => {
      const leftOrder = left.sourceSlot ? (ARTIFACT_SLOT_ORDER.get(left.sourceSlot) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
      const rightOrder = right.sourceSlot ? (ARTIFACT_SLOT_ORDER.get(right.sourceSlot) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.id.localeCompare(right.id);
    });

  return await withRealmNames(orderedArtifactEntries);
}

export async function getPlayerSkillLoadout({
  playerId,
  realm,
}: GetPlayerActiveSkillEntriesArgs): Promise<PlayerSkillLoadout> {
  const [learnedSkills, artifactSkills, combatSetting] = await Promise.all([
    loadLearnedSkillEntries({ playerId, realm }),
    loadArtifactSkillEntries({ playerId, realm }),
    db.select({
      skillRotation: playerCombatSettings.skillRotation,
    }).from(playerCombatSettings)
      .where(eq(playerCombatSettings.playerId, playerId))
      .get(),
  ]);

  const learnedSkillMap = new Map(learnedSkills.map((skill) => [skill.id, skill]));
  const artifactSkillMap = new Map(artifactSkills.map((skill) => [skill.id, skill]));
  const hasStoredSkillRotation = Array.isArray(combatSetting?.skillRotation);
  const storedSkillRotation = normalizeStoredSkillRotation(combatSetting?.skillRotation);

  const equippedLearnedSkillIds: string[] = [];
  const activeSkillIds: string[] = [];

  if (hasStoredSkillRotation) {
    for (const skillId of storedSkillRotation) {
      if (learnedSkillMap.has(skillId)) {
        if (equippedLearnedSkillIds.length >= MAX_EQUIPPED_SHENTONG_SKILLS) {
          continue;
        }
        equippedLearnedSkillIds.push(skillId);
        activeSkillIds.push(skillId);
        continue;
      }

      if (artifactSkillMap.has(skillId)) {
        activeSkillIds.push(skillId);
      }
    }
  } else {
    const initialEquippedIds = learnedSkills
      .slice(0, MAX_EQUIPPED_SHENTONG_SKILLS)
      .map((skill) => skill.id);

    equippedLearnedSkillIds.push(...initialEquippedIds);
    activeSkillIds.push(...initialEquippedIds);
  }

  for (const artifactSkill of artifactSkills) {
    if (!activeSkillIds.includes(artifactSkill.id)) {
      activeSkillIds.push(artifactSkill.id);
    }
  }

  const equippedLearnedSkills = equippedLearnedSkillIds
    .map((skillId) => learnedSkillMap.get(skillId))
    .filter((skill): skill is ActiveSkillEntry => Boolean(skill));
  const activeSkills = activeSkillIds
    .map((skillId) => learnedSkillMap.get(skillId) || artifactSkillMap.get(skillId))
    .filter((skill): skill is ActiveSkillEntry => Boolean(skill));

  return {
    learnedSkills,
    equippedLearnedSkills,
    artifactSkills,
    activeSkills,
    skillRotation: activeSkills.map((skill) => skill.id),
    hasStoredSkillRotation,
  };
}

export async function getPlayerActiveSkillEntries(args: GetPlayerActiveSkillEntriesArgs): Promise<ActiveSkillEntry[]> {
  const loadout = await getPlayerSkillLoadout(args);
  return loadout.activeSkills;
}

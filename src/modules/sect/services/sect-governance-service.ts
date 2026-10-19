import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { players, sectMembers, sectRolePermissions, sects } from "@/db/schema";
import type { SectRoleKey } from "@/types/game";
import {
  SECT_DEFAULT_INACTIVE_TRANSFER_DAYS,
  SECT_GOVERNANCE_ROLE_ORDER,
  SECT_ROLE_PERMISSION_DEFAULTS,
} from "@/modules/sect/services/sect-constants";
import { getSystemConfigValue } from "@/modules/system/services/system-config";

function buildInactiveDeadline(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function getSectInactiveTransferDays() {
  const raw = await getSystemConfigValue("SECT_INACTIVE_TRANSFER_DAYS");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return SECT_DEFAULT_INACTIVE_TRANSFER_DAYS;
  }
  return Math.floor(parsed);
}

export async function ensureDefaultSectRolePermissions(sectId: string) {
  const existing = await db.select({
    roleKey: sectRolePermissions.roleKey,
    permissionKey: sectRolePermissions.permissionKey,
  }).from(sectRolePermissions)
    .where(eq(sectRolePermissions.sectId, sectId))
    .all();
  if (existing.length > 0) {
    return;
  }

  const nowIso = new Date().toISOString();
  const values = Object.entries(SECT_ROLE_PERMISSION_DEFAULTS).flatMap(([roleKey, permissionKeys]) => (
    permissionKeys.map((permissionKey) => ({
      sectId,
      roleKey: roleKey as SectRoleKey,
      permissionKey,
      enabled: true,
      updatedAt: nowIso,
    }))
  ));
  if (values.length === 0) {
    return;
  }
  await db.insert(sectRolePermissions).values(values).onConflictDoNothing().run();
}

export async function refreshSectGovernance(sectId: string) {
  const inactiveDays = await getSectInactiveTransferDays();
  const inactiveDeadline = buildInactiveDeadline(inactiveDays);
  const sect = await db.select({
    id: sects.id,
    state: sects.state,
    governorPlayerId: sects.governorPlayerId,
  }).from(sects).where(eq(sects.id, sectId)).get();
  if (!sect) {
    return null;
  }

  const members = await db.select({
    playerId: sectMembers.playerId,
    roleKey: sectMembers.roleKey,
    lastSeenAt: players.lastSeenAt,
  }).from(sectMembers)
    .innerJoin(players, eq(players.id, sectMembers.playerId))
    .where(and(
      eq(sectMembers.sectId, sectId),
      inArray(sectMembers.roleKey, SECT_GOVERNANCE_ROLE_ORDER),
    ))
    .all();

  let nextGovernorPlayerId: string | null = null;
  for (const roleKey of SECT_GOVERNANCE_ROLE_ORDER) {
    const activeMember = members.find((member) => member.roleKey === roleKey && String(member.lastSeenAt || "") >= inactiveDeadline);
    if (activeMember) {
      nextGovernorPlayerId = activeMember.playerId;
      break;
    }
  }

  const nowIso = new Date().toISOString();
  const nextState = nextGovernorPlayerId ? "active" : "abandoned_public";
  if (sect.governorPlayerId === nextGovernorPlayerId && sect.state === nextState) {
    return {
      governorPlayerId: nextGovernorPlayerId,
      state: nextState,
    };
  }

  await db.update(sects).set({
    governorPlayerId: nextGovernorPlayerId,
    state: nextState,
    governanceRefreshedAt: nowIso,
    updatedAt: nowIso,
  }).where(eq(sects.id, sectId)).run();

  return {
    governorPlayerId: nextGovernorPlayerId,
    state: nextState,
  };
}

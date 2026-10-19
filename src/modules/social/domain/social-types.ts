export const FRIENDSHIP_STATUS_LIST = ["pending", "accepted", "rejected", "canceled"] as const;
export type FriendshipStatus = (typeof FRIENDSHIP_STATUS_LIST)[number];

export const INTIMACY_RELATION_TYPE_LIST = ["dao_lv", "jie_yi", "shi_tu"] as const;
export type IntimacyRelationType = (typeof INTIMACY_RELATION_TYPE_LIST)[number];

export const INTIMACY_STATUS_LIST = ["pending", "accepted", "rejected", "canceled"] as const;
export type IntimacyStatus = (typeof INTIMACY_STATUS_LIST)[number];

export const DM_PERMISSION_LIST = ["all", "friends", "none"] as const;
export type DmPermission = (typeof DM_PERMISSION_LIST)[number];

export const DM_CONTENT_MAX_LENGTH = 200;
export const DM_RETENTION_DAYS = 90;

export function isIntimacyRelationType(value: string): value is IntimacyRelationType {
  return INTIMACY_RELATION_TYPE_LIST.includes(value as IntimacyRelationType);
}

export function isDmPermission(value: string): value is DmPermission {
  return DM_PERMISSION_LIST.includes(value as DmPermission);
}

export function normalizePairPlayerIds(playerId: string, targetPlayerId: string) {
  return playerId < targetPlayerId
    ? { playerAId: playerId, playerBId: targetPlayerId }
    : { playerAId: targetPlayerId, playerBId: playerId };
}

export function buildDmRetentionCutoff(days = DM_RETENTION_DAYS) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function normalizeDmContent(raw: unknown) {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.replace(/[\r\n]+/g, " ").trim().slice(0, DM_CONTENT_MAX_LENGTH);
}

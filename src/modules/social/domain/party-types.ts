import type { CombatState, CombatTurnState } from "@/types/game";

export type PartyInviteStatus = "pending" | "accepted" | "rejected" | "expired" | "canceled";
export type PartyGroupStatus = "active" | "disbanded";
export type PartyEncounterType = "normal" | "boss";
export type PartyEncounterStatus = "ongoing" | "resolved" | "abandoned";

export type PartyMemberView = {
  playerId: string;
  name: string;
  realmName: string;
  combatPower: number;
  maxHp: number;
  maxMp: number;
  currentMapId: string | null;
  positionX: number;
  positionY: number;
  avatarImageUrl?: string | null;
  avatarFrameImageUrl?: string | null;
  isLeader: boolean;
  joinedAt: string;
};

export type PartyInviteView = {
  id: string;
  inviterId: string;
  inviterName: string;
  targetPlayerId: string;
  targetPlayerName: string;
  expiresAt: string;
  createdAt: string;
  status: PartyInviteStatus;
  memberCount: number;
};

export type PartyView = {
  id: string;
  leaderPlayerId: string;
  createdAt: string;
  members: PartyMemberView[];
};

export type PartySnapshot = {
  party: PartyView | null;
  incomingInvites: PartyInviteView[];
  activeEncounter: PartyEncounterView | null;
};

export type PartyEncounterView = {
  id: string;
  partyId: string;
  encounterType: PartyEncounterType;
  monsterId: string;
  status: PartyEncounterStatus;
  routePath: string;
  state: CombatState | null;
  turnState: CombatTurnState | null;
  eligibleMemberIds: string[];
  sceneSnapshot?: Record<string, unknown> | null;
};

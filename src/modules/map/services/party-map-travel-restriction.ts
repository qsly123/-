export type PartyMapTravelMember = {
  id: string;
  name: string;
  realm: number;
  realmName: string | null;
};

function getMemberDisplayName(member: PartyMapTravelMember) {
  return String(member.name || "").trim() || "无名道友";
}

export function listPartyMembersBelowMapRealm(params: {
  members: PartyMapTravelMember[];
  minRealm: number;
}) {
  return params.members.filter((member) => member.realm < params.minRealm);
}

export function buildPartyMapTravelDisabledReason(params: {
  requiredRealmName: string;
  blockedMembers: PartyMapTravelMember[];
}) {
  if (!params.blockedMembers.length) {
    return null;
  }

  const previewNames = params.blockedMembers
    .slice(0, 2)
    .map(getMemberDisplayName);

  if (params.blockedMembers.length === 1) {
    return `队伍未全员达 ${params.requiredRealmName}（${previewNames[0]}）`;
  }

  if (params.blockedMembers.length === 2) {
    return `队伍未全员达 ${params.requiredRealmName}（${previewNames.join("、")}）`;
  }

  return `队伍未全员达 ${params.requiredRealmName}（${previewNames.join("、")}等${params.blockedMembers.length}人）`;
}

export function buildPartyMapTravelBlockedMessage(params: {
  targetMapName: string;
  requiredRealmName: string;
  blockedMembers: PartyMapTravelMember[];
}) {
  if (!params.blockedMembers.length) {
    return null;
  }

  const memberText = params.blockedMembers
    .map((member) => {
      const realmName = String(member.realmName || "").trim() || "未知境界";
      return `${getMemberDisplayName(member)}（${realmName}）`;
    })
    .join("、");

  return `队伍需全员达到 ${params.requiredRealmName} 及以上，${memberText} 尚未达标，整队无法进入 ${params.targetMapName}`;
}

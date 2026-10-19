import type { QuestRequirement } from "@/types/game";

export const QUEST_REALM_PROGRESS_KEY = "__quest_realm__";
export const QUEST_POWER_PROGRESS_KEY = "__quest_power__";

export function getQuestRequirementProgressKey(requirement: Pick<QuestRequirement, "type" | "targetId">) {
  if (requirement.type === "realm") {
    return QUEST_REALM_PROGRESS_KEY;
  }
  if (requirement.type === "power") {
    return QUEST_POWER_PROGRESS_KEY;
  }
  const targetId = typeof requirement.targetId === "string" ? requirement.targetId.trim() : "";
  return targetId || "__quest_unknown__";
}

export function getQuestRequirementActionText(type: QuestRequirement["type"]) {
  if (type === "talk") return "传话";
  if (type === "kill") return "击杀";
  if (type === "collect") return "收集";
  if (type === "realm") return "境界达到";
  return "战力达到";
}

export function getQuestRequirementTargetName(requirement: Pick<QuestRequirement, "type" | "targetId" | "targetName">) {
  const targetName = typeof requirement.targetName === "string" ? requirement.targetName.trim() : "";
  if (targetName) {
    return targetName;
  }
  if (requirement.type === "realm") {
    return "当前境界";
  }
  if (requirement.type === "power") {
    return "综合战力";
  }
  const targetId = typeof requirement.targetId === "string" ? requirement.targetId.trim() : "";
  return targetId || "目标";
}

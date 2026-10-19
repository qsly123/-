export interface BuiltinRandomEventActionDefinition {
  type: "battle" | "teleport" | "pregnancyAdvance" | "doubleCultivation";
  label: string;
}

export const BUILTIN_RANDOM_EVENT_ACTION_DEFINITIONS: BuiltinRandomEventActionDefinition[] = [
  {
    type: "battle",
    label: "战斗",
  },
  {
    type: "teleport",
    label: "传送",
  },
  {
    type: "pregnancyAdvance",
    label: "孕育推进",
  },
  {
    type: "doubleCultivation",
    label: "双修",
  },
];

export const BUILTIN_RANDOM_EVENT_ACTION_TYPE_SET = new Set<string>(
  BUILTIN_RANDOM_EVENT_ACTION_DEFINITIONS.map((item) => item.type),
);

export function isBuiltinRandomEventActionType(type: string) {
  return BUILTIN_RANDOM_EVENT_ACTION_TYPE_SET.has(String(type || "").trim());
}

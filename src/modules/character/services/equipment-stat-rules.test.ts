import { describe, expect, test } from "bun:test";
import { collectEquipmentAffixBonus, getEquipmentDisplayEffects, getEquipmentRefineBonus, scaleEquipmentEffects } from "@/modules/character/services/equipment-stat-rules";
import { applyModifiers } from "@/modules/character/services/framework/stat-modifiers";
import type { ItemEffect } from "@/types/game";

describe("装备数值契约", () => {
  test("阶段只放大固定属性，保留百分点、技能、恢复和零/负值语义", () => {
    const effects: ItemEffect[] = [
      { type: "boost_atk", value: 54 }, { type: "boost_skill_damage_bonus", value: 5 },
      { type: "boost_skill_damage_reduction", value: 3 }, { type: "boost_artifact_damage_bonus", value: 4 },
      { type: "boost_artifact_damage_reduction", value: 2 }, { type: "heal_hp", value: 40 },
      { type: "bind_skill", value: 0, skillId: "test" }, { type: "boost_speed", value: -2 },
      { type: "boost_luck", value: 0 },
    ];
    const result = scaleEquipmentEffects(effects, 257.55);
    expect(result.map((effect) => effect.value)).toEqual([13908, 5, 3, 4, 2, 40, 0, -515, 0]);
    expect(result[6].skillId).toBe("test");
    expect(effects[0].value).toBe(54);
    for (const invalid of [0, -1, NaN, Infinity, undefined]) {
      expect(scaleEquipmentEffects(effects, invalid)[0].value).toBe(54);
    }
  });

  test("精炼按实例取整后的固定属性增加50%，不强化增减伤", () => {
    const effects: ItemEffect[] = [{ type: "boost_atk", value: 54 }, { type: "boost_skill_damage_bonus", value: 5 }];
    expect(getEquipmentRefineBonus(effects, 257.55, 10)).toEqual({ attack: 6954 });
    expect(getEquipmentRefineBonus(effects, 257.55, 100)).toEqual({ attack: 6954 });
    expect(getEquipmentRefineBonus(effects, 257.55, -1)).toEqual({ attack: 0 });
    expect(getEquipmentDisplayEffects(effects, 257.55, 10).map((effect) => effect.value)).toEqual([20862, 5]);
  });

  test("存量与新增伤害词条收益一致，普通属性仍按百分比聚合", () => {
    for (const key of ["skillDamageBonus", "skillDamageReduction", "artifactDamageBonus", "artifactDamageReduction"]) {
      const legacy = collectEquipmentAffixBonus([{ key, percent: 0.02 }]);
      const current = collectEquipmentAffixBonus([{ kind: "stat", key, flat: 2 }]);
      expect(legacy).toEqual(current);
      expect(applyModifiers({}, { ...legacy, elementDamageBonus: 0 })[key as "skillDamageBonus"]).toBe(2);
    }
    const bonus = collectEquipmentAffixBonus([
      { key: "attack", percent: 0.1 }, { kind: "stat", key: "attack", flat: 10 },
      { kind: "rate", key: "attack", flat: 999 }, { key: "unknown", flat: 999 },
    ]);
    expect(applyModifiers({ attack: 100 }, { ...bonus, elementDamageBonus: 0 }).attack).toBe(121);
  });
});

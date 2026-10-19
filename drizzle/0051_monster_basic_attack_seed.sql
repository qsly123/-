INSERT INTO "skills" (
  "id",
  "name",
  "description",
  "skill_type",
  "damage_base",
  "damage_multiplier",
  "mp_cost",
  "cooldown",
  "effects",
  "target",
  "created_at"
)
VALUES (
  'skill_basic_attack',
  '基础攻击',
  '怪物与默认战斗 AI 使用的基础攻击，不消耗灵气。',
  'attack',
  0,
  1,
  0,
  1,
  '[]'::jsonb,
  'enemy',
  to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "skill_type" = EXCLUDED."skill_type",
  "damage_base" = EXCLUDED."damage_base",
  "damage_multiplier" = EXCLUDED."damage_multiplier",
  "mp_cost" = EXCLUDED."mp_cost",
  "cooldown" = EXCLUDED."cooldown",
  "effects" = EXCLUDED."effects",
  "target" = EXCLUDED."target";

UPDATE "skills"
SET "effects" = jsonb_build_object(
  'effects',
  CASE
    WHEN jsonb_typeof("effects") = 'object' AND jsonb_typeof("effects"->'effects') = 'array' THEN "effects"->'effects'
    WHEN jsonb_typeof("effects") = 'array' THEN "effects"
    ELSE '[]'::jsonb
  END,
  'visualEffect',
  '{
    "spriteUrl": "/uploads/cosmetics/skill-sprite/ai-candidates/all/30FPS_AC2Q001_Slash.png",
    "frameWidth": 192,
    "frameHeight": 192,
    "frameCount": 10,
    "frameDurationMs": 52,
    "scale": 0.76,
    "offsetX": 0,
    "offsetY": -8
  }'::jsonb
)
WHERE "id" = 'skill_basic_attack'
  AND coalesce("effects"->'visualEffect'->>'spriteUrl', '') = '';

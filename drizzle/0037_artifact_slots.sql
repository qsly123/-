ALTER TABLE "player_inventory"
ADD COLUMN IF NOT EXISTS "equip_slot" text;

UPDATE "player_inventory" AS pi
SET
  "equipped" = false,
  "equip_slot" = NULL
FROM "items" AS i
WHERE pi."item_id" = i."id"
  AND i."item_type" IN ('ring', 'necklace');

UPDATE "player_inventory" AS pi
SET "equip_slot" = NULL
FROM "items" AS i
WHERE pi."item_id" = i."id"
  AND i."item_type" <> 'artifact';

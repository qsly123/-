UPDATE "items"
SET "item_type" = 'shoes'
WHERE "id" = 'item_armor_cloudstep_boots';
--> statement-breakpoint
UPDATE "items"
SET "item_type" = CASE
  WHEN "item_type" = 'armor' AND (
    lower("id") LIKE '%boots%'
    OR lower("id") LIKE '%shoe%'
    OR lower("id") LIKE '%greaves%'
    OR coalesce("name", '') ~ '(履|靴|鞋)'
  ) THEN 'shoes'
  WHEN "item_type" = 'armor' AND (
    lower("id") LIKE '%helmet%'
    OR lower("id") LIKE '%helm%'
    OR lower("id") LIKE '%hat%'
    OR lower("id") LIKE '%crown%'
    OR coalesce("name", '') ~ '(盔|冠|帽)'
  ) THEN 'helmet'
  WHEN "item_type" = 'armor' AND (
    lower("id") LIKE '%ring%'
    OR coalesce("name", '') ~ '戒'
  ) THEN 'ring'
  WHEN "item_type" = 'armor' AND (
    lower("id") LIKE '%necklace%'
    OR lower("id") LIKE '%pendant%'
    OR lower("id") LIKE '%amulet%'
    OR lower("id") LIKE '%chain%'
    OR coalesce("name", '') ~ '(项链|挂坠|吊坠|项坠|链坠|坠)'
  ) THEN 'necklace'
  ELSE "item_type"
END
WHERE "item_type" = 'armor';

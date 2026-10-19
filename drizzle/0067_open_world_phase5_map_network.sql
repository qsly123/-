alter table "world_map_instances"
  add column if not exists "heat_tier" text not null default 'cold';

alter table "world_map_instances"
  add column if not exists "heat_score" integer not null default 0;

alter table "world_map_instances"
  add column if not exists "region_band" text not null default '凡尘城镇带';

alter table "world_map_instances"
  add column if not exists "danger_level" integer not null default 0;

alter table "world_map_instances"
  add column if not exists "mystery_level" integer not null default 0;

alter table "world_map_instances"
  add column if not exists "travel_connections_json" jsonb not null default '[]'::jsonb;

alter table "world_map_instances"
  add column if not exists "rumor_hooks_json" jsonb not null default '[]'::jsonb;

alter table "world_map_instances"
  add column if not exists "encounter_hooks_json" jsonb not null default '[]'::jsonb;

alter table "world_map_instances"
  add column if not exists "secret_realm_hooks_json" jsonb not null default '[]'::jsonb;

create index if not exists "world_map_instances_heat_tier_idx"
  on "world_map_instances" ("heat_tier");

create index if not exists "world_map_instances_region_band_idx"
  on "world_map_instances" ("region_band");

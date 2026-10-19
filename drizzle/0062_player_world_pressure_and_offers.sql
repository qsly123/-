create table if not exists "player_world_profiles" (
  "player_id" text primary key references "players"("id"),
  "notoriety_score" integer not null default 0,
  "bounty_heat" integer not null default 0,
  "shadow_favor" integer not null default 0,
  "lawful_pressure" integer not null default 0,
  "active_alert_tier" text not null default 'observe',
  "active_watcher_count" integer not null default 0,
  "last_decay_at" text not null default now()::text,
  "flags_json" jsonb not null default '{}'::jsonb,
  "created_at" text not null default now()::text,
  "updated_at" text not null default now()::text
);

create index if not exists "player_world_profiles_alert_idx"
  on "player_world_profiles" ("active_alert_tier");

create index if not exists "player_world_profiles_bounty_idx"
  on "player_world_profiles" ("bounty_heat");

create index if not exists "player_world_profiles_shadow_idx"
  on "player_world_profiles" ("shadow_favor");

create table if not exists "player_world_incidents" (
  "id" integer generated always as identity primary key,
  "player_id" text not null references "players"("id"),
  "incident_type" text not null,
  "source_type" text not null,
  "source_id" text,
  "map_id" text,
  "district_name" text,
  "severity" integer not null default 1,
  "summary" text not null,
  "payload_json" jsonb not null default '{}'::jsonb,
  "created_at" text not null default now()::text
);

create index if not exists "player_world_incidents_player_created_idx"
  on "player_world_incidents" ("player_id", "created_at");

create index if not exists "player_world_incidents_player_type_idx"
  on "player_world_incidents" ("player_id", "incident_type");

create index if not exists "player_world_incidents_map_idx"
  on "player_world_incidents" ("map_id");

create table if not exists "player_world_event_offers" (
  "id" text primary key,
  "player_id" text not null references "players"("id"),
  "offer_type" text not null,
  "source_faction" text,
  "source_npc_id" text references "world_npc_profiles"("id"),
  "status" text not null default 'pending',
  "summary" text not null,
  "payload_json" jsonb not null default '{}'::jsonb,
  "expires_at" text not null,
  "responded_at" text,
  "created_at" text not null default now()::text,
  "updated_at" text not null default now()::text
);

create index if not exists "player_world_event_offers_player_status_idx"
  on "player_world_event_offers" ("player_id", "status");

create index if not exists "player_world_event_offers_expires_idx"
  on "player_world_event_offers" ("expires_at");

create index if not exists "player_world_event_offers_type_idx"
  on "player_world_event_offers" ("offer_type");

alter table "player_world_event_offers"
  add column if not exists "responded_at" text;

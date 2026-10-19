alter table "sects"
  add column if not exists "empty_since_at" text;

create index if not exists "sects_empty_since_idx"
  on "sects" ("empty_since_at");

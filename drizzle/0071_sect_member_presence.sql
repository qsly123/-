-- 宗门成员 presence 字段：在线 / 驻地在场状态。
-- 实时房间是权威来源，这里只做断线兜底读，允许 best-effort 写入。

alter table "sect_members"
  add column if not exists "presence_state" text not null default 'offline';

alter table "sect_members"
  add column if not exists "presence_at_home" boolean not null default false;

alter table "sect_members"
  add column if not exists "presence_map_id" text;

alter table "sect_members"
  add column if not exists "presence_updated_at" text not null default now()::text;

create index if not exists "sect_members_sect_presence_idx"
  on "sect_members" ("sect_id", "presence_state");

create index if not exists "sect_members_sect_home_idx"
  on "sect_members" ("sect_id", "presence_at_home");

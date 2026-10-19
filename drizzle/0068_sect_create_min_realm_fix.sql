update "system_configs"
set
  "value" = '17',
  "description" = '创建宗门所需最低线性境界（默认 17，即结丹初期）',
  "updated_at" = now()::text
where "key" = 'SECT_CREATE_MIN_REALM'
  and trim(coalesce("value", '')) = '31';

update "system_configs"
set
  "description" = '创建宗门所需最低线性境界（默认 17，即结丹初期）',
  "updated_at" = now()::text
where "key" = 'SECT_CREATE_MIN_REALM'
  and (
    coalesce("description", '') like '%31%'
    or coalesce("description", '') like '%结丹一重%'
  );

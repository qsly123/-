-- 附近频道消息幂等键。
--
-- 背景：附近频道的持久化唯一入口是核心 API `POST /api/game/chat/nearby`；
-- `SocialRoom` 只做同图实时广播回声，不写库。同一条消息因此会同时出现在
-- 「SSE 持久化回灌」和「房间广播回声」两条链路上，需要幂等键让客户端只渲染一次。
--
-- 本文件为幂等迁移：重复执行不会产生重复列 / 重复索引 / 报错。

ALTER TABLE IF EXISTS "world_local_messages"
ADD COLUMN IF NOT EXISTS "dedupe_key" text;

-- NULL 不参与唯一冲突，旧数据与 NPC / 天道系统消息无需回填即可共存。
CREATE UNIQUE INDEX IF NOT EXISTS "world_local_messages_dedupe_key_unique_idx"
ON "world_local_messages" ("map_id", "dedupe_key");

CREATE INDEX IF NOT EXISTS "players_current_map_id_idx" ON "players" ("current_map_id");
CREATE INDEX IF NOT EXISTS "player_inventory_player_id_idx" ON "player_inventory" ("player_id");
CREATE INDEX IF NOT EXISTS "player_inventory_player_item_idx" ON "player_inventory" ("player_id", "item_id");
CREATE INDEX IF NOT EXISTS "player_inventory_player_equipped_idx" ON "player_inventory" ("player_id", "equipped");
CREATE INDEX IF NOT EXISTS "chat_messages_type_id_idx" ON "chat_messages" ("message_type", "id");

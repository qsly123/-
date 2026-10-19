ALTER TABLE "checkin_reward_rules" ADD COLUMN "fortune_extra_reward" jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE "realm_majors"
  ADD COLUMN IF NOT EXISTS "base_spiritual_sense" integer NOT NULL DEFAULT 0;

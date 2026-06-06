-- Relink BotConfig rows to the owning User before dropping legacy join columns.
UPDATE "BotConfig" AS bc
SET "userId" = u."id"
FROM "User" AS u
WHERE u."botConfigId" = bc."id";

-- Rename legacy Gemini columns if they still exist from older schemas.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'UserConfig' AND column_name = 'geminiApiKey'
  ) THEN
    ALTER TABLE "UserConfig" RENAME COLUMN "geminiApiKey" TO "aiApiKey";
  END IF;
END $$;

ALTER TABLE "User" DROP COLUMN IF EXISTS "botConfigId";
ALTER TABLE "User" DROP COLUMN IF EXISTS "userConfigsId";

CREATE UNIQUE INDEX IF NOT EXISTS "BotConfig_userId_key" ON "BotConfig"("userId");

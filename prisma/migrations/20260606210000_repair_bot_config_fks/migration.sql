-- BotConfig.userId was populated with stale UUIDs that no longer match User.id.
-- Remove orphaned rows and recreate defaults for users missing a config row.

DELETE FROM "BotConfig" AS bc
WHERE NOT EXISTS (
  SELECT 1
  FROM "User" AS u
  WHERE u."id" = bc."userId"
);

INSERT INTO "BotConfig" (
  "id",
  "userId",
  "maxOrderSizeUsdc",
  "maxExposureUsdc",
  "allowedSides",
  "minPrice",
  "maxPrice",
  "dryRun",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  u."id",
  100,
  500,
  ARRAY['BUY', 'SELL']::TEXT[],
  0.01,
  0.99,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" AS u
WHERE NOT EXISTS (
  SELECT 1
  FROM "BotConfig" AS bc
  WHERE bc."userId" = u."id"
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'BotConfig_userId_fkey'
  ) THEN
    ALTER TABLE "BotConfig"
      ADD CONSTRAINT "BotConfig_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

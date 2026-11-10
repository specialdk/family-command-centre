-- How a family member's name is said, for text-to-speech only.
-- Nullable with no default and no backfill: adding it cannot fail and cannot
-- lock the table for any meaningful time, so this is safe to run against the
-- live database while the family is using the app.
ALTER TABLE "FamilyMember" ADD COLUMN "pronunciation" TEXT;

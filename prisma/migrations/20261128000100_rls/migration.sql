-- Supabase exposes tables in "public" through its web API, and its public roles may read and write them.
-- With row level security on and no policy, those roles get no rows. The server connects as the table owner,
-- which row level security does not restrict.
-- Applied to production by hand on 2026-11-28 (see DEPLOYMENT.md).
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

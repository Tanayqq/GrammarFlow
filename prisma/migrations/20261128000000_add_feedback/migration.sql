-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- Supabase exposes tables in "public" through its web API. With row level security on and no policy, that API can
-- read and write nothing here; the server connects as the table owner and is not affected.
ALTER TABLE "Feedback" ENABLE ROW LEVEL SECURITY;

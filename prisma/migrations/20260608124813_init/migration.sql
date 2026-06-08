-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "guest_session_id" TEXT,
    "email" TEXT,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiOperation" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "input_text" TEXT NOT NULL,
    "output_text" TEXT NOT NULL,
    "operation_type" TEXT NOT NULL,
    "language" TEXT,
    "style" TEXT,
    "model" TEXT,
    "tokens_used" INTEGER,
    "processing_time_ms" INTEGER,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "operation_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "preferred_theme" TEXT,
    "preferred_language" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_guest_session_id_key" ON "User"("guest_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "AiOperation_user_id_created_at_idx" ON "AiOperation"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_user_id_key" ON "UserSettings"("user_id");

-- AddForeignKey
ALTER TABLE "AiOperation" ADD CONSTRAINT "AiOperation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

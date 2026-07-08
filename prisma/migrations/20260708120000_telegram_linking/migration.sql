-- Add Telegram account linking fields to User
ALTER TABLE "User"
ADD COLUMN     "telegramId" TEXT,
ADD COLUMN     "telegramToken" TEXT;

CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
CREATE UNIQUE INDEX "User_telegramToken_key" ON "User"("telegramToken");


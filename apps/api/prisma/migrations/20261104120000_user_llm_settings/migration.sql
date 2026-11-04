CREATE TABLE "UserLlmSettings" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL CHECK ("provider" IN ('local', 'openrouter')),
    "cloudModel" TEXT,
    "encryptedKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserLlmSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

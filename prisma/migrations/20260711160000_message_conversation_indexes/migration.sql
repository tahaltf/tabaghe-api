-- Chat message query patterns: orderBy createdAt, unread by senderId+isRead
CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_conversationId_isRead_senderId_idx" ON "Message"("conversationId", "isRead", "senderId");

-- Preserve the original encrypted prompt, evidence and history for safe replay
-- of completed model results. Legacy conversations intentionally remain NULL.
ALTER TABLE `reading_conversation` ADD COLUMN `inputCipher` LONGTEXT NULL;

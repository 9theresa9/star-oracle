-- Link private model results to their original content so deletion cascades.
ALTER TABLE `ai_request`
  ADD COLUMN `readingId` VARCHAR(36) NULL,
  ADD COLUMN `reportId` VARCHAR(36) NULL;
CREATE INDEX `ai_request_readingId_idx` ON `ai_request`(`readingId`);
CREATE INDEX `ai_request_reportId_idx` ON `ai_request`(`reportId`);
ALTER TABLE `ai_request` ADD CONSTRAINT `ai_request_readingId_fkey` FOREIGN KEY (`readingId`) REFERENCES `reading`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ai_request` ADD CONSTRAINT `ai_request_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `review_report`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `review_report` ADD COLUMN `inputCipher` LONGTEXT NULL;

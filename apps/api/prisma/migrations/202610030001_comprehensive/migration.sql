-- Expand private features without rewriting existing readings or auth tables.
ALTER TABLE `reading`
  ADD COLUMN `favorite` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `tagsCipher` TEXT NULL,
  ADD COLUMN `annotation` TEXT NULL,
  ADD COLUMN `metadataVersion` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `ai_request` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(36) NOT NULL,
  `requestId` VARCHAR(36) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'idle',
  `pendingSince` DATETIME(3) NULL,
  `reservedDay` VARCHAR(10) NULL,
  `fingerprint` VARCHAR(64) NOT NULL,
  `resultCipher` LONGTEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_request_userId_requestId_key` (`userId`, `requestId`),
  INDEX `ai_request_userId_createdAt_idx` (`userId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `reading_conversation` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(36) NOT NULL,
  `readingId` VARCHAR(36) NOT NULL,
  `promptCipher` TEXT NOT NULL,
  `answerCipher` LONGTEXT NULL,
  `requestId` VARCHAR(36) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `pendingSince` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `reading_conversation_userId_requestId_key` (`userId`, `requestId`),
  INDEX `reading_conversation_userId_readingId_createdAt_idx` (`userId`, `readingId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `action_plan` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(36) NOT NULL,
  `readingId` VARCHAR(36) NULL,
  `titleCipher` TEXT NOT NULL,
  `detailCipher` TEXT NULL,
  `dueDate` VARCHAR(10) NULL,
  `completedAt` DATETIME(3) NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `action_plan_userId_createdAt_idx` (`userId`, `createdAt`),
  INDEX `action_plan_userId_dueDate_idx` (`userId`, `dueDate`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `feedback` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(36) NOT NULL,
  `category` VARCHAR(16) NOT NULL,
  `bodyCipher` TEXT NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'open',
  `adminReplyCipher` TEXT NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `feedback_userId_createdAt_idx` (`userId`, `createdAt`),
  INDEX `feedback_status_createdAt_idx` (`status`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `site_content` (
  `id` VARCHAR(36) NOT NULL,
  `slug` VARCHAR(80) NOT NULL,
  `kind` VARCHAR(24) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `body` TEXT NOT NULL,
  `published` BOOLEAN NOT NULL DEFAULT false,
  `version` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `site_content_slug_key` (`slug`),
  INDEX `site_content_published_kind_createdAt_idx` (`published`, `kind`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `membership` (
  `userId` VARCHAR(36) NOT NULL,
  `tier` VARCHAR(16) NOT NULL DEFAULT 'free',
  `expiresAt` DATETIME(3) NULL,
  `credits` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_ai_usage` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(36) NOT NULL,
  `date` VARCHAR(10) NOT NULL,
  `requests` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `user_ai_usage_userId_date_key` (`userId`, `date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_allowance` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(36) NOT NULL,
  `requestId` VARCHAR(36) NOT NULL,
  `source` VARCHAR(16) NOT NULL DEFAULT 'daily',
  `creditsSpent` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_allowance_userId_requestId_key` (`userId`, `requestId`),
  INDEX `ai_allowance_userId_createdAt_idx` (`userId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `redeem_code` (
  `id` VARCHAR(36) NOT NULL,
  `codeHash` VARCHAR(64) NOT NULL,
  `codeHint` VARCHAR(20) NOT NULL,
  `kind` VARCHAR(16) NOT NULL,
  `amount` INTEGER NOT NULL,
  `durationDays` INTEGER NULL,
  `expiresAt` DATETIME(3) NULL,
  `maxUses` INTEGER NOT NULL DEFAULT 1,
  `usedCount` INTEGER NOT NULL DEFAULT 0,
  `disabled` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `redeem_code_codeHash_key` (`codeHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `redemption` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(36) NOT NULL,
  `codeId` VARCHAR(36) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `redemption_userId_codeId_key` (`userId`, `codeId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `credit_ledger` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(36) NOT NULL,
  `kind` VARCHAR(32) NOT NULL,
  `amount` INTEGER NOT NULL,
  `balance` INTEGER NOT NULL,
  `requestId` VARCHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `credit_ledger_userId_requestId_key` (`userId`, `requestId`),
  INDEX `credit_ledger_userId_createdAt_idx` (`userId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `review_report` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(36) NOT NULL,
  `period` VARCHAR(16) NOT NULL,
  `startDate` VARCHAR(10) NOT NULL,
  `endDate` VARCHAR(10) NOT NULL,
  `includeJournal` BOOLEAN NOT NULL DEFAULT false,
  `requestId` VARCHAR(36) NOT NULL,
  `resultCipher` LONGTEXT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `review_report_userId_requestId_key` (`userId`, `requestId`),
  INDEX `review_report_userId_createdAt_idx` (`userId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_request` ADD CONSTRAINT `ai_request_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `reading_conversation` ADD CONSTRAINT `reading_conversation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `reading_conversation` ADD CONSTRAINT `reading_conversation_readingId_fkey` FOREIGN KEY (`readingId`) REFERENCES `reading` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `action_plan` ADD CONSTRAINT `action_plan_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `action_plan` ADD CONSTRAINT `action_plan_readingId_fkey` FOREIGN KEY (`readingId`) REFERENCES `reading` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `feedback` ADD CONSTRAINT `feedback_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `membership` ADD CONSTRAINT `membership_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `user_ai_usage` ADD CONSTRAINT `user_ai_usage_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ai_allowance` ADD CONSTRAINT `ai_allowance_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `redemption` ADD CONSTRAINT `redemption_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `redemption` ADD CONSTRAINT `redemption_codeId_fkey` FOREIGN KEY (`codeId`) REFERENCES `redeem_code` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `credit_ledger` ADD CONSTRAINT `credit_ledger_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `review_report` ADD CONSTRAINT `review_report_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

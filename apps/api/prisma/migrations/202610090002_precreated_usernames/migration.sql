ALTER TABLE `user` ADD COLUMN `username` VARCHAR(32) NULL;
CREATE UNIQUE INDEX `user_username_key` ON `user`(`username`);

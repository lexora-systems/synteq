-- Upgrade users for SaaS identity model.
UPDATE `users`
SET `role` = 'engineer'
WHERE `role` = 'operator';

ALTER TABLE `users`
  ADD COLUMN `password_hash` VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN `email_verified_at` DATETIME(3) NULL,
  ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  ADD COLUMN `disabled_at` DATETIME(3) NULL;

ALTER TABLE `users`
  MODIFY `role` ENUM('owner','admin','engineer','viewer') NOT NULL DEFAULT 'viewer';

ALTER TABLE `users`
  DROP COLUMN `is_active`;

-- Refresh tokens for rolling access sessions.
CREATE TABLE `refresh_tokens` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revoked_at` DATETIME(3) NULL,
  UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
  INDEX `refresh_tokens_user_id_expires_at_idx`(`user_id`, `expires_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Email verification tokens.
CREATE TABLE `email_verification_tokens` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `used_at` DATETIME(3) NULL,
  UNIQUE INDEX `email_verification_tokens_token_hash_key`(`token_hash`),
  INDEX `email_verification_tokens_user_id_expires_at_idx`(`user_id`, `expires_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Password reset tokens.
CREATE TABLE `password_reset_tokens` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `used_at` DATETIME(3) NULL,
  UNIQUE INDEX `password_reset_tokens_token_hash_key`(`token_hash`),
  INDEX `password_reset_tokens_user_id_expires_at_idx`(`user_id`, `expires_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Invite-only onboarding table.
CREATE TABLE `invites` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `role` ENUM('owner','admin','engineer','viewer') NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  `invited_by_user_id` VARCHAR(36) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `accepted_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `invites_token_hash_key`(`token_hash`),
  INDEX `invites_tenant_id_email_accepted_at_idx`(`tenant_id`, `email`, `accepted_at`),
  INDEX `invites_tenant_id_expires_at_idx`(`tenant_id`, `expires_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `email_verification_tokens` ADD CONSTRAINT `email_verification_tokens_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `invites` ADD CONSTRAINT `invites_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `invites` ADD CONSTRAINT `invites_invited_by_user_id_fkey`
  FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

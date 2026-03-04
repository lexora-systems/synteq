CREATE TABLE `security_events` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NULL,
  `user_id` VARCHAR(36) NULL,
  `type` VARCHAR(64) NOT NULL,
  `ip` VARCHAR(64) NULL,
  `user_agent` VARCHAR(512) NULL,
  `metadata_json` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `security_events_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
  INDEX `security_events_user_id_created_at_idx`(`user_id`, `created_at`),
  INDEX `security_events_type_created_at_idx`(`type`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `invites_tenant_id_email_created_at_idx`
  ON `invites`(`tenant_id`, `email`, `created_at`);

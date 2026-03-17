CREATE TABLE `github_integrations` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `webhook_id` VARCHAR(64) NOT NULL,
  `webhook_secret` VARCHAR(255) NOT NULL,
  `repository_full_name` VARCHAR(255) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `last_delivery_id` VARCHAR(128) NULL,
  `last_seen_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `github_integrations_webhook_id_key`(`webhook_id`),
  INDEX `github_integrations_tenant_id_is_active_idx`(`tenant_id`, `is_active`),
  INDEX `github_integrations_repository_full_name_idx`(`repository_full_name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `github_integrations` ADD CONSTRAINT `github_integrations_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

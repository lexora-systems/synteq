-- CreateTable
CREATE TABLE `tenants` (
  `id` VARCHAR(36) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `plan` VARCHAR(64) NOT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'UTC',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `users` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `full_name` VARCHAR(191) NOT NULL,
  `role` ENUM('admin','operator','viewer') NOT NULL DEFAULT 'operator',
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `users_tenant_id_email_key`(`tenant_id`, `email`),
  INDEX `users_tenant_id_idx`(`tenant_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `api_keys` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `key_hash` VARCHAR(64) NOT NULL,
  `last_used_at` DATETIME(3) NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `api_keys_key_hash_key`(`key_hash`),
  INDEX `api_keys_tenant_id_idx`(`tenant_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `workflows` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `slug` VARCHAR(191) NOT NULL,
  `display_name` VARCHAR(191) NOT NULL,
  `system` VARCHAR(191) NOT NULL,
  `environment` VARCHAR(64) NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `workflows_tenant_id_slug_environment_key`(`tenant_id`, `slug`, `environment`),
  INDEX `workflows_tenant_id_idx`(`tenant_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `workflow_versions` (
  `id` VARCHAR(36) NOT NULL,
  `workflow_id` VARCHAR(36) NOT NULL,
  `version` VARCHAR(128) NOT NULL,
  `config_json` JSON NOT NULL,
  `deployed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `workflow_versions_workflow_id_idx`(`workflow_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `alert_policies` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `metric` VARCHAR(64) NOT NULL,
  `window_sec` INTEGER NOT NULL DEFAULT 300,
  `threshold` DOUBLE NOT NULL,
  `comparator` ENUM('gt','gte','lt','lte','eq') NOT NULL DEFAULT 'gte',
  `min_events` INTEGER NOT NULL DEFAULT 20,
  `severity` ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `is_enabled` BOOLEAN NOT NULL DEFAULT true,
  `filter_workflow_id` VARCHAR(36) NULL,
  `filter_env` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `alert_policies_tenant_id_is_enabled_idx`(`tenant_id`, `is_enabled`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `alert_channels` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `type` ENUM('slack','webhook','email') NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `config_json` JSON NOT NULL,
  `is_enabled` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `alert_channels_tenant_id_is_enabled_idx`(`tenant_id`, `is_enabled`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `alert_policy_channels` (
  `policy_id` VARCHAR(36) NOT NULL,
  `channel_id` VARCHAR(36) NOT NULL,
  PRIMARY KEY (`policy_id`, `channel_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `incidents` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `policy_id` VARCHAR(36) NULL,
  `workflow_id` VARCHAR(36) NULL,
  `environment` VARCHAR(64) NULL,
  `status` ENUM('open','acked','resolved') NOT NULL DEFAULT 'open',
  `severity` ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `started_at` DATETIME(3) NOT NULL,
  `last_seen_at` DATETIME(3) NOT NULL,
  `resolved_at` DATETIME(3) NULL,
  `fingerprint` VARCHAR(64) NOT NULL,
  `summary` VARCHAR(512) NOT NULL,
  `details_json` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `incidents_tenant_id_status_idx`(`tenant_id`, `status`),
  INDEX `incidents_policy_id_workflow_id_environment_status_idx`(`policy_id`, `workflow_id`, `environment`, `status`),
  INDEX `incidents_fingerprint_idx`(`fingerprint`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `incident_events` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `incident_id` VARCHAR(36) NOT NULL,
  `at_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `event_type` VARCHAR(64) NOT NULL,
  `payload_json` JSON NOT NULL,
  INDEX `incident_events_incident_id_at_time_idx`(`incident_id`, `at_time`),
  INDEX `incident_events_event_type_at_time_idx`(`event_type`, `at_time`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `users` ADD CONSTRAINT `users_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `workflows` ADD CONSTRAINT `workflows_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `workflow_versions` ADD CONSTRAINT `workflow_versions_workflow_id_fkey`
  FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `alert_policies` ADD CONSTRAINT `alert_policies_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `alert_policies` ADD CONSTRAINT `alert_policies_filter_workflow_id_fkey`
  FOREIGN KEY (`filter_workflow_id`) REFERENCES `workflows`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `alert_channels` ADD CONSTRAINT `alert_channels_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `alert_policy_channels` ADD CONSTRAINT `alert_policy_channels_policy_id_fkey`
  FOREIGN KEY (`policy_id`) REFERENCES `alert_policies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `alert_policy_channels` ADD CONSTRAINT `alert_policy_channels_channel_id_fkey`
  FOREIGN KEY (`channel_id`) REFERENCES `alert_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `incidents` ADD CONSTRAINT `incidents_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `incidents` ADD CONSTRAINT `incidents_policy_id_fkey`
  FOREIGN KEY (`policy_id`) REFERENCES `alert_policies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `incidents` ADD CONSTRAINT `incidents_workflow_id_fkey`
  FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `incident_events` ADD CONSTRAINT `incident_events_incident_id_fkey`
  FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

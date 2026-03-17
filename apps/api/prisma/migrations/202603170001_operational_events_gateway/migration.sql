CREATE TABLE `operational_events` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `source` VARCHAR(64) NOT NULL,
  `event_type` VARCHAR(128) NOT NULL,
  `system` VARCHAR(191) NOT NULL,
  `service` VARCHAR(191) NULL,
  `environment` VARCHAR(64) NULL,
  `event_ts` DATETIME(3) NOT NULL,
  `severity` ENUM('warn', 'low', 'medium', 'high', 'critical') NULL,
  `correlation_key` VARCHAR(191) NULL,
  `metadata_json` JSON NOT NULL,
  `request_id` VARCHAR(64) NULL,
  `api_key_id` VARCHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `operational_events_tenant_id_event_ts_idx`(`tenant_id`, `event_ts`),
  INDEX `operational_events_tenant_id_source_event_type_event_ts_idx`(`tenant_id`, `source`, `event_type`, `event_ts`),
  INDEX `operational_events_tenant_id_correlation_key_event_ts_idx`(`tenant_id`, `correlation_key`, `event_ts`),
  INDEX `operational_events_api_key_id_created_at_idx`(`api_key_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `operational_events` ADD CONSTRAINT `operational_events_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `operational_events` ADD CONSTRAINT `operational_events_api_key_id_fkey`
  FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

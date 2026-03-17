ALTER TABLE `operational_events`
  ADD INDEX `operational_events_created_at_id_idx`(`created_at`, `id`);

CREATE TABLE `operational_event_analysis_cursors` (
  `worker_key` VARCHAR(64) NOT NULL,
  `last_event_created_at` DATETIME(3) NULL,
  `last_event_id` VARCHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`worker_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `operational_findings` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `source` VARCHAR(64) NOT NULL,
  `rule_key` VARCHAR(128) NOT NULL,
  `severity` ENUM('warn', 'low', 'medium', 'high', 'critical') NOT NULL,
  `status` ENUM('open', 'resolved') NOT NULL DEFAULT 'open',
  `system` VARCHAR(191) NOT NULL,
  `correlation_key` VARCHAR(191) NULL,
  `fingerprint` VARCHAR(64) NOT NULL,
  `summary` VARCHAR(512) NOT NULL,
  `evidence_json` JSON NOT NULL,
  `first_seen_at` DATETIME(3) NOT NULL,
  `last_seen_at` DATETIME(3) NOT NULL,
  `resolved_at` DATETIME(3) NULL,
  `event_count` INTEGER NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `operational_findings_tenant_id_fingerprint_key`(`tenant_id`, `fingerprint`),
  INDEX `operational_findings_tenant_id_status_last_seen_at_idx`(`tenant_id`, `status`, `last_seen_at`),
  INDEX `operational_findings_tenant_id_source_rule_key_system_idx`(`tenant_id`, `source`, `rule_key`, `system`),
  INDEX `operational_findings_tenant_id_correlation_key_status_idx`(`tenant_id`, `correlation_key`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `operational_findings` ADD CONSTRAINT `operational_findings_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

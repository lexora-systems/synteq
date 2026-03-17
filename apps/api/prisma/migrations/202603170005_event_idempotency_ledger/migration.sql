CREATE TABLE `event_idempotency_ledger` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `source` VARCHAR(64) NOT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `status` ENUM('processing', 'completed', 'failed') NOT NULL DEFAULT 'processing',
  `first_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL,
  `lock_expires_at` DATETIME(3) NULL,
  `error_code` VARCHAR(64) NULL,
  `error_message` VARCHAR(512) NULL,
  `operational_event_id` VARCHAR(36) NULL,
  `seen_count` INTEGER NOT NULL DEFAULT 1,
  `attempt_count` INTEGER NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `eid_ledger_tenant_source_key_uq`(`tenant_id`, `source`, `idempotency_key`),
  INDEX `eid_ledger_tenant_source_status_seen_idx`(`tenant_id`, `source`, `status`, `last_seen_at`),
  INDEX `eid_ledger_status_lock_idx`(`status`, `lock_expires_at`),
  INDEX `eid_ledger_op_event_idx`(`operational_event_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `event_idempotency_ledger` ADD CONSTRAINT `event_idempotency_ledger_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `event_idempotency_ledger` ADD CONSTRAINT `event_idempotency_ledger_operational_event_id_fkey`
  FOREIGN KEY (`operational_event_id`) REFERENCES `operational_events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

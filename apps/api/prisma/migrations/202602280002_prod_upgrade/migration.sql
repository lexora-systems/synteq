-- Add "warn" severity value for richer escalation states.
ALTER TABLE `alert_policies`
  MODIFY `severity` ENUM('warn','low','medium','high','critical') NOT NULL DEFAULT 'medium';

ALTER TABLE `incidents`
  MODIFY `severity` ENUM('warn','low','medium','high','critical') NOT NULL DEFAULT 'medium';

-- Add SLA tracking fields.
ALTER TABLE `incidents`
  ADD COLUMN `sla_due_at` DATETIME(3) NULL,
  ADD COLUMN `sla_breached_at` DATETIME(3) NULL;

UPDATE `incidents`
SET `sla_due_at` = DATE_ADD(`started_at`, INTERVAL 120 MINUTE)
WHERE `sla_due_at` IS NULL;

ALTER TABLE `incidents`
  MODIFY `sla_due_at` DATETIME(3) NOT NULL;

CREATE INDEX `incidents_tenant_id_status_sla_due_at_idx`
  ON `incidents`(`tenant_id`, `status`, `sla_due_at`);

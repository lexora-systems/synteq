CREATE TABLE `incident_bridge_cursors` (
  `worker_key` VARCHAR(64) NOT NULL,
  `last_finding_updated_at` DATETIME(3) NULL,
  `last_finding_id` VARCHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`worker_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `finding_incident_links` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` VARCHAR(36) NOT NULL,
  `finding_id` VARCHAR(36) NOT NULL,
  `incident_id` VARCHAR(36) NOT NULL,
  `bridge_key` VARCHAR(64) NOT NULL,
  `last_bridged_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `finding_incident_links_finding_id_key`(`finding_id`),
  UNIQUE INDEX `finding_incident_links_tenant_id_bridge_key_key`(`tenant_id`, `bridge_key`),
  INDEX `finding_incident_links_incident_id_idx`(`incident_id`),
  INDEX `finding_incident_links_tenant_id_updated_at_idx`(`tenant_id`, `updated_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `finding_incident_links` ADD CONSTRAINT `finding_incident_links_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `finding_incident_links` ADD CONSTRAINT `finding_incident_links_finding_id_fkey`
  FOREIGN KEY (`finding_id`) REFERENCES `operational_findings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `finding_incident_links` ADD CONSTRAINT `finding_incident_links_incident_id_fkey`
  FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

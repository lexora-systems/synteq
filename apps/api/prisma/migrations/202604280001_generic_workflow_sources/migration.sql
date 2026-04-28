ALTER TABLE `workflows`
  ADD COLUMN `source_type` VARCHAR(32) NOT NULL DEFAULT 'workflow';

CREATE INDEX `workflows_tenant_id_source_type_is_active_idx`
  ON `workflows` (`tenant_id`, `source_type`, `is_active`);

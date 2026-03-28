ALTER TABLE `tenants`
  ADD COLUMN `trial_status` VARCHAR(32) NOT NULL DEFAULT 'none',
  ADD COLUMN `trial_started_at` DATETIME(3) NULL,
  ADD COLUMN `trial_ends_at` DATETIME(3) NULL,
  ADD COLUMN `trial_source` VARCHAR(64) NULL;

UPDATE `tenants`
SET `plan` = 'free'
WHERE LOWER(`plan`) = 'mvp';

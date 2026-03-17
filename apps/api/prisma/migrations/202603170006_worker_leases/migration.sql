CREATE TABLE `worker_leases` (
  `worker_name` VARCHAR(128) NOT NULL,
  `owner_token` VARCHAR(191) NULL,
  `lease_expires_at` DATETIME(3) NULL,
  `acquired_at` DATETIME(3) NULL,
  `renewed_at` DATETIME(3) NULL,
  `last_heartbeat_at` DATETIME(3) NULL,
  `last_completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `worker_lease_expires_idx`(`lease_expires_at`),
  INDEX `worker_lease_owner_exp_idx`(`owner_token`, `lease_expires_at`),
  PRIMARY KEY (`worker_name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

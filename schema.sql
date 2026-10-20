-- ========================================================
-- MONEY LOG UNIFIED DATABASE SCHEMA
-- Single Source of Truth for Personal Finance & POS Subsystems
-- Total Tables: 33
-- ========================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ========================================================
-- 1. CORE USER & AUTHENTICATION TABLES
-- ========================================================

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `phone_number` VARCHAR(20) NOT NULL,
  `name` VARCHAR(100) DEFAULT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `profile_image_url` VARCHAR(255) DEFAULT NULL,
  `global_sms_enabled` TINYINT(1) DEFAULT 0,
  `global_email_enabled` TINYINT(1) DEFAULT 1,
  `global_push_enabled` TINYINT(1) DEFAULT 0,
  `timezone` VARCHAR(100) DEFAULT 'UTC',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_users_phone` (`phone_number`),
  UNIQUE KEY `uniq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `user_push_tokens`;
CREATE TABLE `user_push_tokens` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `push_token` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_push_token` (`user_id`, `push_token`),
  CONSTRAINT `fk_push_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `refresh_tokens`;
CREATE TABLE `refresh_tokens` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_refresh_tokens_user` (`user_id`),
  CONSTRAINT `fk_refresh_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ========================================================
-- 2. PERSONAL FINANCE TABLES
-- ========================================================

DROP TABLE IF EXISTS `categories`;
CREATE TABLE `categories` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `icon_name` VARCHAR(100) DEFAULT NULL,
  `color` VARCHAR(20) DEFAULT NULL,
  `budget_limit` DECIMAL(10,2) DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_categories_user` (`user_id`),
  CONSTRAINT `fk_categories_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `subscriptions`;
CREATE TABLE `subscriptions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `category_id` INT DEFAULT NULL,
  `name` VARCHAR(255) NOT NULL,
  `start_date` DATE NOT NULL DEFAULT (CURDATE()),
  `amount` DECIMAL(10,2) NOT NULL,
  `billing_cycle` ENUM('monthly','yearly') NOT NULL DEFAULT 'monthly',
  `frequency` ENUM('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'custom') NOT NULL DEFAULT 'monthly',
  `interval_count` INT NOT NULL DEFAULT 1,
  `by_month_day` INT DEFAULT NULL,
  `by_weekday` TINYINT DEFAULT NULL,
  `end_mode` ENUM('never', 'on_date', 'after_n') NOT NULL DEFAULT 'never',
  `end_date` DATE DEFAULT NULL,
  `occurrences_total` INT DEFAULT NULL,
  `auto_post` TINYINT(1) NOT NULL DEFAULT 0,
  `generated_through` DATE DEFAULT NULL,
  `next_billing_date` DATE NOT NULL,
  `type` ENUM('expense','income') NOT NULL DEFAULT 'expense',
  `status` ENUM('active','paused','cancelled') NOT NULL DEFAULT 'active',
  `source` VARCHAR(255) DEFAULT 'Manual Added',
  `is_reminder_on` TINYINT(1) DEFAULT 0,
  `reminder_days` INT DEFAULT 3,
  `is_sms_enabled` TINYINT(1) DEFAULT 0,
  `is_email_enabled` TINYINT(1) DEFAULT 0,
  `is_push_enabled` TINYINT(1) DEFAULT 0,
  `last_reminder_sent_date` DATE DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_subscriptions_user` (`user_id`),
  KEY `idx_subscriptions_category` (`category_id`),
  CONSTRAINT `fk_subscriptions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_subscriptions_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `recurring_occurrences`;
CREATE TABLE `recurring_occurrences` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `recurring_id` INT NOT NULL,
  `due_date` DATE NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `status` ENUM('due', 'paid', 'skipped', 'missed', 'cancelled') NOT NULL DEFAULT 'due',
  `transaction_id` INT DEFAULT NULL,
  `paid_at` TIMESTAMP NULL DEFAULT NULL,
  `skipped_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_recurring_due` (`recurring_id`, `due_date`),
  KEY `idx_user_status_due` (`user_id`, `status`, `due_date`),
  KEY `idx_recurring_id` (`recurring_id`),
  KEY `idx_transaction_id` (`transaction_id`),
  CONSTRAINT `fk_recurring_occ_sub` FOREIGN KEY (`recurring_id`) REFERENCES `subscriptions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_recurring_occ_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_recurring_occ_tx` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `transactions`;
CREATE TABLE `transactions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `subscription_id` INT DEFAULT NULL,
  `category_id` INT DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `subtitle` VARCHAR(255) DEFAULT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `type` ENUM('expense','income') NOT NULL DEFAULT 'expense',
  `date` DATE NOT NULL,
  `icon_name` VARCHAR(100) DEFAULT NULL,
  `icon_bg_color` VARCHAR(100) DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `receipt_url` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transactions_user` (`user_id`),
  KEY `idx_transactions_subscription` (`subscription_id`),
  KEY `idx_transactions_category` (`category_id`),
  CONSTRAINT `fk_transactions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_transactions_sub` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_transactions_cat` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `in_app_notifications`;
CREATE TABLE `in_app_notifications` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `message` TEXT NOT NULL,
  `type` ENUM('warning','success','alert','info') NOT NULL DEFAULT 'info',
  `link_url` VARCHAR(255) DEFAULT NULL,
  `is_read` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_in_app_notif_user` (`user_id`),
  KEY `idx_user_unread` (`user_id`, `is_read`, `created_at`),
  CONSTRAINT `fk_in_app_notif_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `notification_queue`;
CREATE TABLE `notification_queue` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `subscription_id` INT DEFAULT NULL,
  `user_id` INT NOT NULL,
  `type` ENUM('push','email','sms') NOT NULL,
  `status` ENUM('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notif_queue_user` (`user_id`),
  KEY `idx_notif_queue_sub` (`subscription_id`),
  CONSTRAINT `fk_notif_queue_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notif_queue_sub` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ========================================================
-- 3. BANKING, PLAID & ACCOUNT TRANSACTIONS TABLES
-- ========================================================

DROP TABLE IF EXISTS `accounts`;
CREATE TABLE `accounts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `type` ENUM('bank','card','wallet') NOT NULL DEFAULT 'bank',
  `subtype` VARCHAR(50) DEFAULT NULL,
  `name` VARCHAR(255) NOT NULL,
  `account_number` VARCHAR(255) DEFAULT NULL,
  `holder_name` VARCHAR(255) DEFAULT NULL,
  `expiry_date` VARCHAR(10) DEFAULT NULL,
  `provider` VARCHAR(100) DEFAULT NULL,
  `institution_id` VARCHAR(255) DEFAULT NULL,
  `item_id` VARCHAR(255) DEFAULT NULL,
  `external_id` VARCHAR(255) DEFAULT NULL,
  `balance` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `available_balance` DECIMAL(15,2) DEFAULT NULL,
  `credit_limit` DECIMAL(15,2) DEFAULT NULL,
  `logo` LONGTEXT DEFAULT NULL,
  `color` VARCHAR(20) DEFAULT NULL,
  `plaid_raw_data` JSON DEFAULT NULL,
  `last_balance_sync` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_accounts_user` (`user_id`),
  CONSTRAINT `fk_accounts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `plaid_items`;
CREATE TABLE `plaid_items` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `item_id` VARCHAR(255) NOT NULL,
  `access_token` VARCHAR(255) NOT NULL,
  `institution_id` VARCHAR(255) DEFAULT NULL,
  `institution_name` VARCHAR(255) DEFAULT NULL,
  `plaid_raw_data` JSON DEFAULT NULL,
  `transaction_cursor` VARCHAR(255) DEFAULT NULL,
  `status` ENUM('good', 'login_required') DEFAULT 'good',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_plaid_items_item_id` (`item_id`),
  KEY `idx_plaid_items_user` (`user_id`),
  CONSTRAINT `fk_plaid_items_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `account_transactions`;
CREATE TABLE `account_transactions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `account_id` INT NOT NULL,
  `provider_transaction_id` VARCHAR(255) NOT NULL,
  `amount` DECIMAL(15,2) NOT NULL,
  `date` DATE NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `merchant_name` VARCHAR(255) DEFAULT NULL,
  `logo_url` VARCHAR(255) DEFAULT NULL,
  `currency` VARCHAR(10) DEFAULT 'USD',
  `payment_channel` VARCHAR(50) DEFAULT NULL,
  `primary_category` VARCHAR(100) DEFAULT NULL,
  `detailed_category` VARCHAR(100) DEFAULT NULL,
  `pending` TINYINT(1) DEFAULT 0,
  `datetime` DATETIME DEFAULT NULL,
  `authorized_date` DATE DEFAULT NULL,
  `authorized_datetime` DATETIME DEFAULT NULL,
  `location` JSON DEFAULT NULL,
  `payment_meta` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_acct_tx_provider_id` (`provider_transaction_id`),
  KEY `idx_account_transactions_user` (`user_id`),
  KEY `idx_account_transactions_account` (`account_id`),
  CONSTRAINT `fk_acct_tx_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_acct_tx_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `account_liabilities`;
CREATE TABLE `account_liabilities` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `account_id` INT NOT NULL,
  `type` VARCHAR(50) NOT NULL,
  `apr` DECIMAL(10,4) DEFAULT NULL,
  `rate_type` VARCHAR(50) DEFAULT NULL,
  `minimum_payment` DECIMAL(15,2) DEFAULT NULL,
  `last_payment_amount` DECIMAL(15,2) DEFAULT NULL,
  `next_payment_date` DATE DEFAULT NULL,
  `loan_term` VARCHAR(50) DEFAULT NULL,
  `expected_payoff_date` DATE DEFAULT NULL,
  `origination_principal` DECIMAL(15,2) DEFAULT NULL,
  `ytd_interest_paid` DECIMAL(15,2) DEFAULT NULL,
  `raw_data` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_account_liabilities_account` (`account_id`),
  CONSTRAINT `fk_acct_liabilities_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `liability_aprs`;
CREATE TABLE `liability_aprs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `account_liability_id` INT NOT NULL,
  `apr_type` VARCHAR(50) NOT NULL,
  `apr_percentage` DECIMAL(6,3) DEFAULT NULL,
  `balance_subject_to_apr` DECIMAL(15,2) DEFAULT NULL,
  `interest_charge_amount` DECIMAL(15,2) DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_liability_apr_type` (`account_liability_id`, `apr_type`),
  CONSTRAINT `fk_liability_aprs_parent` FOREIGN KEY (`account_liability_id`) REFERENCES `account_liabilities` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `asset_reports`;
CREATE TABLE `asset_reports` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `asset_report_id` VARCHAR(64) NOT NULL,
  `asset_report_token` VARCHAR(128) NOT NULL,
  `status` ENUM('pending','ready','error') DEFAULT 'pending',
  `days_requested` INT DEFAULT 90,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `ready_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_asset_reports_user` (`user_id`),
  CONSTRAINT `fk_asset_reports_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ========================================================
-- 4. POS (POINT OF SALE) SUBSYSTEM TABLES
-- ========================================================

DROP TABLE IF EXISTS `pos_categories`;
CREATE TABLE `pos_categories` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `slug` VARCHAR(120) NOT NULL,
  `icon` VARCHAR(50) DEFAULT NULL,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pos_categories_user` (`user_id`),
  CONSTRAINT `fk_pos_cat_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_brands`;
CREATE TABLE `pos_brands` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `logo_url` VARCHAR(500) DEFAULT NULL,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pos_brands_user` (`user_id`),
  CONSTRAINT `fk_pos_brand_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_products`;
CREATE TABLE `pos_products` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `category_id` INT UNSIGNED DEFAULT NULL,
  `brand_id` INT UNSIGNED DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `base_unit` VARCHAR(30) DEFAULT 'pcs',
  `is_taxable` TINYINT(1) DEFAULT 1,
  `tax_rate` DECIMAL(5,2) DEFAULT NULL,
  `status` ENUM('active', 'draft', 'archived') NOT NULL DEFAULT 'active',
  `image_url` VARCHAR(500) DEFAULT NULL,
  `options_config` JSON DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pos_products_user` (`user_id`),
  KEY `idx_pos_products_category` (`category_id`),
  KEY `idx_pos_products_brand` (`brand_id`),
  KEY `idx_pos_products_status` (`user_id`, `status`),
  CONSTRAINT `fk_pos_prod_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pos_prod_cat` FOREIGN KEY (`category_id`) REFERENCES `pos_categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pos_prod_brand` FOREIGN KEY (`brand_id`) REFERENCES `pos_brands` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_product_variants`;
CREATE TABLE `pos_product_variants` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `product_id` INT UNSIGNED NOT NULL,
  `sku` VARCHAR(100) NOT NULL,
  `barcode` VARCHAR(100) DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `attributes` JSON NOT NULL,
  `cost_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `mrp` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `selling_price` DECIMAL(12,2) NOT NULL,
  `discount_percent` DECIMAL(5,2) DEFAULT 0.00,
  `stock_quantity` DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  `min_stock_alert` DECIMAL(12,3) NOT NULL DEFAULT 5.000,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pos_variant_sku` (`user_id`, `sku`),
  KEY `idx_pos_variant_barcode` (`user_id`, `barcode`),
  KEY `idx_pos_variant_product` (`product_id`),
  CONSTRAINT `fk_pos_var_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pos_var_prod` FOREIGN KEY (`product_id`) REFERENCES `pos_products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_settings`;
CREATE TABLE `pos_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `store_name` VARCHAR(150) NOT NULL DEFAULT 'MoneyLog Store',
  `tagline` VARCHAR(255) DEFAULT 'Artisan Store & Roastery',
  `store_phone` VARCHAR(30) DEFAULT NULL,
  `store_email` VARCHAR(150) DEFAULT NULL,
  `website` VARCHAR(255) DEFAULT NULL,
  `store_address` TEXT DEFAULT NULL,
  `address_line1` VARCHAR(255) DEFAULT NULL,
  `address_line2` VARCHAR(255) DEFAULT NULL,
  `city` VARCHAR(100) DEFAULT NULL,
  `state` VARCHAR(100) DEFAULT NULL,
  `postal_code` VARCHAR(30) DEFAULT NULL,
  `tax_number` VARCHAR(60) DEFAULT NULL,
  `store_logo_url` VARCHAR(500) DEFAULT NULL,
  `store_logo_initial` VARCHAR(10) DEFAULT 'M',
  `upi_id` VARCHAR(100) DEFAULT 'moneylogpos@okaxis',
  `upi_payee_name` VARCHAR(150) DEFAULT NULL,
  `upi_qr_type` VARCHAR(20) DEFAULT 'auto',
  `upi_qr_image_url` LONGTEXT DEFAULT NULL,
  `upi_qr_code_url` VARCHAR(500) DEFAULT NULL,
  `default_tax_rate` DECIMAL(5,2) NOT NULL DEFAULT 8.00,
  `taxes` JSON DEFAULT NULL,
  `currency_symbol` VARCHAR(10) NOT NULL DEFAULT '$',
  `currency_code` VARCHAR(10) NOT NULL DEFAULT 'USD',
  `is_tax_inclusive` TINYINT(1) NOT NULL DEFAULT 0,
  `paper_width` VARCHAR(20) NOT NULL DEFAULT '80mm',
  `show_tax_breakdown` TINYINT(1) NOT NULL DEFAULT 1,
  `show_cashier_name` TINYINT(1) NOT NULL DEFAULT 1,
  `cashier_name` VARCHAR(150) DEFAULT NULL,
  `show_customer_info` TINYINT(1) NOT NULL DEFAULT 1,
  `show_upi_qr_on_receipt` TINYINT(1) NOT NULL DEFAULT 1,
  `receipt_header_note` VARCHAR(255) DEFAULT 'Welcome to our store!',
  `receipt_footer_note` VARCHAR(255) DEFAULT 'Thank you for your purchase!',
  `return_policy` VARCHAR(255) DEFAULT 'Returns accepted within 14 days with original receipt.',
  `return_window_days` INT NOT NULL DEFAULT 14,
  `auto_print_receipt` TINYINT(1) NOT NULL DEFAULT 0,
  `cash_drawer_float` DECIMAL(12,2) NOT NULL DEFAULT 200.00,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pos_settings_user` (`user_id`),
  CONSTRAINT `fk_pos_set_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_orders`;
CREATE TABLE `pos_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `order_number` VARCHAR(50) NOT NULL,
  `register_label` VARCHAR(50) DEFAULT 'Terminal #01',
  `customer_name` VARCHAR(150) NOT NULL DEFAULT 'Walk-in Customer',
  `customer_phone` VARCHAR(30) DEFAULT NULL,
  `subtotal` DECIMAL(14,2) NOT NULL,
  `discount_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `tax_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `grand_total` DECIMAL(14,2) NOT NULL,
  `status` ENUM('completed', 'refunded', 'partially_refunded', 'exchanged', 'voided') NOT NULL DEFAULT 'completed',
  `notes` TEXT DEFAULT NULL,
  `order_date` DATE NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pos_order_num` (`user_id`, `order_number`),
  KEY `idx_pos_order_user_date` (`user_id`, `order_date`),
  KEY `idx_pos_order_status` (`user_id`, `status`),
  CONSTRAINT `fk_pos_ord_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_order_items`;
CREATE TABLE `pos_order_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `variant_id` INT UNSIGNED NOT NULL,
  `item_name` VARCHAR(255) NOT NULL,
  `sku` VARCHAR(100) NOT NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `unit_cost` DECIMAL(12,2) NOT NULL,
  `unit_price` DECIMAL(12,2) NOT NULL,
  `discount_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `tax_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `total_amount` DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pos_item_order` (`order_id`),
  KEY `idx_pos_item_variant` (`variant_id`),
  CONSTRAINT `fk_pos_item_ord` FOREIGN KEY (`order_id`) REFERENCES `pos_orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pos_item_var` FOREIGN KEY (`variant_id`) REFERENCES `pos_product_variants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_order_payments`;
CREATE TABLE `pos_order_payments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `payment_mode` ENUM('Cash', 'Card', 'UPI', 'Bank Transfer', 'Store Credit') NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `reference_number` VARCHAR(100) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pos_pay_order` (`order_id`),
  CONSTRAINT `fk_pos_pay_ord` FOREIGN KEY (`order_id`) REFERENCES `pos_orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_order_receipt_configs`;
CREATE TABLE `pos_order_receipt_configs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `store_name` VARCHAR(150) NOT NULL DEFAULT 'MONEY LOG POS',
  `store_logo_url` TEXT DEFAULT NULL,
  `store_logo_initial` VARCHAR(10) DEFAULT 'M',
  `store_tagline` VARCHAR(255) DEFAULT NULL,
  `store_phone` VARCHAR(50) DEFAULT NULL,
  `store_email` VARCHAR(150) DEFAULT NULL,
  `address_line1` VARCHAR(255) DEFAULT NULL,
  `address_line2` VARCHAR(255) DEFAULT NULL,
  `city` VARCHAR(100) DEFAULT NULL,
  `state` VARCHAR(100) DEFAULT NULL,
  `postal_code` VARCHAR(50) DEFAULT NULL,
  `tax_number` VARCHAR(100) DEFAULT NULL,
  `receipt_header_note` TEXT DEFAULT NULL,
  `receipt_footer_note` TEXT DEFAULT NULL,
  `return_policy` TEXT DEFAULT NULL,
  `return_window_days` INT NOT NULL DEFAULT 14,
  `currency_symbol` VARCHAR(10) DEFAULT '$',
  `paper_width` VARCHAR(50) DEFAULT '80mm',
  `show_tax_breakdown` TINYINT(1) DEFAULT 1,
  `show_cashier_name` TINYINT(1) DEFAULT 1,
  `cashier_name` VARCHAR(150) DEFAULT NULL,
  `show_customer_info` TINYINT(1) DEFAULT 1,
  `show_upi_qr_on_receipt` TINYINT(1) DEFAULT 1,
  `upi_id` VARCHAR(100) DEFAULT NULL,
  `upi_payee_name` VARCHAR(150) DEFAULT NULL,
  `upi_qr_type` VARCHAR(50) DEFAULT 'auto',
  `upi_qr_image_url` TEXT DEFAULT NULL,
  `taxes_json` JSON DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_ord_cfg` (`order_id`),
  CONSTRAINT `fk_ord_cfg_order` FOREIGN KEY (`order_id`) REFERENCES `pos_orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_returns`;
CREATE TABLE `pos_returns` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `return_number` VARCHAR(50) NOT NULL,
  `original_order_id` BIGINT UNSIGNED NOT NULL,
  `customer_name` VARCHAR(150) NOT NULL,
  `refund_amount` DECIMAL(14,2) NOT NULL,
  `refund_mode` ENUM('Store Credit', 'Cash', 'Card', 'UPI') NOT NULL DEFAULT 'Store Credit',
  `status` ENUM('Processed', 'Pending') NOT NULL DEFAULT 'Processed',
  `reason` VARCHAR(255) DEFAULT NULL,
  `items_summary` TEXT DEFAULT NULL,
  `returned_items_json` JSON DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pos_ret_num` (`user_id`, `return_number`),
  KEY `idx_pos_ret_order` (`original_order_id`),
  CONSTRAINT `fk_pos_ret_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pos_ret_ord` FOREIGN KEY (`original_order_id`) REFERENCES `pos_orders` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_exchanges`;
CREATE TABLE `pos_exchanges` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `exchange_number` VARCHAR(50) NOT NULL,
  `original_order_id` BIGINT UNSIGNED NOT NULL,
  `customer_name` VARCHAR(150) NOT NULL,
  `returned_desc` VARCHAR(255) NOT NULL,
  `replacement_desc` VARCHAR(255) NOT NULL,
  `price_difference` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `payment_mode` VARCHAR(50) DEFAULT 'Cash',
  `returned_items_json` JSON DEFAULT NULL,
  `replacement_items_json` JSON DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `status` ENUM('Completed', 'Pending') NOT NULL DEFAULT 'Completed',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pos_exc_num` (`user_id`, `exchange_number`),
  CONSTRAINT `fk_pos_exc_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pos_exc_ord` FOREIGN KEY (`original_order_id`) REFERENCES `pos_orders` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_suppliers`;
CREATE TABLE `pos_suppliers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `contact_person` VARCHAR(100) DEFAULT NULL,
  `phone` VARCHAR(30) DEFAULT NULL,
  `email` VARCHAR(150) DEFAULT NULL,
  `address` TEXT DEFAULT NULL,
  `city` VARCHAR(100) DEFAULT NULL,
  `gst_tax_number` VARCHAR(50) DEFAULT NULL,
  `payment_terms` VARCHAR(50) NOT NULL DEFAULT 'Net 30',
  `balance_payable` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `bank_details` JSON DEFAULT NULL,
  `categories` JSON DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `status` ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pos_sup_code` (`user_id`, `code`),
  KEY `idx_pos_sup_user` (`user_id`),
  CONSTRAINT `fk_pos_sup_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_purchase_orders`;
CREATE TABLE `pos_purchase_orders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `po_number` VARCHAR(50) NOT NULL,
  `supplier_id` INT UNSIGNED NOT NULL,
  `order_date` DATE NOT NULL,
  `expected_date` DATE DEFAULT NULL,
  `subtotal` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `tax_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `shipping_fee` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `discount_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `total_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `status` ENUM('Draft', 'Ordered', 'Partial', 'Received', 'Cancelled') NOT NULL DEFAULT 'Draft',
  `notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pos_po_num` (`user_id`, `po_number`),
  KEY `idx_pos_po_supplier` (`supplier_id`),
  CONSTRAINT `fk_pos_po_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pos_po_sup` FOREIGN KEY (`supplier_id`) REFERENCES `pos_suppliers` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_po_items`;
CREATE TABLE `pos_po_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `po_id` INT UNSIGNED NOT NULL,
  `variant_id` INT UNSIGNED DEFAULT NULL,
  `sku` VARCHAR(100) NOT NULL,
  `item_name` VARCHAR(255) NOT NULL,
  `unit` VARCHAR(30) NOT NULL DEFAULT 'pack',
  `ordered_qty` DECIMAL(12,3) NOT NULL,
  `received_qty` DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  `unit_cost` DECIMAL(12,2) NOT NULL,
  `tax_percent` DECIMAL(5,2) DEFAULT 0.00,
  `total_cost` DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pos_po_item_po` (`po_id`),
  CONSTRAINT `fk_pos_po_item_po` FOREIGN KEY (`po_id`) REFERENCES `pos_purchase_orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_goods_receipts`;
CREATE TABLE `pos_goods_receipts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `grn_number` VARCHAR(50) NOT NULL,
  `po_id` INT UNSIGNED DEFAULT NULL,
  `supplier_id` INT UNSIGNED NOT NULL,
  `received_date` DATE NOT NULL,
  `carrier` VARCHAR(100) DEFAULT NULL,
  `tracking_number` VARCHAR(100) DEFAULT NULL,
  `status` ENUM('Received', 'Partial', 'Discrepancy', 'Completed') NOT NULL DEFAULT 'Completed',
  `items_summary` TEXT DEFAULT NULL,
  `received_items_json` JSON DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pos_grn_num` (`user_id`, `grn_number`),
  CONSTRAINT `fk_pos_grn_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pos_grn_po` FOREIGN KEY (`po_id`) REFERENCES `pos_purchase_orders` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pos_grn_sup` FOREIGN KEY (`supplier_id`) REFERENCES `pos_suppliers` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_purchase_bills`;
CREATE TABLE `pos_purchase_bills` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `bill_number` VARCHAR(50) NOT NULL,
  `supplier_invoice_no` VARCHAR(100) DEFAULT NULL,
  `po_id` INT UNSIGNED DEFAULT NULL,
  `supplier_id` INT UNSIGNED NOT NULL,
  `bill_date` DATE NOT NULL,
  `due_date` DATE NOT NULL,
  `subtotal` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `tax_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `shipping_fee` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `discount_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `grand_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `total_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `paid_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `balance_due` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `status` ENUM('Paid', 'Partial', 'Unpaid') NOT NULL DEFAULT 'Unpaid',
  `items_json` JSON DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pos_bill_num` (`user_id`, `bill_number`),
  KEY `idx_pos_bill_supplier` (`supplier_id`),
  CONSTRAINT `fk_pos_bill_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pos_bill_sup` FOREIGN KEY (`supplier_id`) REFERENCES `pos_suppliers` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_supplier_payments`;
CREATE TABLE `pos_supplier_payments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `payment_number` VARCHAR(50) NOT NULL,
  `supplier_id` INT UNSIGNED NOT NULL,
  `bill_id` INT UNSIGNED DEFAULT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `payment_date` DATE NOT NULL,
  `payment_mode` ENUM('Bank Transfer', 'UPI', 'Cheque', 'Cash', 'Card') NOT NULL,
  `reference_number` VARCHAR(100) NOT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pos_suppay_num` (`user_id`, `payment_number`),
  CONSTRAINT `fk_pos_suppay_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pos_suppay_sup` FOREIGN KEY (`supplier_id`) REFERENCES `pos_suppliers` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_pos_suppay_bill` FOREIGN KEY (`bill_id`) REFERENCES `pos_purchase_bills` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_shifts`;
CREATE TABLE `pos_shifts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `register_label` VARCHAR(50) NOT NULL DEFAULT 'Terminal #01',
  `shift_name` ENUM('Morning', 'Evening', 'All Day') NOT NULL DEFAULT 'All Day',
  `opened_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` TIMESTAMP NULL DEFAULT NULL,
  `opening_cash` DECIMAL(12,2) NOT NULL,
  `actual_cash` DECIMAL(12,2) DEFAULT NULL,
  `expected_cash` DECIMAL(12,2) DEFAULT NULL,
  `difference` DECIMAL(12,2) DEFAULT NULL,
  `status` ENUM('Open', 'Balanced', 'Over', 'Short') NOT NULL DEFAULT 'Open',
  `notes` TEXT DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pos_shift_user` (`user_id`, `opened_at`),
  CONSTRAINT `fk_pos_shift_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `pos_daily_aggregates`;
CREATE TABLE `pos_daily_aggregates` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `date` DATE NOT NULL,
  `gross_sales` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `net_sales` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `discounts_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `tax_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `cogs_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `orders_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `items_sold_count` DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pos_daily_user_date` (`user_id`, `date`),
  CONSTRAINT `fk_pos_daily_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS = 1;

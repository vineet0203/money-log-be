-- =========================================================
-- Standalone POS Database Schema
-- 100% Decoupled from personal finance tables.
-- =========================================================

SET FOREIGN_KEY_CHECKS = 0;

-- 1. POS Categories (Independent from personal budget categories)
CREATE TABLE IF NOT EXISTS `pos_categories` (
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

-- 2. POS Brands
CREATE TABLE IF NOT EXISTS `pos_brands` (
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

-- 3. POS Products (Catalog Master)
CREATE TABLE IF NOT EXISTS `pos_products` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `category_id` INT UNSIGNED DEFAULT NULL,
  `brand_id` INT UNSIGNED DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `base_unit` VARCHAR(30) DEFAULT 'pcs',
  `is_taxable` TINYINT(1) DEFAULT 1,
  `tax_rate` DECIMAL(5,2) DEFAULT NULL, -- NULL = inherit store default tax
  `status` ENUM('active', 'draft', 'archived') NOT NULL DEFAULT 'active',
  `image_url` VARCHAR(500) DEFAULT NULL,
  `options_config` JSON DEFAULT NULL, -- e.g. [{"name":"Size","values":["Small","Large"]}]
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

-- 4. POS Product Variants (Sellable SKUs with independent prices & stock)
CREATE TABLE IF NOT EXISTS `pos_product_variants` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `product_id` INT UNSIGNED NOT NULL,
  `sku` VARCHAR(100) NOT NULL,
  `barcode` VARCHAR(100) DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL, -- e.g. "Default" or "500g / Dark Roast"
  `attributes` JSON NOT NULL, -- e.g. {"Size": "500g", "Roast": "Dark"}
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

-- 5. POS Settings (Receipt configuration, UPI QR, tax rates)
CREATE TABLE IF NOT EXISTS `pos_settings` (
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

-- 6. POS Orders
CREATE TABLE IF NOT EXISTS `pos_orders` (
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

-- 7. POS Order Items
CREATE TABLE IF NOT EXISTS `pos_order_items` (
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

-- 8. POS Order Payments
CREATE TABLE IF NOT EXISTS `pos_order_payments` (
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

-- 8b. POS Order Receipt Config Snapshot (Frozen at time of checkout)
CREATE TABLE IF NOT EXISTS `pos_order_receipt_configs` (
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

-- 9. POS Returns & Exchanges
CREATE TABLE IF NOT EXISTS `pos_returns` (
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

CREATE TABLE IF NOT EXISTS `pos_exchanges` (
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

-- 10. POS Suppliers & Purchases
CREATE TABLE IF NOT EXISTS `pos_suppliers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `contact_person` VARCHAR(100) DEFAULT NULL,
  `phone` VARCHAR(30) DEFAULT NULL,
  `email` VARCHAR(150) DEFAULT NULL,
  `address` TEXT DEFAULT NULL,
  `payment_terms` ENUM('Immediate', 'Net 15', 'Net 30', 'Net 45', 'Net 60') NOT NULL DEFAULT 'Net 30',
  `balance_payable` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `bank_details` JSON DEFAULT NULL,
  `categories` JSON DEFAULT NULL,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pos_sup_code` (`user_id`, `code`),
  KEY `idx_pos_sup_user` (`user_id`),
  CONSTRAINT `fk_pos_sup_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `pos_purchase_orders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `po_number` VARCHAR(50) NOT NULL,
  `supplier_id` INT UNSIGNED NOT NULL,
  `order_date` DATE NOT NULL,
  `expected_date` DATE DEFAULT NULL,
  `subtotal` DECIMAL(14,2) NOT NULL,
  `tax_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `shipping_fee` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `discount_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `total_cost` DECIMAL(14,2) NOT NULL,
  `status` ENUM('Draft', 'Ordered', 'Partial', 'Received', 'Cancelled') NOT NULL DEFAULT 'Draft',
  `notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pos_po_num` (`user_id`, `po_number`),
  KEY `idx_pos_po_supplier` (`supplier_id`),
  CONSTRAINT `fk_pos_po_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pos_po_sup` FOREIGN KEY (`supplier_id`) REFERENCES `pos_suppliers` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `pos_po_items` (
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

CREATE TABLE IF NOT EXISTS `pos_goods_receipts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `grn_number` VARCHAR(50) NOT NULL,
  `po_id` INT UNSIGNED DEFAULT NULL,
  `supplier_id` INT UNSIGNED NOT NULL,
  `received_date` DATE NOT NULL,
  `carrier` VARCHAR(100) DEFAULT NULL,
  `tracking_number` VARCHAR(100) DEFAULT NULL,
  `status` ENUM('Received', 'Partial', 'Discrepancy') NOT NULL DEFAULT 'Received',
  `items_summary` TEXT DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pos_grn_num` (`user_id`, `grn_number`),
  CONSTRAINT `fk_pos_grn_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pos_grn_po` FOREIGN KEY (`po_id`) REFERENCES `pos_purchase_orders` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pos_grn_sup` FOREIGN KEY (`supplier_id`) REFERENCES `pos_suppliers` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `pos_purchase_bills` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `bill_number` VARCHAR(50) NOT NULL,
  `po_id` INT UNSIGNED DEFAULT NULL,
  `supplier_id` INT UNSIGNED NOT NULL,
  `bill_date` DATE NOT NULL,
  `due_date` DATE NOT NULL,
  `total_amount` DECIMAL(14,2) NOT NULL,
  `paid_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `balance_due` DECIMAL(14,2) NOT NULL,
  `status` ENUM('Paid', 'Partial', 'Unpaid') NOT NULL DEFAULT 'Unpaid',
  `notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pos_bill_num` (`user_id`, `bill_number`),
  KEY `idx_pos_bill_supplier` (`supplier_id`),
  CONSTRAINT `fk_pos_bill_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pos_bill_sup` FOREIGN KEY (`supplier_id`) REFERENCES `pos_suppliers` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `pos_supplier_payments` (
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

-- 11. POS Shifts (Cash Drawer Reconciliation / Z-Report)
CREATE TABLE IF NOT EXISTS `pos_shifts` (
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

-- 12. POS Daily Aggregates (Rollups for instant reports)
CREATE TABLE IF NOT EXISTS `pos_daily_aggregates` (
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

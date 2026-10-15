/**
 * Auto-creates POS Supplier & Purchase subsystem tables and migrates missing columns.
 */

async function addColumnIfNotExists(connection, table, column, definition) {
  try {
    const [cols] = await connection.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
    if (cols.length === 0) {
      await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
      console.log(`[POS DB] Added column \`${column}\` to \`${table}\``);
    }
  } catch (err) {
    console.warn(`[POS DB] Notice adding \`${column}\` to \`${table}\`:`, err.message);
  }
}

async function ensureSupplierTablesExist(pool) {
  let connection;
  try {
    connection = await pool.getConnection();
  } catch (connErr) {
    console.warn('[POS DB] Unable to obtain connection for table checks:', connErr.message);
    return;
  }

  try {
    // 1. pos_suppliers table
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS \`pos_suppliers\` (
          \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`user_id\` INT NOT NULL,
          \`name\` VARCHAR(150) NOT NULL,
          \`code\` VARCHAR(50) NOT NULL,
          \`contact_person\` VARCHAR(100) DEFAULT NULL,
          \`phone\` VARCHAR(30) DEFAULT NULL,
          \`email\` VARCHAR(150) DEFAULT NULL,
          \`address\` TEXT DEFAULT NULL,
          \`city\` VARCHAR(100) DEFAULT NULL,
          \`gst_tax_number\` VARCHAR(50) DEFAULT NULL,
          \`payment_terms\` VARCHAR(50) NOT NULL DEFAULT 'Net 30',
          \`balance_payable\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          \`bank_details\` JSON DEFAULT NULL,
          \`categories\` JSON DEFAULT NULL,
          \`notes\` TEXT DEFAULT NULL,
          \`status\` ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
          \`is_active\` TINYINT(1) DEFAULT 1,
          \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uniq_pos_sup_code\` (\`user_id\`, \`code\`),
          KEY \`idx_pos_sup_user\` (\`user_id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);
    } catch (e) {
      console.warn('[POS DB] Table pos_suppliers check:', e.message);
    }

    // Ensure missing columns on pos_suppliers if table was created with older schema
    await addColumnIfNotExists(connection, 'pos_suppliers', 'city', 'VARCHAR(100) DEFAULT NULL');
    await addColumnIfNotExists(connection, 'pos_suppliers', 'gst_tax_number', 'VARCHAR(50) DEFAULT NULL');
    await addColumnIfNotExists(connection, 'pos_suppliers', 'notes', 'TEXT DEFAULT NULL');
    await addColumnIfNotExists(connection, 'pos_suppliers', 'status', "ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active'");
    await addColumnIfNotExists(connection, 'pos_suppliers', 'is_active', 'TINYINT(1) DEFAULT 1');

    // 2. pos_purchase_orders table
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS \`pos_purchase_orders\` (
          \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`user_id\` INT NOT NULL,
          \`po_number\` VARCHAR(50) NOT NULL,
          \`supplier_id\` INT UNSIGNED NOT NULL,
          \`order_date\` DATE NOT NULL,
          \`expected_date\` DATE DEFAULT NULL,
          \`subtotal\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          \`tax_total\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          \`shipping_fee\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          \`discount_amount\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          \`total_cost\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          \`status\` ENUM('Draft', 'Ordered', 'Partial', 'Received', 'Cancelled') NOT NULL DEFAULT 'Draft',
          \`notes\` TEXT DEFAULT NULL,
          \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uniq_pos_po_num\` (\`user_id\`, \`po_number\`),
          KEY \`idx_pos_po_supplier\` (\`supplier_id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);
    } catch (e) {
      console.warn('[POS DB] Table pos_purchase_orders check:', e.message);
    }

    // 3. pos_po_items table
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS \`pos_po_items\` (
          \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`po_id\` INT UNSIGNED NOT NULL,
          \`variant_id\` INT UNSIGNED DEFAULT NULL,
          \`sku\` VARCHAR(100) NOT NULL,
          \`item_name\` VARCHAR(255) NOT NULL,
          \`unit\` VARCHAR(30) NOT NULL DEFAULT 'pack',
          \`ordered_qty\` DECIMAL(12,3) NOT NULL,
          \`received_qty\` DECIMAL(12,3) NOT NULL DEFAULT 0.000,
          \`unit_cost\` DECIMAL(12,2) NOT NULL,
          \`tax_percent\` DECIMAL(5,2) DEFAULT 0.00,
          \`total_cost\` DECIMAL(14,2) NOT NULL,
          PRIMARY KEY (\`id\`),
          KEY \`idx_pos_po_item_po\` (\`po_id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);
    } catch (e) {
      console.warn('[POS DB] Table pos_po_items check:', e.message);
    }

    // 4. pos_goods_receipts table
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS \`pos_goods_receipts\` (
          \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`user_id\` INT NOT NULL,
          \`grn_number\` VARCHAR(50) NOT NULL,
          \`po_id\` INT UNSIGNED DEFAULT NULL,
          \`supplier_id\` INT UNSIGNED NOT NULL,
          \`received_date\` DATE NOT NULL,
          \`carrier\` VARCHAR(100) DEFAULT NULL,
          \`tracking_number\` VARCHAR(100) DEFAULT NULL,
          \`status\` ENUM('Received', 'Partial', 'Discrepancy', 'Completed') NOT NULL DEFAULT 'Completed',
          \`items_summary\` TEXT DEFAULT NULL,
          \`received_items_json\` JSON DEFAULT NULL,
          \`notes\` TEXT DEFAULT NULL,
          \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uniq_pos_grn_num\` (\`user_id\`, \`grn_number\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);
    } catch (e) {
      console.warn('[POS DB] Table pos_goods_receipts check:', e.message);
    }
    await addColumnIfNotExists(connection, 'pos_goods_receipts', 'received_items_json', 'JSON DEFAULT NULL');

    // 5. pos_purchase_bills table
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS \`pos_purchase_bills\` (
          \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`user_id\` INT NOT NULL,
          \`bill_number\` VARCHAR(50) NOT NULL,
          \`supplier_invoice_no\` VARCHAR(100) DEFAULT NULL,
          \`po_id\` INT UNSIGNED DEFAULT NULL,
          \`supplier_id\` INT UNSIGNED NOT NULL,
          \`bill_date\` DATE NOT NULL,
          \`due_date\` DATE NOT NULL,
          \`subtotal\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          \`tax_total\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          \`shipping_fee\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          \`discount_amount\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          \`grand_total\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          \`total_amount\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          \`paid_amount\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          \`balance_due\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          \`status\` ENUM('Paid', 'Partial', 'Unpaid') NOT NULL DEFAULT 'Unpaid',
          \`items_json\` JSON DEFAULT NULL,
          \`notes\` TEXT DEFAULT NULL,
          \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uniq_pos_bill_num\` (\`user_id\`, \`bill_number\`),
          KEY \`idx_pos_bill_supplier\` (\`supplier_id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);
    } catch (e) {
      console.warn('[POS DB] Table pos_purchase_bills check:', e.message);
    }

    // Ensure columns on pos_purchase_bills if table existed previously with older schema
    await addColumnIfNotExists(connection, 'pos_purchase_bills', 'supplier_invoice_no', 'VARCHAR(100) DEFAULT NULL');
    await addColumnIfNotExists(connection, 'pos_purchase_bills', 'subtotal', 'DECIMAL(14,2) NOT NULL DEFAULT 0.00');
    await addColumnIfNotExists(connection, 'pos_purchase_bills', 'tax_total', 'DECIMAL(14,2) NOT NULL DEFAULT 0.00');
    await addColumnIfNotExists(connection, 'pos_purchase_bills', 'shipping_fee', 'DECIMAL(14,2) NOT NULL DEFAULT 0.00');
    await addColumnIfNotExists(connection, 'pos_purchase_bills', 'discount_amount', 'DECIMAL(14,2) NOT NULL DEFAULT 0.00');
    await addColumnIfNotExists(connection, 'pos_purchase_bills', 'grand_total', 'DECIMAL(14,2) NOT NULL DEFAULT 0.00');
    await addColumnIfNotExists(connection, 'pos_purchase_bills', 'total_amount', 'DECIMAL(14,2) NOT NULL DEFAULT 0.00');
    await addColumnIfNotExists(connection, 'pos_purchase_bills', 'items_json', 'JSON DEFAULT NULL');

    // Sync grand_total from total_amount if grand_total was 0
    try {
      await connection.query(`
        UPDATE pos_purchase_bills 
        SET grand_total = total_amount 
        WHERE (grand_total IS NULL OR grand_total = 0) AND total_amount > 0
      `);
    } catch (_) {}

    // 6. pos_supplier_payments table
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS \`pos_supplier_payments\` (
          \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`user_id\` INT NOT NULL,
          \`payment_number\` VARCHAR(50) NOT NULL,
          \`supplier_id\` INT UNSIGNED NOT NULL,
          \`bill_id\` INT UNSIGNED DEFAULT NULL,
          \`amount\` DECIMAL(14,2) NOT NULL,
          \`payment_date\` DATE NOT NULL,
          \`payment_mode\` ENUM('Bank Transfer', 'UPI', 'Cheque', 'Cash', 'Card') NOT NULL,
          \`reference_number\` VARCHAR(100) NOT NULL,
          \`notes\` TEXT DEFAULT NULL,
          \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uniq_pos_suppay_num\` (\`user_id\`, \`payment_number\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);
    } catch (e) {
      console.warn('[POS DB] Table pos_supplier_payments check:', e.message);
    }
  } catch (err) {
    console.warn('[POS Suppliers] Table check/creation warning:', err.message);
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

module.exports = {
  ensureSupplierTablesExist
};

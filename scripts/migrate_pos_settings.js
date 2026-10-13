const mysql = require('mysql2/promise');
require('dotenv').config();

async function migratePosSettings() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'moneylog',
  });

  try {
    console.log('Checking pos_settings schema...');

    const [columns] = await connection.query('DESCRIBE pos_settings');
    const existing = new Set(columns.map(c => c.Field.toLowerCase()));

    const alterStatements = [];

    if (!existing.has('taxes')) {
      alterStatements.push('ADD COLUMN `taxes` JSON DEFAULT NULL AFTER `default_tax_rate`');
    }
    if (!existing.has('address_line1')) {
      alterStatements.push('ADD COLUMN `address_line1` VARCHAR(255) DEFAULT NULL AFTER `store_address`');
    }
    if (!existing.has('address_line2')) {
      alterStatements.push('ADD COLUMN `address_line2` VARCHAR(255) DEFAULT NULL AFTER `address_line1`');
    }
    if (!existing.has('city')) {
      alterStatements.push('ADD COLUMN `city` VARCHAR(100) DEFAULT NULL AFTER `address_line2`');
    }
    if (!existing.has('state')) {
      alterStatements.push('ADD COLUMN `state` VARCHAR(100) DEFAULT NULL AFTER `city`');
    }
    if (!existing.has('postal_code')) {
      alterStatements.push('ADD COLUMN `postal_code` VARCHAR(30) DEFAULT NULL AFTER `state`');
    }
    if (!existing.has('website')) {
      alterStatements.push('ADD COLUMN `website` VARCHAR(255) DEFAULT NULL AFTER `store_email`');
    }
    if (!existing.has('store_logo_initial')) {
      alterStatements.push("ADD COLUMN `store_logo_initial` VARCHAR(10) DEFAULT 'M' AFTER `store_logo_url`");
    }
    if (!existing.has('upi_payee_name')) {
      alterStatements.push('ADD COLUMN `upi_payee_name` VARCHAR(150) DEFAULT NULL AFTER `upi_id`');
    }
    if (!existing.has('upi_qr_type')) {
      alterStatements.push("ADD COLUMN `upi_qr_type` VARCHAR(20) DEFAULT 'auto' AFTER `upi_payee_name`");
    }
    if (!existing.has('upi_qr_image_url')) {
      alterStatements.push('ADD COLUMN `upi_qr_image_url` LONGTEXT DEFAULT NULL AFTER `upi_qr_type`');
    }
    if (!existing.has('show_tax_breakdown')) {
      alterStatements.push('ADD COLUMN `show_tax_breakdown` TINYINT(1) NOT NULL DEFAULT 1 AFTER `paper_width`');
    }
    if (!existing.has('show_cashier_name')) {
      alterStatements.push('ADD COLUMN `show_cashier_name` TINYINT(1) NOT NULL DEFAULT 1 AFTER `show_tax_breakdown`');
    }
    if (!existing.has('show_customer_info')) {
      alterStatements.push('ADD COLUMN `show_customer_info` TINYINT(1) NOT NULL DEFAULT 1 AFTER `show_cashier_name`');
    }
    if (!existing.has('show_upi_qr_on_receipt')) {
      alterStatements.push('ADD COLUMN `show_upi_qr_on_receipt` TINYINT(1) NOT NULL DEFAULT 1 AFTER `show_customer_info`');
    }

    if (alterStatements.length > 0) {
      console.log(`Applying ${alterStatements.length} schema changes to pos_settings...`);
      for (const stmt of alterStatements) {
        await connection.query(`ALTER TABLE pos_settings ${stmt}`);
        console.log(`Executed: ALTER TABLE pos_settings ${stmt}`);
      }
    } else {
      console.log('pos_settings already has all required columns.');
    }

    // Modify paper_width to VARCHAR(20) to support 'A4' alongside '58mm' and '80mm'
    await connection.query("ALTER TABLE `pos_settings` MODIFY COLUMN `paper_width` VARCHAR(20) NOT NULL DEFAULT '80mm'");

    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

migratePosSettings();

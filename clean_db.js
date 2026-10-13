const mysql = require("mysql2/promise");
require("dotenv").config();

async function run() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "moneylog",
  });

  try {
    console.log("Cleaning database...");
    
    // Disable foreign key checks so we can truncate tables with relations
    await pool.query('SET FOREIGN_KEY_CHECKS = 0;');
    
    // Truncate all tables (this deletes all data and resets IDs back to 1)
    const tables = [
      'users',
      'accounts',
      'categories',
      'subscriptions',
      'transactions',
      'refresh_tokens',
      'in_app_notifications',
      'notification_queue',
      'pos_daily_aggregates',
      'pos_shifts',
      'pos_supplier_payments',
      'pos_purchase_bills',
      'pos_goods_receipts',
      'pos_po_items',
      'pos_purchase_orders',
      'pos_suppliers',
      'pos_exchanges',
      'pos_returns',
      'pos_order_payments',
      'pos_order_items',
      'pos_orders',
      'pos_product_variants',
      'pos_products',
      'pos_brands',
      'pos_categories',
      'pos_settings'
    ];

    for (const table of tables) {
      await pool.query(`TRUNCATE TABLE \`${table}\`;`);
      console.log(`- Emptied table: ${table}`);
    }

    // Re-enable foreign key checks
    await pool.query('SET FOREIGN_KEY_CHECKS = 1;');
    
    console.log("Database successfully cleaned! All IDs have been reset to 1.");
  } catch (err) {
    console.error("Error cleaning database:", err);
  } finally {
    await pool.end();
  }
}

run();

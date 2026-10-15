const mysql = require('mysql2/promise');
require('dotenv').config();

const KNOWN_TABLES = [
  'account_transactions',
  'liability_aprs',
  'account_liabilities',
  'accounts',
  'plaid_items',
  'asset_reports',
  'transactions',
  'notification_queue',
  'in_app_notifications',
  'subscriptions',
  'categories',
  'refresh_tokens',
  'user_push_tokens',
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
  'pos_order_receipt_configs',
  'pos_order_payments',
  'pos_order_items',
  'pos_orders',
  'pos_settings',
  'pos_product_variants',
  'pos_products',
  'pos_brands',
  'pos_categories',
  'users'
];

async function dropAllTables() {
  const dbName = process.env.DB_NAME || 'moneylog';
  console.log(`Connecting to MySQL database [${dbName}] to drop all tables and data...`);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: dbName,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    multipleStatements: true,
  });

  try {
    // 1. Temporarily disable foreign key constraints
    await connection.query('SET FOREIGN_KEY_CHECKS = 0;');

    // 2. Discover all tables currently existing in the database
    const [existingRows] = await connection.query('SHOW TABLES;');
    const dynamicTables = existingRows.map((row) => Object.values(row)[0]);

    // Merge dynamic tables with known tables list to guarantee nothing is missed
    const allTablesToDrop = Array.from(new Set([...dynamicTables, ...KNOWN_TABLES]));

    if (allTablesToDrop.length === 0) {
      console.log('No tables found to drop.');
    } else {
      console.log(`Found ${allTablesToDrop.length} table(s) to remove...`);
      for (const table of allTablesToDrop) {
        await connection.query(`DROP TABLE IF EXISTS \`${table}\`;`);
        console.log(`  ✓ Dropped table: ${table}`);
      }
    }

    // 3. Re-enable foreign key checks
    await connection.query('SET FOREIGN_KEY_CHECKS = 1;');

    // 4. Verify that database is now completely empty
    const [remainingRows] = await connection.query('SHOW TABLES;');
    if (remainingRows.length === 0) {
      console.log(`\n🎉 Success: All tables and data from [${dbName}] have been completely removed!`);
    } else {
      const remaining = remainingRows.map((r) => Object.values(r)[0]);
      console.warn(`\n⚠️ Notice: Some tables could not be removed:`, remaining.join(', '));
    }
  } catch (error) {
    console.error('❌ Error dropping tables:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  dropAllTables();
}

module.exports = { dropAllTables };

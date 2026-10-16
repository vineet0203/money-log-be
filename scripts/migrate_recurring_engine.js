require('dotenv').config();
const { pool } = require('../src/config/db');

async function migrateRecurringEngine() {
  const connection = await pool.getConnection();
  try {
    console.log('[Migration] Starting Recurring Engine schema migration (§2)...');

    // 1. Modify subscriptions status ENUM to include 'paused'
    console.log('[Migration] Updating subscriptions.status ENUM...');
    await connection.query(`
      ALTER TABLE subscriptions 
      MODIFY COLUMN status ENUM('active', 'paused', 'cancelled') NOT NULL DEFAULT 'active'
    `);

    // 2. Add recurrence fields to subscriptions if not present
    console.log('[Migration] Adding recurrence columns to subscriptions...');
    const [subCols] = await connection.query('DESCRIBE subscriptions');
    const existingColNames = new Set(subCols.map(c => c.Field));

    const columnsToAdd = [
      { name: 'frequency', ddl: "ENUM('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'custom') NOT NULL DEFAULT 'monthly' AFTER billing_cycle" },
      { name: 'interval_count', ddl: "INT NOT NULL DEFAULT 1 AFTER frequency" },
      { name: 'by_month_day', ddl: "INT NULL AFTER interval_count" },
      { name: 'by_weekday', ddl: "TINYINT NULL AFTER by_month_day" },
      { name: 'end_mode', ddl: "ENUM('never', 'on_date', 'after_n') NOT NULL DEFAULT 'never' AFTER by_weekday" },
      { name: 'end_date', ddl: "DATE NULL AFTER end_mode" },
      { name: 'occurrences_total', ddl: "INT NULL AFTER end_date" },
      { name: 'auto_post', ddl: "TINYINT(1) NOT NULL DEFAULT 0 AFTER occurrences_total" },
      { name: 'generated_through', ddl: "DATE NULL AFTER auto_post" },
      { name: 'is_push_enabled', ddl: "TINYINT(1) NOT NULL DEFAULT 0 AFTER is_email_enabled" },
    ];

    for (const col of columnsToAdd) {
      if (!existingColNames.has(col.name)) {
        console.log(`[Migration] Adding column ${col.name}...`);
        await connection.query(`ALTER TABLE subscriptions ADD COLUMN ${col.name} ${col.ddl}`);
      }
    }

    // 3. Create recurring_occurrences table
    console.log('[Migration] Creating recurring_occurrences table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS recurring_occurrences (
        id INT NOT NULL AUTO_INCREMENT,
        user_id INT NOT NULL,
        recurring_id INT NOT NULL,
        due_date DATE NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        status ENUM('due', 'paid', 'skipped', 'missed', 'cancelled') NOT NULL DEFAULT 'due',
        transaction_id INT DEFAULT NULL,
        paid_at TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY unique_recurring_due (recurring_id, due_date),
        KEY idx_user_status_due (user_id, status, due_date),
        KEY idx_recurring_id (recurring_id),
        KEY idx_transaction_id (transaction_id),
        CONSTRAINT fk_recurring_occ_sub FOREIGN KEY (recurring_id) REFERENCES subscriptions (id) ON DELETE CASCADE,
        CONSTRAINT fk_recurring_occ_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_recurring_occ_tx FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    // 4. Backfill existing subscriptions
    console.log('[Migration] Backfilling existing subscriptions...');
    await connection.query(`
      UPDATE subscriptions 
      SET 
        frequency = CASE WHEN billing_cycle = 'yearly' THEN 'yearly' ELSE 'monthly' END,
        interval_count = 1,
        by_month_day = DAY(start_date),
        end_mode = 'never',
        auto_post = 0
      WHERE frequency IS NULL OR frequency = ''
    `);

    console.log('[Migration] Schema migration completed successfully!');
  } catch (err) {
    console.error('[Migration] Failed:', err);
    throw err;
  } finally {
    connection.release();
    process.exit();
  }
}

migrateRecurringEngine();

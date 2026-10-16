const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function resetDatabase(options = {}) {
  const dbName = process.env.DB_NAME || 'moneylog';
  const dropOnly = options.dropOnly || process.argv.includes('--drop-only');
  const createOnly = options.createOnly || process.argv.includes('--create-only');

  console.log(`\n========================================================`);
  console.log(`[DB Manager] Target Database: [${dbName}]`);
  console.log(`========================================================`);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: dbName,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    multipleStatements: true,
  });

  try {
    // 1. Drop all tables if not in create-only mode
    if (!createOnly) {
      console.log(`\n[1/3] Dropping all existing tables...`);
      await connection.query('SET FOREIGN_KEY_CHECKS = 0;');

      const [existingRows] = await connection.query('SHOW TABLES;');
      const existingTables = existingRows.map((row) => Object.values(row)[0]);

      if (existingTables.length === 0) {
        console.log('  No existing tables found to drop.');
      } else {
        console.log(`  Found ${existingTables.length} table(s) to remove.`);
        for (const table of existingTables) {
          await connection.query(`DROP TABLE IF EXISTS \`${table}\`;`);
          console.log(`  ✓ Dropped table: ${table}`);
        }
      }

      await connection.query('SET FOREIGN_KEY_CHECKS = 1;');

      if (dropOnly) {
        console.log(`\n🎉 Success: All tables in [${dbName}] dropped successfully.`);
        return;
      }
    }

    // 2. Create tables from master schema.sql
    console.log(`\n[2/3] Applying schema from schema.sql...`);
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Master schema file not found at: ${schemaPath}`);
    }

    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await connection.query(schemaSql);

    // 3. Verify created tables
    const [createdTables] = await connection.query('SHOW TABLES;');
    const tableNames = createdTables.map((r) => Object.values(r)[0]);

    console.log(`\n[3/3] Verification: ${tableNames.length} tables active in [${dbName}]:`);
    tableNames.forEach((t) => console.log(`  ✓ ${t}`));

    // 4. Seed default POS settings & categories for any existing users
    try {
      const [users] = await connection.query('SELECT id, name FROM users');
      if (users.length > 0) {
        console.log(`\nFound ${users.length} registered user(s). Verifying starter defaults...`);
        for (const user of users) {
          const [existingSettings] = await connection.query(
            'SELECT id FROM pos_settings WHERE user_id = ?',
            [user.id]
          );
          if (existingSettings.length === 0) {
            await connection.query(
              `INSERT INTO pos_settings (user_id, store_name, tagline, upi_id, default_tax_rate, currency_symbol, currency_code, paper_width)
               VALUES (?, 'MoneyLog Store', 'Artisan Store & Roastery', 'moneylogpos@okaxis', 8.00, '$', 'USD', '80mm')`,
              [user.id]
            );
          }

          const [existingCats] = await connection.query(
            'SELECT id FROM pos_categories WHERE user_id = ?',
            [user.id]
          );
          if (existingCats.length === 0) {
            const starterCats = [
              { name: 'Coffee Beans', slug: 'coffee-beans', icon: 'Coffee' },
              { name: 'Beverages', slug: 'beverages', icon: 'CupSoda' },
              { name: 'Pastries & Bakery', slug: 'pastries-bakery', icon: 'Croissant' },
              { name: 'Merchandise & Gear', slug: 'merchandise-gear', icon: 'ShoppingBag' },
            ];
            for (const cat of starterCats) {
              await connection.query(
                'INSERT INTO pos_categories (user_id, name, slug, icon) VALUES (?, ?, ?, ?)',
                [user.id, cat.name, cat.slug, cat.icon]
              );
            }
          }
        }
      }
    } catch (seedErr) {
      console.warn('Notice while verifying defaults:', seedErr.message);
    }

    console.log(`\n🎉 Success: Database setup complete! All ${tableNames.length} tables ready.`);
  } catch (error) {
    console.error('\n❌ Database operation failed:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  resetDatabase();
}

module.exports = { resetDatabase };

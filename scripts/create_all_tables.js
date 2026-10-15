const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function createAllTables() {
  const dbName = process.env.DB_NAME || 'moneylog';
  console.log(`Connecting to MySQL database [${dbName}] to create all tables...`);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: dbName,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    multipleStatements: true,
  });

  try {
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found at: ${schemaPath}`);
    }

    console.log(`Reading unified schema from: ${schemaPath}`);
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('Executing DDL statements to create all tables (personal finance, account transactions & POS subsystem)...');
    await connection.query(schemaSql);

    // Verify all created tables
    const [tables] = await connection.query('SHOW TABLES;');
    const tableNames = tables.map((r) => Object.values(r)[0]);

    console.log(`\n✅ Successfully verified ${tableNames.length} tables in database:`);
    tableNames.forEach((t) => console.log(`  ✓ ${t}`));

    // Seed default POS settings & categories for any existing users
    try {
      const [users] = await connection.query('SELECT id, name FROM users');
      if (users.length > 0) {
        console.log(`\nFound ${users.length} registered user(s). Verifying default POS setup...`);

        for (const user of users) {
          // 1. Seed POS Settings if not present
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
            console.log(`  + Seeded default POS settings for user ${user.id} (${user.name})`);
          }

          // 2. Seed starter categories if not present
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
            console.log(`  + Seeded default POS categories for user ${user.id}`);
          }
        }
      }
    } catch (seedErr) {
      console.warn('Notice while checking user POS seed defaults:', seedErr.message);
    }

    console.log(`\n🎉 Database setup complete! All ${tableNames.length} tables created and ready.`);
  } catch (error) {
    console.error('❌ Error creating tables:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  createAllTables();
}

module.exports = { createAllTables };

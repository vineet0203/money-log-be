const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function migratePos() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'moneylog',
    multipleStatements: true,
  });

  try {
    console.log('Connecting to MySQL database:', process.env.DB_NAME || 'moneylog');
    const sqlPath = path.join(__dirname, 'src', 'database', 'pos_schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Executing POS schema DDL...');
    await connection.query(sql);
    console.log('✅ All POS tables successfully created/verified!');

    // Check users to seed initial POS categories for existing users
    const [users] = await connection.query('SELECT id, name FROM users');
    console.log(`Found ${users.length} registered user(s).`);

    for (const user of users) {
      // 1. Seed default POS settings if not present
      const [existingSettings] = await connection.query(
        'SELECT id FROM pos_settings WHERE user_id = ?',
        [user.id]
      );
      if (existingSettings.length === 0) {
        await connection.query(
          `INSERT INTO pos_settings (user_id, store_name, tagline, upi_id, default_tax_rate, currency_symbol, currency_code, paper_width)
           VALUES (?, 'Coffee & Co. Roastery', 'Artisan Coffee & Bakery', 'pos@okaxis', 8.00, '$', 'USD', '80mm')`,
          [user.id]
        );
        console.log(`- Created default POS settings for user ${user.id} (${user.name})`);
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
        console.log(`- Seeded 4 default POS categories for user ${user.id}`);
      }
    }

    console.log('🎉 POS Migration completed successfully!');
  } catch (error) {
    console.error('❌ Error executing POS migration:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

migratePos();

require('dotenv').config();
const { pool } = require('../src/config/db');

async function run() {
  try {
    console.log("Adding columns to account_transactions...");
    await pool.query(`
      ALTER TABLE account_transactions
      ADD COLUMN datetime DATETIME DEFAULT NULL,
      ADD COLUMN authorized_date DATE DEFAULT NULL,
      ADD COLUMN authorized_datetime DATETIME DEFAULT NULL,
      ADD COLUMN location JSON DEFAULT NULL,
      ADD COLUMN payment_meta JSON DEFAULT NULL
    `);
    console.log("Columns added successfully!");
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log("Columns already exist.");
    } else {
      console.error(err);
    }
  } finally {
    process.exit(0);
  }
}

run();

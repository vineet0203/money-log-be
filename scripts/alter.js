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
    `).catch(err => {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
      console.log("account_transactions columns already exist.");
    });
    
    console.log("Adding plaid_raw_data to accounts...");
    await pool.query(`
      ALTER TABLE accounts
      ADD COLUMN plaid_raw_data JSON DEFAULT NULL
    `).catch(err => {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
      console.log("accounts.plaid_raw_data already exists.");
    });

    console.log("Adding plaid_raw_data to plaid_items...");
    await pool.query(`
      ALTER TABLE plaid_items
      ADD COLUMN plaid_raw_data JSON DEFAULT NULL
    `).catch(err => {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
      console.log("plaid_items.plaid_raw_data already exists.");
    });

    console.log("All columns added successfully!");
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();

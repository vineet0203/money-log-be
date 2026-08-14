const mysql = require('mysql2/promise');
require('dotenv').config();

async function runMigration() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'money_log_db',
  });

  const query = `
    CREATE TABLE IF NOT EXISTS \`liability_aprs\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`account_liability_id\` int NOT NULL,
      \`apr_type\` varchar(50) NOT NULL,
      \`apr_percentage\` decimal(6,3) DEFAULT NULL,
      \`balance_subject_to_apr\` decimal(15,2) DEFAULT NULL,
      \`interest_charge_amount\` decimal(15,2) DEFAULT NULL,
      \`created_at\` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uniq_liability_apr_type\` (\`account_liability_id\`, \`apr_type\`),
      CONSTRAINT \`liability_aprs_ibfk_1\` FOREIGN KEY (\`account_liability_id\`) REFERENCES \`account_liabilities\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `;

  try {
    await connection.execute('DROP TABLE IF EXISTS `liability_aprs`;');
    await connection.execute(query);
    console.log("Migration successful!");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await connection.end();
  }
}

runMigration();

// Root convenience wrapper for scripts/create_all_tables.js
const { createAllTables } = require('./scripts/create_all_tables');

if (require.main === module) {
  createAllTables();
}

module.exports = { createAllTables };

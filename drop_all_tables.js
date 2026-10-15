// Root convenience wrapper for scripts/drop_all_tables.js
const { dropAllTables } = require('./scripts/drop_all_tables');

if (require.main === module) {
  dropAllTables();
}

module.exports = { dropAllTables };

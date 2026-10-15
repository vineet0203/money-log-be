// Clean/drop all tables with their data
const { dropAllTables } = require('./scripts/drop_all_tables');

if (require.main === module) {
  dropAllTables();
}

module.exports = { dropAllTables };

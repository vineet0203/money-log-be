# Database Guidelines

## Schema Updates
**CRITICAL RULE:** Any time you write code that changes the database schema (e.g. creating new tables, altering columns, adding indexes), you **MUST** immediately update the `schema.sql` file in the root directory.

This file serves as the single source of truth for the database structure. Keeping it updated ensures that when the application is deployed to new environments (or when new developers clone the project), the database can be reconstructed perfectly.

### Workflow for adding a table:
1. Create the table in your local or live MySQL database.
2. Generate the `CREATE TABLE` script (or write it out manually).
3. Paste the `DROP TABLE IF EXISTS ...` and `CREATE TABLE ...` script into `schema.sql`.
4. Commit the updated `schema.sql` along with your code changes.

Failure to do this will result in production crashes (like `ER_NO_SUCH_TABLE`) because the live servers may not have received your ad-hoc queries.

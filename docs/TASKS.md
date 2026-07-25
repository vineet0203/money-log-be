# Plaid Integration - Remaining Tasks

This document tracks the outstanding tasks and improvements needed to make the Plaid integration robust and production-ready. 
Mark tasks as done by changing `[ ]` to `[x]`, which will render them with a ~~strikethrough~~ depending on your markdown viewer!

- [ ] **Plaid "Update Mode" (Token Expiration)**
  - Detect `ITEM_LOGIN_REQUIRED` errors from Plaid (e.g., when a user changes their bank password or requires MFA).
  - Implement "Update Mode" in the frontend to launch Plaid Link so users can re-authenticate without deleting and re-adding the bank.

- [ ] **Webhooks (Automatic Background Syncing)**
  - Create a `/api/plaid/webhook` endpoint on the backend.
  - Configure Plaid to send webhooks to this endpoint.
  - Automatically update database balances when Plaid notifies us of a change, without requiring manual user refreshes.

- [ ] **Fetching Transactions**
  - Integrate Plaid's `/transactions/sync` endpoint.
  - Fetch and store historical and ongoing transactions (deposits, expenses) into the application's `transactions` table.

- [ ] **Smart Cascading Deletes**
  - Update the account deletion logic.
  - If a user deletes the very last account associated with a specific bank connection, automatically sever the Plaid Item connection to clean up unused `access_token`s.

- [x] **Refresh Rate Limiting (Spam Prevention)**
  - Implement a cooldown mechanism (e.g., 1 minute) on the "Refresh Balance" button for Plaid accounts.
  - Prevent users from spamming the Plaid API and hitting rate limits or being temporarily blocked.

- [ ] **Duplicate Bank Prevention**
  - Add logic during the public token exchange to check if the user has already linked this `institution_id`.
  - Prevent the creation of duplicate Plaid Items and accounts if the user tries to connect the exact same bank twice.

- [ ] **Plaid Identity (Account Holder Names)**
  - Add the `identity` product to `PLAID_PRODUCTS` in `.env`.
  - Call `plaidClient.identityGet()` after token exchange to fetch true account owner names, emails, and phone numbers.
  - Save this data into the `holder_name` database column instead of using the bank's marketing product name.

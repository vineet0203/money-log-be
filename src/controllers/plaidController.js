const {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
} = require("plaid");
require("dotenv").config();
const { pool } = require("../config/db");

const PLAID_PRODUCTS = (
  process.env.PLAID_PRODUCTS || Products.Transactions
).split(",");

const PLAID_COUNTRY_CODES = (process.env.PLAID_COUNTRY_CODES || "US,CA").split(
  ",",
);

const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || "sandbox"],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

exports.createLinkToken = async (req, res) => {
  try {
    const request = {
      user: {
        // req.user.id comes from verifyToken middleware
        client_user_id: req.user ? req.user.id.toString() : "guest",
      },
      client_name: "Money Log",
      products: PLAID_PRODUCTS,
      country_codes: PLAID_COUNTRY_CODES,
      language: "en",
    };

    // Optional: Only include webhook if you configure one later
    // if (process.env.PLAID_WEBHOOK_URL) {
    //   request.webhook = process.env.PLAID_WEBHOOK_URL;
    // }

    const response = await plaidClient.linkTokenCreate(request);
    res.json(response.data);
  } catch (error) {
    console.error(
      "Error creating link token:",
      error.response?.data || error.message,
    );
    res
      .status(500)
      .json({ error: error.response?.data?.error_message || error.message });
  }
};

exports.exchangePublicToken = async (req, res) => {
  try {
    const { public_token } = req.body;
    if (!public_token) {
      return res.status(400).json({ error: "public_token is required" });
    }

    // Step 1: Exchange public token for access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token: public_token,
    });
    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    // Step 2: Get institution details
    const itemResponse = await plaidClient.itemGet({
      access_token: accessToken,
    });
    const institutionId = itemResponse.data.item.institution_id;

    let institutionName = null;
    let institutionLogo = null;
    let institutionColor = null;
    let institutionRawData = null;
    if (institutionId) {
      try {
        const instResponse = await plaidClient.institutionsGetById({
          institution_id: institutionId,
          country_codes: PLAID_COUNTRY_CODES,
          options: { include_optional_metadata: true },
        });
        institutionName = instResponse.data.institution.name;
        institutionLogo = instResponse.data.institution.logo || null;
        institutionColor = instResponse.data.institution.primary_color || null;
        institutionRawData = JSON.stringify(instResponse.data.institution);
      } catch (instError) {
        console.warn("Could not fetch institution details:", instError.message);
      }
    }

    // Step 3: Save the plaid item
    await pool.query(
      "INSERT INTO plaid_items (user_id, item_id, access_token, institution_id, institution_name, plaid_raw_data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        req.user.id,
        itemId,
        accessToken,
        institutionId,
        institutionName,
        institutionRawData,
      ],
    );

    // Step 4: Fetch linked accounts from Plaid
    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
    });
    const plaidAccounts = accountsResponse.data.accounts;

    // Step 5: Save each account into the accounts table
    const savedAccounts = [];
    for (const account of plaidAccounts) {
      // Map Plaid account type to our type enum
      let accountType = "bank";
      if (account.type === "credit" || account.type === "loan") {
        accountType = "card";
      }

      let accountBalance = account.balances.current || 0;
      let availableBalance =
        account.balances.available !== null ? account.balances.available : null;
      let creditLimit =
        account.balances.limit !== null ? account.balances.limit : null;

      const [result] = await pool.query(
        `INSERT INTO accounts (user_id, type, subtype, name, account_number, balance, available_balance, credit_limit, holder_name, provider, external_id, logo, color, plaid_raw_data, last_balance_sync) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'plaid', ?, ?, ?, ?, NOW())`,
        [
          req.user.id,
          accountType,
          account.subtype || null,
          account.name,
          account.mask || null,
          accountBalance,
          availableBalance,
          creditLimit,
          account.official_name || account.name,
          account.account_id,
          institutionLogo,
          institutionColor,
          JSON.stringify(account),
        ],
      );

      const [newAccount] = await pool.query(
        "SELECT * FROM accounts WHERE id = ?",
        [result.insertId],
      );
      savedAccounts.push(newAccount[0]);
    }

    // IMPORTANT: Never send the access_token back to the client!
    res.json({
      public_token_exchange: "complete",
      item_id: itemId,
      institution_name: institutionName,
      accounts_linked: savedAccounts.length,
      accounts: savedAccounts,
    });
  } catch (error) {
    console.error(
      "Error exchanging public token:",
      error.response?.data || error.message,
    );
    res
      .status(500)
      .json({ error: error.response?.data?.error_message || error.message });
  }
};

// Get all Plaid-connected items (banks) for the user
exports.getPlaidItems = async (req, res) => {
  try {
    const [items] = await pool.query(
      "SELECT id, user_id, item_id, institution_id, institution_name, status, created_at FROM plaid_items WHERE user_id = ? ORDER BY created_at DESC",
      [req.user.id],
    );
    res.json({ data: items });
  } catch (error) {
    console.error("Error fetching plaid items:", error);
    res.status(500).json({ error: "Failed to fetch linked banks" });
  }
};

// Remove a Plaid item (disconnect a bank) and its associated accounts
exports.removePlaidItem = async (req, res) => {
  try {
    const { itemId } = req.params;

    // Find the plaid item
    const [items] = await pool.query(
      "SELECT * FROM plaid_items WHERE id = ? AND user_id = ?",
      [itemId, req.user.id],
    );

    if (items.length === 0) {
      return res.status(404).json({ error: "Linked bank not found" });
    }

    const plaidItem = items[0];

    // Remove the item from Plaid's side
    try {
      await plaidClient.itemRemove({ access_token: plaidItem.access_token });
    } catch (plaidError) {
      console.warn("Could not remove item from Plaid:", plaidError.message);
    }

    // Delete all accounts linked via this plaid item's external_ids
    // First get account_ids from Plaid to know which accounts to delete
    try {
      const accountsResponse = await plaidClient.accountsGet({
        access_token: plaidItem.access_token,
      });
      const plaidAccountIds = accountsResponse.data.accounts.map(
        (a) => a.account_id,
      );
      if (plaidAccountIds.length > 0) {
        await pool.query(
          "DELETE FROM accounts WHERE user_id = ? AND provider = ? AND external_id IN (?)",
          [req.user.id, "plaid", plaidAccountIds],
        );
      }
    } catch (fetchError) {
      // If we can't fetch from Plaid (e.g. token already invalid), delete by provider
      console.warn(
        "Could not fetch accounts from Plaid, deleting by provider:",
        fetchError.message,
      );
    }

    // Delete the plaid item from our database
    await pool.query("DELETE FROM plaid_items WHERE id = ?", [plaidItem.id]);

    res.json({ message: "Bank disconnected successfully" });
  } catch (error) {
    console.error("Error removing plaid item:", error);
    res.status(500).json({ error: "Failed to disconnect bank" });
  }
};

// Sync account balance from Plaid
exports.syncBalance = async (req, res) => {
  try {
    const { id } = req.body;

    // 1. Get the account
    const [accounts] = await pool.query(
      "SELECT * FROM accounts WHERE id = ? AND user_id = ?",
      [id, req.user.id],
    );
    if (accounts.length === 0) {
      return res.status(404).json({ error: "Account not found" });
    }
    const account = accounts[0];
    if (account.provider !== "plaid") {
      return res.status(400).json({ error: "Can only sync Plaid accounts" });
    }

    // Rate Limiting (90 seconds)
    const lastUpdated = new Date(
      account.last_balance_sync || account.created_at,
    ).getTime();
    const now = Date.now();
    const diffSeconds = (now - lastUpdated) / 1000;

    if (diffSeconds < 90) {
      return res.status(429).json({
        error: `Please wait ${Math.ceil(90 - diffSeconds)} seconds before refreshing this account again.`,
      });
    }

    // 2. Find the Plaid Item that has this account and fetch balances
    const [items] = await pool.query(
      "SELECT access_token FROM plaid_items WHERE user_id = ?",
      [req.user.id],
    );
    let newBalance = null;
    let found = false;

    for (const item of items) {
      try {
        const balanceResponse = await plaidClient.accountsBalanceGet({
          access_token: item.access_token,
          options: {
            account_ids: [account.external_id],
          },
        });
        const plaidAccounts = balanceResponse.data.accounts;
        const plaidAccount = plaidAccounts.find(
          (a) => a.account_id === account.external_id,
        );

        if (plaidAccount) {
          const newBalance = plaidAccount.balances.current || 0;
          const availableBalance =
            plaidAccount.balances.available !== null
              ? plaidAccount.balances.available
              : null;
          const creditLimit =
            plaidAccount.balances.limit !== null
              ? plaidAccount.balances.limit
              : null;

          // Update the account balance and raw data in our DB, and set last_balance_sync to NOW()
          await pool.query(
            `UPDATE accounts 
             SET balance = ?, 
                 available_balance = ?, 
                 credit_limit = ?, 
                 plaid_raw_data = ?, 
                 last_balance_sync = NOW() 
             WHERE id = ?`,
            [
              newBalance,
              availableBalance,
              creditLimit,
              JSON.stringify(plaidAccount),
              account.id,
            ],
          );

          return res.json({
            message: "Balance synced successfully",
            balance: newBalance,
            available_balance: availableBalance,
            credit_limit: creditLimit,
            last_balance_sync: new Date().toISOString(),
          });
        }
      } catch (err) {
        if (err.response?.data?.error_code !== "INVALID_ACCOUNT_ID") {
          console.warn(
            "Error fetching balance for an item:",
            err.response?.data?.error_message || err.message,
          );
        }
      }
    }

    if (!found) {
      return res
        .status(404)
        .json({
          error:
            "Could not sync balance from Plaid (account not found in linked items)",
        });
    }
  } catch (error) {
    console.error("Error syncing balance:", error);
    res.status(500).json({ error: "Failed to sync balance" });
  }
};

// Sync all transactions for all linked banks
exports.syncAllTransactions = async (req, res) => {
  try {
    // Configurable loop limit. Set to null to process all available historical chunks.
    const MAX_LOOPS = null;

    // 1. Get all Plaid Items for the user
    const [items] = await pool.query(
      "SELECT id, access_token, transaction_cursor FROM plaid_items WHERE user_id = ?",
      [req.user.id],
    );

    // 2. Get a mapping of Plaid account_id -> Local DB account.id
    const [accounts] = await pool.query(
      'SELECT id, external_id FROM accounts WHERE user_id = ? AND provider = "plaid"',
      [req.user.id],
    );
    const accountMap = {};
    accounts.forEach((acc) => {
      if (acc.external_id) {
        accountMap[acc.external_id] = acc.id;
      }
    });

    let totalAdded = 0;
    let totalModified = 0;
    let totalRemoved = 0;

    // 3. Process each Plaid Item
    for (const item of items) {
      let hasMore = true;
      let cursor = item.transaction_cursor;
      let loopCount = 0;

      while (hasMore && (MAX_LOOPS === null || loopCount < MAX_LOOPS)) {
        try {
          const syncResponse = await plaidClient.transactionsSync({
            access_token: item.access_token,
            cursor: cursor || undefined,
          });

          const data = syncResponse.data;

          // Handle Added and Modified Transactions
          const upsertTransactions = [...data.added, ...data.modified];
          for (const txn of upsertTransactions) {
            const localAccountId = accountMap[txn.account_id];
            if (!localAccountId) continue;

            await pool.query(
              `INSERT INTO account_transactions (
                user_id, account_id, provider_transaction_id, amount, date, name, merchant_name, 
                logo_url, currency, payment_channel, primary_category, detailed_category, pending,
                datetime, authorized_date, authorized_datetime, location, payment_meta
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
              ON DUPLICATE KEY UPDATE 
                amount = VALUES(amount), date = VALUES(date), name = VALUES(name), merchant_name = VALUES(merchant_name),
                logo_url = VALUES(logo_url), currency = VALUES(currency), payment_channel = VALUES(payment_channel),
                primary_category = VALUES(primary_category), detailed_category = VALUES(detailed_category), pending = VALUES(pending),
                datetime = VALUES(datetime), authorized_date = VALUES(authorized_date), authorized_datetime = VALUES(authorized_datetime),
                location = VALUES(location), payment_meta = VALUES(payment_meta)`,
              [
                req.user.id,
                localAccountId,
                txn.transaction_id,
                txn.amount,
                txn.date,
                txn.name,
                txn.merchant_name || null,
                txn.logo_url || null,
                txn.iso_currency_code || "USD",
                txn.payment_channel || null,
                txn.personal_finance_category?.primary || null,
                txn.personal_finance_category?.detailed || null,
                txn.pending ? 1 : 0,
                txn.datetime || null,
                txn.authorized_date || null,
                txn.authorized_datetime || null,
                txn.location ? JSON.stringify(txn.location) : null,
                txn.payment_meta ? JSON.stringify(txn.payment_meta) : null,
              ],
            );
          }

          totalAdded += data.added.length;
          totalModified += data.modified.length;

          // Handle Removed Transactions
          for (const txn of data.removed) {
            await pool.query(
              "DELETE FROM account_transactions WHERE provider_transaction_id = ? AND user_id = ?",
              [txn.transaction_id, req.user.id],
            );
          }
          totalRemoved += data.removed.length;

          // Update cursor and has_more
          cursor = data.next_cursor;
          hasMore = data.has_more;
          loopCount++;
        } catch (syncError) {
          console.error(
            `Error syncing transactions for item ${item.id}:`,
            syncError.response?.data || syncError.message,
          );
          break; // Break the loop for this item and move to the next item
        }
      }

      // Save the final cursor to the database
      if (cursor !== item.transaction_cursor) {
        await pool.query(
          "UPDATE plaid_items SET transaction_cursor = ? WHERE id = ?",
          [cursor, item.id],
        );
      }
    }

    res.json({
      message: "Transactions synced successfully",
      stats: {
        added: totalAdded,
        modified: totalModified,
        removed: totalRemoved,
      },
    });
  } catch (error) {
    console.error("Error syncing transactions:", error);
    res.status(500).json({ error: "Failed to sync transactions" });
  }
};

const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
require('dotenv').config();
const { pool } = require('../config/db');

const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});
const plaidClient = new PlaidApi(configuration);

/**
 * POST /api/dev/fire-webhook
 * Fires a Plaid sandbox webhook for a given item.
 * Body: { item_id: string, webhook_code: string }
 * webhook_type is fixed to TRANSACTIONS.
 * Only works in sandbox environment.
 */
exports.fireWebhook = async (req, res) => {
  if (process.env.PLAID_ENV !== 'sandbox') {
    return res.status(403).json({ error: 'This endpoint is only available in sandbox environment' });
  }

  const { item_id, webhook_code } = req.body;

  if (!webhook_code) {
    return res.status(400).json({ error: 'webhook_code is required (e.g. SYNC_UPDATES_AVAILABLE)' });
  }

  try {
    // Look up the item from our DB — item_id is optional, defaults to user's first item
    let query, params;
    if (item_id) {
      query = 'SELECT access_token, item_id FROM plaid_items WHERE item_id = ? AND user_id = ?';
      params = [item_id, req.user.id];
    } else {
      query = 'SELECT access_token, item_id FROM plaid_items WHERE user_id = ? LIMIT 1';
      params = [req.user.id];
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No linked Plaid item found for this user' });
    }

    const item = rows[0];

    const response = await plaidClient.sandboxItemFireWebhook({
      access_token: item.access_token,
      webhook_type: 'TRANSACTIONS',
      webhook_code,
    });

    res.json({
      message: 'Webhook fired successfully',
      item_id: item.item_id,
      webhook_type: 'TRANSACTIONS',
      webhook_code,
      plaid_response: response.data,
      webhook_url: process.env.PLAID_WEBHOOK_URL || null,
    });
  } catch (error) {
    console.error('Error firing sandbox webhook:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.error_message || 'Failed to fire webhook' });
  }
};

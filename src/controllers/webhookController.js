const { pool } = require("../config/db");
const { syncTransactionsForItem, syncLiabilitiesForItem } = require("../services/plaidServices");

exports.handlePlaidWebhook = async (req, res) => {
  const payload = req.body;
  const { webhook_type, webhook_code, item_id, asset_report_id } = payload;

  console.log("🔔 Plaid webhook:", webhook_type, webhook_code, item_id || asset_report_id);

  // Respond immediately — Plaid must get 200 fast, never make it wait on sync work
  res.status(200).json({ received: true });

  try {
    switch (webhook_type) {
      case 'TRANSACTIONS': {
        if (webhook_code !== 'SYNC_UPDATES_AVAILABLE') break;
        const [rows] = await pool.query(
          "SELECT id, access_token, transaction_cursor, user_id FROM plaid_items WHERE item_id = ?",
          [item_id]
        );
        if (rows.length === 0) {
          console.warn(`Webhook for unknown item_id: ${item_id}`);
          break;
        }
        await syncTransactionsForItem(rows[0]);
        break;
      }

      case 'LIABILITIES': {
        if (webhook_code !== 'DEFAULT_UPDATE') break;
        const [rows] = await pool.query(
          "SELECT id, access_token, user_id FROM plaid_items WHERE item_id = ?",
          [item_id]
        );
        if (rows.length === 0) {
          console.warn(`Webhook for unknown item_id: ${item_id}`);
          break;
        }
        await syncLiabilitiesForItem(rows[0]);
        break;
      }

      case 'ASSETS': {
        if (webhook_code === 'PRODUCT_READY') {
          await pool.query(
            "UPDATE asset_reports SET status = 'ready', ready_at = NOW() WHERE asset_report_id = ?",
            [asset_report_id]
          );
        } else if (webhook_code === 'ERROR') {
          await pool.query(
            "UPDATE asset_reports SET status = 'error' WHERE asset_report_id = ?",
            [asset_report_id]
          );
        }
        break;
      }

      case 'ITEM': {
        if (webhook_code === 'ERROR') {
          await pool.query(
            "UPDATE plaid_items SET status = 'login_required' WHERE item_id = ?",
            [item_id]
          );
          console.warn(`Item ${item_id} requires re-authentication.`);
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    // Response already sent — just log; don't let this crash the process
    console.error("Error processing webhook payload:", err.response?.data || err.message);
  }
};

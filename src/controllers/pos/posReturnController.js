const { pool } = require('../../config/db');
const { createPosReturnSchema, createPosExchangeSchema } = require('../../validations/pos/posReturnValidation');

/**
 * Generate unique sequential Return Number: RET-YYYYMMDD-XXXX
 */
async function generateReturnNumber(connection, userId) {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

  const [countResult] = await connection.query(
    `SELECT COUNT(*) as count 
     FROM pos_returns 
     WHERE user_id = ? AND DATE(created_at) = CURDATE()`,
    [userId]
  );

  const nextSeq = String((countResult[0]?.count || 0) + 1).padStart(4, '0');
  let returnNumber = `RET-${dateStr}-${nextSeq}`;

  const [exists] = await connection.query(
    'SELECT id FROM pos_returns WHERE user_id = ? AND return_number = ?',
    [userId, returnNumber]
  );
  if (exists.length > 0) {
    returnNumber = `RET-${dateStr}-${nextSeq}-${Math.floor(Math.random() * 900 + 100)}`;
  }

  return returnNumber;
}

/**
 * Generate unique sequential Exchange Number: EXC-YYYYMMDD-XXXX
 */
async function generateExchangeNumber(connection, userId) {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

  const [countResult] = await connection.query(
    `SELECT COUNT(*) as count 
     FROM pos_exchanges 
     WHERE user_id = ? AND DATE(created_at) = CURDATE()`,
    [userId]
  );

  const nextSeq = String((countResult[0]?.count || 0) + 1).padStart(4, '0');
  let exchangeNumber = `EXC-${dateStr}-${nextSeq}`;

  const [exists] = await connection.query(
    'SELECT id FROM pos_exchanges WHERE user_id = ? AND exchange_number = ?',
    [userId, exchangeNumber]
  );
  if (exists.length > 0) {
    exchangeNumber = `EXC-${dateStr}-${nextSeq}-${Math.floor(Math.random() * 900 + 100)}`;
  }

  return exchangeNumber;
}

/**
 * GET /api/pos/returns
 * List all processed returns
 */
exports.getReturns = async (req, res) => {
  const userId = req.user.id;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const search = req.query.search?.trim();

  try {
    let whereClause = 'WHERE r.user_id = ?';
    const params = [userId];

    if (search) {
      whereClause += ' AND (r.return_number LIKE ? OR o.order_number LIKE ? OR r.customer_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total 
       FROM pos_returns r
       JOIN pos_orders o ON r.original_order_id = o.id
       ${whereClause}`,
      params
    );
    const total = countResult[0]?.total || 0;

    const [rows] = await pool.query(
      `SELECT 
        r.id,
        r.return_number,
        r.original_order_id,
        o.order_number as original_order_number,
        o.order_date,
        o.grand_total as original_order_total,
        o.customer_name as original_customer_name,
        o.customer_phone as original_customer_phone,
        r.customer_name,
        r.refund_amount,
        r.refund_mode,
        r.status,
        r.reason,
        r.items_summary,
        r.returned_items_json,
        r.notes,
        r.created_at
       FROM pos_returns r
       JOIN pos_orders o ON r.original_order_id = o.id
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const formattedRows = rows.map(r => ({
      ...r,
      refund_amount: Number(r.refund_amount),
      original_order_total: Number(r.original_order_total || 0),
      returned_items: typeof r.returned_items_json === 'string'
        ? JSON.parse(r.returned_items_json)
        : (r.returned_items_json || null),
    }));

    res.json({
      success: true,
      data: formattedRows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching POS returns:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch returns history' });
  }
};

/**
 * GET /api/pos/returns/exchanges
 * List all processed exchanges
 */
exports.getExchanges = async (req, res) => {
  const userId = req.user.id;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const search = req.query.search?.trim();

  try {
    let whereClause = 'WHERE e.user_id = ?';
    const params = [userId];

    if (search) {
      whereClause += ' AND (e.exchange_number LIKE ? OR o.order_number LIKE ? OR e.customer_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total 
       FROM pos_exchanges e
       JOIN pos_orders o ON e.original_order_id = o.id
       ${whereClause}`,
      params
    );
    const total = countResult[0]?.total || 0;

    const [rows] = await pool.query(
      `SELECT 
        e.id,
        e.exchange_number,
        e.original_order_id,
        o.order_number as original_order_number,
        o.order_date,
        o.grand_total as original_order_total,
        o.customer_name as original_customer_name,
        o.customer_phone as original_customer_phone,
        e.customer_name,
        e.returned_desc,
        e.replacement_desc,
        e.price_difference,
        e.payment_mode,
        e.returned_items_json,
        e.replacement_items_json,
        e.notes,
        e.status,
        e.created_at
       FROM pos_exchanges e
       JOIN pos_orders o ON e.original_order_id = o.id
       ${whereClause}
       ORDER BY e.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const formattedRows = rows.map(e => ({
      ...e,
      price_difference: Number(e.price_difference),
      original_order_total: Number(e.original_order_total || 0),
      returned_items: typeof e.returned_items_json === 'string'
        ? JSON.parse(e.returned_items_json)
        : (e.returned_items_json || null),
      replacement_items: typeof e.replacement_items_json === 'string'
        ? JSON.parse(e.replacement_items_json)
        : (e.replacement_items_json || null),
    }));

    res.json({
      success: true,
      data: formattedRows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching POS exchanges:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch exchanges history' });
  }
};

/**
 * GET /api/pos/returns/check-eligibility/:orderId
 * Check if order is within configured return & exchange window
 */
exports.checkReturnEligibility = async (req, res) => {
  const userId = req.user.id;
  const orderId = req.params.orderId;

  try {
    const [orderRows] = await pool.query(
      `SELECT o.id, o.order_number, o.order_date, o.customer_name, o.grand_total, o.status,
              cfg.return_window_days as cfg_return_window_days
       FROM pos_orders o
       LEFT JOIN pos_order_receipt_configs cfg ON cfg.order_id = o.id
       WHERE o.id = ? AND o.user_id = ?`,
      [orderId, userId]
    );

    if (orderRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const order = orderRows[0];

    // Determine return window (from snapshot config or current settings)
    let returnWindowDays = order.cfg_return_window_days;
    if (returnWindowDays === null || returnWindowDays === undefined) {
      const [settingsRows] = await pool.query(
        'SELECT return_window_days FROM pos_settings WHERE user_id = ?',
        [userId]
      );
      returnWindowDays = settingsRows[0]?.return_window_days ?? 14;
    }
    returnWindowDays = Number(returnWindowDays);

    const orderDate = new Date(order.order_date);
    const now = new Date();
    const diffMs = now.getTime() - orderDate.getTime();
    const daysElapsed = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

    const isEligible = returnWindowDays > 0 && daysElapsed <= returnWindowDays && order.status !== 'refunded';
    const daysRemaining = Math.max(0, returnWindowDays - daysElapsed);

    res.json({
      success: true,
      data: {
        order_id: order.id,
        order_number: order.order_number,
        order_date: order.order_date,
        customer_name: order.customer_name,
        grand_total: order.grand_total,
        order_status: order.status,
        return_window_days: returnWindowDays,
        days_elapsed: daysElapsed,
        days_remaining: daysRemaining,
        is_eligible: isEligible,
        policy_message: order.status === 'refunded'
          ? 'This order has already been fully refunded.'
          : returnWindowDays === 0
          ? 'Returns and exchanges are not allowed (No Returns policy).'
          : isEligible
          ? `Eligible for return or exchange (${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} remaining in ${returnWindowDays}-day window).`
          : `Return window expired. This order was placed ${daysElapsed} days ago, exceeding the ${returnWindowDays}-day return limit.`,
      },
    });
  } catch (error) {
    console.error('Error checking return eligibility:', error);
    res.status(500).json({ success: false, error: 'Failed to verify return eligibility' });
  }
};

/**
 * POST /api/pos/returns
 * Process a return / refund within policy window
 * Restores product variant inventory and updates sales order status
 */
exports.createReturn = async (req, res) => {
  const userId = req.user.id;

  let connection;
  try {
    const validated = createPosReturnSchema.parse(req.body);
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Fetch original order
    const [orderRows] = await connection.query(
      `SELECT o.id, o.order_number, o.order_date, o.customer_name, o.grand_total, o.status,
              cfg.return_window_days as cfg_return_window_days
       FROM pos_orders o
       LEFT JOIN pos_order_receipt_configs cfg ON cfg.order_id = o.id
       WHERE o.id = ? AND o.user_id = ?`,
      [validated.original_order_id, userId]
    );

    if (orderRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Original order not found' });
    }

    const order = orderRows[0];

    if (order.status === 'refunded') {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'Order has already been fully refunded' });
    }

    // 2. Enforce Return & Exchange window
    let returnWindowDays = order.cfg_return_window_days;
    if (returnWindowDays === null || returnWindowDays === undefined) {
      const [settingsRows] = await connection.query(
        'SELECT return_window_days FROM pos_settings WHERE user_id = ?',
        [userId]
      );
      returnWindowDays = settingsRows[0]?.return_window_days ?? 14;
    }
    returnWindowDays = Number(returnWindowDays);

    const orderDate = new Date(order.order_date);
    const now = new Date();
    const diffMs = now.getTime() - orderDate.getTime();
    const daysElapsed = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

    if (returnWindowDays === 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'Returns are disabled. The store policy does not accept returns or exchanges.',
      });
    }

    if (daysElapsed > returnWindowDays) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: `Return window expired. This order was placed ${daysElapsed} days ago, exceeding the ${returnWindowDays}-day return & exchange policy.`,
      });
    }

    // 3. Generate return number
    const returnNumber = await generateReturnNumber(connection, userId);

    // 4. Insert return record
    const [returnResult] = await connection.query(
      `INSERT INTO pos_returns (
        user_id, return_number, original_order_id, customer_name,
        refund_amount, refund_mode, status, reason, items_summary,
        returned_items_json, notes
      ) VALUES (?, ?, ?, ?, ?, ?, 'Processed', ?, ?, ?, ?)`,
      [
        userId,
        returnNumber,
        validated.original_order_id,
        order.customer_name || 'Walk-in Customer',
        validated.refund_amount,
        validated.refund_mode,
        validated.reason || 'Customer Return',
        validated.items_summary || null,
        validated.returned_items?.length ? JSON.stringify(validated.returned_items) : null,
        validated.notes || null,
      ]
    );

    // 5. Restore inventory stock for returned items
    if (Array.isArray(validated.returned_items)) {
      for (const item of validated.returned_items) {
        if (item.variant_id && item.quantity > 0) {
          await connection.query(
            `UPDATE pos_product_variants 
             SET stock_quantity = stock_quantity + ? 
             WHERE id = ? AND user_id = ?`,
            [item.quantity, item.variant_id, userId]
          );
        }
      }
    }

    // 6. Update sales order status in pos_orders
    const isFullRefund = Number(validated.refund_amount) >= Number(order.grand_total);
    const newOrderStatus = isFullRefund ? 'refunded' : 'partially_refunded';
    await connection.query(
      `UPDATE pos_orders SET status = ? WHERE id = ? AND user_id = ?`,
      [newOrderStatus, validated.original_order_id, userId]
    );

    await connection.commit();

    res.status(201).json({
      success: true,
      message: 'Return processed successfully, order updated, and inventory restocked',
      data: {
        id: returnResult.insertId,
        return_number: returnNumber,
        original_order_number: order.order_number,
        order_status: newOrderStatus,
        customer_name: order.customer_name,
        refund_amount: validated.refund_amount,
        refund_mode: validated.refund_mode,
        days_elapsed: daysElapsed,
        return_window_days: returnWindowDays,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Error processing POS return:', error);
    res.status(400).json({
      success: false,
      error: error?.errors?.[0]?.message || error?.message || 'Failed to process return',
    });
  } finally {
    if (connection) connection.release();
  }
};

/**
 * POST /api/pos/returns/exchange
 * Process an exchange within policy window
 * Restores returned stock, deducts replacement stock, updates sales order status
 */
exports.createExchange = async (req, res) => {
  const userId = req.user.id;

  let connection;
  try {
    const validated = createPosExchangeSchema.parse(req.body);
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Fetch original order
    const [orderRows] = await connection.query(
      `SELECT o.id, o.order_number, o.order_date, o.customer_name, o.grand_total, o.status,
              cfg.return_window_days as cfg_return_window_days
       FROM pos_orders o
       LEFT JOIN pos_order_receipt_configs cfg ON cfg.order_id = o.id
       WHERE o.id = ? AND o.user_id = ?`,
      [validated.original_order_id, userId]
    );

    if (orderRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Original order not found' });
    }

    const order = orderRows[0];

    // 2. Enforce Return & Exchange window
    let returnWindowDays = order.cfg_return_window_days;
    if (returnWindowDays === null || returnWindowDays === undefined) {
      const [settingsRows] = await connection.query(
        'SELECT return_window_days FROM pos_settings WHERE user_id = ?',
        [userId]
      );
      returnWindowDays = settingsRows[0]?.return_window_days ?? 14;
    }
    returnWindowDays = Number(returnWindowDays);

    const orderDate = new Date(order.order_date);
    const now = new Date();
    const diffMs = now.getTime() - orderDate.getTime();
    const daysElapsed = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

    if (returnWindowDays === 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'Exchanges are disabled. Store policy does not allow returns or exchanges.',
      });
    }

    if (daysElapsed > returnWindowDays) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: `Exchange window expired. Order was placed ${daysElapsed} days ago (> ${returnWindowDays}-day policy).`,
      });
    }

    // 3. Generate exchange number
    const exchangeNumber = await generateExchangeNumber(connection, userId);

    // 4. Build returned items description & restore stock
    const returnedDescParts = [];
    for (const item of validated.returned_items) {
      returnedDescParts.push(`${item.item_name || 'Item'} (x${item.quantity})`);
      await connection.query(
        `UPDATE pos_product_variants 
         SET stock_quantity = stock_quantity + ? 
         WHERE id = ? AND user_id = ?`,
        [item.quantity, item.variant_id, userId]
      );
    }
    const returnedDesc = returnedDescParts.join(', ');

    // 5. Build replacement items description & deduct stock
    const replacementDescParts = [];
    for (const item of validated.replacement_items) {
      replacementDescParts.push(`${item.item_name || 'Item'} (x${item.quantity})`);
      await connection.query(
        `UPDATE pos_product_variants 
         SET stock_quantity = GREATEST(0, stock_quantity - ?) 
         WHERE id = ? AND user_id = ?`,
        [item.quantity, item.variant_id, userId]
      );
    }
    const replacementDesc = replacementDescParts.join(', ');

    // 6. Insert exchange record into pos_exchanges
    const [exchangeResult] = await connection.query(
      `INSERT INTO pos_exchanges (
        user_id, exchange_number, original_order_id, customer_name,
        returned_desc, replacement_desc, price_difference, payment_mode,
        returned_items_json, replacement_items_json, notes, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Completed')`,
      [
        userId,
        exchangeNumber,
        validated.original_order_id,
        order.customer_name || 'Walk-in Customer',
        returnedDesc,
        replacementDesc,
        validated.price_difference,
        validated.payment_mode || 'Cash',
        validated.returned_items?.length ? JSON.stringify(validated.returned_items) : null,
        validated.replacement_items?.length ? JSON.stringify(validated.replacement_items) : null,
        validated.notes || null,
      ]
    );

    // 7. Update sales order status to 'exchanged'
    await connection.query(
      `UPDATE pos_orders SET status = 'exchanged' WHERE id = ? AND user_id = ?`,
      [validated.original_order_id, userId]
    );

    await connection.commit();

    res.status(201).json({
      success: true,
      message: 'Exchange processed successfully, sales status updated, and inventory synchronized',
      data: {
        id: exchangeResult.insertId,
        exchange_number: exchangeNumber,
        original_order_number: order.order_number,
        order_status: 'exchanged',
        customer_name: order.customer_name,
        returned_desc: returnedDesc,
        replacement_desc: replacementDesc,
        price_difference: validated.price_difference,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Error processing POS exchange:', error);
    res.status(400).json({
      success: false,
      error: error?.errors?.[0]?.message || error?.message || 'Failed to process exchange',
    });
  } finally {
    if (connection) connection.release();
  }
};

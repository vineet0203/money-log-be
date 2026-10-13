const { pool } = require('../../config/db');
const { createOrderSchema } = require('../../validations/pos/posOrderValidation');

/**
 * Generate a sequential, professional order invoice number
 */
async function generateOrderNumber(connection, userId) {
  const [rows] = await connection.query(
    'SELECT COUNT(*) AS total FROM pos_orders WHERE user_id = ?',
    [userId]
  );
  const nextSeq = (rows[0]?.total || 0) + 1;
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let orderNumber = `INV-${10000 + nextSeq}`;

  // Ensure uniqueness
  const [exists] = await connection.query(
    'SELECT id FROM pos_orders WHERE user_id = ? AND order_number = ?',
    [userId, orderNumber]
  );
  if (exists.length > 0) {
    orderNumber = `INV-${dateStr}-${nextSeq}`;
  }

  return orderNumber;
}

/**
 * Format receipt config snapshot from DB row
 */
function formatReceiptConfig(row) {
  if (!row) return null;
  return {
    storeName: row.store_name,
    storeLogoUrl: row.store_logo_url,
    storeLogoInitial: row.store_logo_initial,
    storeTagline: row.store_tagline,
    phone: row.store_phone,
    email: row.store_email,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    gstTaxNumber: row.tax_number,
    receiptHeaderNote: row.receipt_header_note,
    receiptFooterNote: row.receipt_footer_note,
    returnPolicy: row.return_policy,
    returnWindowDays: Number(row.return_window_days !== undefined ? row.return_window_days : 14),
    currencySymbol: row.currency_symbol || '$',
    paperSize: row.paper_width || '80mm',
    showTaxBreakdown: Boolean(row.show_tax_breakdown),
    showCashierName: Boolean(row.show_cashier_name),
    showCustomerInfo: Boolean(row.show_customer_info),
    showUpiQrOnReceipt: Boolean(row.show_upi_qr_on_receipt),
    upiId: row.upi_id,
    upiPayeeName: row.upi_payee_name,
    upiQrType: row.upi_qr_type || 'default',
    upiQrImageUrl: row.upi_qr_image_url,
    taxes: typeof row.taxes_json === 'string' ? JSON.parse(row.taxes_json) : (row.taxes_json || []),
  };
}

/**
 * POST /api/pos/orders
 * Create a new completed POS Sale order, decrease stock, log payment
 */
exports.createOrder = async (req, res) => {
  const userId = req.user.id;
  const connection = await pool.getConnection();

  try {
    const validated = createOrderSchema.parse(req.body);

    await connection.beginTransaction();

    const orderNumber = await generateOrderNumber(connection, userId);
    const orderDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // 1. Insert into pos_orders
    const [orderResult] = await connection.query(
      `INSERT INTO pos_orders (
        user_id, order_number, register_label, customer_name, customer_phone,
        subtotal, discount_total, tax_total, grand_total, status, notes, order_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
      [
        userId,
        orderNumber,
        validated.register_label || 'Terminal #01',
        validated.customer_name || 'Walk-in Customer',
        validated.customer_phone || null,
        validated.subtotal,
        validated.discount_total || 0,
        validated.tax_total || 0,
        validated.grand_total,
        validated.notes || null,
        orderDate,
      ]
    );

    const orderId = orderResult.insertId;
    const insertedItems = [];

    // 2. Insert items and update variant inventory
    for (const item of validated.items) {
      const [itemResult] = await connection.query(
        `INSERT INTO pos_order_items (
          order_id, variant_id, item_name, sku, quantity,
          unit_cost, unit_price, discount_amount, tax_amount, total_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          item.variant_id,
          item.item_name,
          item.sku,
          item.quantity,
          item.unit_cost || 0,
          item.unit_price,
          item.discount_amount || 0,
          item.tax_amount || 0,
          item.total_amount,
        ]
      );

      // Decrement inventory stock
      await connection.query(
        `UPDATE pos_product_variants 
         SET stock_quantity = GREATEST(0, stock_quantity - ?) 
         WHERE id = ? AND user_id = ?`,
        [item.quantity, item.variant_id, userId]
      );

      insertedItems.push({
        id: itemResult.insertId,
        order_id: orderId,
        variant_id: item.variant_id,
        item_name: item.item_name,
        sku: item.sku,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_amount: item.total_amount,
      });
    }

    // 3. Insert payment record
    const paymentAmount = validated.payment_amount !== undefined 
      ? validated.payment_amount 
      : validated.grand_total;

    const [paymentResult] = await connection.query(
      `INSERT INTO pos_order_payments (
        order_id, payment_mode, amount, reference_number
      ) VALUES (?, ?, ?, ?)`,
      [
        orderId,
        validated.payment_mode || 'Cash',
        paymentAmount,
        validated.payment_reference || null,
      ]
    );

    // 4. Save frozen receipt configuration snapshot in pos_order_receipt_configs
    const [settingsRows] = await connection.query(
      'SELECT * FROM pos_settings WHERE user_id = ?',
      [userId]
    );
    const curSettings = settingsRows[0] || {};
    const reqCfg = validated.receipt_config || {};

    const configSnapshot = {
      order_id: orderId,
      store_name: reqCfg.storeName || curSettings.store_name || 'MONEY LOG POS',
      store_logo_url: reqCfg.storeLogoUrl !== undefined ? reqCfg.storeLogoUrl : curSettings.store_logo_url,
      store_logo_initial: reqCfg.storeLogoInitial || curSettings.store_logo_initial || 'M',
      store_tagline: reqCfg.storeTagline !== undefined ? reqCfg.storeTagline : curSettings.tagline,
      store_phone: reqCfg.phone !== undefined ? reqCfg.phone : curSettings.store_phone,
      store_email: reqCfg.email !== undefined ? reqCfg.email : curSettings.store_email,
      address_line1: reqCfg.addressLine1 !== undefined ? reqCfg.addressLine1 : curSettings.address_line1,
      address_line2: reqCfg.addressLine2 !== undefined ? reqCfg.addressLine2 : curSettings.address_line2,
      city: reqCfg.city !== undefined ? reqCfg.city : curSettings.city,
      state: reqCfg.state !== undefined ? reqCfg.state : curSettings.state,
      postal_code: reqCfg.postalCode !== undefined ? reqCfg.postalCode : curSettings.postal_code,
      tax_number: reqCfg.gstTaxNumber !== undefined ? reqCfg.gstTaxNumber : curSettings.tax_number,
      receipt_header_note: reqCfg.receiptHeaderNote !== undefined ? reqCfg.receiptHeaderNote : curSettings.receipt_header_note,
      receipt_footer_note: reqCfg.receiptFooterNote !== undefined ? reqCfg.receiptFooterNote : curSettings.receipt_footer_note,
      return_policy: reqCfg.returnPolicy !== undefined ? reqCfg.returnPolicy : curSettings.return_policy,
      return_window_days: reqCfg.returnWindowDays !== undefined ? reqCfg.returnWindowDays : (curSettings.return_window_days ?? 14),
      currency_symbol: reqCfg.currencySymbol || curSettings.currency_symbol || '$',
      paper_width: reqCfg.paperSize || curSettings.paper_width || '80mm',
      show_tax_breakdown: reqCfg.showTaxBreakdown !== undefined ? (reqCfg.showTaxBreakdown ? 1 : 0) : (curSettings.show_tax_breakdown ?? 1),
      show_cashier_name: reqCfg.showCashierName !== undefined ? (reqCfg.showCashierName ? 1 : 0) : (curSettings.show_cashier_name ?? 1),
      show_customer_info: reqCfg.showCustomerInfo !== undefined ? (reqCfg.showCustomerInfo ? 1 : 0) : (curSettings.show_customer_info ?? 1),
      show_upi_qr_on_receipt: reqCfg.showUpiQrOnReceipt !== undefined ? (reqCfg.showUpiQrOnReceipt ? 1 : 0) : (curSettings.show_upi_qr_on_receipt ?? 1),
      upi_id: reqCfg.upiId !== undefined ? reqCfg.upiId : curSettings.upi_id,
      upi_payee_name: reqCfg.upiPayeeName !== undefined ? reqCfg.upiPayeeName : curSettings.upi_payee_name,
      upi_qr_type: reqCfg.upiQrType || curSettings.upi_qr_type || 'auto',
      upi_qr_image_url: reqCfg.upiQrImageUrl !== undefined ? reqCfg.upiQrImageUrl : curSettings.upi_qr_image_url,
      taxes_json: JSON.stringify(reqCfg.taxes || (curSettings.taxes ? (typeof curSettings.taxes === 'string' ? JSON.parse(curSettings.taxes) : curSettings.taxes) : [])),
    };

    await connection.query(
      `INSERT INTO pos_order_receipt_configs (
        order_id, store_name, store_logo_url, store_logo_initial, store_tagline,
        store_phone, store_email, address_line1, address_line2, city, state, postal_code,
        tax_number, receipt_header_note, receipt_footer_note, return_policy, return_window_days,
        currency_symbol, paper_width, show_tax_breakdown, show_cashier_name,
        show_customer_info, show_upi_qr_on_receipt, upi_id, upi_payee_name,
        upi_qr_type, upi_qr_image_url, taxes_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        configSnapshot.store_name,
        configSnapshot.store_logo_url,
        configSnapshot.store_logo_initial,
        configSnapshot.store_tagline,
        configSnapshot.store_phone,
        configSnapshot.store_email,
        configSnapshot.address_line1,
        configSnapshot.address_line2,
        configSnapshot.city,
        configSnapshot.state,
        configSnapshot.postal_code,
        configSnapshot.tax_number,
        configSnapshot.receipt_header_note,
        configSnapshot.receipt_footer_note,
        configSnapshot.return_policy,
        configSnapshot.return_window_days,
        configSnapshot.currency_symbol,
        configSnapshot.paper_width,
        configSnapshot.show_tax_breakdown,
        configSnapshot.show_cashier_name,
        configSnapshot.show_customer_info,
        configSnapshot.show_upi_qr_on_receipt,
        configSnapshot.upi_id,
        configSnapshot.upi_payee_name,
        configSnapshot.upi_qr_type,
        configSnapshot.upi_qr_image_url,
        configSnapshot.taxes_json,
      ]
    );

    await connection.commit();

    res.status(201).json({
      success: true,
      message: 'Sale completed successfully',
      data: {
        id: orderId,
        order_number: orderNumber,
        register_label: validated.register_label || 'Terminal #01',
        customer_name: validated.customer_name || 'Walk-in Customer',
        customer_phone: validated.customer_phone || null,
        subtotal: Number(validated.subtotal),
        discount_total: Number(validated.discount_total || 0),
        tax_total: Number(validated.tax_total || 0),
        grand_total: Number(validated.grand_total),
        status: 'completed',
        notes: validated.notes || null,
        order_date: orderDate,
        items: insertedItems,
        payment: {
          id: paymentResult.insertId,
          order_id: orderId,
          payment_mode: validated.payment_mode || 'Cash',
          amount: Number(paymentAmount),
          reference_number: validated.payment_reference || null,
        },
        receipt_config: formatReceiptConfig(configSnapshot),
      },
    });
  } catch (error) {
    await connection.rollback();

    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: error.issues?.[0]?.message || 'Validation failed',
        details: error.issues,
      });
    }

    console.error('Error creating POS order:', error);
    res.status(500).json({ success: false, error: 'Failed to complete sale order' });
  } finally {
    connection.release();
  }
};

/**
 * GET /api/pos/orders
 * Fetch list of sales orders with search, date filters and pagination
 */
exports.getOrders = async (req, res) => {
  const userId = req.user.id;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
  const offset = (page - 1) * limit;

  const { search, status, payment_mode, start_date, end_date } = req.query;

  try {
    let whereClause = 'o.user_id = ?';
    const params = [userId];

    if (search && search.trim()) {
      whereClause += ' AND (o.order_number LIKE ? OR o.customer_name LIKE ?)';
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (status && status !== 'all') {
      whereClause += ' AND o.status = ?';
      params.push(status);
    }

    if (payment_mode && payment_mode !== 'all') {
      whereClause += ' AND p.payment_mode = ?';
      params.push(payment_mode);
    }

    if (start_date) {
      whereClause += ' AND o.order_date >= ?';
      params.push(start_date);
    }

    if (end_date) {
      whereClause += ' AND o.order_date <= ?';
      params.push(end_date);
    }

    // Total count
    const [countRows] = await pool.query(
      `SELECT COUNT(DISTINCT o.id) AS total
       FROM pos_orders o
       LEFT JOIN pos_order_payments p ON p.order_id = o.id
       WHERE ${whereClause}`,
      params
    );
    const total = countRows[0]?.total || 0;

    // Order list with aggregated items and payment mode
    const [orders] = await pool.query(
      `SELECT 
        o.id,
        o.order_number,
        o.register_label,
        o.customer_name,
        o.customer_phone,
        o.subtotal,
        o.discount_total,
        o.tax_total,
        o.grand_total,
        o.status,
        o.notes,
        o.order_date,
        o.created_at,
        COUNT(i.id) AS items_count,
        COALESCE(SUM(i.quantity), 0) AS total_units,
        COALESCE(MAX(p.payment_mode), 'Cash') AS payment_mode,
        COALESCE(MAX(p.reference_number), '') AS payment_reference
      FROM pos_orders o
      LEFT JOIN pos_order_items i ON i.order_id = o.id
      LEFT JOIN pos_order_payments p ON p.order_id = o.id
      WHERE ${whereClause}
      GROUP BY o.id
      ORDER BY o.id DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const formattedOrders = orders.map(ord => ({
      ...ord,
      subtotal: Number(ord.subtotal),
      discount_total: Number(ord.discount_total),
      tax_total: Number(ord.tax_total),
      grand_total: Number(ord.grand_total),
      items_count: Number(ord.items_count),
      total_units: Number(ord.total_units),
    }));

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: formattedOrders,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error('Error fetching POS orders:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch sales orders' });
  }
};

/**
 * GET /api/pos/orders/:id
 * Get single order by ID with line items and payments
 */
exports.getOrderById = async (req, res) => {
  const userId = req.user.id;
  const orderId = parseInt(req.params.id, 10);

  if (isNaN(orderId)) {
    return res.status(400).json({ success: false, error: 'Invalid order ID' });
  }

  try {
    const [orders] = await pool.query(
      `SELECT * FROM pos_orders WHERE id = ? AND user_id = ?`,
      [orderId, userId]
    );

    if (orders.length === 0) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const order = orders[0];

    const [items] = await pool.query(
      `SELECT i.*, v.barcode, v.title AS variant_title, p.name AS product_name
       FROM pos_order_items i
       LEFT JOIN pos_product_variants v ON v.id = i.variant_id
       LEFT JOIN pos_products p ON p.id = v.product_id
       WHERE i.order_id = ? 
       ORDER BY i.id ASC`,
      [orderId]
    );

    const [payments] = await pool.query(
      `SELECT * FROM pos_order_payments WHERE order_id = ? ORDER BY id ASC`,
      [orderId]
    );

    const [configRows] = await pool.query(
      `SELECT * FROM pos_order_receipt_configs WHERE order_id = ?`,
      [orderId]
    );
    const receiptConfig = configRows.length > 0 ? formatReceiptConfig(configRows[0]) : null;

    res.json({
      success: true,
      data: {
        ...order,
        subtotal: Number(order.subtotal),
        discount_total: Number(order.discount_total),
        tax_total: Number(order.tax_total),
        grand_total: Number(order.grand_total),
        items: items.map(item => ({
          ...item,
          quantity: Number(item.quantity),
          unit_cost: Number(item.unit_cost),
          unit_price: Number(item.unit_price),
          discount_amount: Number(item.discount_amount),
          tax_amount: Number(item.tax_amount),
          total_amount: Number(item.total_amount),
        })),
        payments: payments.map(p => ({
          ...p,
          amount: Number(p.amount),
        })),
        receipt_config: receiptConfig,
      },
    });
  } catch (error) {
    console.error('Error fetching order by ID:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch order details' });
  }
};

const { pool } = require('../../config/db');
const { ensureSupplierTablesExist } = require('../../database/posSupplierTables');

let tablesEnsured = false;
async function checkTables() {
  if (!tablesEnsured) {
    try {
      await ensureSupplierTablesExist(pool);
      tablesEnsured = true;
    } catch (err) {
      console.warn('[POS Purchase] checkTables warning:', err.message);
    }
  }
}

/**
 * Sequential Number Generators
 */
async function generateNumber(connection, userId, table, prefix, fieldName) {
  const year = new Date().getFullYear();
  const [rows] = await connection.query(
    `SELECT COUNT(*) as count FROM ${table} WHERE user_id = ? AND YEAR(created_at) = ?`,
    [userId, year]
  );
  const nextSeq = String((rows[0]?.count || 0) + 1).padStart(4, '0');
  let generated = `${prefix}-${year}-${nextSeq}`;

  const [exists] = await connection.query(
    `SELECT id FROM ${table} WHERE user_id = ? AND ${fieldName} = ?`,
    [userId, generated]
  );
  if (exists.length > 0) {
    generated = `${prefix}-${year}-${nextSeq}-${Math.floor(Math.random() * 900 + 100)}`;
  }
  return generated;
}

// =========================================================================
// 1. Metrics Overview
// =========================================================================
exports.getMetrics = async (req, res) => {
  const userId = req.user.id;

  try {
    await checkTables();

    const [supplierStats] = await pool.query(
      `SELECT 
        COALESCE(SUM(balance_payable), 0) as total_payable,
        COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_suppliers
       FROM pos_suppliers 
       WHERE user_id = ? AND is_active = 1`,
      [userId]
    );

    const [poStats] = await pool.query(
      `SELECT 
        COUNT(CASE WHEN status IN ('Draft', 'Ordered', 'Partial') THEN 1 END) as open_pos
       FROM pos_purchase_orders 
       WHERE user_id = ?`,
      [userId]
    );

    const [billStats] = await pool.query(
      `SELECT 
        COALESCE(SUM(COALESCE(grand_total, total_amount, 0)), 0) as total_purchases_value
       FROM pos_purchase_bills 
       WHERE user_id = ?`,
      [userId]
    );

    const [grnStats] = await pool.query(
      `SELECT 
        COUNT(*) as completed_grns
       FROM pos_goods_receipts 
       WHERE user_id = ? AND status = 'Completed'`,
      [userId]
    );

    return res.json({
      success: true,
      data: {
        totalPayableBalance: Number(supplierStats[0]?.total_payable || 0),
        activeSuppliersCount: Number(supplierStats[0]?.active_suppliers || 0),
        openPOsCount: Number(poStats[0]?.open_pos || 0),
        totalPurchasesValue: Number(billStats[0]?.total_purchases_value || 0),
        completedGRNsCount: Number(grnStats[0]?.completed_grns || 0),
      }
    });
  } catch (err) {
    console.error('Error fetching POS supplier metrics:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch metrics' });
  }
};

// =========================================================================
// 2. Purchase Orders
// =========================================================================
exports.getPurchaseOrders = async (req, res) => {
  const userId = req.user.id;
  const { search, status, supplier_id } = req.query;

  try {
    await checkTables();

    let whereClause = 'WHERE po.user_id = ?';
    const params = [userId];

    if (status && status !== 'All') {
      whereClause += ' AND po.status = ?';
      params.push(status);
    }

    if (supplier_id && supplier_id !== 'All') {
      whereClause += ' AND po.supplier_id = ?';
      params.push(supplier_id);
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      whereClause += ' AND (po.po_number LIKE ? OR s.name LIKE ?)';
      params.push(term, term);
    }

    const [orders] = await pool.query(
      `SELECT 
        po.id,
        po.po_number,
        po.supplier_id,
        s.name as supplier_name,
        s.code as supplier_code,
        s.payment_terms,
        po.order_date,
        po.expected_date,
        po.subtotal,
        po.tax_total,
        po.shipping_fee,
        po.discount_amount,
        po.total_cost,
        po.status,
        po.notes,
        po.created_at,
        (SELECT COUNT(*) FROM pos_po_items WHERE po_id = po.id) as items_count,
        (SELECT COALESCE(SUM(ordered_qty), 0) FROM pos_po_items WHERE po_id = po.id) as total_units_ordered,
        (SELECT COALESCE(SUM(received_qty), 0) FROM pos_po_items WHERE po_id = po.id) as total_units_received
       FROM pos_purchase_orders po
       JOIN pos_suppliers s ON s.id = po.supplier_id
       ${whereClause}
       ORDER BY po.created_at DESC`,
      params
    );

    const formatted = orders.map(po => ({
      id: String(po.id),
      poNumber: po.po_number,
      supplierId: String(po.supplier_id),
      supplierName: po.supplier_name,
      orderDate: po.order_date ? new Date(po.order_date).toISOString().split('T')[0] : '',
      expectedDeliveryDate: po.expected_date ? new Date(po.expected_date).toISOString().split('T')[0] : '',
      paymentTerms: po.payment_terms,
      status: po.status,
      itemsCount: Number(po.items_count || 0),
      totalUnitsOrdered: Number(po.total_units_ordered || 0),
      totalUnitsReceived: Number(po.total_units_received || 0),
      subtotal: Number(po.subtotal || 0),
      taxTotal: Number(po.tax_total || 0),
      shippingFee: Number(po.shipping_fee || 0),
      discountAmount: Number(po.discount_amount || 0),
      grandTotal: Number(po.total_cost || 0),
      totalCost: Number(po.total_cost || 0),
      notes: po.notes || '',
      createdAt: po.created_at
    }));

    return res.json({ success: true, count: formatted.length, data: formatted });
  } catch (err) {
    console.error('Error fetching purchase orders:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch purchase orders' });
  }
};

exports.getPurchaseOrderById = async (req, res) => {
  const userId = req.user.id;
  const poId = req.params.id;

  try {
    await checkTables();

    const [orders] = await pool.query(
      `SELECT 
        po.*,
        s.name as supplier_name,
        s.code as supplier_code,
        s.email as supplier_email,
        s.phone as supplier_phone,
        s.payment_terms
       FROM pos_purchase_orders po
       JOIN pos_suppliers s ON s.id = po.supplier_id
       WHERE po.id = ? AND po.user_id = ?`,
      [poId, userId]
    );

    if (orders.length === 0) {
      return res.status(404).json({ success: false, error: 'Purchase Order not found' });
    }

    const po = orders[0];

    const [items] = await pool.query(
      `SELECT 
        id,
        variant_id,
        sku,
        item_name,
        unit,
        ordered_qty,
        received_qty,
        unit_cost,
        tax_percent,
        total_cost
       FROM pos_po_items
       WHERE po_id = ?
       ORDER BY id ASC`,
      [poId]
    );

    const formattedItems = items.map(it => ({
      id: String(it.id),
      variantId: it.variant_id ? String(it.variant_id) : undefined,
      sku: it.sku,
      itemName: it.item_name,
      unit: it.unit,
      orderedQty: Number(it.ordered_qty),
      receivedQty: Number(it.received_qty),
      unitCost: Number(it.unit_cost),
      taxPercent: Number(it.tax_percent),
      totalCost: Number(it.total_cost)
    }));

    const formatted = {
      id: String(po.id),
      poNumber: po.po_number,
      supplierId: String(po.supplier_id),
      supplierName: po.supplier_name,
      supplierCode: po.supplier_code,
      supplierEmail: po.supplier_email,
      supplierPhone: po.supplier_phone,
      orderDate: po.order_date ? new Date(po.order_date).toISOString().split('T')[0] : '',
      expectedDeliveryDate: po.expected_date ? new Date(po.expected_date).toISOString().split('T')[0] : '',
      paymentTerms: po.payment_terms,
      status: po.status,
      subtotal: Number(po.subtotal),
      taxTotal: Number(po.tax_total),
      shippingFee: Number(po.shipping_fee),
      discountAmount: Number(po.discount_amount),
      grandTotal: Number(po.total_cost),
      notes: po.notes || '',
      items: formattedItems,
      createdAt: po.created_at
    };

    return res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Error fetching PO details:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Purchase Order details' });
  }
};

exports.createPurchaseOrder = async (req, res) => {
  const userId = req.user.id;
  const {
    supplierId,
    orderDate,
    expectedDeliveryDate,
    items,
    shippingFee = 0,
    discountAmount = 0,
    notes = ''
  } = req.body;

  if (!supplierId) {
    return res.status(400).json({ success: false, error: 'Supplier is required.' });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'At least one line item is required.' });
  }

  const connection = await pool.getConnection();

  try {
    await checkTables();
    await connection.beginTransaction();

    const poNumber = await generateNumber(connection, userId, 'pos_purchase_orders', 'PO', 'po_number');

    // Calculate subtotal and tax
    let subtotal = 0;
    let taxTotal = 0;

    const validatedItems = items.map(item => {
      const qty = Math.max(0.001, parseFloat(item.orderedQty) || 1);
      const cost = Math.max(0, parseFloat(item.unitCost) || 0);
      const taxRate = Math.max(0, parseFloat(item.taxPercent) || 0);

      const lineNet = qty * cost;
      const lineTax = (lineNet * taxRate) / 100;
      const lineTotal = lineNet + lineTax;

      subtotal += lineNet;
      taxTotal += lineTax;

      return {
        variantId: item.variantId ? parseInt(item.variantId, 10) : null,
        sku: item.sku || 'N/A',
        itemName: item.itemName || 'Custom Item',
        unit: item.unit || 'pack',
        orderedQty: qty,
        unitCost: cost,
        taxPercent: taxRate,
        totalCost: lineTotal
      };
    });

    const numShipping = Math.max(0, parseFloat(shippingFee) || 0);
    const numDiscount = Math.max(0, parseFloat(discountAmount) || 0);
    const totalCost = Math.max(0, subtotal + taxTotal + numShipping - numDiscount);

    const [poResult] = await connection.query(
      `INSERT INTO pos_purchase_orders (
        user_id, po_number, supplier_id, order_date, expected_date,
        subtotal, tax_total, shipping_fee, discount_amount, total_cost,
        status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Ordered', ?)`,
      [
        userId,
        poNumber,
        supplierId,
        orderDate || new Date().toISOString().split('T')[0],
        expectedDeliveryDate || null,
        subtotal,
        taxTotal,
        numShipping,
        numDiscount,
        totalCost,
        notes || null
      ]
    );

    const poId = poResult.insertId;

    // Insert items
    for (const it of validatedItems) {
      await connection.query(
        `INSERT INTO pos_po_items (
          po_id, variant_id, sku, item_name, unit, ordered_qty, received_qty,
          unit_cost, tax_percent, total_cost
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          poId,
          it.variantId,
          it.sku,
          it.itemName,
          it.unit,
          it.orderedQty,
          it.unitCost,
          it.taxPercent,
          it.totalCost
        ]
      );
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: `Purchase Order ${poNumber} created successfully.`,
      data: {
        id: String(poId),
        poNumber,
        grandTotal: totalCost
      }
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error creating Purchase Order:', err);
    return res.status(500).json({ success: false, error: 'Failed to create Purchase Order' });
  } finally {
    connection.release();
  }
};

exports.updatePOStatus = async (req, res) => {
  const userId = req.user.id;
  const poId = req.params.id;
  const { status } = req.body;

  const validStatuses = ['Draft', 'Ordered', 'Partial', 'Received', 'Cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid Purchase Order status.' });
  }

  try {
    await checkTables();

    const [result] = await pool.query(
      'UPDATE pos_purchase_orders SET status = ? WHERE id = ? AND user_id = ?',
      [status, poId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Purchase Order not found.' });
    }

    return res.json({ success: true, message: `PO status updated to ${status}.` });
  } catch (err) {
    console.error('Error updating PO status:', err);
    return res.status(500).json({ success: false, error: 'Failed to update PO status' });
  }
};

// =========================================================================
// 3. Purchase Bills & Direct Purchases (WITH INVENTORY RESTOCKING)
// =========================================================================
exports.getPurchaseBills = async (req, res) => {
  const userId = req.user.id;
  const { search, status, supplier_id } = req.query;

  try {
    await checkTables();

    let whereClause = 'WHERE b.user_id = ?';
    const params = [userId];

    if (status && status !== 'All') {
      whereClause += ' AND b.status = ?';
      params.push(status);
    }

    if (supplier_id && supplier_id !== 'All') {
      whereClause += ' AND b.supplier_id = ?';
      params.push(supplier_id);
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      whereClause += ' AND (b.bill_number LIKE ? OR b.supplier_invoice_no LIKE ? OR s.name LIKE ?)';
      params.push(term, term, term);
    }

    const [bills] = await pool.query(
      `SELECT 
        b.*,
        s.name as supplier_name,
        s.code as supplier_code,
        s.payment_terms
       FROM pos_purchase_bills b
       JOIN pos_suppliers s ON s.id = b.supplier_id
       ${whereClause}
       ORDER BY b.created_at DESC`,
      params
    );

    const formatted = bills.map(b => ({
      id: String(b.id),
      billNumber: b.bill_number,
      supplierInvoiceNo: b.supplier_invoice_no || 'N/A',
      poId: b.po_id ? String(b.po_id) : undefined,
      supplierId: String(b.supplier_id),
      supplierName: b.supplier_name,
      billDate: b.bill_date ? new Date(b.bill_date).toISOString().split('T')[0] : '',
      dueDate: b.due_date ? new Date(b.due_date).toISOString().split('T')[0] : '',
      subtotal: Number(b.subtotal || 0),
      taxTotal: Number(b.tax_total || 0),
      shippingFee: Number(b.shipping_fee || 0),
      discountAmount: Number(b.discount_amount || 0),
      grandTotal: Number(b.grand_total || 0),
      paidAmount: Number(b.paid_amount || 0),
      balanceDue: Number(b.balance_due || 0),
      status: b.status,
      items: typeof b.items_json === 'string' ? JSON.parse(b.items_json) : (b.items_json || []),
      notes: b.notes || '',
      createdAt: b.created_at
    }));

    return res.json({ success: true, count: formatted.length, data: formatted });
  } catch (err) {
    console.error('Error fetching purchase bills:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch purchase bills' });
  }
};

exports.createPurchaseBill = async (req, res) => {
  const userId = req.user.id;
  const {
    supplierId,
    supplierInvoiceNo,
    poId,
    billDate,
    dueDate,
    items,
    shippingFee = 0,
    discountAmount = 0,
    isReceived = true, // By default Direct Bills are received stock
    notes = ''
  } = req.body;

  if (!supplierId) {
    return res.status(400).json({ success: false, error: 'Supplier is required.' });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'At least one line item is required.' });
  }

  const connection = await pool.getConnection();

  try {
    await checkTables();
    await connection.beginTransaction();

    const billNumber = await generateNumber(connection, userId, 'pos_purchase_bills', 'BILL', 'bill_number');

    let subtotal = 0;
    let taxTotal = 0;

    const validatedItems = items.map(item => {
      const qty = Math.max(0.001, parseFloat(item.orderedQty || item.quantity) || 1);
      const cost = Math.max(0, parseFloat(item.unitCost || item.costPrice) || 0);
      const taxRate = Math.max(0, parseFloat(item.taxPercent) || 0);

      const lineNet = qty * cost;
      const lineTax = (lineNet * taxRate) / 100;
      const lineTotal = lineNet + lineTax;

      subtotal += lineNet;
      taxTotal += lineTax;

      return {
        variantId: item.variantId ? parseInt(item.variantId, 10) : (item.productId ? parseInt(item.productId, 10) : null),
        sku: item.sku || 'N/A',
        itemName: item.itemName || item.name || 'Purchased Item',
        unit: item.unit || 'pack',
        quantity: qty,
        unitCost: cost,
        taxPercent: taxRate,
        totalCost: lineTotal
      };
    });

    const numShipping = Math.max(0, parseFloat(shippingFee) || 0);
    const numDiscount = Math.max(0, parseFloat(discountAmount) || 0);
    const grandTotal = Math.max(0, subtotal + taxTotal + numShipping - numDiscount);

    // 1. Create Purchase Bill
    const [billResult] = await connection.query(
      `INSERT INTO pos_purchase_bills (
        user_id, bill_number, supplier_invoice_no, po_id, supplier_id,
        bill_date, due_date, subtotal, tax_total, shipping_fee, discount_amount,
        grand_total, paid_amount, balance_due, status, items_json, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.00, ?, 'Unpaid', ?, ?)`,
      [
        userId,
        billNumber,
        supplierInvoiceNo || null,
        poId ? parseInt(poId, 10) : null,
        supplierId,
        billDate || new Date().toISOString().split('T')[0],
        dueDate || new Date().toISOString().split('T')[0],
        subtotal,
        taxTotal,
        numShipping,
        numDiscount,
        grandTotal,
        grandTotal,
        JSON.stringify(validatedItems),
        notes || null
      ]
    );

    const insertedBillId = billResult.insertId;

    // 2. Increase Supplier Balance Payable
    await connection.query(
      'UPDATE pos_suppliers SET balance_payable = balance_payable + ? WHERE id = ? AND user_id = ?',
      [grandTotal, supplierId, userId]
    );

    // 3. INVENTORY RESTOCKING: If received, restock product variants directly
    if (isReceived) {
      for (const it of validatedItems) {
        if (it.variantId) {
          // Increment stock quantity & update cost price
          await connection.query(
            `UPDATE pos_product_variants 
             SET stock_quantity = stock_quantity + ?,
                 cost_price = CASE WHEN ? > 0 THEN ? ELSE cost_price END
             WHERE id = ? AND user_id = ?`,
            [it.quantity, it.unitCost, it.unitCost, it.variantId, userId]
          );
        }
      }

      // Generate GRN audit record automatically
      const grnNumber = await generateNumber(connection, userId, 'pos_goods_receipts', 'GRN', 'grn_number');
      const itemsSummary = validatedItems.map(i => `${i.itemName} (x${i.quantity})`).join(', ');

      await connection.query(
        `INSERT INTO pos_goods_receipts (
          user_id, grn_number, po_id, supplier_id, received_date,
          status, items_summary, received_items_json, notes
        ) VALUES (?, ?, ?, ?, CURDATE(), 'Completed', ?, ?, ?)`,
        [
          userId,
          grnNumber,
          poId ? parseInt(poId, 10) : null,
          supplierId,
          itemsSummary,
          JSON.stringify(validatedItems),
          `Auto-received upon creation of Direct Purchase Bill ${billNumber}`
        ]
      );
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: `Purchase Bill ${billNumber} created successfully.${isReceived ? ' Inventory has been replenished.' : ''}`,
      data: {
        id: String(insertedBillId),
        billNumber,
        grandTotal,
        balanceDue: grandTotal
      }
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error creating purchase bill:', err);
    return res.status(500).json({ success: false, error: 'Failed to create purchase bill' });
  } finally {
    connection.release();
  }
};

// =========================================================================
// 4. Goods Receiving (GRN) & INVENTORY REPLENISHMENT
// =========================================================================
exports.getGoodsReceipts = async (req, res) => {
  const userId = req.user.id;

  try {
    await checkTables();

    const [rows] = await pool.query(
      `SELECT 
        grn.*,
        s.name as supplier_name,
        po.po_number
       FROM pos_goods_receipts grn
       JOIN pos_suppliers s ON s.id = grn.supplier_id
       LEFT JOIN pos_purchase_orders po ON po.id = grn.po_id
       WHERE grn.user_id = ?
       ORDER BY grn.created_at DESC`,
      [userId]
    );

    const formatted = rows.map(r => ({
      id: String(r.id),
      grnNumber: r.grn_number,
      poNumber: r.po_number || 'Direct/Standalone',
      poId: r.po_id ? String(r.po_id) : undefined,
      supplierId: String(r.supplier_id),
      supplierName: r.supplier_name,
      receivedDate: r.received_date ? new Date(r.received_date).toISOString().split('T')[0] : '',
      carrier: r.carrier || '',
      trackingNumber: r.tracking_number || '',
      status: r.status,
      itemsSummary: r.items_summary || '',
      receivedItems: typeof r.received_items_json === 'string' ? JSON.parse(r.received_items_json) : (r.received_items_json || []),
      notes: r.notes || '',
      createdAt: r.created_at
    }));

    return res.json({ success: true, count: formatted.length, data: formatted });
  } catch (err) {
    console.error('Error fetching GRN records:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Goods Receiving records' });
  }
};

exports.processGoodsReceiving = async (req, res) => {
  const userId = req.user.id;
  const {
    poId,
    supplierId,
    receivedDate,
    carrier = '',
    trackingNumber = '',
    notes = '',
    items
  } = req.body;

  if (!supplierId) {
    return res.status(400).json({ success: false, error: 'Supplier ID is required.' });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'Received items list cannot be empty.' });
  }

  const connection = await pool.getConnection();

  try {
    await checkTables();
    await connection.beginTransaction();

    const grnNumber = await generateNumber(connection, userId, 'pos_goods_receipts', 'GRN', 'grn_number');

    let totalUnitsReceived = 0;
    const validatedItems = [];

    // 1. Process each received item & replenish inventory
    for (const item of items) {
      const receivedQty = Math.max(0, parseFloat(item.receivedQty) || 0);
      if (receivedQty <= 0) continue;

      totalUnitsReceived += receivedQty;

      validatedItems.push({
        variantId: item.variantId ? parseInt(item.variantId, 10) : null,
        poItemId: item.poItemId ? parseInt(item.poItemId, 10) : null,
        sku: item.sku,
        itemName: item.itemName,
        receivedQty,
        condition: item.condition || 'Good',
        batchNumber: item.batchNumber || null,
        expiryDate: item.expiryDate || null,
      });

      // RESTOCK variant stock in MySQL
      if (item.variantId) {
        await connection.query(
          `UPDATE pos_product_variants 
           SET stock_quantity = stock_quantity + ?
           WHERE id = ? AND user_id = ?`,
          [receivedQty, item.variantId, userId]
        );
      }

      // Update received_qty in pos_po_items if tied to PO
      if (item.poItemId) {
        await connection.query(
          `UPDATE pos_po_items 
           SET received_qty = received_qty + ?
           WHERE id = ? AND po_id = ?`,
          [receivedQty, item.poItemId, poId]
        );
      }
    }

    if (validatedItems.length === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'At least one item must have a received quantity > 0.' });
    }

    const itemsSummary = validatedItems.map(i => `${i.itemName} (x${i.receivedQty})`).join(', ');

    // 2. Save GRN Record
    const [grnResult] = await connection.query(
      `INSERT INTO pos_goods_receipts (
        user_id, grn_number, po_id, supplier_id, received_date,
        carrier, tracking_number, status, items_summary, received_items_json, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Completed', ?, ?, ?)`,
      [
        userId,
        grnNumber,
        poId ? parseInt(poId, 10) : null,
        supplierId,
        receivedDate || new Date().toISOString().split('T')[0],
        carrier || null,
        trackingNumber || null,
        itemsSummary,
        JSON.stringify(validatedItems),
        notes || null
      ]
    );

    // 3. If tied to a PO, update PO status (Received or Partial)
    if (poId) {
      const [poItems] = await connection.query(
        'SELECT ordered_qty, received_qty FROM pos_po_items WHERE po_id = ?',
        [poId]
      );

      const allFullyReceived = poItems.every(p => Number(p.received_qty) >= Number(p.ordered_qty));
      const newStatus = allFullyReceived ? 'Received' : 'Partial';

      await connection.query(
        'UPDATE pos_purchase_orders SET status = ? WHERE id = ? AND user_id = ?',
        [newStatus, poId, userId]
      );
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: `Goods receipt ${grnNumber} processed. ${totalUnitsReceived} units restocked into inventory.`,
      data: {
        id: String(grnResult.insertId),
        grnNumber,
        totalUnitsReceived
      }
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error processing goods receiving:', err);
    return res.status(500).json({ success: false, error: 'Failed to process goods receiving' });
  } finally {
    connection.release();
  }
};

// =========================================================================
// 5. Supplier Payments
// =========================================================================
exports.getSupplierPayments = async (req, res) => {
  const userId = req.user.id;
  const { supplier_id, bill_id } = req.query;

  try {
    await checkTables();

    let whereClause = 'WHERE p.user_id = ?';
    const params = [userId];

    if (supplier_id && supplier_id !== 'All') {
      whereClause += ' AND p.supplier_id = ?';
      params.push(supplier_id);
    }

    if (bill_id) {
      whereClause += ' AND p.bill_id = ?';
      params.push(bill_id);
    }

    const [payments] = await pool.query(
      `SELECT 
        p.*,
        s.name as supplier_name,
        b.bill_number
       FROM pos_supplier_payments p
       JOIN pos_suppliers s ON s.id = p.supplier_id
       LEFT JOIN pos_purchase_bills b ON b.id = p.bill_id
       ${whereClause}
       ORDER BY p.created_at DESC`,
      params
    );

    const formatted = payments.map(p => ({
      id: String(p.id),
      paymentNumber: p.payment_number,
      supplierId: String(p.supplier_id),
      supplierName: p.supplier_name,
      billId: p.bill_id ? String(p.bill_id) : undefined,
      billNumber: p.bill_number || undefined,
      amount: Number(p.amount || 0),
      paymentDate: p.payment_date ? new Date(p.payment_date).toISOString().split('T')[0] : '',
      paymentMode: p.payment_mode,
      referenceNumber: p.reference_number,
      notes: p.notes || '',
      createdAt: p.created_at
    }));

    return res.json({ success: true, count: formatted.length, data: formatted });
  } catch (err) {
    console.error('Error fetching supplier payments:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch supplier payments' });
  }
};

exports.recordSupplierPayment = async (req, res) => {
  const userId = req.user.id;
  const {
    supplierId,
    billId,
    amount,
    paymentDate,
    paymentMode = 'Bank Transfer',
    referenceNumber,
    notes = ''
  } = req.body;

  const numAmount = parseFloat(amount);
  if (!supplierId || isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Valid supplier ID and positive payment amount are required.' });
  }

  const connection = await pool.getConnection();

  try {
    await checkTables();
    await connection.beginTransaction();

    const paymentNumber = await generateNumber(connection, userId, 'pos_supplier_payments', 'PAY', 'payment_number');

    // 1. Record payment entry
    const [payResult] = await connection.query(
      `INSERT INTO pos_supplier_payments (
        user_id, payment_number, supplier_id, bill_id, amount,
        payment_date, payment_mode, reference_number, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        paymentNumber,
        supplierId,
        billId ? parseInt(billId, 10) : null,
        numAmount,
        paymentDate || new Date().toISOString().split('T')[0],
        paymentMode,
        referenceNumber || `REF-${Date.now().toString().slice(-6)}`,
        notes || null
      ]
    );

    // 2. Reduce supplier balance payable
    await connection.query(
      `UPDATE pos_suppliers 
       SET balance_payable = GREATEST(0, balance_payable - ?) 
       WHERE id = ? AND user_id = ?`,
      [numAmount, supplierId, userId]
    );

    // 3. If tied to a specific bill, update bill paid_amount and balance_due
    if (billId) {
      const [bills] = await connection.query(
        'SELECT grand_total, paid_amount FROM pos_purchase_bills WHERE id = ? AND user_id = ?',
        [billId, userId]
      );

      if (bills.length > 0) {
        const total = Number(bills[0].grand_total);
        const newPaid = Number(bills[0].paid_amount) + numAmount;
        const newDue = Math.max(0, total - newPaid);
        const newStatus = newDue <= 0.01 ? 'Paid' : 'Partial';

        await connection.query(
          `UPDATE pos_purchase_bills 
           SET paid_amount = ?, balance_due = ?, status = ?
           WHERE id = ? AND user_id = ?`,
          [newPaid, newDue, newStatus, billId, userId]
        );
      }
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: `Payment ${paymentNumber} of $${numAmount.toFixed(2)} recorded successfully.`,
      data: {
        id: String(payResult.insertId),
        paymentNumber,
        amount: numAmount
      }
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error recording supplier payment:', err);
    return res.status(500).json({ success: false, error: 'Failed to record supplier payment' });
  } finally {
    connection.release();
  }
};

const { pool } = require('../../config/db');
const { ensureSupplierTablesExist } = require('../../database/posSupplierTables');

let tablesEnsured = false;
async function checkTables() {
  if (!tablesEnsured) {
    try {
      await ensureSupplierTablesExist(pool);
      tablesEnsured = true;
    } catch (err) {
      console.warn('[POS Suppliers] checkTables warning:', err.message);
    }
  }
}

/**
 * Generate unique Supplier Code if not provided: SUP-001, SUP-002...
 */
async function generateSupplierCode(connection, userId) {
  const [rows] = await connection.query(
    'SELECT COUNT(*) as count FROM pos_suppliers WHERE user_id = ?',
    [userId]
  );
  const nextNum = (rows[0]?.count || 0) + 1;
  let code = `SUP-${String(nextNum).padStart(3, '0')}`;

  const [exists] = await connection.query(
    'SELECT id FROM pos_suppliers WHERE user_id = ? AND code = ?',
    [userId, code]
  );
  if (exists.length > 0) {
    code = `SUP-${Date.now().toString().slice(-4)}`;
  }
  return code;
}

/**
 * GET /api/pos/suppliers
 * List suppliers with search, status filters, and active counts
 */
exports.getSuppliers = async (req, res) => {
  const userId = req.user.id;
  const { search, status } = req.query;

  try {
    await checkTables();

    let whereClause = 'WHERE user_id = ? AND is_active = 1';
    const params = [userId];

    if (status && status !== 'All') {
      if (status === 'Active') {
        whereClause += ' AND is_active = 1';
      } else if (status === 'Inactive') {
        whereClause += ' AND is_active = 0';
      }
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      whereClause += ' AND (name LIKE ? OR code LIKE ? OR contact_person LIKE ? OR email LIKE ?)';
      params.push(term, term, term, term);
    }

    const [rows] = await pool.query(
      `SELECT * FROM pos_suppliers
       ${whereClause}
       ORDER BY name ASC`,
      params
    );

    // Format fields with both camelCase and snake_case for frontend convenience
    const formatted = rows.map(r => ({
      id: String(r.id),
      name: r.name,
      code: r.code,
      contactPerson: r.contact_person || '',
      phone: r.phone || '',
      email: r.email || '',
      address: r.address || '',
      city: r.city || '',
      gstTaxNumber: r.gst_tax_number || 'N/A',
      paymentTerms: r.payment_terms || 'Net 30',
      balancePayable: Number(r.balance_payable || 0),
      bankDetails: typeof r.bank_details === 'string' ? JSON.parse(r.bank_details) : (r.bank_details || {}),
      categoriesSupplied: typeof r.categories === 'string' ? JSON.parse(r.categories) : (r.categories || []),
      status: r.status || (r.is_active === 1 ? 'Active' : 'Inactive'),
      notes: r.notes || '',
      createdAt: r.created_at ? new Date(r.created_at).toISOString().split('T')[0] : '',
    }));

    return res.json({
      success: true,
      count: formatted.length,
      data: formatted
    });
  } catch (err) {
    console.error('Error fetching POS suppliers:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch suppliers' });
  }
};

/**
 * GET /api/pos/suppliers/:id
 * Get single supplier with metrics (open POs, total purchases, unpaid bills)
 */
exports.getSupplierById = async (req, res) => {
  const userId = req.user.id;
  const supplierId = req.params.id;

  try {
    await checkTables();

    const [suppliers] = await pool.query(
      'SELECT * FROM pos_suppliers WHERE id = ? AND user_id = ? AND is_active = 1',
      [supplierId, userId]
    );

    if (suppliers.length === 0) {
      return res.status(404).json({ success: false, error: 'Supplier not found' });
    }

    const s = suppliers[0];

    // Compute related metrics
    const [poCount] = await pool.query(
      `SELECT 
        COUNT(*) as total_pos,
        SUM(CASE WHEN status IN ('Draft', 'Ordered', 'Partial') THEN 1 ELSE 0 END) as open_pos,
        COALESCE(SUM(total_cost), 0) as total_spend
       FROM pos_purchase_orders 
       WHERE supplier_id = ? AND user_id = ?`,
      [supplierId, userId]
    );

    const [billsSummary] = await pool.query(
      `SELECT 
        COUNT(*) as total_bills,
        COALESCE(SUM(COALESCE(grand_total, total_amount, 0)), 0) as total_invoiced,
        COALESCE(SUM(balance_due), 0) as total_due
       FROM pos_purchase_bills
       WHERE supplier_id = ? AND user_id = ?`,
      [supplierId, userId]
    );

    const formatted = {
      id: String(s.id),
      name: s.name,
      code: s.code,
      contactPerson: s.contact_person || '',
      phone: s.phone || '',
      email: s.email || '',
      address: s.address || '',
      city: s.city || '',
      gstTaxNumber: s.gst_tax_number || 'N/A',
      paymentTerms: s.payment_terms || 'Net 30',
      balancePayable: Number(s.balance_payable || 0),
      bankDetails: typeof s.bank_details === 'string' ? JSON.parse(s.bank_details) : (s.bank_details || {}),
      categoriesSupplied: typeof s.categories === 'string' ? JSON.parse(s.categories) : (s.categories || []),
      status: s.status || (s.is_active === 1 ? 'Active' : 'Inactive'),
      notes: s.notes || '',
      metrics: {
        totalPOs: poCount[0]?.total_pos || 0,
        openPOs: poCount[0]?.open_pos || 0,
        totalSpend: Number(poCount[0]?.total_spend || 0),
        totalBills: billsSummary[0]?.total_bills || 0,
        totalInvoiced: Number(billsSummary[0]?.total_invoiced || 0),
        totalDue: Number(billsSummary[0]?.total_due || 0)
      },
      createdAt: s.created_at ? new Date(s.created_at).toISOString().split('T')[0] : '',
    };

    return res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Error fetching supplier details:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch supplier details' });
  }
};

/**
 * POST /api/pos/suppliers
 * Create a new supplier
 */
exports.createSupplier = async (req, res) => {
  const userId = req.user.id;
  const {
    name,
    code,
    contactPerson,
    phone,
    email,
    address,
    city,
    gstTaxNumber,
    paymentTerms = 'Net 30',
    bankName,
    accountNumber,
    ifscOrSwift,
    upiId,
    categoriesSupplied = [],
    status = 'Active',
    notes = ''
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Supplier company name is required.' });
  }

  const connection = await pool.getConnection();

  try {
    await checkTables();
    await connection.beginTransaction();

    let finalCode = (code || '').trim().toUpperCase();
    if (!finalCode) {
      finalCode = await generateSupplierCode(connection, userId);
    } else {
      // Check uniqueness of code
      const [exists] = await connection.query(
        'SELECT id FROM pos_suppliers WHERE user_id = ? AND code = ? AND is_active = 1',
        [userId, finalCode]
      );
      if (exists.length > 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: `Supplier code "${finalCode}" already exists.` });
      }
    }

    const bankDetails = {
      bankName: bankName || '',
      accountNumber: accountNumber || '',
      ifscOrSwift: ifscOrSwift || '',
      upiId: upiId || ''
    };

    const [result] = await connection.query(
      `INSERT INTO pos_suppliers (
        user_id, name, code, contact_person, phone, email, address, city,
        gst_tax_number, payment_terms, balance_payable, bank_details, categories,
        status, notes, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.00, ?, ?, ?, ?, 1)`,
      [
        userId,
        name.trim(),
        finalCode,
        contactPerson || null,
        phone || null,
        email || null,
        address || null,
        city || null,
        gstTaxNumber || null,
        paymentTerms,
        JSON.stringify(bankDetails),
        JSON.stringify(categoriesSupplied),
        status,
        notes || null
      ]
    );

    await connection.commit();

    const createdSupplier = {
      id: String(result.insertId),
      name: name.trim(),
      code: finalCode,
      contactPerson: contactPerson || '',
      phone: phone || '',
      email: email || '',
      address: address || '',
      city: city || '',
      gstTaxNumber: gstTaxNumber || 'N/A',
      paymentTerms,
      balancePayable: 0,
      bankDetails,
      categoriesSupplied,
      status,
      notes,
      createdAt: new Date().toISOString().split('T')[0]
    };

    return res.status(201).json({
      success: true,
      message: `Supplier "${name}" created successfully.`,
      data: createdSupplier
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error creating supplier:', err);
    return res.status(500).json({ success: false, error: 'Failed to create supplier' });
  } finally {
    connection.release();
  }
};

/**
 * PUT /api/pos/suppliers/:id
 * Update supplier details
 */
exports.updateSupplier = async (req, res) => {
  const userId = req.user.id;
  const supplierId = req.params.id;
  const {
    name,
    code,
    contactPerson,
    phone,
    email,
    address,
    city,
    gstTaxNumber,
    paymentTerms,
    bankName,
    accountNumber,
    ifscOrSwift,
    upiId,
    categoriesSupplied,
    status,
    notes
  } = req.body;

  try {
    await checkTables();

    // Verify ownership
    const [existing] = await pool.query(
      'SELECT * FROM pos_suppliers WHERE id = ? AND user_id = ? AND is_active = 1',
      [supplierId, userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Supplier not found' });
    }

    const current = existing[0];

    // If code changed, check uniqueness
    if (code && code.trim().toUpperCase() !== current.code) {
      const [duplicate] = await pool.query(
        'SELECT id FROM pos_suppliers WHERE user_id = ? AND code = ? AND id != ? AND is_active = 1',
        [userId, code.trim().toUpperCase(), supplierId]
      );
      if (duplicate.length > 0) {
        return res.status(400).json({ success: false, error: `Supplier code "${code}" is already in use.` });
      }
    }

    const currentBank = typeof current.bank_details === 'string' ? JSON.parse(current.bank_details) : (current.bank_details || {});
    const updatedBank = {
      bankName: bankName !== undefined ? bankName : (currentBank.bankName || ''),
      accountNumber: accountNumber !== undefined ? accountNumber : (currentBank.accountNumber || ''),
      ifscOrSwift: ifscOrSwift !== undefined ? ifscOrSwift : (currentBank.ifscOrSwift || ''),
      upiId: upiId !== undefined ? upiId : (currentBank.upiId || '')
    };

    await pool.query(
      `UPDATE pos_suppliers SET
        name = COALESCE(?, name),
        code = COALESCE(?, code),
        contact_person = COALESCE(?, contact_person),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        address = COALESCE(?, address),
        city = COALESCE(?, city),
        gst_tax_number = COALESCE(?, gst_tax_number),
        payment_terms = COALESCE(?, payment_terms),
        bank_details = ?,
        categories = COALESCE(?, categories),
        status = COALESCE(?, status),
        notes = COALESCE(?, notes)
       WHERE id = ? AND user_id = ?`,
      [
        name ? name.trim() : null,
        code ? code.trim().toUpperCase() : null,
        contactPerson !== undefined ? contactPerson : null,
        phone !== undefined ? phone : null,
        email !== undefined ? email : null,
        address !== undefined ? address : null,
        city !== undefined ? city : null,
        gstTaxNumber !== undefined ? gstTaxNumber : null,
        paymentTerms || null,
        JSON.stringify(updatedBank),
        categoriesSupplied ? JSON.stringify(categoriesSupplied) : null,
        status || null,
        notes !== undefined ? notes : null,
        supplierId,
        userId
      ]
    );

    return res.json({
      success: true,
      message: 'Supplier updated successfully.'
    });
  } catch (err) {
    console.error('Error updating supplier:', err);
    return res.status(500).json({ success: false, error: 'Failed to update supplier' });
  }
};

/**
 * DELETE /api/pos/suppliers/:id
 * Soft delete supplier with safety check on unpaid balances or open POs
 */
exports.deleteSupplier = async (req, res) => {
  const userId = req.user.id;
  const supplierId = req.params.id;

  try {
    await checkTables();

    const [suppliers] = await pool.query(
      'SELECT * FROM pos_suppliers WHERE id = ? AND user_id = ? AND is_active = 1',
      [supplierId, userId]
    );

    if (suppliers.length === 0) {
      return res.status(404).json({ success: false, error: 'Supplier not found' });
    }

    const s = suppliers[0];

    // Check if balance payable > 0
    if (Number(s.balance_payable) > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete supplier with an outstanding balance of $${Number(s.balance_payable).toFixed(2)}. Settle all payments first.`
      });
    }

    // Check open POs
    const [openPOs] = await pool.query(
      `SELECT COUNT(*) as count FROM pos_purchase_orders 
       WHERE supplier_id = ? AND user_id = ? AND status IN ('Draft', 'Ordered', 'Partial')`,
      [supplierId, userId]
    );

    if ((openPOs[0]?.count || 0) > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete supplier with ${openPOs[0].count} active open purchase order(s). Close or cancel them first.`
      });
    }

    await pool.query(
      'UPDATE pos_suppliers SET is_active = 0, status = "Inactive" WHERE id = ? AND user_id = ?',
      [supplierId, userId]
    );

    return res.json({
      success: true,
      message: `Supplier "${s.name}" deleted successfully.`
    });
  } catch (err) {
    console.error('Error deleting supplier:', err);
    return res.status(500).json({ success: false, error: 'Failed to delete supplier' });
  }
};

const { pool } = require('../../config/db');
const { updatePosSettingsSchema } = require('../../validations/pos/posSettingsValidation');

const DEFAULT_TAXES = [
  { id: 'tax-1', name: 'Sales Tax', percentage: 8.0 }
];

function parseJson(val, fallback = null) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

let hasCheckedCashierColumn = false;
async function ensureCashierNameColumn() {
  if (hasCheckedCashierColumn) return;
  try {
    const [cols] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_settings' AND COLUMN_NAME = 'cashier_name'"
    );
    if (cols.length === 0) {
      await pool.query("ALTER TABLE pos_settings ADD COLUMN cashier_name VARCHAR(150) DEFAULT NULL AFTER show_cashier_name");
    }
    hasCheckedCashierColumn = true;
  } catch (err) {
    console.warn('Could not check or add cashier_name column:', err.message);
  }
}

/**
 * Maps DB row to frontend camelCase settings object
 */
function formatSettingsResponse(row) {
  const parsedTaxes = parseJson(row.taxes, null);
  const taxes = Array.isArray(parsedTaxes) && parsedTaxes.length > 0
    ? parsedTaxes
    : [
        {
          id: 'tax-1',
          name: 'Sales Tax',
          percentage: Number(row.default_tax_rate) || 8.0,
        },
      ];

  const totalTaxRate = taxes.reduce((acc, t) => acc + (Number(t.percentage) || 0), 0);

  return {
    id: row.id,
    userId: row.user_id,

    // Store Branding
    storeName: row.store_name || 'MoneyLog Store',
    storeTagline: row.tagline || '',
    storeLogoUrl: row.store_logo_url || '',
    storeLogoInitial: row.store_logo_initial || (row.store_name ? row.store_name.charAt(0).toUpperCase() : 'M'),

    // Location & Contact
    addressLine1: row.address_line1 || '',
    addressLine2: row.address_line2 || '',
    city: row.city || '',
    state: row.state || '',
    postalCode: row.postal_code || '',
    phone: row.store_phone || '',
    email: row.store_email || '',
    website: row.website || '',
    gstTaxNumber: row.tax_number || '',

    // Taxation & Currency (Always fixed to USD / $)
    currencySymbol: '$',
    currencyCode: 'USD',
    taxes,
    defaultTaxRate: Number(totalTaxRate.toFixed(2)),
    isTaxInclusive: Boolean(row.is_tax_inclusive),

    // UPI Payments & QR
    upiId: row.upi_id || '',
    upiPayeeName: row.upi_payee_name || '',
    upiQrType: row.upi_qr_type || 'auto',
    upiQrImageUrl: row.upi_qr_image_url || '',

    // Header, Footer & Policy
    receiptHeaderNote: row.receipt_header_note || '',
    receiptFooterNote: row.receipt_footer_note || '',
    returnPolicy: row.return_policy || 'Returns accepted within 14 days with original receipt.',
    returnWindowDays: Number(row.return_window_days !== undefined ? row.return_window_days : 14),

    // Printing Preferences
    paperSize: row.paper_width || '80mm',
    showTaxBreakdown: row.show_tax_breakdown !== undefined ? Boolean(row.show_tax_breakdown) : true,
    showCashierName: row.show_cashier_name !== undefined ? Boolean(row.show_cashier_name) : true,
    cashierName: row.cashier_name || '',
    showCustomerInfo: row.show_customer_info !== undefined ? Boolean(row.show_customer_info) : true,
    showUpiQrOnReceipt: row.show_upi_qr_on_receipt !== undefined ? Boolean(row.show_upi_qr_on_receipt) : true,
    autoPrintReceipt: Boolean(row.auto_print_receipt),
    cashDrawerFloat: Number(row.cash_drawer_float) || 0,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/pos/settings
 * Fetch POS settings for the authenticated user
 */
exports.getSettings = async (req, res) => {
  const userId = req.user.id;

  try {
    await ensureCashierNameColumn();
    const [rows] = await pool.query(
      'SELECT * FROM pos_settings WHERE user_id = ? LIMIT 1',
      [userId]
    );

    if (rows.length === 0) {
      // Auto-initialize default settings for this user
      const defaultTaxesJson = JSON.stringify(DEFAULT_TAXES);
      await pool.query(
        `INSERT INTO pos_settings (
          user_id, store_name, tagline, upi_id, default_tax_rate, taxes, 
          currency_symbol, currency_code, is_tax_inclusive, paper_width,
          show_tax_breakdown, show_cashier_name, show_customer_info, show_upi_qr_on_receipt
        ) VALUES (?, 'MoneyLog Store', 'Artisan Store & Roastery', 'pos@okaxis', 8.00, ?, '$', 'USD', 0, '80mm', 1, 1, 1, 1)`,
        [userId, defaultTaxesJson]
      );

      const [newRows] = await pool.query(
        'SELECT * FROM pos_settings WHERE user_id = ? LIMIT 1',
        [userId]
      );
      return res.json({ success: true, data: formatSettingsResponse(newRows[0]) });
    }

    res.json({ success: true, data: formatSettingsResponse(rows[0]) });
  } catch (error) {
    console.error('Error fetching POS settings:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch POS settings' });
  }
};

/**
 * PUT /api/pos/settings
 * Update POS settings for authenticated user (upsert)
 */
exports.updateSettings = async (req, res) => {
  const userId = req.user.id;

  try {
    await ensureCashierNameColumn();
    const validated = updatePosSettingsSchema.parse(req.body);

    // Compute combined default tax rate from taxes array
    let taxesJson = null;
    let defaultTaxRate = 8.00;

    if (Array.isArray(validated.taxes)) {
      taxesJson = JSON.stringify(validated.taxes);
      defaultTaxRate = validated.taxes.reduce(
        (sum, t) => sum + (Number(t.percentage) || 0),
        0
      );
    }

    // Check if settings record exists
    const [existing] = await pool.query(
      'SELECT id, taxes, default_tax_rate FROM pos_settings WHERE user_id = ? LIMIT 1',
      [userId]
    );

    if (existing.length === 0) {
      // Create new record
      await pool.query(
        `INSERT INTO pos_settings (
          user_id, store_name, tagline, store_logo_url, store_logo_initial,
          address_line1, address_line2, city, state, postal_code,
          store_phone, store_email, website, tax_number,
          taxes, default_tax_rate, currency_symbol, currency_code, is_tax_inclusive,
          upi_id, upi_payee_name, upi_qr_type, upi_qr_image_url,
          receipt_header_note, receipt_footer_note, return_policy, return_window_days,
          paper_width, show_tax_breakdown, show_cashier_name, show_customer_info,
          show_upi_qr_on_receipt, auto_print_receipt, cash_drawer_float
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, '$', 'USD', ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?
        )`,
        [
          userId,
          validated.storeName || 'MoneyLog Store',
          validated.storeTagline || null,
          validated.storeLogoUrl || null,
          validated.storeLogoInitial || 'M',
          validated.addressLine1 || null,
          validated.addressLine2 || null,
          validated.city || null,
          validated.state || null,
          validated.postalCode || null,
          validated.phone || null,
          validated.email || null,
          validated.website || null,
          validated.gstTaxNumber || null,
          taxesJson || JSON.stringify(DEFAULT_TAXES),
          defaultTaxRate,
          validated.isTaxInclusive ? 1 : 0,
          validated.upiId || 'pos@okaxis',
          validated.upiPayeeName || null,
          validated.upiQrType || 'auto',
          validated.upiQrImageUrl || null,
          validated.receiptHeaderNote || null,
          validated.receiptFooterNote || null,
          validated.returnPolicy || null,
          validated.returnWindowDays !== undefined ? validated.returnWindowDays : 14,
          validated.paperSize || '80mm',
          validated.showTaxBreakdown !== undefined ? (validated.showTaxBreakdown ? 1 : 0) : 1,
          validated.showCashierName !== undefined ? (validated.showCashierName ? 1 : 0) : 1,
          validated.showCustomerInfo !== undefined ? (validated.showCustomerInfo ? 1 : 0) : 1,
          validated.showUpiQrOnReceipt !== undefined ? (validated.showUpiQrOnReceipt ? 1 : 0) : 1,
          validated.autoPrintReceipt ? 1 : 0,
          validated.cashDrawerFloat || 0,
        ]
      );
    } else {
      // Update existing record
      const fields = [];
      const values = [];

      if (validated.storeName !== undefined) {
        fields.push('`store_name` = ?');
        values.push(validated.storeName);
      }
      if (validated.storeTagline !== undefined) {
        fields.push('`tagline` = ?');
        values.push(validated.storeTagline);
      }
      if (validated.storeLogoUrl !== undefined) {
        fields.push('`store_logo_url` = ?');
        values.push(validated.storeLogoUrl);
      }
      if (validated.storeLogoInitial !== undefined) {
        fields.push('`store_logo_initial` = ?');
        values.push(validated.storeLogoInitial);
      }
      if (validated.addressLine1 !== undefined) {
        fields.push('`address_line1` = ?');
        values.push(validated.addressLine1);
      }
      if (validated.addressLine2 !== undefined) {
        fields.push('`address_line2` = ?');
        values.push(validated.addressLine2);
      }
      if (validated.city !== undefined) {
        fields.push('`city` = ?');
        values.push(validated.city);
      }
      if (validated.state !== undefined) {
        fields.push('`state` = ?');
        values.push(validated.state);
      }
      if (validated.postalCode !== undefined) {
        fields.push('`postal_code` = ?');
        values.push(validated.postalCode);
      }
      if (validated.phone !== undefined) {
        fields.push('`store_phone` = ?');
        values.push(validated.phone);
      }
      if (validated.email !== undefined) {
        fields.push('`store_email` = ?');
        values.push(validated.email);
      }
      if (validated.website !== undefined) {
        fields.push('`website` = ?');
        values.push(validated.website);
      }
      if (validated.gstTaxNumber !== undefined) {
        fields.push('`tax_number` = ?');
        values.push(validated.gstTaxNumber);
      }
      if (taxesJson !== null) {
        fields.push('`taxes` = ?');
        values.push(taxesJson);
        fields.push('`default_tax_rate` = ?');
        values.push(defaultTaxRate);
      }
      if (validated.isTaxInclusive !== undefined) {
        fields.push('`is_tax_inclusive` = ?');
        values.push(validated.isTaxInclusive ? 1 : 0);
      }
      // Currency is always USD
      fields.push("`currency_symbol` = '$'");
      fields.push("`currency_code` = 'USD'");

      if (validated.upiId !== undefined) {
        fields.push('`upi_id` = ?');
        values.push(validated.upiId);
      }
      if (validated.upiPayeeName !== undefined) {
        fields.push('`upi_payee_name` = ?');
        values.push(validated.upiPayeeName);
      }
      if (validated.upiQrType !== undefined) {
        fields.push('`upi_qr_type` = ?');
        values.push(validated.upiQrType);
      }
      if (validated.upiQrImageUrl !== undefined) {
        fields.push('`upi_qr_image_url` = ?');
        values.push(validated.upiQrImageUrl);
      }
      if (validated.receiptHeaderNote !== undefined) {
        fields.push('`receipt_header_note` = ?');
        values.push(validated.receiptHeaderNote);
      }
      if (validated.receiptFooterNote !== undefined) {
        fields.push('`receipt_footer_note` = ?');
        values.push(validated.receiptFooterNote);
      }
      if (validated.returnPolicy !== undefined) {
        fields.push('`return_policy` = ?');
        values.push(validated.returnPolicy);
      }
      if (validated.returnWindowDays !== undefined) {
        fields.push('`return_window_days` = ?');
        values.push(validated.returnWindowDays);
      }
      if (validated.paperSize !== undefined) {
        fields.push('`paper_width` = ?');
        values.push(validated.paperSize);
      }
      if (validated.showTaxBreakdown !== undefined) {
        fields.push('`show_tax_breakdown` = ?');
        values.push(validated.showTaxBreakdown ? 1 : 0);
      }
      if (validated.showCashierName !== undefined) {
        fields.push('`show_cashier_name` = ?');
        values.push(validated.showCashierName ? 1 : 0);
      }
      if (validated.cashierName !== undefined) {
        fields.push('`cashier_name` = ?');
        values.push(validated.cashierName || null);
      }
      if (validated.showCustomerInfo !== undefined) {
        fields.push('`show_customer_info` = ?');
        values.push(validated.showCustomerInfo ? 1 : 0);
      }
      if (validated.showUpiQrOnReceipt !== undefined) {
        fields.push('`show_upi_qr_on_receipt` = ?');
        values.push(validated.showUpiQrOnReceipt ? 1 : 0);
      }
      if (validated.autoPrintReceipt !== undefined) {
        fields.push('`auto_print_receipt` = ?');
        values.push(validated.autoPrintReceipt ? 1 : 0);
      }
      if (validated.cashDrawerFloat !== undefined) {
        fields.push('`cash_drawer_float` = ?');
        values.push(validated.cashDrawerFloat);
      }

      if (fields.length > 0) {
        values.push(userId);
        await pool.query(
          `UPDATE pos_settings SET ${fields.join(', ')} WHERE user_id = ?`,
          values
        );
      }
    }

    const [updatedRows] = await pool.query(
      'SELECT * FROM pos_settings WHERE user_id = ? LIMIT 1',
      [userId]
    );

    res.json({
      success: true,
      message: 'POS settings updated successfully',
      data: formatSettingsResponse(updatedRows[0]),
    });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: error.issues?.[0]?.message || 'Validation failed',
        details: error.issues,
      });
    }

    console.error('Error updating POS settings:', error);
    res.status(500).json({ success: false, error: 'Failed to update POS settings' });
  }
};

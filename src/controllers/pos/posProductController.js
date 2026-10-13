const { pool } = require('../../config/db');
const { createProductSchema, updateProductSchema } = require('../../validations/pos/posProductValidation');

/**
 * Generate a clean SKU if none is provided
 */
function generateSku(productName, index = 1) {
  const prefix = (productName || 'SKU')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 4)
    .toUpperCase() || 'PROD';
  const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  return `${prefix}-${timestamp}-${index}-${randomSuffix}`;
}

/**
 * Safe JSON parser helper
 */
function parseJson(val, fallback = null) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

/**
 * GET /api/pos/products
 * Listing with pagination, search, category/brand/stock/status filters
 */
exports.getProducts = async (req, res) => {
  const userId = req.user.id;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const offset = (page - 1) * limit;

  const {
    search,
    category_id,
    brand_id,
    status,
    stock_status,
    sortBy = 'created_at',
    sortOrder = 'desc',
  } = req.query;

  try {
    // 1. Build WHERE conditions
    const whereConditions = ['p.user_id = ?'];
    const whereParams = [userId];

    // Status filter (default to excluding archived unless specifically asked)
    if (status && status !== 'all') {
      whereConditions.push('p.status = ?');
      whereParams.push(status);
    } else if (!status || status === 'all') {
      whereConditions.push("p.status != 'archived'");
    }

    // Category filter
    if (category_id && category_id !== 'all') {
      whereConditions.push('p.category_id = ?');
      whereParams.push(parseInt(category_id, 10));
    }

    // Brand filter
    if (brand_id && brand_id !== 'all') {
      whereConditions.push('p.brand_id = ?');
      whereParams.push(parseInt(brand_id, 10));
    }

    // Search filter across name, description, variant SKU, barcode, title
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      whereConditions.push(`(
        p.name LIKE ? OR 
        p.description LIKE ? OR 
        EXISTS (
          SELECT 1 FROM pos_product_variants v_search 
          WHERE v_search.product_id = p.id 
          AND (v_search.sku LIKE ? OR v_search.barcode LIKE ? OR v_search.title LIKE ?)
        )
      )`);
      whereParams.push(term, term, term, term, term);
    }

    const whereClause = whereConditions.join(' AND ');

    // 2. Count total matching products
    const countSql = `
      SELECT COUNT(DISTINCT p.id) AS total
      FROM pos_products p
      WHERE ${whereClause}
    `;
    const [countRows] = await pool.query(countSql, whereParams);
    const total = countRows[0]?.total || 0;

    if (total === 0) {
      return res.json({
        success: true,
        data: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false,
        },
      });
    }

    // 3. Build Sorting
    const allowedSortFields = {
      name: 'p.name',
      created_at: 'p.created_at',
      status: 'p.status',
      selling_price: 'min_price',
      stock_quantity: 'total_stock',
    };
    const orderColumn = allowedSortFields[sortBy] || 'p.created_at';
    const direction = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // 4. Fetch paginated products with aggregates
    const productsSql = `
      SELECT 
        p.id,
        p.name,
        p.category_id,
        c.name AS category_name,
        p.brand_id,
        b.name AS brand_name,
        p.description,
        p.base_unit,
        p.is_taxable,
        p.tax_rate,
        p.status,
        p.image_url,
        p.options_config,
        p.created_at,
        p.updated_at,
        COUNT(v.id) AS variants_count,
        COALESCE(SUM(v.stock_quantity), 0) AS total_stock,
        COALESCE(MIN(v.selling_price), 0) AS min_price,
        COALESCE(MAX(v.selling_price), 0) AS max_price,
        COALESCE(MIN(v.min_stock_alert), 5) AS min_stock_alert
      FROM pos_products p
      LEFT JOIN pos_categories c ON c.id = p.category_id
      LEFT JOIN pos_brands b ON b.id = p.brand_id
      LEFT JOIN pos_product_variants v ON v.product_id = p.id AND v.is_active = 1
      WHERE ${whereClause}
      GROUP BY p.id
      ${
        stock_status && stock_status !== 'all'
          ? stock_status === 'out_of_stock'
            ? 'HAVING total_stock <= 0'
            : stock_status === 'low_stock'
            ? 'HAVING total_stock > 0 AND total_stock <= min_stock_alert'
            : stock_status === 'in_stock'
            ? 'HAVING total_stock > min_stock_alert'
            : ''
          : ''
      }
      ORDER BY ${orderColumn} ${direction}
      LIMIT ? OFFSET ?
    `;

    const productQueryParams = [...whereParams, limit, offset];
    const [products] = await pool.query(productsSql, productQueryParams);

    // 5. Batch-fetch variants for these products
    if (products.length > 0) {
      const productIds = products.map((p) => p.id);
      const [variants] = await pool.query(
        `SELECT 
          id, product_id, sku, barcode, title, attributes,
          cost_price, mrp, selling_price, discount_percent,
          stock_quantity, min_stock_alert, is_active
        FROM pos_product_variants
        WHERE product_id IN (?) AND user_id = ?
        ORDER BY id ASC`,
        [productIds, userId]
      );

      // Group variants by product_id
      const variantsByProductId = {};
      for (const variant of variants) {
        if (!variantsByProductId[variant.product_id]) {
          variantsByProductId[variant.product_id] = [];
        }
        variantsByProductId[variant.product_id].push({
          ...variant,
          attributes: parseJson(variant.attributes, {}),
          cost_price: Number(variant.cost_price),
          mrp: Number(variant.mrp),
          selling_price: Number(variant.selling_price),
          discount_percent: Number(variant.discount_percent),
          stock_quantity: Number(variant.stock_quantity),
          min_stock_alert: Number(variant.min_stock_alert),
          is_active: Boolean(variant.is_active),
        });
      }

      // Format product results
      for (const prod of products) {
        prod.options_config = parseJson(prod.options_config, []);
        prod.is_taxable = Boolean(prod.is_taxable);
        prod.tax_rate = prod.tax_rate !== null ? Number(prod.tax_rate) : null;
        prod.variants_count = Number(prod.variants_count);
        prod.total_stock = Number(prod.total_stock);
        prod.min_price = Number(prod.min_price);
        prod.max_price = Number(prod.max_price);
        prod.min_stock_alert = Number(prod.min_stock_alert);

        // Derive stock status
        if (prod.total_stock <= 0) {
          prod.stock_status = 'out_of_stock';
        } else if (prod.total_stock <= prod.min_stock_alert) {
          prod.stock_status = 'low_stock';
        } else {
          prod.stock_status = 'in_stock';
        }

        prod.variants = variantsByProductId[prod.id] || [];
      }
    }

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: products,
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
    console.error('Error fetching POS products:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch POS products' });
  }
};

/**
 * GET /api/pos/products/:id
 * Get single product by ID with full variants
 */
exports.getProductById = async (req, res) => {
  const userId = req.user.id;
  const productId = parseInt(req.params.id, 10);

  if (isNaN(productId)) {
    return res.status(400).json({ success: false, error: 'Invalid product ID' });
  }

  try {
    const [products] = await pool.query(
      `SELECT 
        p.id,
        p.name,
        p.category_id,
        c.name AS category_name,
        p.brand_id,
        b.name AS brand_name,
        p.description,
        p.base_unit,
        p.is_taxable,
        p.tax_rate,
        p.status,
        p.image_url,
        p.options_config,
        p.created_at,
        p.updated_at
      FROM pos_products p
      LEFT JOIN pos_categories c ON c.id = p.category_id
      LEFT JOIN pos_brands b ON b.id = p.brand_id
      WHERE p.id = ? AND p.user_id = ?`,
      [productId, userId]
    );

    if (products.length === 0) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const product = products[0];
    product.options_config = parseJson(product.options_config, []);
    product.is_taxable = Boolean(product.is_taxable);
    product.tax_rate = product.tax_rate !== null ? Number(product.tax_rate) : null;

    const [variants] = await pool.query(
      `SELECT 
        id, product_id, sku, barcode, title, attributes,
        cost_price, mrp, selling_price, discount_percent,
        stock_quantity, min_stock_alert, is_active
      FROM pos_product_variants
      WHERE product_id = ? AND user_id = ?
      ORDER BY id ASC`,
      [productId, userId]
    );

    product.variants = variants.map((v) => ({
      ...v,
      attributes: parseJson(v.attributes, {}),
      cost_price: Number(v.cost_price),
      mrp: Number(v.mrp),
      selling_price: Number(v.selling_price),
      discount_percent: Number(v.discount_percent),
      stock_quantity: Number(v.stock_quantity),
      min_stock_alert: Number(v.min_stock_alert),
      is_active: Boolean(v.is_active),
    }));

    product.total_stock = product.variants.reduce((acc, v) => acc + v.stock_quantity, 0);

    res.json({ success: true, data: product });
  } catch (error) {
    console.error('Error fetching product by ID:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch product' });
  }
};

/**
 * POST /api/pos/products
 * Create product + dynamic variants (Zod verified: requires at least 1 variant)
 */
exports.createProduct = async (req, res) => {
  const userId = req.user.id;
  const connection = await pool.getConnection();

  try {
    const validated = createProductSchema.parse(req.body);

    await connection.beginTransaction();

    // 1. Insert product master
    const [productResult] = await connection.query(
      `INSERT INTO pos_products (
        user_id, name, category_id, brand_id, description,
        base_unit, is_taxable, tax_rate, status, image_url, options_config
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        validated.name,
        validated.category_id || null,
        validated.brand_id || null,
        validated.description || null,
        validated.base_unit || 'pcs',
        validated.is_taxable ? 1 : 0,
        validated.tax_rate !== undefined ? validated.tax_rate : null,
        validated.status || 'active',
        validated.image_url || null,
        validated.options_config ? JSON.stringify(validated.options_config) : null,
      ]
    );

    const productId = productResult.insertId;

    // 2. Insert variants (at least 1 guaranteed by Zod schema)
    const insertedVariants = [];
    for (let i = 0; i < validated.variants.length; i++) {
      const v = validated.variants[i];
      const sku = v.sku?.trim() || generateSku(validated.name, i + 1);
      const barcode = v.barcode?.trim() || null;
      const title = v.title?.trim() || 'Default';
      const attributesJson = JSON.stringify(v.attributes || {});
      const costPrice = v.cost_price || 0;
      const mrp = v.mrp || 0;
      const sellingPrice = v.selling_price;
      const discountPercent = v.discount_percent || 0;
      const stockQuantity = v.stock_quantity || 0;
      const minStockAlert = v.min_stock_alert !== undefined ? v.min_stock_alert : 5;
      const isActive = v.is_active !== undefined ? (v.is_active ? 1 : 0) : 1;

      const [variantResult] = await connection.query(
        `INSERT INTO pos_product_variants (
          user_id, product_id, sku, barcode, title, attributes,
          cost_price, mrp, selling_price, discount_percent,
          stock_quantity, min_stock_alert, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          productId,
          sku,
          barcode,
          title,
          attributesJson,
          costPrice,
          mrp,
          sellingPrice,
          discountPercent,
          stockQuantity,
          minStockAlert,
          isActive,
        ]
      );

      insertedVariants.push({
        id: variantResult.insertId,
        product_id: productId,
        sku,
        barcode,
        title,
        attributes: v.attributes || {},
        cost_price: costPrice,
        mrp,
        selling_price: sellingPrice,
        discount_percent: discountPercent,
        stock_quantity: stockQuantity,
        min_stock_alert: minStockAlert,
        is_active: Boolean(isActive),
      });
    }

    await connection.commit();

    res.status(201).json({
      success: true,
      data: {
        id: productId,
        name: validated.name,
        category_id: validated.category_id || null,
        brand_id: validated.brand_id || null,
        description: validated.description || null,
        base_unit: validated.base_unit || 'pcs',
        is_taxable: Boolean(validated.is_taxable),
        tax_rate: validated.tax_rate !== undefined ? validated.tax_rate : null,
        status: validated.status || 'active',
        image_url: validated.image_url || null,
        options_config: validated.options_config || [],
        variants: insertedVariants,
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

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        error: 'Duplicate SKU or barcode detected. SKUs must be unique.',
      });
    }

    console.error('Error creating POS product:', error);
    res.status(500).json({ success: false, error: 'Failed to create POS product' });
  } finally {
    connection.release();
  }
};

/**
 * PUT /api/pos/products/:id
 * Update product and synchronize variants
 */
exports.updateProduct = async (req, res) => {
  const userId = req.user.id;
  const productId = parseInt(req.params.id, 10);

  if (isNaN(productId)) {
    return res.status(400).json({ success: false, error: 'Invalid product ID' });
  }

  const connection = await pool.getConnection();

  try {
    const validated = updateProductSchema.parse(req.body);

    await connection.beginTransaction();

    // Check ownership
    const [existing] = await connection.query(
      'SELECT id FROM pos_products WHERE id = ? AND user_id = ?',
      [productId, userId]
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    // 1. Update product details if provided
    const updateFields = [];
    const updateParams = [];

    if (validated.name !== undefined) {
      updateFields.push('name = ?');
      updateParams.push(validated.name);
    }
    if (validated.category_id !== undefined) {
      updateFields.push('category_id = ?');
      updateParams.push(validated.category_id);
    }
    if (validated.brand_id !== undefined) {
      updateFields.push('brand_id = ?');
      updateParams.push(validated.brand_id);
    }
    if (validated.description !== undefined) {
      updateFields.push('description = ?');
      updateParams.push(validated.description);
    }
    if (validated.base_unit !== undefined) {
      updateFields.push('base_unit = ?');
      updateParams.push(validated.base_unit);
    }
    if (validated.is_taxable !== undefined) {
      updateFields.push('is_taxable = ?');
      updateParams.push(validated.is_taxable ? 1 : 0);
    }
    if (validated.tax_rate !== undefined) {
      updateFields.push('tax_rate = ?');
      updateParams.push(validated.tax_rate);
    }
    if (validated.status !== undefined) {
      updateFields.push('status = ?');
      updateParams.push(validated.status);
    }
    if (validated.image_url !== undefined) {
      updateFields.push('image_url = ?');
      updateParams.push(validated.image_url);
    }
    if (validated.options_config !== undefined) {
      updateFields.push('options_config = ?');
      updateParams.push(validated.options_config ? JSON.stringify(validated.options_config) : null);
    }

    if (updateFields.length > 0) {
      updateParams.push(productId, userId);
      await connection.query(
        `UPDATE pos_products SET ${updateFields.join(', ')} WHERE id = ? AND user_id = ?`,
        updateParams
      );
    }

    // 2. Synchronize variants if supplied
    if (validated.variants && validated.variants.length > 0) {
      const submittedVariantIds = [];

      for (let i = 0; i < validated.variants.length; i++) {
        const v = validated.variants[i];
        const sku = v.sku?.trim() || generateSku(validated.name || 'PROD', i + 1);
        const barcode = v.barcode?.trim() || null;
        const title = v.title?.trim() || 'Default';
        const attributesJson = JSON.stringify(v.attributes || {});
        const costPrice = v.cost_price || 0;
        const mrp = v.mrp || 0;
        const sellingPrice = v.selling_price;
        const discountPercent = v.discount_percent || 0;
        const stockQuantity = v.stock_quantity || 0;
        const minStockAlert = v.min_stock_alert !== undefined ? v.min_stock_alert : 5;
        const isActive = v.is_active !== undefined ? (v.is_active ? 1 : 0) : 1;

        if (v.id) {
          // Update existing variant
          await connection.query(
            `UPDATE pos_product_variants SET 
              sku = ?, barcode = ?, title = ?, attributes = ?,
              cost_price = ?, mrp = ?, selling_price = ?, discount_percent = ?,
              stock_quantity = ?, min_stock_alert = ?, is_active = ?
            WHERE id = ? AND product_id = ? AND user_id = ?`,
            [
              sku,
              barcode,
              title,
              attributesJson,
              costPrice,
              mrp,
              sellingPrice,
              discountPercent,
              stockQuantity,
              minStockAlert,
              isActive,
              v.id,
              productId,
              userId,
            ]
          );
          submittedVariantIds.push(v.id);
        } else {
          // Insert new variant
          const [newVar] = await connection.query(
            `INSERT INTO pos_product_variants (
              user_id, product_id, sku, barcode, title, attributes,
              cost_price, mrp, selling_price, discount_percent,
              stock_quantity, min_stock_alert, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              userId,
              productId,
              sku,
              barcode,
              title,
              attributesJson,
              costPrice,
              mrp,
              sellingPrice,
              discountPercent,
              stockQuantity,
              minStockAlert,
              isActive,
            ]
          );
          submittedVariantIds.push(newVar.insertId);
        }
      }

      // Mark removed variants inactive
      if (submittedVariantIds.length > 0) {
        await connection.query(
          `UPDATE pos_product_variants 
           SET is_active = 0 
           WHERE product_id = ? AND user_id = ? AND id NOT IN (?)`,
          [productId, userId, submittedVariantIds]
        );
      }
    }

    await connection.commit();

    // Fetch and return the updated product
    const [updatedProduct] = await pool.query(
      `SELECT 
        p.id, p.name, p.category_id, c.name AS category_name,
        p.brand_id, p.description, p.base_unit, p.is_taxable, p.tax_rate,
        p.status, p.image_url, p.options_config, p.updated_at
      FROM pos_products p
      LEFT JOIN pos_categories c ON c.id = p.category_id
      WHERE p.id = ? AND p.user_id = ?`,
      [productId, userId]
    );

    const [variants] = await pool.query(
      'SELECT * FROM pos_product_variants WHERE product_id = ? AND user_id = ? ORDER BY id ASC',
      [productId, userId]
    );

    const result = updatedProduct[0];
    result.options_config = parseJson(result.options_config, []);
    result.variants = variants.map((v) => ({
      ...v,
      attributes: parseJson(v.attributes, {}),
      cost_price: Number(v.cost_price),
      mrp: Number(v.mrp),
      selling_price: Number(v.selling_price),
      discount_percent: Number(v.discount_percent),
      stock_quantity: Number(v.stock_quantity),
      min_stock_alert: Number(v.min_stock_alert),
      is_active: Boolean(v.is_active),
    }));

    res.json({ success: true, data: result });
  } catch (error) {
    await connection.rollback();

    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: error.issues?.[0]?.message || 'Validation failed',
      });
    }

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        error: 'Duplicate SKU or barcode detected.',
      });
    }

    console.error('Error updating POS product:', error);
    res.status(500).json({ success: false, error: 'Failed to update POS product' });
  } finally {
    connection.release();
  }
};

/**
 * DELETE /api/pos/products/:id
 * Soft delete (archive) or hard delete if permanent
 */
exports.deleteProduct = async (req, res) => {
  const userId = req.user.id;
  const productId = parseInt(req.params.id, 10);
  const permanent = req.query.permanent === 'true';

  if (isNaN(productId)) {
    return res.status(400).json({ success: false, error: 'Invalid product ID' });
  }

  try {
    if (permanent) {
      try {
        const [result] = await pool.query(
          'DELETE FROM pos_products WHERE id = ? AND user_id = ?',
          [productId, userId]
        );
        if (result.affectedRows === 0) {
          return res.status(404).json({ success: false, error: 'Product not found' });
        }
        return res.json({ success: true, message: 'Product permanently deleted' });
      } catch (err) {
        // If foreign key constraint from orders prevents deletion, fallback to archive
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
          await pool.query(
            "UPDATE pos_products SET status = 'archived' WHERE id = ? AND user_id = ?",
            [productId, userId]
          );
          return res.json({
            success: true,
            message: 'Product has order history, so it was archived instead of deleted.',
          });
        }
        throw err;
      }
    } else {
      const [result] = await pool.query(
        "UPDATE pos_products SET status = 'archived' WHERE id = ? AND user_id = ?",
        [productId, userId]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, error: 'Product not found' });
      }
      return res.json({ success: true, message: 'Product archived successfully' });
    }
  } catch (error) {
    console.error('Error deleting/archiving POS product:', error);
    res.status(500).json({ success: false, error: 'Failed to delete product' });
  }
};

/**
 * GET /api/pos/products/scan/:code
 * High-speed barcode or SKU lookup for POS Register
 */
exports.scanProduct = async (req, res) => {
  const userId = req.user.id;
  const code = req.params.code?.trim();

  if (!code) {
    return res.status(400).json({ success: false, error: 'Scan code is required' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT 
        v.id AS variant_id,
        v.product_id,
        p.name AS product_name,
        v.title AS variant_title,
        v.sku,
        v.barcode,
        v.selling_price,
        v.mrp,
        v.cost_price,
        v.discount_percent,
        v.stock_quantity,
        v.attributes,
        p.base_unit,
        p.is_taxable,
        p.tax_rate,
        p.image_url
      FROM pos_product_variants v
      JOIN pos_products p ON p.id = v.product_id
      WHERE v.user_id = ? 
        AND (v.barcode = ? OR v.sku = ?)
        AND v.is_active = 1
        AND p.status = 'active'
      LIMIT 1`,
      [userId, code, code]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: `No active product found with code "${code}"` });
    }

    const item = rows[0];
    item.attributes = parseJson(item.attributes, {});
    item.selling_price = Number(item.selling_price);
    item.mrp = Number(item.mrp);
    item.cost_price = Number(item.cost_price);
    item.discount_percent = Number(item.discount_percent);
    item.stock_quantity = Number(item.stock_quantity);
    item.is_taxable = Boolean(item.is_taxable);
    item.tax_rate = item.tax_rate !== null ? Number(item.tax_rate) : null;

    res.json({ success: true, data: item });
  } catch (error) {
    console.error('Error scanning product:', error);
    res.status(500).json({ success: false, error: 'Failed to scan product' });
  }
};

/**
 * Helper: Escape field for standard CSV RFC-4180
 */
function escapeCsvValue(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Helper: Parse CSV text supporting RFC-4180 quotes, commas, newlines and escaped quotes
 */
function parseCsvText(text) {
  if (!text) return [];
  const cleanText = text.replace(/^\uFEFF/, ''); // strip UTF-8 BOM
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let insideQuote = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (insideQuote) {
      if (char === '"' && nextChar === '"') {
        currentCell += '"';
        i++; // skip escaped quote
      } else if (char === '"') {
        insideQuote = false;
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        insideQuote = true;
      } else if (char === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\r') {
        if (nextChar === '\n') i++;
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else if (char === '\n') {
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Helper: Slugify category names
 */
function slugify(text) {
  return (text || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
}

/**
 * GET /api/pos/products/export
 * Export entire catalog without pagination limits (all products + variants)
 */
exports.exportProducts = async (req, res) => {
  const userId = req.user.id;
  const { category_id, brand_id, status, search, format = 'csv' } = req.query;

  try {
    const whereConditions = ['p.user_id = ?'];
    const whereParams = [userId];

    if (status && status !== 'all') {
      whereConditions.push('p.status = ?');
      whereParams.push(status);
    } else {
      whereConditions.push("p.status != 'archived'");
    }

    if (category_id && category_id !== 'all') {
      whereConditions.push('p.category_id = ?');
      whereParams.push(parseInt(category_id, 10));
    }

    if (brand_id && brand_id !== 'all') {
      whereConditions.push('p.brand_id = ?');
      whereParams.push(parseInt(brand_id, 10));
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      whereConditions.push(`(
        p.name LIKE ? OR 
        p.description LIKE ? OR 
        v.sku LIKE ? OR 
        v.barcode LIKE ? OR 
        v.title LIKE ?
      )`);
      whereParams.push(term, term, term, term, term);
    }

    const whereClause = whereConditions.join(' AND ');

    const sql = `
      SELECT 
        p.id AS product_id,
        p.name AS product_name,
        COALESCE(c.name, 'Uncategorized') AS category_name,
        COALESCE(b.name, 'Generic') AS brand_name,
        COALESCE(p.description, '') AS description,
        p.status AS product_status,
        p.base_unit,
        v.id AS variant_id,
        COALESCE(v.title, 'Standard') AS variant_title,
        COALESCE(v.sku, '') AS sku,
        COALESCE(v.barcode, '') AS barcode,
        COALESCE(v.cost_price, 0.00) AS cost_price,
        COALESCE(v.mrp, 0.00) AS mrp,
        COALESCE(v.selling_price, 0.00) AS selling_price,
        COALESCE(v.stock_quantity, 0) AS stock_quantity,
        COALESCE(v.min_stock_alert, 5) AS min_stock_alert
      FROM pos_products p
      LEFT JOIN pos_categories c ON c.id = p.category_id
      LEFT JOIN pos_brands b ON b.id = p.brand_id
      LEFT JOIN pos_product_variants v ON v.product_id = p.id AND v.is_active = 1
      WHERE ${whereClause}
      ORDER BY p.name ASC, v.id ASC
    `;

    const [rows] = await pool.query(sql, whereParams);

    if (format === 'json') {
      return res.json({
        success: true,
        count: rows.length,
        data: rows,
      });
    }

    // Standard CSV headers compatible with import format
    const headers = [
      'Product Name',
      'Category',
      'Brand',
      'Description',
      'Variant / Measure',
      'SKU',
      'Barcode',
      'Cost Price',
      'MRP',
      'Selling Price',
      'Available Stock',
      'Min Stock Alert',
      'Status',
    ];

    const csvLines = [headers.join(',')];

    for (const r of rows) {
      const line = [
        escapeCsvValue(r.product_name),
        escapeCsvValue(r.category_name),
        escapeCsvValue(r.brand_name),
        escapeCsvValue(r.description),
        escapeCsvValue(r.variant_title),
        escapeCsvValue(r.sku),
        escapeCsvValue(r.barcode),
        Number(r.cost_price).toFixed(2),
        Number(r.mrp).toFixed(2),
        Number(r.selling_price).toFixed(2),
        Number(r.stock_quantity),
        Number(r.min_stock_alert),
        r.product_status === 'draft' ? 'Draft' : 'Active',
      ];
      csvLines.push(line.join(','));
    }

    const csvOutput = csvLines.join('\r\n');
    const dateStr = new Date().toISOString().split('T')[0];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pos-products-export-${dateStr}.csv"`);
    res.setHeader('x-total-count', rows.length);
    return res.status(200).send(csvOutput);
  } catch (error) {
    console.error('Error exporting POS products:', error);
    res.status(500).json({ success: false, error: 'Failed to export products' });
  }
};

/**
 * POST /api/pos/products/import
 * Bulk import products with variants from CSV file or payload
 */
exports.importProducts = async (req, res) => {
  const userId = req.user.id;

  let rawCsvText = '';
  let preParsedRows = null;

  if (req.file && req.file.buffer) {
    rawCsvText = req.file.buffer.toString('utf-8');
  } else if (req.body && typeof req.body.csvText === 'string') {
    rawCsvText = req.body.csvText;
  } else if (req.body && Array.isArray(req.body.rows)) {
    preParsedRows = req.body.rows;
  }

  if (!rawCsvText && (!preParsedRows || preParsedRows.length === 0)) {
    return res.status(400).json({
      success: false,
      error: 'No CSV file or data received. Please provide a file or rows payload.',
    });
  }

  const connection = await pool.getConnection();

  try {
    let rowsToProcess = [];

    if (preParsedRows) {
      rowsToProcess = preParsedRows;
    } else {
      const parsedTable = parseCsvText(rawCsvText);
      if (parsedTable.length < 2) {
        return res.status(400).json({
          success: false,
          error: 'CSV file is empty or missing headers.',
        });
      }

      const headerRow = parsedTable[0];
      const normalizedHeaders = headerRow.map((h) =>
        h.toLowerCase().replace(/[^a-z0-9]/g, '')
      );

      // Helper to find header index by aliases
      const findHeaderIdx = (aliases) => {
        return normalizedHeaders.findIndex((h) => aliases.includes(h));
      };

      const nameIdx = findHeaderIdx(['productname', 'name', 'product', 'title']);
      const categoryIdx = findHeaderIdx(['category', 'categoryname']);
      const brandIdx = findHeaderIdx(['brand', 'brandname']);
      const descIdx = findHeaderIdx(['description', 'desc', 'details']);
      const variantIdx = findHeaderIdx([
        'variantmeasure',
        'variant',
        'measure',
        'variantname',
        'size',
        'attributes',
      ]);
      const skuIdx = findHeaderIdx(['sku', 'code']);
      const barcodeIdx = findHeaderIdx(['barcode', 'upc', 'ean']);
      const costIdx = findHeaderIdx(['costprice', 'cost', 'unitcost', 'purchaseprice']);
      const mrpIdx = findHeaderIdx(['mrp', 'retailprice', 'listprice']);
      const priceIdx = findHeaderIdx(['sellingprice', 'price', 'rate', 'unitprice']);
      const stockIdx = findHeaderIdx(['availablestock', 'stockquantity', 'stock', 'qty', 'quantity']);
      const alertIdx = findHeaderIdx(['minstockalert', 'minalert', 'alert', 'reorderlevel']);
      const statusIdx = findHeaderIdx(['status', 'state']);

      if (nameIdx === -1) {
        return res.status(400).json({
          success: false,
          error: 'Required header "Product Name" (or "Name") is missing in the CSV file.',
        });
      }

      for (let i = 1; i < parsedTable.length; i++) {
        const row = parsedTable[i];
        if (!row || row.length === 0) continue;

        const productName = (row[nameIdx] || '').trim();
        if (!productName) continue; // Skip rows without product name

        const category = categoryIdx !== -1 ? (row[categoryIdx] || '').trim() : '';
        const brand = brandIdx !== -1 ? (row[brandIdx] || '').trim() : '';
        const description = descIdx !== -1 ? (row[descIdx] || '').trim() : '';
        const variantTitle = variantIdx !== -1 ? (row[variantIdx] || '').trim() : 'Standard';
        const sku = skuIdx !== -1 ? (row[skuIdx] || '').trim() : '';
        const barcode = barcodeIdx !== -1 ? (row[barcodeIdx] || '').trim() : '';
        const costPrice = costIdx !== -1 ? parseFloat(row[costIdx]) || 0 : 0;
        const mrp = mrpIdx !== -1 ? parseFloat(row[mrpIdx]) || 0 : 0;
        const sellingPrice = priceIdx !== -1 ? parseFloat(row[priceIdx]) || (mrp > 0 ? mrp : 10) : 10;
        const stock = stockIdx !== -1 ? parseFloat(row[stockIdx]) || 0 : 0;
        const minAlert = alertIdx !== -1 ? parseFloat(row[alertIdx]) || 5 : 5;
        const status = statusIdx !== -1 && row[statusIdx]?.toLowerCase() === 'draft' ? 'draft' : 'active';

        rowsToProcess.push({
          productName,
          category: category || 'General',
          brand: brand || 'Generic',
          description,
          variantTitle: variantTitle || 'Standard',
          sku,
          barcode,
          costPrice,
          mrp: mrp > 0 ? mrp : sellingPrice,
          sellingPrice,
          stock,
          minAlert,
          status,
        });
      }
    }

    if (rowsToProcess.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid data rows found in the CSV to import.',
      });
    }

    await connection.beginTransaction();

    // 1. Preload user categories & brands into quick lookup maps
    const [existingCategories] = await connection.query(
      'SELECT id, name FROM pos_categories WHERE user_id = ?',
      [userId]
    );
    const categoryMap = new Map();
    for (const c of existingCategories) {
      categoryMap.set(c.name.toLowerCase().trim(), c.id);
    }

    const [existingBrands] = await connection.query(
      'SELECT id, name FROM pos_brands WHERE user_id = ?',
      [userId]
    );
    const brandMap = new Map();
    for (const b of existingBrands) {
      brandMap.set(b.name.toLowerCase().trim(), b.id);
    }

    // 2. Preload existing products
    const [existingProducts] = await connection.query(
      "SELECT id, name FROM pos_products WHERE user_id = ? AND status != 'archived'",
      [userId]
    );
    const productMap = new Map();
    for (const p of existingProducts) {
      productMap.set(p.name.toLowerCase().trim(), p.id);
    }

    // 3. Preload existing variants by SKU
    const [existingVariants] = await connection.query(
      'SELECT id, product_id, sku FROM pos_product_variants WHERE user_id = ?',
      [userId]
    );
    const variantSkuMap = new Map();
    for (const v of existingVariants) {
      variantSkuMap.set(v.sku.toLowerCase().trim(), v.id);
    }

    const summary = {
      totalRowsProcessed: rowsToProcess.length,
      productsCreated: 0,
      productsUpdated: 0,
      variantsCreated: 0,
      variantsUpdated: 0,
      categoriesCreated: 0,
      brandsCreated: 0,
    };

    // 4. Group rows by Product Name
    const productGroups = new Map();
    for (const item of rowsToProcess) {
      const key = item.productName.toLowerCase().trim();
      if (!productGroups.has(key)) {
        productGroups.set(key, []);
      }
      productGroups.get(key).push(item);
    }

    // 5. Process each product and its variants
    for (const [normProdName, variantItems] of productGroups.entries()) {
      const firstItem = variantItems[0];

      // Resolve Category
      const normCat = firstItem.category.toLowerCase().trim();
      let categoryId = categoryMap.get(normCat);
      if (!categoryId && firstItem.category) {
        const slug = slugify(firstItem.category);
        const [catInsert] = await connection.query(
          'INSERT INTO pos_categories (user_id, name, slug, is_active) VALUES (?, ?, ?, 1)',
          [userId, firstItem.category, slug]
        );
        categoryId = catInsert.insertId;
        categoryMap.set(normCat, categoryId);
        summary.categoriesCreated++;
      }

      // Resolve Brand
      const normBrand = firstItem.brand.toLowerCase().trim();
      let brandId = brandMap.get(normBrand);
      if (!brandId && firstItem.brand) {
        const [brandInsert] = await connection.query(
          'INSERT INTO pos_brands (user_id, name, is_active) VALUES (?, ?, 1)',
          [userId, firstItem.brand]
        );
        brandId = brandInsert.insertId;
        brandMap.set(normBrand, brandId);
        summary.brandsCreated++;
      }

      // Resolve Product Master
      let productId = productMap.get(normProdName);
      if (productId) {
        // Update product metadata
        await connection.query(
          `UPDATE pos_products 
           SET category_id = COALESCE(?, category_id),
               brand_id = COALESCE(?, brand_id),
               description = COALESCE(NULLIF(?, ''), description),
               status = ?
           WHERE id = ? AND user_id = ?`,
          [
            categoryId || null,
            brandId || null,
            firstItem.description,
            firstItem.status,
            productId,
            userId,
          ]
        );
        summary.productsUpdated++;
      } else {
        // Insert new product
        const [prodInsert] = await connection.query(
          `INSERT INTO pos_products (
            user_id, name, category_id, brand_id, description,
            base_unit, is_taxable, status
          ) VALUES (?, ?, ?, ?, ?, 'pcs', 1, ?)`,
          [
            userId,
            firstItem.productName,
            categoryId || null,
            brandId || null,
            firstItem.description || null,
            firstItem.status,
          ]
        );
        productId = prodInsert.insertId;
        productMap.set(normProdName, productId);
        summary.productsCreated++;
      }

      // Process Variants
      for (let vIdx = 0; vIdx < variantItems.length; vIdx++) {
        const v = variantItems[vIdx];
        const finalSku = v.sku || generateSku(v.productName, vIdx + 1);
        const normSku = finalSku.toLowerCase().trim();
        const existingVariantId = variantSkuMap.get(normSku);

        const attributesJson = JSON.stringify({
          Measure: v.variantTitle,
        });

        if (existingVariantId) {
          // Update existing variant
          await connection.query(
            `UPDATE pos_product_variants
             SET title = ?,
                 cost_price = ?,
                 mrp = ?,
                 selling_price = ?,
                 stock_quantity = ?,
                 min_stock_alert = ?,
                 barcode = COALESCE(NULLIF(?, ''), barcode),
                 attributes = ?
             WHERE id = ? AND user_id = ?`,
            [
              v.variantTitle,
              v.costPrice,
              v.mrp,
              v.sellingPrice,
              v.stock,
              v.minAlert,
              v.barcode || null,
              attributesJson,
              existingVariantId,
              userId,
            ]
          );
          summary.variantsUpdated++;
        } else {
          // Insert new variant
          const [vInsert] = await connection.query(
            `INSERT INTO pos_product_variants (
              user_id, product_id, sku, barcode, title, attributes,
              cost_price, mrp, selling_price, stock_quantity, min_stock_alert, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
              userId,
              productId,
              finalSku,
              v.barcode || null,
              v.variantTitle,
              attributesJson,
              v.costPrice,
              v.mrp,
              v.sellingPrice,
              v.stock,
              v.minAlert,
            ]
          );
          variantSkuMap.set(normSku, vInsert.insertId);
          summary.variantsCreated++;
        }
      }
    }

    await connection.commit();

    return res.json({
      success: true,
      message: `Bulk import completed: ${summary.productsCreated + summary.productsUpdated} products, ${summary.variantsCreated + summary.variantsUpdated} variants.`,
      data: summary,
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error in bulk import POS products:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to import products',
    });
  } finally {
    connection.release();
  }
};

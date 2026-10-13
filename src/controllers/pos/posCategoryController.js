const { pool } = require('../../config/db');
const { createCategorySchema, updateCategorySchema } = require('../../validations/pos/posCategoryValidation');

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
}

/**
 * GET /api/pos/categories
 * List all categories for the authenticated store owner
 */
exports.getCategories = async (req, res) => {
  const userId = req.user.id;
  const { search, is_active } = req.query;

  try {
    let query = `
      SELECT 
        c.id,
        c.name,
        c.slug,
        c.icon,
        c.is_active,
        c.created_at,
        c.updated_at,
        COUNT(p.id) AS product_count
      FROM pos_categories c
      LEFT JOIN pos_products p ON p.category_id = c.id AND p.status != 'archived'
      WHERE c.user_id = ?
    `;
    const params = [userId];

    if (search && search.trim()) {
      query += ` AND c.name LIKE ?`;
      params.push(`%${search.trim()}%`);
    }

    if (is_active !== undefined) {
      query += ` AND c.is_active = ?`;
      params.push(is_active === 'true' || is_active === '1' ? 1 : 0);
    }

    query += ` GROUP BY c.id ORDER BY c.name ASC`;

    const [rows] = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching POS categories:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch POS categories' });
  }
};

/**
 * POST /api/pos/categories
 * Create a new POS category
 */
exports.createCategory = async (req, res) => {
  const userId = req.user.id;

  try {
    const validated = createCategorySchema.parse(req.body);
    const slug = validated.slug || slugify(validated.name);
    const icon = validated.icon || 'Folder';
    const isActive = validated.is_active !== undefined ? (validated.is_active ? 1 : 0) : 1;

    const [result] = await pool.query(
      `INSERT INTO pos_categories (user_id, name, slug, icon, is_active)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, validated.name, slug, icon, isActive]
    );

    const [newRow] = await pool.query(
      `SELECT id, name, slug, icon, is_active, created_at, updated_at, 0 AS product_count
       FROM pos_categories WHERE id = ? AND user_id = ?`,
      [result.insertId, userId]
    );

    res.status(201).json({ success: true, data: newRow[0] });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: error.issues?.[0]?.message || 'Validation failed' });
    }
    console.error('Error creating POS category:', error);
    res.status(500).json({ success: false, error: 'Failed to create POS category' });
  }
};

/**
 * PUT /api/pos/categories/:id
 * Update an existing POS category
 */
exports.updateCategory = async (req, res) => {
  const userId = req.user.id;
  const categoryId = parseInt(req.params.id, 10);

  if (isNaN(categoryId)) {
    return res.status(400).json({ success: false, error: 'Invalid category ID' });
  }

  try {
    const validated = updateCategorySchema.parse(req.body);

    const [existing] = await pool.query(
      'SELECT id, name, slug, icon, is_active FROM pos_categories WHERE id = ? AND user_id = ?',
      [categoryId, userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }

    const current = existing[0];
    const name = validated.name !== undefined ? validated.name : current.name;
    const slug = validated.slug !== undefined ? validated.slug : (validated.name ? slugify(validated.name) : current.slug);
    const icon = validated.icon !== undefined ? validated.icon : current.icon;
    const isActive = validated.is_active !== undefined ? (validated.is_active ? 1 : 0) : current.is_active;

    await pool.query(
      `UPDATE pos_categories
       SET name = ?, slug = ?, icon = ?, is_active = ?
       WHERE id = ? AND user_id = ?`,
      [name, slug, icon, isActive, categoryId, userId]
    );

    const [updatedRow] = await pool.query(
      `SELECT c.id, c.name, c.slug, c.icon, c.is_active, c.created_at, c.updated_at, COUNT(p.id) AS product_count
       FROM pos_categories c
       LEFT JOIN pos_products p ON p.category_id = c.id AND p.status != 'archived'
       WHERE c.id = ? AND c.user_id = ?
       GROUP BY c.id`,
      [categoryId, userId]
    );

    res.json({ success: true, data: updatedRow[0] });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: error.issues?.[0]?.message || 'Validation failed' });
    }
    console.error('Error updating POS category:', error);
    res.status(500).json({ success: false, error: 'Failed to update POS category' });
  }
};

/**
 * DELETE /api/pos/categories/:id
 * Delete a category (sets category_id to NULL on products via FK constraint)
 */
exports.deleteCategory = async (req, res) => {
  const userId = req.user.id;
  const categoryId = parseInt(req.params.id, 10);

  if (isNaN(categoryId)) {
    return res.status(400).json({ success: false, error: 'Invalid category ID' });
  }

  try {
    const [result] = await pool.query(
      'DELETE FROM pos_categories WHERE id = ? AND user_id = ?',
      [categoryId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }

    res.json({ success: true, message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting POS category:', error);
    res.status(500).json({ success: false, error: 'Failed to delete POS category' });
  }
};

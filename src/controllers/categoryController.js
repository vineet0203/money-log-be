const { pool } = require('../config/db');

exports.getCategories = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        c.*, 
        COALESCE(SUM(t.amount), 0) AS spent_this_month
      FROM categories c
      LEFT JOIN transactions t 
        ON c.id = t.category_id 
        AND t.type = 'expense'
        AND t.date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
        AND t.date < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)
      WHERE c.user_id = ?
      GROUP BY c.id
      ORDER BY c.created_at ASC
    `, [req.user.id]);
    
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
};

exports.addCategory = async (req, res) => {
  const { name, icon_name, color, budget_limit } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO categories (user_id, name, icon_name, color, budget_limit) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, name, icon_name || null, color || null, budget_limit || null]
    );

    res.status(201).json({ id: result.insertId, message: 'Category added successfully' });
  } catch (error) {
    console.error('Error adding category:', error);
    res.status(500).json({ error: 'Failed to add category' });
  }
};

exports.updateCategory = async (req, res) => {
  const categoryId = req.params.id;
  const { name, icon_name, color, budget_limit } = req.body;

  try {
    // Check if category exists and belongs to user
    const [category] = await pool.query('SELECT id FROM categories WHERE id = ? AND user_id = ?', [categoryId, req.user.id]);
    
    if (category.length === 0) {
      return res.status(404).json({ error: 'Category not found or unauthorized' });
    }

    await pool.query(
      'UPDATE categories SET name = ?, icon_name = ?, color = ?, budget_limit = ? WHERE id = ?',
      [name, icon_name || null, color || null, budget_limit || null, categoryId]
    );

    res.status(200).json({ message: 'Category updated successfully' });
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
};

exports.deleteCategory = async (req, res) => {
  const categoryId = req.params.id;

  try {
    const [result] = await pool.query('DELETE FROM categories WHERE id = ? AND user_id = ?', [categoryId, req.user.id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Category not found or unauthorized' });
    }

    res.status(200).json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
};

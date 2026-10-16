const { pool } = require('../../config/db');

exports.getBrands = async (req, res) => {
  const userId = req.user.id;
  try {
    const [rows] = await pool.query(
      `SELECT b.id, b.name, b.logo_url, b.is_active, COUNT(p.id) AS product_count
       FROM pos_brands b
       LEFT JOIN pos_products p ON p.brand_id = b.id AND p.status != 'archived'
       WHERE b.user_id = ?
       GROUP BY b.id
       ORDER BY b.name ASC`,
      [userId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching POS brands:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch brands' });
  }
};

exports.createBrand = async (req, res) => {
  const userId = req.user.id;
  const { name, logo_url } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Brand name is required' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO pos_brands (user_id, name, logo_url) VALUES (?, ?, ?)',
      [userId, name.trim(), logo_url || null]
    );

    const [newRow] = await pool.query('SELECT * FROM pos_brands WHERE id = ? AND user_id = ?', [result.insertId, userId]);
    res.status(201).json({ success: true, data: newRow[0] });
  } catch (error) {
    console.error('Error creating POS brand:', error);
    res.status(500).json({ success: false, error: 'Failed to create brand' });
  }
};

exports.deleteBrand = async (req, res) => {
  const userId = req.user.id;
  const id = parseInt(req.params.id, 10);

  try {
    const [result] = await pool.query('DELETE FROM pos_brands WHERE id = ? AND user_id = ?', [id, userId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Brand not found' });
    }
    res.json({ success: true, message: 'Brand deleted successfully' });
  } catch (error) {
    console.error('Error deleting brand:', error);
    res.status(500).json({ success: false, error: 'Failed to delete brand' });
  }
};

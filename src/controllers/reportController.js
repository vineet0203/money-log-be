const { pool } = require('../config/db');

exports.getMonthlyReport = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Default to current month if no params provided
    const now = new Date();
    const year = req.query.year || now.getFullYear();
    const month = req.query.month || (now.getMonth() + 1);

    // Format for SQL (e.g., '2026-06')
    const monthString = `${year}-${month.toString().padStart(2, '0')}`;

    // 1. Get Totals
    const [totalsRaw] = await pool.query(
      `SELECT type, SUM(amount) as total 
       FROM transactions 
       WHERE user_id = ? AND date LIKE ? 
       GROUP BY type`,
      [userId, `${monthString}%`]
    );

    let totalIncome = 0;
    let totalExpense = 0;

    totalsRaw.forEach(row => {
      if (row.type === 'income') totalIncome = parseFloat(row.total);
      if (row.type === 'expense') totalExpense = parseFloat(row.total);
    });

    // 2. Get Category Breakdown for Expenses
    const [categoryBreakdown] = await pool.query(
      `SELECT 
         COALESCE(c.id, 0) as category_id,
         COALESCE(c.name, 'Uncategorized') as category_name,
         COALESCE(c.color, '#94A3B8') as category_color,
         COALESCE(c.icon_name, 'help-circle') as icon_name,
         c.budget_limit,
         SUM(t.amount) as total_amount
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = ? AND t.type = 'expense' AND t.date LIKE ?
       GROUP BY c.id, c.name, c.color, c.icon_name, c.budget_limit
       ORDER BY total_amount DESC`,
      [userId, `${monthString}%`]
    );

    // 3. Get Category Breakdown for Income
    const [incomeCategoryBreakdown] = await pool.query(
      `SELECT 
         COALESCE(c.id, 0) as category_id,
         COALESCE(c.name, 'Uncategorized') as category_name,
         COALESCE(c.color, '#10B981') as category_color,
         COALESCE(c.icon_name, 'cash-outline') as icon_name,
         c.budget_limit,
         SUM(t.amount) as total_amount
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = ? AND t.type = 'income' AND t.date LIKE ?
       GROUP BY c.id, c.name, c.color, c.icon_name, c.budget_limit
       ORDER BY total_amount DESC`,
      [userId, `${monthString}%`]
    );

    res.status(200).json({
      month: monthString,
      totalIncome,
      totalExpense,
      categoryBreakdown: categoryBreakdown.map(c => ({
        ...c,
        total_amount: parseFloat(c.total_amount),
        budget_limit: c.budget_limit ? parseFloat(c.budget_limit) : null
      })),
      incomeCategoryBreakdown: incomeCategoryBreakdown.map(c => ({
        ...c,
        total_amount: parseFloat(c.total_amount),
        budget_limit: null // budgets generally don't apply to income, but keeping structure consistent
      }))
    });

  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
};

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

exports.getDashboardAnalytics = async (req, res) => {
  const toTitleCase = (str) => {
    if (!str) return 'Uncategorized';
    return str
      .toLowerCase()
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    // 1. Get Summary (Total Income, Total Expense, Total Balance)
    // Note: In Plaid, positive amounts are expenses, negative are income
    const [summaryRaw] = await pool.query(
      `SELECT 
         SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as total_income,
         SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total_expense
       FROM account_transactions 
       WHERE user_id = ? AND date >= ? AND date <= ?`,
      [userId, startDate, endDate]
    );

    const [balanceRaw] = await pool.query(
      `SELECT SUM(available_balance) as total_available, SUM(balance) as total_current 
       FROM accounts WHERE user_id = ?`,
      [userId]
    );

    const totalIncome = parseFloat(summaryRaw[0].total_income || 0);
    const totalExpense = parseFloat(summaryRaw[0].total_expense || 0);
    const totalBalance = parseFloat(balanceRaw[0].total_available || balanceRaw[0].total_current || 0);

    // 2. Get Daily Data grouped by date and primary_category
    const [dailyRaw] = await pool.query(
      `SELECT 
         date,
         COALESCE(primary_category, 'Uncategorized') as category,
         SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as income,
         SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as expense
       FROM account_transactions
       WHERE user_id = ? AND date >= ? AND date <= ?
       GROUP BY date, primary_category
       ORDER BY date ASC`,
      [userId, startDate, endDate]
    );

    // Format daily data for Recharts stacked bar chart
    // Output: [{ day: 'Mon', 'Food': 50, ... }]
    const dailyMap = {};
    dailyRaw.forEach(row => {
      // Format date to a short day name or short date, e.g., 'Aug 07'
      const d = new Date(row.date);
      // Since it's a date string like '2026-08-07', we can just take substring or format it
      // To avoid timezone shifts, parse manually or use substring
      const dateStr = row.date.substring(5, 10); // '08-07'
      
      if (!dailyMap[dateStr]) {
        dailyMap[dateStr] = { day: dateStr };
      }
      
      // If a category has both income and expense on the same day, they will just be tracked under the same name for recharts
      // Actually Recharts needs a flat object: { day: '08-07', 'Food': 50 }
      // To differentiate income/expense for the same category, we might need to rely on the fact that recharts can stack them if they are separate keys?
      // Wait, Recharts uses dataKey="Food" for the Bar. If we have one stackId="income" and one stackId="expense" but both use dataKey="Food", recharts will sum them if they are in the same bar. But wait, we specified different `<Bar dataKey="Food" stackId="expense" />` - wait, you can't have two Bars with the SAME dataKey but DIFFERENT stackIds. Recharts needs unique dataKeys per Bar.
      // E.g., dataKey="Food & Dining" for expense, and dataKey="Food & Dining (Income)" for income.
      // Let's adjust the backend to return two keys: `Category` for expense, and `Category (Income)` for income.
      
      const cat = toTitleCase(row.category);
      if (row.expense > 0) {
        dailyMap[dateStr][cat] = (dailyMap[dateStr][cat] || 0) + parseFloat(row.expense);
      }
      if (row.income > 0) {
        const incomeCat = cat === 'Salary' ? cat : `${cat} (Income)`;
        // if it's Salary, we mapped it as income in UI. Let's just append (Income) to anything that is income to make it easy for frontend to render.
        dailyMap[dateStr][incomeCat] = (dailyMap[dateStr][incomeCat] || 0) + parseFloat(row.income);
      }
    });

    const dailyData = Object.values(dailyMap);

    // 3. Get Category Data
    const [categoryRaw] = await pool.query(
      `SELECT 
         COALESCE(primary_category, 'Uncategorized') as name,
         SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as income,
         SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as expense
       FROM account_transactions
       WHERE user_id = ? AND date >= ? AND date <= ?
       GROUP BY primary_category
       ORDER BY (income + expense) DESC`,
      [userId, startDate, endDate]
    );

    const categoryData = categoryRaw.map(c => ({
      name: toTitleCase(c.name),
      income: parseFloat(c.income),
      expense: parseFloat(c.expense)
    }));

    res.status(200).json({
      summary: { balance: totalBalance, income: totalIncome, spend: totalExpense },
      dailyData,
      categoryData
    });

  } catch (error) {
    console.error('Error generating dashboard analytics:', error);
    res.status(500).json({ error: 'Failed to generate analytics' });
  }
};


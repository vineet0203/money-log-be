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

/**
 * Generic Time-Series API (§3.2)
 * GET /api/reports/series?metric=expense|income|net&from=&to=&granularity=day|week|month&category_id=
 * Returns { points: [{ period, label, amount }], total, previous_total, change_pct }
 */
exports.getSeriesReport = async (req, res) => {
  try {
    const userId = req.user.id;
    let { metric = 'expense', from, to, granularity, category_id } = req.query;

    if (!['expense', 'income', 'net'].includes(metric)) {
      metric = 'expense';
    }

    // Default to current month if from / to not supplied
    const now = new Date();
    if (!to) {
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }
    if (!from) {
      from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    const diffTime = Math.max(0, toDate.getTime() - fromDate.getTime());
    const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1);

    // Auto-select granularity if not specified
    if (!granularity) {
      if (diffDays > 90) granularity = 'month';
      else if (diffDays > 31) granularity = 'week';
      else granularity = 'day';
    }

    // Previous comparison period calculation
    const prevToDate = new Date(fromDate.getTime() - 24 * 60 * 60 * 1000);
    const prevFromDate = new Date(prevToDate.getTime() - (diffDays - 1) * 24 * 60 * 60 * 1000);
    const prevTo = prevToDate.toISOString().split('T')[0];
    const prevFrom = prevFromDate.toISOString().split('T')[0];

    // Determine MySQL metric aggregation expression
    let metricExpr = '';
    if (metric === 'expense') {
      metricExpr = "SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END)";
    } else if (metric === 'income') {
      metricExpr = "SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END)";
    } else {
      // net = income - expense
      metricExpr = "SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END)";
    }

    // Determine grouping period format
    let periodExpr = '';
    if (granularity === 'month') {
      periodExpr = "DATE_FORMAT(date, '%Y-%m')";
    } else if (granularity === 'week') {
      periodExpr = "DATE_FORMAT(DATE_SUB(date, INTERVAL WEEKDAY(date) DAY), '%Y-%m-%d')";
    } else {
      periodExpr = "DATE_FORMAT(date, '%Y-%m-%d')";
    }

    // 1. Fetch series points for current period
    let seriesQuery = `SELECT ${periodExpr} as period, ${metricExpr} as amount
                       FROM transactions
                       WHERE user_id = ? AND date >= ? AND date <= ?`;
    const seriesParams = [userId, from, to];

    if (category_id) {
      seriesQuery += ' AND category_id = ?';
      seriesParams.push(category_id);
    }

    seriesQuery += ` GROUP BY period ORDER BY period ASC`;
    const [rows] = await pool.query(seriesQuery, seriesParams);

    // Map rows by period
    const rowMap = {};
    rows.forEach(r => {
      rowMap[r.period] = parseFloat(r.amount || 0);
    });

    // Helper to format human label
    const formatLabel = (p) => {
      try {
        if (granularity === 'month') {
          const [y, m] = p.split('-');
          return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-US', { month: 'short' });
        }
        if (granularity === 'week') {
          const d = new Date(p);
          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        const [y, m, d] = p.split('-');
        return new Date(parseInt(y), parseInt(m) - 1, parseInt(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      } catch (e) {
        return p;
      }
    };

    // Fill continuous series if daily and span <= 62 days
    let points = [];
    if (granularity === 'day' && diffDays <= 62) {
      const cur = new Date(from);
      const end = new Date(to);
      while (cur <= end) {
        const p = cur.toISOString().split('T')[0];
        points.push({
          period: p,
          label: formatLabel(p),
          amount: rowMap[p] !== undefined ? rowMap[p] : 0,
        });
        cur.setDate(cur.getDate() + 1);
      }
    } else {
      points = rows.map(r => ({
        period: r.period,
        label: formatLabel(r.period),
        amount: parseFloat(r.amount || 0),
      }));
    }

    // 2. Fetch total for current period
    let totalQuery = `SELECT ${metricExpr} as total FROM transactions WHERE user_id = ? AND date >= ? AND date <= ?`;
    const totalParams = [userId, from, to];
    if (category_id) {
      totalQuery += ' AND category_id = ?';
      totalParams.push(category_id);
    }
    const [curTotalRows] = await pool.query(totalQuery, totalParams);
    const total = parseFloat(curTotalRows[0]?.total || 0);

    // 3. Fetch total for previous period
    let prevTotalQuery = `SELECT ${metricExpr} as prev_total FROM transactions WHERE user_id = ? AND date >= ? AND date <= ?`;
    const prevParams = [userId, prevFrom, prevTo];
    if (category_id) {
      prevTotalQuery += ' AND category_id = ?';
      prevParams.push(category_id);
    }
    const [prevTotalRows] = await pool.query(prevTotalQuery, prevParams);
    const previous_total = parseFloat(prevTotalRows[0]?.prev_total || 0);

    let change_pct = null;
    if (previous_total > 0) {
      change_pct = parseFloat((((total - previous_total) / previous_total) * 100).toFixed(2));
    } else if (previous_total === 0 && total > 0) {
      change_pct = 100.0;
    } else if (previous_total === 0 && total === 0) {
      change_pct = 0.0;
    }

    res.status(200).json({
      metric,
      from,
      to,
      granularity,
      total,
      previous_total,
      change_pct,
      points,
    });
  } catch (error) {
    console.error('Error in getSeriesReport:', error);
    res.status(500).json({ error: 'Failed to generate time-series report' });
  }
};



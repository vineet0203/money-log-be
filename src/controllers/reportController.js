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
    const [summaryRaw] = await pool.query(
      `SELECT 
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as total_income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expense
       FROM transactions 
       WHERE user_id = ? AND date >= ? AND date <= ?`,
      [userId, startDate, endDate]
    );

    const [balanceRaw] = await pool.query(
      `SELECT 
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) -
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_balance
       FROM transactions WHERE user_id = ?`,
      [userId]
    );

    const totalIncome = parseFloat(summaryRaw[0]?.total_income || 0);
    const totalExpense = parseFloat(summaryRaw[0]?.total_expense || 0);
    const totalBalance = parseFloat(balanceRaw[0]?.total_balance || 0);

    // 2. Get Daily Data grouped by date and category
    const [dailyRaw] = await pool.query(
      `SELECT 
         DATE_FORMAT(t.date, '%Y-%m-%d') as date,
         COALESCE(c.name, 'Uncategorized') as category,
         SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END) as income,
         SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) as expense
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = ? AND t.date >= ? AND t.date <= ?
       GROUP BY t.date, c.name
       ORDER BY t.date ASC`,
      [userId, startDate, endDate]
    );

    // Format daily data for Recharts stacked bar chart
    const dailyMap = {};
    dailyRaw.forEach(row => {
      const rawDateStr = String(row.date || '');
      const dateStr = rawDateStr.length >= 10 ? rawDateStr.substring(5, 10) : rawDateStr;
      
      if (!dailyMap[dateStr]) {
        dailyMap[dateStr] = { day: dateStr };
      }
      
      const cat = row.category;
      if (parseFloat(row.expense) > 0) {
        dailyMap[dateStr][cat] = (dailyMap[dateStr][cat] || 0) + parseFloat(row.expense);
      }
      if (parseFloat(row.income) > 0) {
        const incomeCat = cat === 'Salary' ? cat : `${cat} (Income)`;
        dailyMap[dateStr][incomeCat] = (dailyMap[dateStr][incomeCat] || 0) + parseFloat(row.income);
      }
    });

    const dailyData = Object.values(dailyMap);

    // 3. Get Category Data
    const [categoryRaw] = await pool.query(
      `SELECT 
         COALESCE(c.name, 'Uncategorized') as name,
         SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END) as income,
         SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) as expense
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = ? AND t.date >= ? AND t.date <= ?
       GROUP BY c.name
       ORDER BY (income + expense) DESC`,
      [userId, startDate, endDate]
    );

    const categoryData = categoryRaw.map(c => ({
      name: c.name,
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
 * Generic Time-Series API (§3.2 / §3A.1)
 * GET /api/reports/series?metric=expense|income|net|cumulative_net&from=&to=&granularity=day|week|month&category_id=
 * Returns { points: [{ period, label, amount }], total, previous_total, change_pct }
 */
exports.getSeriesReport = async (req, res) => {
  try {
    const userId = req.user.id;
    let { metric = 'expense', from, to, fromDate: qFromDate, toDate: qToDate, granularity, category_id } = req.query;
    from = from || qFromDate;
    to = to || qToDate;

    if (!['expense', 'income', 'net', 'cumulative_net'].includes(metric)) {
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
      // net or cumulative_net = income - expense
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

    // §3A.1 & §3A.5: cumulative_net is the running sum of income - expense across the window
    if (metric === 'cumulative_net') {
      let runningTotal = 0;
      points = points.map(p => {
        runningTotal += p.amount;
        return {
          ...p,
          amount: parseFloat(runningTotal.toFixed(2)),
        };
      });
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

/**
 * Generic Breakdown API (§3A.1)
 * GET /api/reports/breakdown?dimension=category|day_of_week|recurrence&from=&to=&type=&search=&category_id=
 * Returns { dimension, from, to, items: [{ key, label, color, current, previous, delta, share }] }
 */
exports.getBreakdownReport = async (req, res) => {
  try {
    const userId = req.user.id;
    let { dimension = 'category', from, to, fromDate: qFromDate, toDate: qToDate, type, category_id, search, has_receipt } = req.query;
    from = from || qFromDate;
    to = to || qToDate;

    // Default window to current month if not provided
    const now = new Date();
    if (!to) {
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }
    if (!from) {
      from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }

    const fromD = new Date(from);
    const toD = new Date(to);
    const diffTime = Math.max(0, toD.getTime() - fromD.getTime());
    const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1);

    const prevToD = new Date(fromD.getTime() - 24 * 60 * 60 * 1000);
    const prevFromD = new Date(prevToD.getTime() - (diffDays - 1) * 24 * 60 * 60 * 1000);
    const prevTo = prevToD.toISOString().split('T')[0];
    const prevFrom = prevFromD.toISOString().split('T')[0];

    const buildFilterClause = (winFrom, winTo, alias = 't') => {
      let clause = ` AND ${alias}.date >= ? AND ${alias}.date <= ?`;
      const params = [winFrom, winTo];
      if (type && type !== 'all') {
        clause += ` AND ${alias}.type = ?`;
        params.push(type);
      }
      if (category_id) {
        clause += ` AND ${alias}.category_id = ?`;
        params.push(category_id);
      }
      if (search) {
        clause += ` AND (${alias}.title LIKE ? OR ${alias}.description LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
      }
      if (has_receipt === 'true' || has_receipt === true) {
        clause += ` AND ${alias}.receipt_url IS NOT NULL AND ${alias}.receipt_url != ""`;
      }
      return { clause, params };
    };

    let items = [];

    if (dimension === 'day_of_week') {
      // Group by DAYOFWEEK(date) (1 = Sunday, 2 = Monday, ..., 7 = Saturday)
      const dayLabels = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayColors = ['', '#64748b', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6'];

      const curFilter = buildFilterClause(from, to);
      const [curRows] = await pool.query(
        `SELECT DAYOFWEEK(date) as dow, SUM(amount) as total
         FROM transactions t
         WHERE t.user_id = ? ${curFilter.clause}
         GROUP BY dow`,
        [userId, ...curFilter.params]
      );

      const prevFilter = buildFilterClause(prevFrom, prevTo);
      const [prevRows] = await pool.query(
        `SELECT DAYOFWEEK(date) as dow, SUM(amount) as total
         FROM transactions t
         WHERE t.user_id = ? ${prevFilter.clause}
         GROUP BY dow`,
        [userId, ...prevFilter.params]
      );

      const curMap = {};
      let totalAmount = 0;
      curRows.forEach(r => {
        const val = parseFloat(r.total || 0);
        curMap[r.dow] = val;
        totalAmount += val;
      });

      const prevMap = {};
      prevRows.forEach(r => {
        prevMap[r.dow] = parseFloat(r.total || 0);
      });

      for (let d = 1; d <= 7; d++) {
        const curVal = curMap[d] || 0;
        const prevVal = prevMap[d] !== undefined ? prevMap[d] : null;
        let delta = null;
        if (prevVal && prevVal > 0) {
          delta = parseFloat((((curVal - prevVal) / prevVal) * 100).toFixed(2));
        }
        const share = totalAmount > 0 ? parseFloat(((curVal / totalAmount) * 100).toFixed(1)) : 0;
        items.push({
          key: `dow_${d}`,
          label: dayLabels[d],
          color: dayColors[d],
          current: curVal,
          previous: prevVal,
          delta,
          share,
        });
      }
    } else if (dimension === 'recurrence') {
      // Recurring (subscription_id IS NOT NULL) vs One-off
      const curFilter = buildFilterClause(from, to);
      const [curRows] = await pool.query(
        `SELECT 
           CASE WHEN subscription_id IS NOT NULL THEN 'recurring' ELSE 'one_off' END as rec_type,
           SUM(amount) as total
         FROM transactions t
         WHERE t.user_id = ? ${curFilter.clause}
         GROUP BY rec_type`,
        [userId, ...curFilter.params]
      );

      const prevFilter = buildFilterClause(prevFrom, prevTo);
      const [prevRows] = await pool.query(
        `SELECT 
           CASE WHEN subscription_id IS NOT NULL THEN 'recurring' ELSE 'one_off' END as rec_type,
           SUM(amount) as total
         FROM transactions t
         WHERE t.user_id = ? ${prevFilter.clause}
         GROUP BY rec_type`,
        [userId, ...prevFilter.params]
      );

      const curMap = { recurring: 0, one_off: 0 };
      let totalAmount = 0;
      curRows.forEach(r => {
        const val = parseFloat(r.total || 0);
        curMap[r.rec_type] = val;
        totalAmount += val;
      });

      const prevMap = {};
      prevRows.forEach(r => {
        prevMap[r.rec_type] = parseFloat(r.total || 0);
      });

      const recTypes = [
        { key: 'recurring', label: 'Recurring Subscriptions', color: '#f59e0b' },
        { key: 'one_off', label: 'One-off Expenses', color: '#10b981' },
      ];

      items = recTypes.map(rt => {
        const curVal = curMap[rt.key] || 0;
        const prevVal = prevMap[rt.key] !== undefined ? prevMap[rt.key] : null;
        let delta = null;
        if (prevVal && prevVal > 0) {
          delta = parseFloat((((curVal - prevVal) / prevVal) * 100).toFixed(2));
        }
        const share = totalAmount > 0 ? parseFloat(((curVal / totalAmount) * 100).toFixed(1)) : 0;
        return {
          key: rt.key,
          label: rt.label,
          color: rt.color,
          current: curVal,
          previous: prevVal,
          delta,
          share,
        };
      });
    } else {
      // Default: category breakdown
      const curFilter = buildFilterClause(from, to);
      const [curRows] = await pool.query(
        `SELECT 
           COALESCE(c.id, 0) as category_id,
           COALESCE(c.name, 'Uncategorized') as category_name,
           COALESCE(c.color, '#94a3b8') as category_color,
           SUM(t.amount) as total
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.user_id = ? ${curFilter.clause}
         GROUP BY c.id, c.name, c.color
         ORDER BY total DESC`,
        [userId, ...curFilter.params]
      );

      const prevFilter = buildFilterClause(prevFrom, prevTo);
      const [prevRows] = await pool.query(
        `SELECT 
           COALESCE(c.id, 0) as category_id,
           SUM(t.amount) as total
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.user_id = ? ${prevFilter.clause}
         GROUP BY c.id`,
        [userId, ...prevFilter.params]
      );

      const prevMap = {};
      prevRows.forEach(r => {
        prevMap[r.category_id] = parseFloat(r.total || 0);
      });

      let totalAmount = 0;
      curRows.forEach(r => {
        totalAmount += parseFloat(r.total || 0);
      });

      items = curRows.map(r => {
        const curVal = parseFloat(r.total || 0);
        const prevVal = prevMap[r.category_id] !== undefined ? prevMap[r.category_id] : null;
        let delta = null;
        if (prevVal && prevVal > 0) {
          delta = parseFloat((((curVal - prevVal) / prevVal) * 100).toFixed(2));
        }
        const share = totalAmount > 0 ? parseFloat(((curVal / totalAmount) * 100).toFixed(1)) : 0;
        return {
          key: String(r.category_id),
          label: r.category_name,
          color: r.category_color,
          current: curVal,
          previous: prevVal,
          delta,
          share,
        };
      });
    }

    res.status(200).json({
      dimension,
      from,
      to,
      items,
    });
  } catch (error) {
    console.error('Error generating breakdown report:', error);
    res.status(500).json({ error: 'Failed to generate breakdown report' });
  }
};



const { pool } = require('../config/db');
const { buildPublicUrl } = require('../services/storageService');

exports.getOverview = async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Total Balance
    const [[balanceRows]] = await pool.query(
      `SELECT 
        SUM(CASE WHEN type = 'bank' THEN balance ELSE 0 END) as cash,
        SUM(CASE WHEN type = 'card' THEN balance ELSE 0 END) as creditDebt
       FROM accounts WHERE user_id = ?`,
      [userId]
    );

    const cash = parseFloat(balanceRows?.cash || 0);
    const creditDebt = parseFloat(balanceRows?.creditDebt || 0);
    const totalBalance = cash - creditDebt;

    // 2. Today, This Week, This Month Income & Expenses
    const [[statsRows]] = await pool.query(
      `SELECT 
        SUM(CASE WHEN type = 'income' AND date = CURDATE() THEN amount ELSE 0 END) as todayIncome,
        SUM(CASE WHEN type = 'income' AND YEARWEEK(date, 1) = YEARWEEK(CURDATE(), 1) THEN amount ELSE 0 END) as weekIncome,
        SUM(CASE WHEN type = 'income' AND MONTH(date) = MONTH(CURDATE()) AND YEAR(date) = YEAR(CURDATE()) THEN amount ELSE 0 END) as monthIncome,
        SUM(CASE WHEN type = 'income' AND YEAR(date) = YEAR(CURDATE()) THEN amount ELSE 0 END) as yearIncome,
        
        SUM(CASE WHEN type = 'expense' AND date = CURDATE() THEN amount ELSE 0 END) as todayExpense,
        SUM(CASE WHEN type = 'expense' AND YEARWEEK(date, 1) = YEARWEEK(CURDATE(), 1) THEN amount ELSE 0 END) as weekExpense,
        SUM(CASE WHEN type = 'expense' AND MONTH(date) = MONTH(CURDATE()) AND YEAR(date) = YEAR(CURDATE()) THEN amount ELSE 0 END) as monthExpense,
        SUM(CASE WHEN type = 'expense' AND YEAR(date) = YEAR(CURDATE()) THEN amount ELSE 0 END) as yearExpense
       FROM transactions WHERE user_id = ?`,
      [userId]
    );

    const todayIncome = parseFloat(statsRows?.todayIncome || 0);
    const weekIncome = parseFloat(statsRows?.weekIncome || 0);
    const monthIncome = parseFloat(statsRows?.monthIncome || 0);
    const yearIncome = parseFloat(statsRows?.yearIncome || 0);

    const todayExpense = parseFloat(statsRows?.todayExpense || 0);
    const weekExpense = parseFloat(statsRows?.weekExpense || 0);
    const monthExpense = parseFloat(statsRows?.monthExpense || 0);
    const yearExpense = parseFloat(statsRows?.yearExpense || 0);

    // 3. Charts: Income Vs Expenses (Last 6 Months)
    const [chartRows] = await pool.query(
      `SELECT 
        DATE_FORMAT(date, '%b') as month,
        MONTH(date) as month_num,
        SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expenses
       FROM transactions 
       WHERE user_id = ? AND date >= DATE_SUB(LAST_DAY(CURDATE()), INTERVAL 6 MONTH)
       GROUP BY month, month_num
       ORDER BY YEAR(MAX(date)) ASC, month_num ASC`,
      [userId]
    );

    // 4. Charts: Spending By Category (Current Month)
    const [categoryRows] = await pool.query(
      `SELECT 
        c.name as name, 
        SUM(t.amount) as value, 
        c.color 
       FROM transactions t
       JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = ? AND t.type = 'expense' AND MONTH(t.date) = MONTH(CURDATE()) AND YEAR(t.date) = YEAR(CURDATE())
       GROUP BY c.id, c.name, c.color
       ORDER BY value DESC
       LIMIT 6`,
      [userId]
    );

    // 5. Recent Transactions
    const [recentTransactions] = await pool.query(
      `SELECT t.*, c.name as category_name 
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = ?
       ORDER BY t.date DESC, t.id DESC 
       LIMIT 5`,
      [userId]
    );

    // 6. Upcoming Subscriptions (Next 7 Days)
    const [upcomingSubs] = await pool.query(
      `SELECT * FROM subscriptions 
       WHERE user_id = ? AND status = 'active' AND next_billing_date >= CURDATE() AND next_billing_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
       ORDER BY next_billing_date ASC`,
      [userId]
    );

    
    // 7. Budgets (Categories with spending or limit)
    const [budgetRows] = await pool.query(
      `SELECT 
        c.name as category, 
        c.color,
        COALESCE(c.budget_limit, 0) as total,
        COALESCE(SUM(t.amount), 0) as spent
       FROM categories c
       LEFT JOIN transactions t ON c.id = t.category_id 
          AND t.type = 'expense' 
          AND MONTH(t.date) = MONTH(CURDATE()) 
          AND YEAR(t.date) = YEAR(CURDATE())
          AND t.user_id = ?
       WHERE c.user_id = ? OR (t.id IS NOT NULL)
       GROUP BY c.id, c.name, c.color, c.budget_limit
       HAVING spent > 0 OR total > 0
       ORDER BY spent DESC
       LIMIT 6`,
      [userId, userId]
    );

    // Build the final response payload
    const response = {
      totalBalance: {
        total: totalBalance,
        cash: cash,
        creditDebt: creditDebt
      },
      todayIncome: {
        today: todayIncome,
        thisWeek: weekIncome,
        thisMonth: monthIncome
      },
      todayExpenses: {
        today: todayExpense,
        thisWeek: weekExpense,
        thisMonth: monthExpense
      },
      netProfit: {
        daily: todayIncome - todayExpense,
        monthly: monthIncome - monthExpense,
        yearly: yearIncome - yearExpense
      },
      charts: {
        incomeVsExpenses: chartRows.map(r => ({ month: r.month, income: parseFloat(r.income), expenses: parseFloat(r.expenses) })),
        spendingByCategory: categoryRows.map(r => ({ name: r.name, value: parseFloat(r.value), color: r.color || '#3B82F6' }))
      },
      recentTransactions: recentTransactions.map(tx => ({
        ...tx,
        receipt_url: buildPublicUrl(req, tx.receipt_url)
      })),
      budgets: budgetRows.map(r => ({ category: r.category, spent: parseFloat(r.spent), total: parseFloat(r.total), color: r.color || '#3B82F6' })),
      upcomingSubscriptions: {
        count: upcomingSubs.length,
        items: upcomingSubs
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching dashboard overview:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
};

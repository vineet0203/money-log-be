const { pool } = require('../config/db');
const { buildPublicUrl } = require('../services/storageService');

exports.getOverview = async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Total Balance (retained for backward compatibility / account ledgers)
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

    // 2. Today, This Week, This Month, Previous Month & Year Stats
    const [[statsRows]] = await pool.query(
      `SELECT 
        SUM(CASE WHEN type = 'income' AND date = CURDATE() THEN amount ELSE 0 END) as todayIncome,
        SUM(CASE WHEN type = 'income' AND YEARWEEK(date, 1) = YEARWEEK(CURDATE(), 1) THEN amount ELSE 0 END) as weekIncome,
        SUM(CASE WHEN type = 'income' AND MONTH(date) = MONTH(CURDATE()) AND YEAR(date) = YEAR(CURDATE()) THEN amount ELSE 0 END) as monthIncome,
        SUM(CASE WHEN type = 'income' AND MONTH(date) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) AND YEAR(date) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) THEN amount ELSE 0 END) as prevMonthIncome,
        SUM(CASE WHEN type = 'income' AND YEAR(date) = YEAR(CURDATE()) THEN amount ELSE 0 END) as yearIncome,
        
        SUM(CASE WHEN type = 'expense' AND date = CURDATE() THEN amount ELSE 0 END) as todayExpense,
        SUM(CASE WHEN type = 'expense' AND YEARWEEK(date, 1) = YEARWEEK(CURDATE(), 1) THEN amount ELSE 0 END) as weekExpense,
        SUM(CASE WHEN type = 'expense' AND MONTH(date) = MONTH(CURDATE()) AND YEAR(date) = YEAR(CURDATE()) THEN amount ELSE 0 END) as monthExpense,
        SUM(CASE WHEN type = 'expense' AND MONTH(date) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) AND YEAR(date) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) THEN amount ELSE 0 END) as prevMonthExpense,
        SUM(CASE WHEN type = 'expense' AND YEAR(date) = YEAR(CURDATE()) THEN amount ELSE 0 END) as yearExpense,

        COUNT(CASE WHEN category_id IS NULL THEN 1 END) as uncategorisedCount,
        COUNT(CASE WHEN type = 'expense' THEN 1 END) as totalExpenseCount,
        COUNT(CASE WHEN type = 'expense' AND (receipt_url IS NOT NULL AND receipt_url != '') THEN 1 END) as receiptCount
       FROM transactions WHERE user_id = ?`,
      [userId]
    );

    const todayIncome = parseFloat(statsRows?.todayIncome || 0);
    const weekIncome = parseFloat(statsRows?.weekIncome || 0);
    const monthIncome = parseFloat(statsRows?.monthIncome || 0);
    const prevMonthIncome = parseFloat(statsRows?.prevMonthIncome || 0);
    const yearIncome = parseFloat(statsRows?.yearIncome || 0);

    const todayExpense = parseFloat(statsRows?.todayExpense || 0);
    const weekExpense = parseFloat(statsRows?.weekExpense || 0);
    const monthExpense = parseFloat(statsRows?.monthExpense || 0);
    const prevMonthExpense = parseFloat(statsRows?.prevMonthExpense || 0);
    const yearExpense = parseFloat(statsRows?.yearExpense || 0);

    const uncategorisedCount = parseInt(statsRows?.uncategorisedCount || 0, 10);
    const totalExpenseCount = parseInt(statsRows?.totalExpenseCount || 0, 10);
    const receiptCount = parseInt(statsRows?.receiptCount || 0, 10);

    // Month-on-Month deltas (null when previous is 0 or absent per §3A.2)
    const incomeDelta = prevMonthIncome > 0 
      ? Number((((monthIncome - prevMonthIncome) / prevMonthIncome) * 100).toFixed(1)) 
      : null;

    const expenseDelta = prevMonthExpense > 0 
      ? Number((((monthExpense - prevMonthExpense) / prevMonthExpense) * 100).toFixed(1)) 
      : null;

    const monthNet = monthIncome - monthExpense;
    const prevMonthNet = prevMonthIncome - prevMonthExpense;
    const netDelta = prevMonthNet !== 0 
      ? Number((((monthNet - prevMonthNet) / Math.abs(prevMonthNet)) * 100).toFixed(1)) 
      : null;

    // Savings Rate: (income - expense) / income (null when income is 0 per §3A.2)
    const savingsRate = monthIncome > 0 
      ? Number((((monthIncome - monthExpense) / monthIncome) * 100).toFixed(1)) 
      : null;

    const prevSavingsRate = prevMonthIncome > 0 
      ? Number((((prevMonthIncome - prevMonthExpense) / prevMonthIncome) * 100).toFixed(1)) 
      : null;

    const savingsRateDelta = (savingsRate !== null && prevSavingsRate !== null)
      ? Number((savingsRate - prevSavingsRate).toFixed(1))
      : null;

    // Projection: average daily spend and projected month-end spend
    const now = new Date();
    const daysElapsed = Math.max(1, now.getDate());
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const averageDailySpend = Number((monthExpense / daysElapsed).toFixed(2));
    const projectedMonthEndSpend = Number((averageDailySpend * daysInMonth).toFixed(2));

    // Data Quality: receipt coverage percentage
    const receiptCoverage = totalExpenseCount > 0 
      ? Number(((receiptCount / totalExpenseCount) * 100).toFixed(1)) 
      : null;

    // 3. Commitments: active subscriptions & upcoming billing
    const [subRows] = await pool.query(
      `SELECT amount, frequency, interval_count, next_billing_date, type 
       FROM subscriptions 
       WHERE user_id = ? AND status = 'active' AND type = 'expense'`,
      [userId]
    );

    let monthlyCommittedOutflow = 0;
    subRows.forEach((sub) => {
      let baseAmount = parseFloat(sub.amount || 0);
      const interval = Math.max(1, parseInt(sub.interval_count || 1, 10));
      switch (sub.frequency) {
        case 'daily':
          monthlyCommittedOutflow += (baseAmount / interval) * 30;
          break;
        case 'weekly':
          monthlyCommittedOutflow += (baseAmount / interval) * 4.333;
          break;
        case 'biweekly':
          monthlyCommittedOutflow += (baseAmount / interval) * 2.167;
          break;
        case 'monthly':
          monthlyCommittedOutflow += baseAmount / interval;
          break;
        case 'quarterly':
          monthlyCommittedOutflow += (baseAmount / interval) / 3;
          break;
        case 'half_yearly':
          monthlyCommittedOutflow += (baseAmount / interval) / 6;
          break;
        case 'yearly':
          monthlyCommittedOutflow += (baseAmount / interval) / 12;
          break;
        default:
          monthlyCommittedOutflow += baseAmount / interval;
      }
    });

    const committedPercentOfIncome = monthIncome > 0 
      ? Number(((monthlyCommittedOutflow / monthIncome) * 100).toFixed(1)) 
      : null;

    // Upcoming dues count and sum in 7 days and 30 days
    const [[dueRows]] = await pool.query(
      `SELECT 
        COUNT(CASE WHEN next_billing_date >= CURDATE() AND next_billing_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 1 END) as count7,
        COALESCE(SUM(CASE WHEN next_billing_date >= CURDATE() AND next_billing_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN amount ELSE 0 END), 0) as amount7,
        COUNT(CASE WHEN next_billing_date >= CURDATE() AND next_billing_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 1 END) as count30,
        COALESCE(SUM(CASE WHEN next_billing_date >= CURDATE() AND next_billing_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN amount ELSE 0 END), 0) as amount30
       FROM subscriptions 
       WHERE user_id = ? AND status = 'active' AND type = 'expense'`,
      [userId]
    );

    // 4. Charts: Income Vs Expenses (Last 6 Months)
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

    // 5. Charts: Spending By Category (Current Month)
    const [categoryRows] = await pool.query(
      `SELECT 
        COALESCE(c.name, 'Uncategorized') as name, 
        SUM(t.amount) as value, 
        COALESCE(c.color, '#94A3B8') as color 
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = ? AND t.type = 'expense' AND MONTH(t.date) = MONTH(CURDATE()) AND YEAR(t.date) = YEAR(CURDATE())
       GROUP BY c.id, c.name, c.color
       ORDER BY value DESC`,
      [userId]
    );

    // 6. Recent Transactions
    const [recentTransactions] = await pool.query(
      `SELECT t.*, c.name as category_name, c.color as category_color 
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = ?
       ORDER BY t.date DESC, t.id DESC 
       LIMIT 5`,
      [userId]
    );

    // 7. Upcoming Subscriptions (Next 7 Days with detail items)
    const [upcomingSubs] = await pool.query(
      `SELECT s.* FROM subscriptions s
       WHERE s.user_id = ? 
         AND s.status = 'active' 
         AND s.next_billing_date >= CURDATE() 
         AND s.next_billing_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
         AND NOT EXISTS (
           SELECT 1 FROM recurring_occurrences ro 
           WHERE ro.recurring_id = s.id 
             AND ro.due_date = s.next_billing_date 
             AND ro.status IN ('skipped', 'paid')
         )
       ORDER BY s.next_billing_date ASC`,
      [userId]
    );

    // 8. Budgets & Budget Health roll-up
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
       ORDER BY spent DESC, total DESC, c.name ASC`,
      [userId, userId]
    );

    let totalBudget = 0;
    let totalSpent = 0;
    let overLimitCount = 0;
    let nearLimitCount = 0;

    budgetRows.forEach((r) => {
      const budgetCap = parseFloat(r.total || 0);
      const actualSpent = parseFloat(r.spent || 0);
      totalBudget += budgetCap;
      totalSpent += actualSpent;
      if (budgetCap > 0) {
        if (actualSpent > budgetCap) {
          overLimitCount++;
        } else if (actualSpent >= 0.8 * budgetCap) {
          nearLimitCount++;
        }
      }
    });

    const budgetHealth = {
      totalBudget: Number(totalBudget.toFixed(2)),
      totalSpent: Number(totalSpent.toFixed(2)),
      overLimit: overLimitCount,
      nearLimit: nearLimitCount,
      totalTracked: budgetRows.filter((r) => parseFloat(r.total || 0) > 0).length,
    };

    // Build the final comprehensive payload
    const response = {
      // Legacy support
      totalBalance: {
        total: totalBalance,
        cash,
        creditDebt,
      },
      // Savings Rate
      savingsRate: {
        rate: savingsRate,
        delta: savingsRateDelta,
      },
      // Income with MoM delta
      todayIncome: {
        today: todayIncome,
        thisWeek: weekIncome,
        thisMonth: monthIncome,
        prevMonth: prevMonthIncome,
        delta: incomeDelta,
      },
      // Expenses with MoM delta
      todayExpenses: {
        today: todayExpense,
        thisWeek: weekExpense,
        thisMonth: monthExpense,
        prevMonth: prevMonthExpense,
        delta: expenseDelta,
      },
      // Net Profit with delta
      netProfit: {
        daily: todayIncome - todayExpense,
        monthly: monthNet,
        yearly: yearIncome - yearExpense,
        delta: netDelta,
      },
      // Commitments block
      commitments: {
        monthlyCommitted: Number(monthlyCommittedOutflow.toFixed(2)),
        committedPercentOfIncome,
        dueNext7: {
          count: parseInt(dueRows?.count7 || 0, 10),
          amount: parseFloat(dueRows?.amount7 || 0),
        },
        dueNext30: {
          count: parseInt(dueRows?.count30 || 0, 10),
          amount: parseFloat(dueRows?.amount30 || 0),
        },
      },
      // Budget Health Roll-up
      budgetHealth,
      // Projection
      projection: {
        averageDailySpend,
        projectedMonthEndSpend,
        daysElapsed,
        daysInMonth,
      },
      // Data Quality
      dataQuality: {
        uncategorisedCount,
        receiptCoverage,
      },
      charts: {
        incomeVsExpenses: chartRows.map((r) => ({
          month: r.month,
          income: parseFloat(r.income),
          expenses: parseFloat(r.expenses),
        })),
        spendingByCategory: categoryRows.map((r) => ({
          name: r.name,
          value: parseFloat(r.value),
          color: r.color || '#3B82F6',
        })),
      },
      recentTransactions: recentTransactions.map((tx) => ({
        ...tx,
        receipt_url: buildPublicUrl(req, tx.receipt_url),
      })),
      budgets: budgetRows.map((r) => ({
        category: r.category,
        spent: parseFloat(r.spent),
        total: parseFloat(r.total),
        color: r.color || '#3B82F6',
      })),
      upcomingSubscriptions: {
        count: upcomingSubs.length,
        items: upcomingSubs,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching dashboard overview:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
};

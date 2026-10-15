const { pool } = require('../../config/db');

/**
 * Helper to build SQL date conditions for current and comparison periods
 */
function buildPeriodConditions(period) {
  switch (period) {
    case 'yesterday':
      return {
        currentSql: ` AND o.created_at >= SUBDATE(CURDATE(), 1) AND o.created_at < CURDATE()`,
        prevSql: ` AND o.created_at >= SUBDATE(CURDATE(), 2) AND o.created_at < SUBDATE(CURDATE(), 1)`,
        returnsCurrentSql: ` AND r.created_at >= SUBDATE(CURDATE(), 1) AND r.created_at < CURDATE()`,
      };
    case 'week':
      return {
        currentSql: ` AND o.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`,
        prevSql: ` AND o.created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY) AND o.created_at < DATE_SUB(CURDATE(), INTERVAL 7 DAY)`,
        returnsCurrentSql: ` AND r.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`,
      };
    case 'month':
      return {
        currentSql: ` AND o.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
        prevSql: ` AND o.created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH) AND o.created_at < DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
        returnsCurrentSql: ` AND r.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
      };
    case 'today':
    default:
      return {
        currentSql: ` AND o.created_at >= CURDATE()`,
        prevSql: ` AND o.created_at >= SUBDATE(CURDATE(), 1) AND o.created_at < CURDATE()`,
        returnsCurrentSql: ` AND r.created_at >= CURDATE()`,
      };
  }
}

/**
 * 1. KPI Stats & Overview Cards
 */
exports.getStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const period = req.query.period || 'today';
    const { currentSql, prevSql, returnsCurrentSql } = buildPeriodConditions(period);

    // Run parallel database queries for optimal performance
    const [
      [salesRows],
      [prevSalesRows],
      [cogsRows],
      [refundRows],
      [paymentRows],
      [inventoryRows]
    ] = await Promise.all([
      // Current Period Sales & Order Totals
      pool.query(
        `SELECT 
          COUNT(*) as total_orders,
          COALESCE(SUM(o.subtotal), 0) as subtotal,
          COALESCE(SUM(o.discount_total), 0) as total_discounts,
          COALESCE(SUM(o.tax_total), 0) as total_tax,
          COALESCE(SUM(o.grand_total), 0) as total_sales
        FROM pos_orders o
        WHERE o.user_id = ? AND o.status != 'voided' ${currentSql}`,
        [userId]
      ),

      // Previous Period Sales for Trend %
      pool.query(
        `SELECT COALESCE(SUM(o.grand_total), 0) as prev_sales
        FROM pos_orders o
        WHERE o.user_id = ? AND o.status != 'voided' ${prevSql}`,
        [userId]
      ),

      // Wholesale Cost of Goods Sold (COGS)
      pool.query(
        `SELECT COALESCE(SUM(oi.unit_cost * oi.quantity), 0) as total_cogs
        FROM pos_order_items oi
        JOIN pos_orders o ON o.id = oi.order_id
        WHERE o.user_id = ? AND o.status != 'voided' ${currentSql}`,
        [userId]
      ),

      // Refunds Total from Returns
      pool.query(
        `SELECT 
          COUNT(*) as refund_count,
          COALESCE(SUM(r.refund_amount), 0) as total_refunds
        FROM pos_returns r
        WHERE r.user_id = ? AND r.status != 'Voided' ${returnsCurrentSql}`,
        [userId]
      ),

      // Payment Tender Breakdown
      pool.query(
        `SELECT 
          op.payment_mode,
          COALESCE(SUM(op.amount), 0) as total_amount
        FROM pos_order_payments op
        JOIN pos_orders o ON o.id = op.order_id
        WHERE o.user_id = ? AND o.status != 'voided' ${currentSql}
        GROUP BY op.payment_mode`,
        [userId]
      ),

      // Live Inventory Health
      pool.query(
        `SELECT 
          COUNT(*) as total_skus,
          COALESCE(SUM(CASE WHEN stock_quantity <= 0 THEN 1 ELSE 0 END), 0) as out_of_stock_count,
          COALESCE(SUM(CASE WHEN stock_quantity > 0 AND stock_quantity <= min_stock_alert THEN 1 ELSE 0 END), 0) as low_stock_count,
          COALESCE(SUM(CASE WHEN stock_quantity <= min_stock_alert THEN 1 ELSE 0 END), 0) as reorders_required,
          COALESCE(SUM(CASE WHEN stock_quantity > 0 THEN stock_quantity * cost_price ELSE 0 END), 0) as asset_value
        FROM pos_product_variants
        WHERE user_id = ? AND is_active = 1`,
        [userId]
      )
    ]);

    // Parse Sales & Orders
    const salesData = salesRows[0] || {};
    const totalOrders = Number(salesData.total_orders || 0);
    const totalSales = Number(salesData.total_sales || 0);
    const totalDiscounts = Number(salesData.total_discounts || 0);
    const totalTax = Number(salesData.total_tax || 0);
    const avgTicket = totalOrders > 0 ? totalSales / totalOrders : 0;

    // Parse Trend
    const prevSales = Number(prevSalesRows[0]?.prev_sales || 0);
    let salesTrend = 0;
    if (prevSales > 0) {
      salesTrend = Number((((totalSales - prevSales) / prevSales) * 100).toFixed(1));
    } else if (totalSales > 0) {
      salesTrend = 100.0;
    }

    // Parse Profits & COGS
    const totalCogs = Number(cogsRows[0]?.total_cogs || 0);
    const grossProfit = totalSales - totalCogs;
    const grossMargin = totalSales > 0 ? Number(((grossProfit / totalSales) * 100).toFixed(1)) : 0;

    // Parse Refunds
    const totalRefunds = Number(refundRows[0]?.total_refunds || 0);
    const refundCount = Number(refundRows[0]?.refund_count || 0);

    // Parse Tenders
    let cardTotal = 0;
    let cashTotal = 0;
    let digitalTotal = 0;

    paymentRows.forEach((row) => {
      const mode = (row.payment_mode || '').toLowerCase();
      const amt = Number(row.total_amount || 0);
      if (mode === 'card') {
        cardTotal += amt;
      } else if (mode === 'cash') {
        cashTotal += amt;
      } else {
        digitalTotal += amt; // UPI, Bank Transfer, Store Credit
      }
    });

    const tenderSum = cardTotal + cashTotal + digitalTotal;
    const cardPercent = tenderSum > 0 ? Number(((cardTotal / tenderSum) * 100).toFixed(0)) : 0;
    const cashPercent = tenderSum > 0 ? Number(((cashTotal / tenderSum) * 100).toFixed(0)) : 0;
    const digitalPercent = tenderSum > 0 ? Number(((digitalTotal / tenderSum) * 100).toFixed(0)) : 0;

    // Parse Inventory
    const inv = inventoryRows[0] || {};
    const totalSkus = Number(inv.total_skus || 0);
    const outOfStockCount = Number(inv.out_of_stock_count || 0);
    const lowStockCount = Number(inv.low_stock_count || 0);
    const reordersRequired = Number(inv.reorders_required || 0);
    const assetValue = Number(inv.asset_value || 0);

    return res.json({
      success: true,
      data: {
        period,
        sales: {
          totalSales,
          totalOrders,
          avgTicket,
          refunds: totalRefunds,
          refundCount,
          trend: salesTrend,
        },
        profit: {
          grossProfit,
          grossMargin,
          cogs: totalCogs,
          tax: totalTax,
          discounts: totalDiscounts,
        },
        tenders: {
          total: tenderSum,
          card: cardTotal,
          cardPercent,
          cash: cashTotal,
          cashPercent,
          digital: digitalTotal,
          digitalPercent,
        },
        inventory: {
          totalSkus,
          outOfStockCount,
          lowStockCount,
          reordersRequired,
          assetValue,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching POS dashboard stats:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch POS dashboard stats' });
  }
};

/**
 * 2. Hourly Sales & Rush Analytics
 */
exports.getHourlySales = async (req, res) => {
  try {
    const userId = req.user.id;
    const period = req.query.period || 'today';

    if (period === 'week') {
      // 7-day daily breakdown
      const [rows] = await pool.query(
        `SELECT 
          DATE_FORMAT(o.created_at, '%a') as hour,
          DATE(o.created_at) as date_val,
          COALESCE(SUM(o.grand_total), 0) as sales,
          COUNT(*) as orders
        FROM pos_orders o
        WHERE o.user_id = ? AND o.status != 'voided' AND o.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        GROUP BY date_val, hour
        ORDER BY date_val ASC`,
        [userId]
      );

      const chartData = rows.map((r) => ({
        hour: r.hour,
        sales: Number(r.sales || 0),
        orders: Number(r.orders || 0),
      }));

      return res.json({
        success: true,
        data: {
          chartData,
          peakHours: 'Sales volume across the past 7 days',
        },
      });
    }

    if (period === 'month') {
      // Monthly week-by-week / multi-day breakdown
      const [rows] = await pool.query(
        `SELECT 
          DATE_FORMAT(o.created_at, '%b %e') as hour,
          DATE(o.created_at) as date_val,
          COALESCE(SUM(o.grand_total), 0) as sales,
          COUNT(*) as orders
        FROM pos_orders o
        WHERE o.user_id = ? AND o.status != 'voided' AND o.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
        GROUP BY date_val, hour
        ORDER BY date_val ASC`,
        [userId]
      );

      const chartData = rows.map((r) => ({
        hour: r.hour,
        sales: Number(r.sales || 0),
        orders: Number(r.orders || 0),
      }));

      return res.json({
        success: true,
        data: {
          chartData,
          peakHours: 'Sales activity across this month',
        },
      });
    }

    // Default: 'today' or 'yesterday' hourly breakdown
    const dateSql = period === 'yesterday'
      ? `AND o.created_at >= SUBDATE(CURDATE(), 1) AND o.created_at < CURDATE()`
      : `AND o.created_at >= CURDATE()`;

    const [rows] = await pool.query(
      `SELECT 
        HOUR(o.created_at) as hr,
        COALESCE(SUM(o.grand_total), 0) as sales,
        COUNT(*) as orders
      FROM pos_orders o
      WHERE o.user_id = ? AND o.status != 'voided' ${dateSql}
      GROUP BY hr
      ORDER BY hr ASC`,
      [userId]
    );

    // Map sales into business hours (8 AM to 9 PM)
    const hoursMap = {};
    rows.forEach((r) => {
      hoursMap[r.hr] = { sales: Number(r.sales || 0), orders: Number(r.orders || 0) };
    });

    const chartData = [];
    let peakHourStr = '12:00 PM – 2:00 PM';
    let maxHourSales = 0;
    let maxHour = 13;

    for (let h = 8; h <= 21; h++) {
      const displayHour = h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`;
      const hourSales = hoursMap[h]?.sales || 0;
      const hourOrders = hoursMap[h]?.orders || 0;

      if (hourSales > maxHourSales) {
        maxHourSales = hourSales;
        maxHour = h;
      }

      chartData.push({
        hour: displayHour,
        sales: hourSales,
        orders: hourOrders,
      });
    }

    if (maxHourSales > 0) {
      const nextHour = maxHour + 1;
      const h1Str = maxHour === 12 ? '12:00 PM' : maxHour > 12 ? `${maxHour - 12}:00 PM` : `${maxHour}:00 AM`;
      const h2Str = nextHour === 12 ? '12:00 PM' : nextHour > 12 ? `${nextHour - 12}:00 PM` : `${nextHour}:00 AM`;
      peakHourStr = `Peak traffic between ${h1Str} – ${h2Str}`;
    }

    return res.json({
      success: true,
      data: {
        chartData,
        peakHours: peakHourStr,
      },
    });
  } catch (error) {
    console.error('Error fetching hourly sales:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch hourly sales' });
  }
};

/**
 * 3. Top Selling Products
 */
exports.getTopProducts = async (req, res) => {
  try {
    const userId = req.user.id;
    const period = req.query.period || 'today';
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
    const { currentSql } = buildPeriodConditions(period);

    const [rows] = await pool.query(
      `SELECT 
        oi.variant_id,
        oi.item_name as name,
        COALESCE(c.name, 'General') as category,
        COALESCE(SUM(oi.quantity), 0) as sold,
        COALESCE(SUM(oi.total_amount), 0) as revenue,
        COALESCE(pv.stock_quantity, 0) as stock
      FROM pos_order_items oi
      JOIN pos_orders o ON o.id = oi.order_id
      LEFT JOIN pos_product_variants pv ON pv.id = oi.variant_id
      LEFT JOIN pos_products p ON p.id = pv.product_id
      LEFT JOIN pos_categories c ON c.id = p.category_id
      WHERE o.user_id = ? AND o.status != 'voided' ${currentSql}
      GROUP BY oi.variant_id, oi.item_name, c.name, pv.stock_quantity
      ORDER BY revenue DESC
      LIMIT ?`,
      [userId, limit]
    );

    const products = rows.map((r, idx) => ({
      id: String(r.variant_id || idx + 1),
      name: r.name,
      category: r.category,
      sold: Number(r.sold || 0),
      revenue: Number(r.revenue || 0),
      stock: Number(r.stock || 0),
    }));

    return res.json({
      success: true,
      data: products,
    });
  } catch (error) {
    console.error('Error fetching top products:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch top products' });
  }
};

/**
 * 4. Recent POS Activity (Receipts & Low Stock Watchlist)
 */
exports.getRecentActivity = async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);

    const [
      [orderRows],
      [lowStockRows],
      [todayCountRows]
    ] = await Promise.all([
      // Latest 5 POS Orders
      pool.query(
        `SELECT 
          o.id,
          o.order_number,
          COALESCE(o.customer_name, 'Walk-in Customer') as customer,
          o.grand_total as total,
          o.status,
          o.created_at,
          (SELECT COUNT(*) FROM pos_order_items oi WHERE oi.order_id = o.id) as items_count,
          COALESCE((SELECT op.payment_mode FROM pos_order_payments op WHERE op.order_id = o.id LIMIT 1), 'Card') as payment_mode
        FROM pos_orders o
        WHERE o.user_id = ? AND o.status != 'voided'
        ORDER BY o.created_at DESC
        LIMIT ?`,
        [userId, limit]
      ),

      // Critical Low Stock Items
      pool.query(
        `SELECT 
          pv.id,
          pv.sku,
          p.name,
          pv.title as variant_title,
          pv.stock_quantity as stock,
          pv.min_stock_alert as threshold,
          COALESCE(p.base_unit, 'units') as unit,
          CASE 
            WHEN pv.stock_quantity <= 0 THEN 'out_of_stock'
            WHEN pv.stock_quantity <= (pv.min_stock_alert / 2) THEN 'critical'
            ELSE 'low'
          END as status
        FROM pos_product_variants pv
        JOIN pos_products p ON p.id = pv.product_id
        WHERE pv.user_id = ? AND pv.is_active = 1 AND pv.stock_quantity <= pv.min_stock_alert
        ORDER BY pv.stock_quantity ASC
        LIMIT ?`,
        [userId, limit]
      ),

      // Count of orders today
      pool.query(
        `SELECT COUNT(*) as count 
         FROM pos_orders 
         WHERE user_id = ? AND status != 'voided' AND created_at >= CURDATE()`,
        [userId]
      )
    ]);

    const recentSales = orderRows.map((o) => ({
      id: o.order_number || `POS-${o.id}`,
      customer: o.customer,
      total: Number(o.total || 0),
      items: Number(o.items_count || 0),
      payment: o.payment_mode || 'Card',
      status: o.status === 'completed' ? 'Paid' : o.status,
      created_at: o.created_at,
    }));

    const lowStockWatchlist = lowStockRows.map((item) => ({
      id: item.sku || `SKU-${item.id}`,
      name: item.variant_title && item.variant_title !== 'Regular'
        ? `${item.name} (${item.variant_title})`
        : item.name,
      stock: Number(item.stock || 0),
      threshold: Number(item.threshold || 0),
      unit: item.unit,
      status: item.status,
    }));

    const todayOrdersCount = Number(todayCountRows[0]?.count || 0);

    return res.json({
      success: true,
      data: {
        recentSales,
        lowStockWatchlist,
        todayOrdersCount,
      },
    });
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch recent activity' });
  }
};

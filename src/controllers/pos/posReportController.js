const { pool } = require('../../config/db');

/**
 * Build SQL date filter condition based on preset or custom dates
 */
function buildDateCondition(preset, field = 'o.created_at', customStart = null, customEnd = null) {
  if (customStart && customEnd) {
    return {
      sql: ` AND ${field} BETWEEN ? AND ?`,
      params: [`${customStart} 00:00:00`, `${customEnd} 23:59:59`]
    };
  }

  switch (preset) {
    case 'today':
      return {
        sql: ` AND ${field} >= CURDATE()`,
        params: []
      };
    case 'yesterday':
      return {
        sql: ` AND ${field} >= SUBDATE(CURDATE(), 1) AND ${field} < CURDATE()`,
        params: []
      };
    case '7days':
      return {
        sql: ` AND ${field} >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
        params: []
      };
    case '30days':
      return {
        sql: ` AND ${field} >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        params: []
      };
    case 'this_month':
      return {
        sql: ` AND ${field} >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
        params: []
      };
    case 'quarter':
      return {
        sql: ` AND ${field} >= DATE_SUB(NOW(), INTERVAL 90 DAY)`,
        params: []
      };
    default:
      return {
        sql: ` AND ${field} >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        params: []
      };
  }
}

// =========================================================================
// 1. Sales Summary Report
// =========================================================================
exports.getSalesSummary = async (req, res) => {
  const userId = req.user.id;
  const { dateRange = '30days', start_date, end_date } = req.query;

  try {
    const dateCond = buildDateCondition(dateRange, 'o.created_at', start_date, end_date);

    // KPI Totals
    const [summaryRows] = await pool.query(
      `SELECT 
        COUNT(*) as total_orders,
        COALESCE(SUM(o.subtotal), 0) as total_subtotal,
        COALESCE(SUM(o.discount_total), 0) as total_discounts,
        COALESCE(SUM(o.tax_total), 0) as total_tax,
        COALESCE(SUM(o.grand_total), 0) as total_net_sales
       FROM pos_orders o
       WHERE o.user_id = ? AND o.status != 'voided' ${dateCond.sql}`,
      [userId, ...dateCond.params]
    );

    const summary = summaryRows[0] || {};
    const totalOrders = Number(summary.total_orders || 0);
    const totalDiscounts = Number(summary.total_discounts || 0);
    const totalNetSales = Number(summary.total_net_sales || 0);
    const totalTax = Number(summary.total_tax || 0);
    const totalGrossSales = totalNetSales + totalDiscounts;
    const averageOrderValue = totalOrders > 0 ? totalNetSales / totalOrders : 0;

    // Total Items Sold
    const [itemRows] = await pool.query(
      `SELECT COALESCE(SUM(oi.quantity), 0) as total_items_sold
       FROM pos_order_items oi
       JOIN pos_orders o ON o.id = oi.order_id
       WHERE o.user_id = ? AND o.status != 'voided' ${dateCond.sql}`,
      [userId, ...dateCond.params]
    );
    const totalItemsSold = Number(itemRows[0]?.total_items_sold || 0);

    // Sales Trend by Day
    const [trendRows] = await pool.query(
      `SELECT 
        DATE(o.created_at) as date,
        COUNT(*) as orders,
        COALESCE(SUM(o.grand_total + o.discount_total), 0) as gross,
        COALESCE(SUM(o.grand_total), 0) as net
       FROM pos_orders o
       WHERE o.user_id = ? AND o.status != 'voided' ${dateCond.sql}
       GROUP BY DATE(o.created_at)
       ORDER BY DATE(o.created_at) ASC`,
      [userId, ...dateCond.params]
    );

    const trend = trendRows.map(r => ({
      date: r.date ? new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
      gross: Number(r.gross || 0),
      net: Number(r.net || 0),
      orders: Number(r.orders || 0),
    }));

    // Hourly Breakdown
    const [hourlyRows] = await pool.query(
      `SELECT 
        HOUR(o.created_at) as hour_num,
        COUNT(*) as orders,
        COALESCE(SUM(o.grand_total), 0) as sales
       FROM pos_orders o
       WHERE o.user_id = ? AND o.status != 'voided' ${dateCond.sql}
       GROUP BY HOUR(o.created_at)
       ORDER BY HOUR(o.created_at) ASC`,
      [userId, ...dateCond.params]
    );

    const hourlyMap = new Map();
    for (let h = 7; h <= 21; h++) {
      const hourLabel = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
      hourlyMap.set(h, { hour: hourLabel, sales: 0, orders: 0 });
    }
    hourlyRows.forEach(r => {
      const h = Number(r.hour_num);
      const hourLabel = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
      hourlyMap.set(h, {
        hour: hourLabel,
        sales: Number(r.sales || 0),
        orders: Number(r.orders || 0),
      });
    });

    const hourlyBreakdown = Array.from(hourlyMap.values());

    return res.json({
      success: true,
      data: {
        totalGrossSales,
        totalDiscounts,
        totalNetSales,
        totalOrders,
        averageOrderValue,
        totalTax,
        totalItemsSold,
        trend,
        hourlyBreakdown,
      }
    });
  } catch (err) {
    console.error('Error fetching sales summary report:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch sales summary' });
  }
};

// =========================================================================
// 2. Product-wise Sales Report
// =========================================================================
exports.getProductSales = async (req, res) => {
  const userId = req.user.id;
  const { dateRange = '30days', category = 'All', start_date, end_date } = req.query;

  try {
    const dateCond = buildDateCondition(dateRange, 'o.created_at', start_date, end_date);
    let categoryClause = '';
    const params = [userId, ...dateCond.params];

    if (category && category !== 'All') {
      categoryClause = ' AND c.name = ?';
      params.push(category);
    }

    const [rows] = await pool.query(
      `SELECT 
        oi.sku,
        oi.item_name as product_name,
        COALESCE(c.name, 'General') as category,
        COALESCE(SUM(oi.quantity), 0) as units_sold,
        COALESCE(SUM(oi.unit_price * oi.quantity), 0) as gross_sales,
        COALESCE(SUM(oi.discount_amount), 0) as discount,
        COALESCE(SUM(oi.total_amount), 0) as net_revenue,
        COALESCE(SUM(oi.unit_cost * oi.quantity), 0) as cogs
       FROM pos_order_items oi
       JOIN pos_orders o ON o.id = oi.order_id
       LEFT JOIN pos_product_variants pv ON pv.id = oi.variant_id
       LEFT JOIN pos_products p ON p.id = pv.product_id
       LEFT JOIN pos_categories c ON c.id = p.category_id
       WHERE o.user_id = ? AND o.status != 'voided' ${dateCond.sql} ${categoryClause}
       GROUP BY oi.sku, oi.item_name, c.name
       ORDER BY net_revenue DESC`,
      params
    );

    const items = rows.map((r, idx) => {
      const unitsSold = Number(r.units_sold || 0);
      const grossSales = Number(r.gross_sales || 0);
      const discount = Number(r.discount || 0);
      const netRevenue = Number(r.net_revenue || 0);
      const cogs = Number(r.cogs || 0);
      const grossProfit = netRevenue - cogs;
      const marginPercent = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;

      return {
        id: `prod-sale-${idx + 1}`,
        productName: r.product_name,
        sku: r.sku,
        category: r.category,
        unitsSold,
        grossSales,
        discount,
        netRevenue,
        cogs,
        grossProfit,
        marginPercent: Number(marginPercent.toFixed(1)),
      };
    });

    return res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    console.error('Error fetching product sales report:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch product sales' });
  }
};

// =========================================================================
// 3. Category-wise Sales Report
// =========================================================================
exports.getCategorySales = async (req, res) => {
  const userId = req.user.id;
  const { dateRange = '30days', start_date, end_date } = req.query;

  try {
    const dateCond = buildDateCondition(dateRange, 'o.created_at', start_date, end_date);

    const [rows] = await pool.query(
      `SELECT 
        COALESCE(c.name, 'General') as category,
        COALESCE(SUM(oi.quantity), 0) as items_sold,
        COALESCE(SUM(oi.total_amount), 0) as revenue,
        COALESCE(SUM(oi.unit_cost * oi.quantity), 0) as cogs
       FROM pos_order_items oi
       JOIN pos_orders o ON o.id = oi.order_id
       LEFT JOIN pos_product_variants pv ON pv.id = oi.variant_id
       LEFT JOIN pos_products p ON p.id = pv.product_id
       LEFT JOIN pos_categories c ON c.id = p.category_id
       WHERE o.user_id = ? AND o.status != 'voided' ${dateCond.sql}
       GROUP BY c.name
       ORDER BY revenue DESC`,
      [userId, ...dateCond.params]
    );

    const totalRevenueAll = rows.reduce((acc, r) => acc + Number(r.revenue || 0), 0);

    const colors = ['#159A1D', '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#6366F1'];

    const items = rows.map((r, idx) => {
      const itemsSold = Number(r.items_sold || 0);
      const revenue = Number(r.revenue || 0);
      const cogs = Number(r.cogs || 0);
      const grossProfit = revenue - cogs;
      const marginPercent = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
      const revenueShare = totalRevenueAll > 0 ? (revenue / totalRevenueAll) * 100 : 0;

      return {
        category: r.category,
        itemsSold,
        revenue,
        revenueShare: Number(revenueShare.toFixed(1)),
        cogs,
        grossProfit,
        marginPercent: Number(marginPercent.toFixed(1)),
        color: colors[idx % colors.length],
      };
    });

    return res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    console.error('Error fetching category sales report:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch category sales' });
  }
};

// =========================================================================
// 4. Profit & Margins Report
// =========================================================================
exports.getProfitMargins = async (req, res) => {
  const userId = req.user.id;
  const { dateRange = '30days', start_date, end_date } = req.query;

  try {
    const dateCond = buildDateCondition(dateRange, 'o.created_at', start_date, end_date);

    // Revenue & COGS
    const [finances] = await pool.query(
      `SELECT 
        COALESCE(SUM(oi.total_amount), 0) as gross_revenue,
        COALESCE(SUM(oi.unit_cost * oi.quantity), 0) as total_cogs
       FROM pos_order_items oi
       JOIN pos_orders o ON o.id = oi.order_id
       WHERE o.user_id = ? AND o.status != 'voided' ${dateCond.sql}`,
      [userId, ...dateCond.params]
    );

    const grossRevenue = Number(finances[0]?.gross_revenue || 0);
    const totalCogs = Number(finances[0]?.total_cogs || 0);
    const grossProfit = grossRevenue - totalCogs;
    const grossMarginPercent = grossRevenue > 0 ? (grossProfit / grossRevenue) * 100 : 0;

    // Operating Deductions (Refunds)
    const [refunds] = await pool.query(
      `SELECT COALESCE(SUM(refund_amount), 0) as total_refunds
       FROM pos_returns
       WHERE user_id = ? ${dateCond.sql.replace(/o\.created_at/g, 'created_at')}`,
      [userId, ...dateCond.params]
    );
    const operatingExpenses = Number(refunds[0]?.total_refunds || 0);
    const netOperatingProfit = grossProfit - operatingExpenses;
    const netMarginPercent = grossRevenue > 0 ? (netOperatingProfit / grossRevenue) * 100 : 0;

    // Margin Tiers Breakdown
    const [productMargins] = await pool.query(
      `SELECT 
        oi.item_name as name,
        COALESCE(c.name, 'General') as category,
        pv.selling_price as current_price,
        pv.cost_price,
        COALESCE(SUM(oi.total_amount), 0) as revenue,
        COALESCE(SUM(oi.total_amount - (oi.unit_cost * oi.quantity)), 0) as profit,
        CASE 
          WHEN SUM(oi.total_amount) > 0 THEN (SUM(oi.total_amount - (oi.unit_cost * oi.quantity)) / SUM(oi.total_amount)) * 100 
          ELSE 0 
        END as margin
       FROM pos_order_items oi
       JOIN pos_orders o ON o.id = oi.order_id
       LEFT JOIN pos_product_variants pv ON pv.id = oi.variant_id
       LEFT JOIN pos_products p ON p.id = pv.product_id
       LEFT JOIN pos_categories c ON c.id = p.category_id
       WHERE o.user_id = ? AND o.status != 'voided' ${dateCond.sql}
       GROUP BY oi.sku, oi.item_name, c.name, pv.selling_price, pv.cost_price
       ORDER BY profit DESC`,
      [userId, ...dateCond.params]
    );

    let highCount = 0, highRev = 0, highProf = 0;
    let modCount = 0, modRev = 0, modProf = 0;
    let lowCount = 0, lowRev = 0, lowProf = 0;

    productMargins.forEach(p => {
      const margin = Number(p.margin);
      const rev = Number(p.revenue);
      const prof = Number(p.profit);
      if (margin >= 50) {
        highCount++; highRev += rev; highProf += prof;
      } else if (margin >= 25) {
        modCount++; modRev += rev; modProf += prof;
      } else {
        lowCount++; lowRev += rev; lowProf += prof;
      }
    });

    const tierBreakdown = [
      { tier: 'High Margin', range: '≥ 50% Margin', count: highCount, revenue: highRev, profit: highProf },
      { tier: 'Mid Margin', range: '25% - 49% Margin', count: modCount, revenue: modRev, profit: modProf },
      { tier: 'Low Margin', range: '< 25% Margin', count: lowCount, revenue: lowRev, profit: lowProf },
    ];

    const topProfitProducts = productMargins.slice(0, 5).map(p => ({
      name: p.name,
      category: p.category,
      profit: Number(p.profit),
      margin: Number(Number(p.margin).toFixed(1)),
    }));

    // Low margin alerts (margin < 35%)
    const lowMarginAlerts = productMargins
      .filter(p => Number(p.margin) < 35)
      .slice(0, 10)
      .map(p => ({
        name: p.name,
        margin: Number(Number(p.margin).toFixed(1)),
        currentPrice: Number(p.current_price || 0),
        costPrice: Number(p.cost_price || 0),
      }));

    return res.json({
      success: true,
      data: {
        grossRevenue,
        totalCogs,
        grossProfit,
        grossMarginPercent: Number(grossMarginPercent.toFixed(1)),
        operatingExpenses,
        netOperatingProfit,
        netMarginPercent: Number(netMarginPercent.toFixed(1)),
        tierBreakdown,
        topProfitProducts,
        lowMarginAlerts,
      }
    });
  } catch (err) {
    console.error('Error fetching profit margins report:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch profit margins' });
  }
};

// =========================================================================
// 5. Inventory Valuation Report (Current Live Snapshot)
// =========================================================================
exports.getInventoryValuation = async (req, res) => {
  const userId = req.user.id;

  try {
    // Total Inventory Value
    const [overall] = await pool.query(
      `SELECT 
        COUNT(pv.id) as total_items,
        COALESCE(SUM(pv.stock_quantity * pv.cost_price), 0) as valuation_at_cost,
        COALESCE(SUM(pv.stock_quantity * pv.selling_price), 0) as valuation_at_retail,
        COALESCE(SUM(pv.stock_quantity), 0) as total_stock_units,
        COUNT(CASE WHEN pv.stock_quantity > pv.min_stock_alert THEN 1 END) as healthy_stock_count,
        COUNT(CASE WHEN pv.stock_quantity <= pv.min_stock_alert AND pv.stock_quantity > 0 THEN 1 END) as low_stock_count,
        COUNT(CASE WHEN pv.stock_quantity <= 0 THEN 1 END) as out_of_stock_count
       FROM pos_product_variants pv
       JOIN pos_products p ON p.id = pv.product_id
       WHERE p.user_id = ? AND p.status != 'archived' AND pv.is_active = 1`,
      [userId]
    );

    const stats = overall[0] || {};
    const totalItems = Number(stats.total_items || 0);
    const valuationAtCost = Number(stats.valuation_at_cost || 0);
    const valuationAtRetail = Number(stats.valuation_at_retail || 0);
    const totalStockUnits = Number(stats.total_stock_units || 0);
    const healthyStockCount = Number(stats.healthy_stock_count || 0);
    const lowStockCount = Number(stats.low_stock_count || 0);
    const outOfStockCount = Number(stats.out_of_stock_count || 0);
    const potentialProfit = valuationAtRetail - valuationAtCost;

    // Breakdown by Category
    const [catBreakdown] = await pool.query(
      `SELECT 
        COALESCE(c.name, 'General') as category,
        COALESCE(SUM(pv.stock_quantity), 0) as units,
        COALESCE(SUM(pv.stock_quantity * pv.cost_price), 0) as cost_value,
        COALESCE(SUM(pv.stock_quantity * pv.selling_price), 0) as retail_value
       FROM pos_product_variants pv
       JOIN pos_products p ON p.id = pv.product_id
       LEFT JOIN pos_categories c ON c.id = p.category_id
       WHERE p.user_id = ? AND p.status != 'archived' AND pv.is_active = 1
       GROUP BY c.name
       ORDER BY cost_value DESC`,
      [userId]
    );

    const categoryValuations = catBreakdown.map(r => {
      const units = Number(r.units || 0);
      const costValue = Number(r.cost_value || 0);
      const retailValue = Number(r.retail_value || 0);
      const expectedProfit = retailValue - costValue;
      const margin = retailValue > 0 ? (expectedProfit / retailValue) * 100 : 0;

      return {
        category: r.category,
        units,
        costValue,
        retailValue,
        margin: Number(margin.toFixed(1)),
      };
    });

    // Breakdown by Brand
    const [brandBreakdown] = await pool.query(
      `SELECT 
        COALESCE(b.name, 'In-House') as brand,
        COALESCE(SUM(pv.stock_quantity), 0) as units,
        COALESCE(SUM(pv.stock_quantity * pv.cost_price), 0) as cost_value,
        COALESCE(SUM(pv.stock_quantity * pv.selling_price), 0) as retail_value
       FROM pos_product_variants pv
       JOIN pos_products p ON p.id = pv.product_id
       LEFT JOIN pos_brands b ON b.id = p.brand_id
       WHERE p.user_id = ? AND p.status != 'archived' AND pv.is_active = 1
       GROUP BY b.name
       ORDER BY cost_value DESC`,
      [userId]
    );

    const brandValuations = brandBreakdown.map(r => ({
      brand: r.brand,
      units: Number(r.units || 0),
      costValue: Number(r.cost_value || 0),
      retailValue: Number(r.retail_value || 0),
    }));

    return res.json({
      success: true,
      data: {
        totalItems,
        totalStockUnits,
        valuationAtCost,
        valuationAtRetail,
        potentialProfit,
        healthyStockCount,
        lowStockCount,
        outOfStockCount,
        categoryValuations,
        brandValuations,
      }
    });
  } catch (err) {
    console.error('Error fetching inventory valuation report:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch inventory valuation' });
  }
};

// =========================================================================
// 6. Payment Summary Report
// =========================================================================
exports.getPaymentSummary = async (req, res) => {
  const userId = req.user.id;
  const { dateRange = '30days', start_date, end_date } = req.query;

  try {
    const dateCond = buildDateCondition(dateRange, 'o.created_at', start_date, end_date);

    // Sum receipts by payment method from pos_order_payments
    const [rows] = await pool.query(
      `SELECT 
        COALESCE(op.payment_mode, 'Cash') as method,
        COUNT(*) as transactions,
        COALESCE(SUM(op.amount), 0) as total_amount
       FROM pos_order_payments op
       JOIN pos_orders o ON o.id = op.order_id
       WHERE o.user_id = ? AND o.status != 'voided' ${dateCond.sql}
       GROUP BY op.payment_mode
       ORDER BY total_amount DESC`,
      [userId, ...dateCond.params]
    );

    const totalIntake = rows.reduce((acc, r) => acc + Number(r.total_amount || 0), 0);

    const colorMap = {
      'Cash': '#159A1D',
      'Card': '#3B82F6',
      'UPI': '#8B5CF6',
      'Bank Transfer': '#06B6D4',
      'Store Credit': '#F59E0B',
    };

    const items = rows.map((r, idx) => {
      const method = r.method;
      const transactions = Number(r.transactions || 0);
      const totalAmount = Number(r.total_amount || 0);
      const percentage = totalIntake > 0 ? (totalAmount / totalIntake) * 100 : 0;
      // Realistic gateway processing fees estimate: Card 2.0%, UPI 0.0%, Cash 0.0%, Bank Transfer 0.5%
      const feeRate = method === 'Card' ? 0.02 : method === 'Bank Transfer' ? 0.005 : 0;
      const processingFees = totalAmount * feeRate;
      const netCollected = totalAmount - processingFees;

      return {
        method,
        transactions,
        totalAmount,
        percentage: Number(percentage.toFixed(1)),
        processingFees: Number(processingFees.toFixed(2)),
        netCollected: Number(netCollected.toFixed(2)),
        color: colorMap[method] || ['#159A1D', '#3B82F6', '#8B5CF6', '#06B6D4', '#F59E0B', '#EC4899'][idx % 6],
      };
    });

    return res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    console.error('Error fetching payment summary report:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch payment summary' });
  }
};

// =========================================================================
// 7. Returns & Refunds Report
// =========================================================================
exports.getReturnsRefunds = async (req, res) => {
  const userId = req.user.id;
  const { dateRange = '30days', start_date, end_date } = req.query;

  try {
    const dateCondReturns = buildDateCondition(dateRange, 'r.created_at', start_date, end_date);
    const dateCondOrders = buildDateCondition(dateRange, 'created_at', start_date, end_date);

    // Returns stats
    const [returnsSummary] = await pool.query(
      `SELECT 
        COUNT(*) as total_returns,
        COALESCE(SUM(refund_amount), 0) as total_refund_amount
       FROM pos_returns r
       WHERE r.user_id = ? ${dateCondReturns.sql}`,
      [userId, ...dateCondReturns.params]
    );

    // Gross Sales for return rate
    const [salesSummary] = await pool.query(
      `SELECT COALESCE(SUM(grand_total), 0) as total_sales
       FROM pos_orders
       WHERE user_id = ? AND status != 'voided' ${dateCondOrders.sql}`,
      [userId, ...dateCondOrders.params]
    );

    const totalReturns = Number(returnsSummary[0]?.total_returns || 0);
    const totalRefundAmount = Number(returnsSummary[0]?.total_refund_amount || 0);
    const totalSales = Number(salesSummary[0]?.total_sales || 0);
    const returnRatePercent = totalSales > 0 ? (totalRefundAmount / totalSales) * 100 : 0;

    // Reason code breakdown
    const [reasonRows] = await pool.query(
      `SELECT 
        COALESCE(r.reason, 'Customer Return') as reason,
        COUNT(*) as count,
        COALESCE(SUM(r.refund_amount), 0) as amount
       FROM pos_returns r
       WHERE r.user_id = ? ${dateCondReturns.sql}
       GROUP BY r.reason
       ORDER BY count DESC`,
      [userId, ...dateCondReturns.params]
    );

    const reasons = reasonRows.map(r => {
      const count = Number(r.count || 0);
      const amount = Number(r.amount || 0);
      const percentage = totalReturns > 0 ? (count / totalReturns) * 100 : 0;
      return {
        reason: r.reason,
        count,
        amount,
        percentage: Number(percentage.toFixed(1)),
      };
    });

    // Refund Method breakdown
    const [methodRows] = await pool.query(
      `SELECT 
        COALESCE(r.refund_mode, 'Store Credit') as method,
        COUNT(*) as count,
        COALESCE(SUM(r.refund_amount), 0) as amount
       FROM pos_returns r
       WHERE r.user_id = ? ${dateCondReturns.sql}
       GROUP BY r.refund_mode
       ORDER BY amount DESC`,
      [userId, ...dateCondReturns.params]
    );

    const refundMethods = methodRows.map(r => ({
      method: r.method,
      count: Number(r.count || 0),
      amount: Number(r.amount || 0),
    }));

    // Top Returned Products from returned_items_json
    const [returnedItemsRows] = await pool.query(
      `SELECT r.returned_items_json, r.reason
       FROM pos_returns r
       WHERE r.user_id = ? ${dateCondReturns.sql}`,
      [userId, ...dateCondReturns.params]
    );

    const productReturnMap = new Map();
    returnedItemsRows.forEach(row => {
      let items = [];
      try {
        items = typeof row.returned_items_json === 'string' 
          ? JSON.parse(row.returned_items_json) 
          : (row.returned_items_json || []);
      } catch (e) {
        items = [];
      }

      if (Array.isArray(items)) {
        items.forEach(it => {
          const sku = it.sku || 'N/A';
          const name = it.item_name || it.productName || 'Unknown Product';
          const qty = Number(it.quantity || 1);
          const amt = Number(it.refund_amount || it.total_amount || 0);

          if (!productReturnMap.has(sku)) {
            productReturnMap.set(sku, {
              productName: name,
              sku,
              unitsReturned: 0,
              refundAmount: 0,
              primaryReason: row.reason || 'General Return',
            });
          }
          const curr = productReturnMap.get(sku);
          curr.unitsReturned += qty;
          curr.refundAmount += amt;
        });
      }
    });

    const returnedProducts = Array.from(productReturnMap.values())
      .sort((a, b) => b.unitsReturned - a.unitsReturned)
      .slice(0, 15);

    return res.json({
      success: true,
      data: {
        totalReturns,
        totalRefundAmount,
        returnRatePercent: Number(returnRatePercent.toFixed(1)),
        reasons,
        refundMethods,
        returnedProducts,
      }
    });
  } catch (err) {
    console.error('Error fetching returns & refunds report:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch returns & refunds' });
  }
};

// =========================================================================
// 8. Purchase Report
// =========================================================================
exports.getPurchaseReport = async (req, res) => {
  const userId = req.user.id;
  const { dateRange = '30days', start_date, end_date } = req.query;

  try {
    const dateCondBills = buildDateCondition(dateRange, 'b.created_at', start_date, end_date);
    const dateCondPOs = buildDateCondition(dateRange, 'po.created_at', start_date, end_date);

    // Overall Spend & Bill counts
    const [billStats] = await pool.query(
      `SELECT 
        COUNT(*) as total_purchases,
        COALESCE(SUM(b.total_amount), 0) as total_spend
       FROM pos_purchase_bills b
       WHERE b.user_id = ? ${dateCondBills.sql}`,
      [userId, ...dateCondBills.params]
    );

    // Completed vs Pending POs
    const [poCounts] = await pool.query(
      `SELECT 
        COUNT(CASE WHEN po.status = 'Received' THEN 1 END) as completed_pos,
        COUNT(CASE WHEN po.status IN ('Draft', 'Ordered', 'Partial') THEN 1 END) as pending_pos
       FROM pos_purchase_orders po
       WHERE po.user_id = ? ${dateCondPOs.sql}`,
      [userId, ...dateCondPOs.params]
    );

    const totalPurchases = Number(billStats[0]?.total_purchases || 0);
    const totalSpend = Number(billStats[0]?.total_spend || 0);
    const completedPOs = Number(poCounts[0]?.completed_pos || 0);
    const pendingPOs = Number(poCounts[0]?.pending_pos || 0);

    // Supplier Spend Breakdown
    const [supplierRows] = await pool.query(
      `SELECT 
        s.name as supplier,
        COUNT(b.id) as po_count,
        COALESCE(SUM(b.total_amount), 0) as total_spend,
        COALESCE(SUM(b.balance_due), 0) as pending_amount
       FROM pos_suppliers s
       LEFT JOIN pos_purchase_bills b ON b.supplier_id = s.id AND b.user_id = s.user_id ${dateCondBills.sql}
       WHERE s.user_id = ? AND s.is_active = 1
       GROUP BY s.id, s.name
       ORDER BY total_spend DESC`,
      [userId, ...dateCondBills.params, userId]
    );

    const supplierSpend = supplierRows.map(r => {
      const spend = Number(r.total_spend || 0);
      const pending = Number(r.pending_amount || 0);
      // Fulfillment rate based on received bills
      const fulfillmentRate = spend > 0 ? (Math.max(0, spend - pending) / spend) * 100 : 100;
      return {
        supplier: r.supplier,
        poCount: Number(r.po_count || 0),
        totalSpend: spend,
        fulfillmentRate: Number(fulfillmentRate.toFixed(1)),
        pendingAmount: pending,
      };
    });

    // Recent Purchases
    const [recentRows] = await pool.query(
      `SELECT 
        b.bill_number as po_number,
        COALESCE(s.name, 'Direct Vendor') as supplier,
        DATE_FORMAT(b.bill_date, '%Y-%m-%d') as date,
        b.total_amount as total_cost,
        b.status as payment_status
       FROM pos_purchase_bills b
       LEFT JOIN pos_suppliers s ON s.id = b.supplier_id
       WHERE b.user_id = ? ${dateCondBills.sql}
       ORDER BY b.created_at DESC
       LIMIT 20`,
      [userId, ...dateCondBills.params]
    );

    const recentPurchases = recentRows.map(r => ({
      poNumber: r.po_number,
      supplier: r.supplier,
      date: r.date || '',
      itemsCount: 1,
      totalCost: Number(r.total_cost || 0),
      status: 'Received',
      paymentStatus: r.payment_status === 'Paid' ? 'Paid' : r.payment_status === 'Partial' ? 'Partial' : 'Unpaid',
    }));

    return res.json({
      success: true,
      data: {
        totalPurchases,
        totalSpend,
        completedPOs,
        pendingPOs,
        supplierSpend,
        recentPurchases,
      }
    });
  } catch (err) {
    console.error('Error fetching purchase report:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch purchase report' });
  }
};

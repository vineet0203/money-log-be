const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middleware/authMiddleware');
const posReportController = require('../../controllers/pos/posReportController');

// All POS report endpoints require authentication
router.use(verifyToken);

// 1. Sales Summary (KPIs, Daily trend, Hourly velocity)
router.get('/sales-summary', posReportController.getSalesSummary);

// 2. Product-wise Sales
router.get('/product-sales', posReportController.getProductSales);

// 3. Category-wise Sales
router.get('/category-sales', posReportController.getCategorySales);

// 4. Profit & Margins
router.get('/profit-margins', posReportController.getProfitMargins);

// 5. Inventory Valuation (Live Cost vs Retail Snapshot)
router.get('/inventory-valuation', posReportController.getInventoryValuation);

// 6. Payment Summary (Cash, Card, UPI, etc.)
router.get('/payment-summary', posReportController.getPaymentSummary);

// 7. Returns & Refunds
router.get('/returns-refunds', posReportController.getReturnsRefunds);

// 8. Purchase Report (Spend, Bills, Payables by Vendor)
router.get('/purchases', posReportController.getPurchaseReport);

module.exports = router;

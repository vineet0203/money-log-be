const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { verifyToken } = require('../middleware/authMiddleware');
const { reportsLimiter } = require('../middleware/rateLimiters');

router.use(verifyToken);
router.use(reportsLimiter);
router.get('/series', reportController.getSeriesReport);
router.get('/monthly', reportController.getMonthlyReport);
router.get('/dashboard', reportController.getDashboardAnalytics);

module.exports = router;

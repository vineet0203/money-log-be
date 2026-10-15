const express = require('express');
const router = express.Router();
const posDashboardController = require('../../controllers/pos/posDashboardController');
const { verifyToken } = require('../../middleware/authMiddleware');

router.use(verifyToken);

router.get('/stats', posDashboardController.getStats);
router.get('/hourly-sales', posDashboardController.getHourlySales);
router.get('/top-products', posDashboardController.getTopProducts);
router.get('/recent-activity', posDashboardController.getRecentActivity);

module.exports = router;

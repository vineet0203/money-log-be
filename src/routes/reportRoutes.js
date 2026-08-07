const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { verifyToken } = require('../middleware/authMiddleware');

router.use(verifyToken);
router.get('/monthly', reportController.getMonthlyReport);
router.get('/dashboard', reportController.getDashboardAnalytics);

module.exports = router;

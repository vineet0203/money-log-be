const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { verifyToken } = require('../middleware/authMiddleware');
const { reportsLimiter } = require('../middleware/rateLimiters');

router.use(verifyToken);
router.use(reportsLimiter);

router.get('/overview', dashboardController.getOverview);

module.exports = router;

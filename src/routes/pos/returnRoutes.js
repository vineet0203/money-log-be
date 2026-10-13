const express = require('express');
const router = express.Router();
const returnController = require('../../controllers/pos/posReturnController');
const { verifyToken } = require('../../middleware/authMiddleware');

router.use(verifyToken);

router.get('/', returnController.getReturns);
router.get('/exchanges', returnController.getExchanges);
router.get('/check-eligibility/:orderId', returnController.checkReturnEligibility);
router.post('/', returnController.createReturn);
router.post('/exchange', returnController.createExchange);

module.exports = router;

const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const { verifyToken } = require('../middleware/authMiddleware');

router.use(verifyToken);

router.get('/', subscriptionController.getSubscriptions);
router.get('/stats', subscriptionController.getSubscriptionStats);
router.post('/', subscriptionController.addSubscription);
router.put('/:id', subscriptionController.updateSubscription);
router.delete('/:id', subscriptionController.deleteSubscription);
router.get('/:id/details', subscriptionController.getSubscriptionDetails);
router.post('/:id/pay', subscriptionController.paySubscription);

module.exports = router;

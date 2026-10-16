const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const { verifyToken } = require('../middleware/authMiddleware');

router.use(verifyToken);

router.get('/', subscriptionController.getSubscriptions);
router.get('/stats', subscriptionController.getSubscriptionStats);
router.get('/preview', subscriptionController.previewRecurrence);
router.get('/catch-up', subscriptionController.getCatchUpOccurrences);
router.post('/catch-up/bulk', subscriptionController.bulkProcessCatchUp);
router.post('/', subscriptionController.addSubscription);

router.get('/:id/occurrences', subscriptionController.getOccurrences);
router.post('/:id/occurrences/:occId/pay', subscriptionController.payOccurrence);
router.post('/:id/occurrences/:occId/skip', subscriptionController.skipOccurrence);
router.put('/:id', subscriptionController.updateSubscription);
router.delete('/:id', subscriptionController.deleteSubscription);
router.get('/:id/details', subscriptionController.getSubscriptionDetails);
router.post('/:id/pay', subscriptionController.paySubscription);
router.post('/:id/undo-payment', subscriptionController.undoPayment);

module.exports = router;

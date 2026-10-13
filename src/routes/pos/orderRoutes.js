const express = require('express');
const router = express.Router();
const orderController = require('../../controllers/pos/posOrderController');
const { verifyToken } = require('../../middleware/authMiddleware');

router.use(verifyToken);

router.get('/', orderController.getOrders);
router.post('/', orderController.createOrder);
router.get('/:id', orderController.getOrderById);

module.exports = router;

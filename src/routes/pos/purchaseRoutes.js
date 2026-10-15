const express = require('express');
const router = express.Router();
const purchaseController = require('../../controllers/pos/posPurchaseController');
const { verifyToken } = require('../../middleware/authMiddleware');

router.use(verifyToken);

// Metrics
router.get('/metrics', purchaseController.getMetrics);

// Purchase Orders
router.get('/orders', purchaseController.getPurchaseOrders);
router.post('/orders', purchaseController.createPurchaseOrder);
router.get('/orders/:id', purchaseController.getPurchaseOrderById);
router.put('/orders/:id/status', purchaseController.updatePOStatus);

// Purchase Bills
router.get('/bills', purchaseController.getPurchaseBills);
router.post('/bills', purchaseController.createPurchaseBill);

// Goods Receiving (GRN)
router.get('/grn', purchaseController.getGoodsReceipts);
router.post('/grn', purchaseController.processGoodsReceiving);

// Supplier Payments
router.get('/payments', purchaseController.getSupplierPayments);
router.post('/payments', purchaseController.recordSupplierPayment);

module.exports = router;

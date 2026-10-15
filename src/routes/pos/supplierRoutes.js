const express = require('express');
const router = express.Router();
const supplierController = require('../../controllers/pos/posSupplierController');
const { verifyToken } = require('../../middleware/authMiddleware');

router.use(verifyToken);

router.get('/', supplierController.getSuppliers);
router.post('/', supplierController.createSupplier);
router.get('/:id', supplierController.getSupplierById);
router.put('/:id', supplierController.updateSupplier);
router.delete('/:id', supplierController.deleteSupplier);

module.exports = router;

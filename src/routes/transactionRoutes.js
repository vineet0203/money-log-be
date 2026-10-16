const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const transactionController = require('../controllers/transactionController');
const { verifyToken } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
  createTransactionSchema,
  updateTransactionSchema,
  transactionIdParamSchema,
  listTransactionsQuerySchema,
} = require('../validations/transactions/transactionValidation');

const { getUploadMiddleware } = require('../services/storageService');

// Configure single storage boundary upload middleware (§7)
const upload = getUploadMiddleware('receipts', 5);

router.use(verifyToken);

router.get('/stats', transactionController.getStats);
router.get('/', validate(listTransactionsQuerySchema), transactionController.getTransactions);
router.post('/', upload.single('receipt'), validate(createTransactionSchema), transactionController.createTransaction);
router.get('/:id', validate(transactionIdParamSchema), transactionController.getTransactionById);
router.put('/:id', upload.single('receipt'), validate(updateTransactionSchema), transactionController.updateTransaction);
router.delete('/:id', validate(transactionIdParamSchema), transactionController.deleteTransaction);

module.exports = router;

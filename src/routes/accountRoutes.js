const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');
const { verifyToken } = require('../middleware/authMiddleware');

router.use(verifyToken);

router.get('/', accountController.getAccounts);
router.post('/', accountController.addAccount);
router.put('/:id', accountController.updateAccount);
router.delete('/:id', accountController.deleteAccount);

// Get specific account transaction details by local ID
router.get('/transactions/:txnId', verifyToken, accountController.getAccountTransactionById);

// Get paginated transactions for a specific account
router.get('/:id/transactions', verifyToken, accountController.getAccountTransactions);

module.exports = router;

const express = require('express');
const router = express.Router();
const plaidController = require('../controllers/plaidController');
const { verifyToken } = require('../middleware/authMiddleware');

// Ensure users are authenticated before they can connect a bank account
router.use(verifyToken);

// Route to create a link token (called when launching Plaid Link)
router.post('/create-link-token', plaidController.createLinkToken);

// Route to exchange the public token (called after successful Plaid Link)
router.post('/exchange-public-token', plaidController.exchangePublicToken);

// Route to get all linked banks for the user
router.get('/items', plaidController.getPlaidItems);

// Route to disconnect a linked bank
router.delete('/items/:itemId', plaidController.removePlaidItem);

// Route to sync account balance
router.post('/sync-balance', plaidController.syncBalance);

// Route to sync all transactions
router.post('/sync-transactions', plaidController.syncAllTransactions);

module.exports = router;

const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Plaid Webhook route (Unauthenticated since it is called by Plaid's servers)
router.post('/', webhookController.handlePlaidWebhook);

module.exports = router;

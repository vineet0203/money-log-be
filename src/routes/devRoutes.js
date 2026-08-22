const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const devController = require('../controllers/devController');

router.use(verifyToken);

router.post('/fire-webhook', devController.fireWebhook);

module.exports = router;

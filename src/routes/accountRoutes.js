const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');
const { verifyToken } = require('../middleware/authMiddleware');

router.use(verifyToken);

router.get('/', accountController.getAccounts);
router.post('/', accountController.addAccount);
router.put('/:id', accountController.updateAccount);
router.delete('/:id', accountController.deleteAccount);

module.exports = router;

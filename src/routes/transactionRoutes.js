const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const transactionController = require('../controllers/transactionController');
const { verifyToken } = require('../middleware/authMiddleware');

// Configure multer for local storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
})
const upload = multer({ storage: storage })

router.use(verifyToken);

router.get('/stats', transactionController.getStats);
router.get('/', transactionController.getTransactions);
router.post('/', upload.single('receipt'), transactionController.createTransaction);
router.get('/:id', transactionController.getTransactionById);

module.exports = router;

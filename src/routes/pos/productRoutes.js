const express = require('express');
const router = express.Router();
const multer = require('multer');
const productController = require('../../controllers/pos/posProductController');
const { verifyToken } = require('../../middleware/authMiddleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

router.use(verifyToken);

// Scan lookup must come before /:id param route
router.get('/scan/:code', productController.scanProduct);

// Bulk Import & Export routes (must precede /:id)
router.get('/export', productController.exportProducts);
router.post('/import', upload.single('file'), productController.importProducts);

// Product CRUD with pagination & filters
router.get('/', productController.getProducts);
router.post('/', productController.createProduct);
router.get('/:id', productController.getProductById);
router.put('/:id', productController.updateProduct);
router.delete('/:id', productController.deleteProduct);

module.exports = router;

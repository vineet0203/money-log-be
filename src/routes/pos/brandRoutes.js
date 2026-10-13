const express = require('express');
const router = express.Router();
const brandController = require('../../controllers/pos/posBrandController');
const { verifyToken } = require('../../middleware/authMiddleware');

router.use(verifyToken);

router.get('/', brandController.getBrands);
router.post('/', brandController.createBrand);
router.delete('/:id', brandController.deleteBrand);

module.exports = router;

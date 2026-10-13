const express = require('express');
const router = express.Router();

const categoryRoutes = require('./categoryRoutes');
const brandRoutes = require('./brandRoutes');
const productRoutes = require('./productRoutes');
const settingsRoutes = require('./settingsRoutes');

// Mount standalone POS sub-resources
router.use('/categories', categoryRoutes);
router.use('/brands', brandRoutes);
router.use('/products', productRoutes);
router.use('/settings', settingsRoutes);

module.exports = router;

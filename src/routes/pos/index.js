const express = require('express');
const router = express.Router();

const categoryRoutes = require('./categoryRoutes');
const brandRoutes = require('./brandRoutes');
const productRoutes = require('./productRoutes');
const settingsRoutes = require('./settingsRoutes');
const orderRoutes = require('./orderRoutes');
const returnRoutes = require('./returnRoutes');

// Mount standalone POS sub-resources
router.use('/categories', categoryRoutes);
router.use('/brands', brandRoutes);
router.use('/products', productRoutes);
router.use('/settings', settingsRoutes);
router.use('/orders', orderRoutes);
router.use('/returns', returnRoutes);

module.exports = router;

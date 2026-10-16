const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken } = require('../middleware/authMiddleware');

const { getUploadMiddleware } = require('../services/storageService');

const upload = getUploadMiddleware('profiles', 5);

router.get('/profile', verifyToken, userController.getProfile);
router.put('/profile', verifyToken, upload.single('profile_image'), userController.updateProfile);
router.put('/push-token', verifyToken, userController.updatePushToken);

module.exports = router;

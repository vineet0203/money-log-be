const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { updateProfileSchema, pushTokenSchema } = require('../validations/users/userValidation');

const { getUploadMiddleware } = require('../services/storageService');

const upload = getUploadMiddleware('profiles', 5);

router.get('/profile', verifyToken, userController.getProfile);
router.put('/profile', verifyToken, upload.single('profile_image'), validate(updateProfileSchema), userController.updateProfile);
router.put('/push-token', verifyToken, validate(pushTokenSchema), userController.updatePushToken);

module.exports = router;

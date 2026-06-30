const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const userController = require('../controllers/userController');
const { verifyToken } = require('../middleware/authMiddleware');

// Setup multer for profile image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, req.user.id + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

router.get('/profile', verifyToken, userController.getProfile);
router.put('/profile', verifyToken, upload.single('profile_image'), userController.updateProfile);
router.put('/push-token', verifyToken, userController.updatePushToken);

module.exports = router;

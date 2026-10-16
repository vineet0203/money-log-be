const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { verifyToken } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
} = require('../validations/notifications/notificationValidation');

router.use(verifyToken);

router.get('/unread-count', notificationController.getUnreadCount);
router.get('/', validate(listNotificationsQuerySchema), notificationController.getNotifications);
router.put('/read-all', notificationController.markAllAsRead);
router.put('/:id/read', validate(notificationIdParamSchema), notificationController.markAsRead);
router.delete('/:id', validate(notificationIdParamSchema), notificationController.deleteNotification);

module.exports = router;

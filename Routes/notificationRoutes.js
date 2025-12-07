const express = require('express');
const router = express.Router();
const {
  getNotifications,
  markAsRead,
  deleteNotification,
  clearAllNotifications,
  createNotification
} = require('../Controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect); // Protect all routes

router.get('/', getNotifications);
router.post('/', createNotification); // Optional: for testing or admin use
router.put('/:id/read', markAsRead);
router.delete('/:id', deleteNotification);
router.delete('/', clearAllNotifications);

module.exports = router;

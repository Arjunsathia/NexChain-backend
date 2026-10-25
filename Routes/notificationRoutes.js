const express = require("express");
const router = express.Router();
const {
  getNotifications,
  markAsRead,
  deleteNotification,
  clearAllNotifications,
  createNotification,
} = require("../Controllers/notificationController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

router.use(protect); // Protect all routes

router.get("/", getNotifications);
router.post("/", adminOnly, createNotification);
router.put("/:id/read", markAsRead);
router.delete("/:id", deleteNotification);
router.delete("/", clearAllNotifications);

module.exports = router;

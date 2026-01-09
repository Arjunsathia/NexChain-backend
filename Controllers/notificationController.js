const Notification = require("../Models/Notification");
const User = require("../Models/userModel");

// Helper to get user _id from req.user.id (UUID)
const getUserMongoId = async (uuid) => {
  const user = await User.findOne({ id: uuid });
  return user ? user._id : null;
};

// Get all notifications for a user
exports.getNotifications = async (req, res) => {
  try {
    const userId = await getUserMongoId(req.user.id);
    if (!userId) return res.status(404).json({ message: "User not found" });

    const notifications = await Notification.find({ user: userId }).sort({
      createdAt: -1,
    }); // Newest first
    res.status(200).json(notifications);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching notifications", error: error.message });
  }
};

// Mark a notification as read
exports.markAsRead = async (req, res) => {
  try {
    const userId = await getUserMongoId(req.user.id);
    if (!userId) return res.status(404).json({ message: "User not found" });

    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: userId },
      { isRead: true },
      { new: true },
    );
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
    res.status(200).json(notification);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error updating notification", error: error.message });
  }
};

// Delete a single notification
exports.deleteNotification = async (req, res) => {
  try {
    const userId = await getUserMongoId(req.user.id);
    if (!userId) return res.status(404).json({ message: "User not found" });

    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      user: userId,
    });
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
    res.status(200).json({ message: "Notification deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error deleting notification", error: error.message });
  }
};

// Clear all notifications for a user
exports.clearAllNotifications = async (req, res) => {
  try {
    const userId = await getUserMongoId(req.user.id);
    if (!userId) return res.status(404).json({ message: "User not found" });

    await Notification.deleteMany({ user: userId });
    res.status(200).json({ message: "All notifications cleared successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error clearing notifications", error: error.message });
  }
};

// Create a notification (Internal use or Admin)
exports.createNotification = async (req, res) => {
  try {
    const { title, message, type, userId } = req.body;

    let targetUserId = userId;

    // If no specific userId provided, fallback to current user (if found)
    if (!targetUserId) {
      const currentUser = await getUserMongoId(req.user.id);
      if (currentUser) targetUserId = currentUser;
    }

    const newNotification = new Notification({
      user: targetUserId,
      title,
      message,
      type: type || "info",
    });

    await newNotification.save();
    res.status(201).json(newNotification);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error creating notification", error: error.message });
  }
};

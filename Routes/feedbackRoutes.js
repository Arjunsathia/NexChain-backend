const express = require("express");
const {
  submitFeedback,
  getFeedback,
  getFeedbackById,
  updateFeedback,
  getFeedbackStats,
  deleteFeedback,
} = require("../Controllers/feedbackController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

// Public route - anyone can submit feedback
router.post("/", submitFeedback);

// Admin routes
router.get("/", protect, adminOnly, getFeedback);
router.get("/stats", protect, adminOnly, getFeedbackStats);
router.get("/:id", protect, adminOnly, getFeedbackById);
router.put("/:id", protect, adminOnly, updateFeedback);
router.delete("/:id", protect, adminOnly, deleteFeedback);

module.exports = router;

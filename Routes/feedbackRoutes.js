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
const { feedbackLimiter } = require("../middleware/rateLimiters");
const validate = require("../middleware/validation");
const schemas = require("../utils/validationSchemas");

const router = express.Router();

// Public route - anyone can submit feedback (rate limited and validated)
router.post("/", feedbackLimiter, validate(schemas.feedback), submitFeedback);

// Admin routes
router.get("/", protect, adminOnly, getFeedback);
router.get("/stats", protect, adminOnly, getFeedbackStats);
router.get("/:id", protect, adminOnly, getFeedbackById);
router.put("/:id", protect, adminOnly, updateFeedback);
router.delete("/:id", protect, adminOnly, deleteFeedback);

module.exports = router;

const express = require("express");
const router = express.Router();
const chatController = require("../Controllers/chatController");
const { protect } = require("../middleware/authMiddleware");
const { chatLimiter } = require("../middleware/rateLimiters");

router.post("/", protect, chatLimiter, chatController.chat);

module.exports = router;

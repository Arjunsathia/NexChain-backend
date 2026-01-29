const express = require("express");
const router = express.Router();
const chatController = require("../Controllers/chatController");
const rateLimit = require("express-rate-limit");

// Rate limiting: 5 requests per minute per IP
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 5, 
  message: { success: false, message: "Too many requests, please try again later." }
});

router.post("/", chatLimiter, chatController.chat);

module.exports = router;

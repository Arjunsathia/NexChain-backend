const express = require("express");
const router = express.Router();
const { rateLimit } = require("express-rate-limit");
const { 
  register, 
  verifyEmailOTP, 
  login, 
  refresh,
  setupTOTP, 
  verifyTOTP 
} = require("../Controllers/authController");
const { protect } = require("../middleware/authMiddleware");

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { message: "Too many requests. Please try again after 10 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/register", register);
router.post("/verify-email-otp", otpLimiter, verifyEmailOTP);
router.post("/login", login);
router.post("/refresh", refresh);
router.get("/setup-totp", protect, setupTOTP);
router.post("/verify-totp", protect, verifyTOTP);

module.exports = router;

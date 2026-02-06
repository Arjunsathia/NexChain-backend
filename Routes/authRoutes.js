const express = require("express");
const router = express.Router();
const { rateLimit } = require("express-rate-limit");
const {
  register,
  verifyEmailOTP,
  login,
  googleLogin,
  refresh,
  setupTOTP,
  verifyTOTP,
  resendOTP,
  forgotPassword,
  resetPassword,
  logout
} = require("../Controllers/authController");
const { protect } = require("../middleware/authMiddleware");

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 100, // Relaxed for dev
  message: { message: "Too many requests. Please try again after 10 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});


const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Relaxed for dev
  message: { message: "Too many login attempts, please try again after 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

const validate = require("../middleware/validation");
const schemas = require("../utils/validationSchemas");

router.post("/register", validate(schemas.register), register);
router.post("/verify-email-otp", otpLimiter, validate(schemas.verifyEmail), verifyEmailOTP);
router.post("/login", loginLimiter, validate(schemas.login), login);
router.post("/google", googleLogin);
router.post("/refresh", refresh);

router.get("/setup-totp", protect, setupTOTP);
router.post("/verify-totp", protect, verifyTOTP);

// New Routes
router.post("/resend-otp", otpLimiter, validate(schemas.resendOTP), resendOTP);
router.post("/forgot-password", loginLimiter, validate(schemas.forgotPassword), forgotPassword);
router.post("/reset-password", loginLimiter, validate(schemas.resetPassword), resetPassword);
router.post("/logout", logout);

module.exports = router;

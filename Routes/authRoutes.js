const express = require("express");
const router = express.Router();
const {
  register,
  verifyEmailOTP,
  login,
  googleLogin,
  refresh,
  setup2FA,
  verify2FA,
  resendOTP,
  forgotPassword,
  resetPassword,
  logout,
} = require("../Controllers/authController");
const { protect } = require("../middleware/authMiddleware");
const {
  loginLimiter,
  otpLimiter,
  passwordResetLimiter,
  googleLimiter,
  refreshLimiter,
} = require("../middleware/rateLimiters");
const validate = require("../middleware/validation");
const schemas = require("../utils/validationSchemas");

router.post("/register", otpLimiter, validate(schemas.register), register);
router.post("/verify-email-otp", otpLimiter, validate(schemas.verifyEmail), verifyEmailOTP);
router.post("/resend-otp", otpLimiter, validate(schemas.resendOTP), resendOTP);
router.post("/login", loginLimiter, validate(schemas.login), login);
router.post("/google", googleLimiter, googleLogin);
router.post("/refresh", refreshLimiter, refresh);
router.post("/logout", logout);

router.post("/forgot-password", passwordResetLimiter, validate(schemas.forgotPassword), forgotPassword);
router.post("/reset-password", passwordResetLimiter, validate(schemas.resetPassword), resetPassword);

// Admin settings page (same flow as /api/2fa)
router.get("/setup-totp", protect, setup2FA);
router.post("/verify-totp", protect, verify2FA);

module.exports = router;

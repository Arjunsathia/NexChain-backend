const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

// Tests exercise these flows far faster than any real user
const skip = () => process.env.NODE_ENV === "test";

const limiter = (windowMinutes, max, message, keyGenerator) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    message: { success: false, message, error: message },
    standardHeaders: true,
    legacyHeaders: false,
    skip,
    ...(keyGenerator ? { keyGenerator } : {}),
  });

// Per IP *and* account, so one attacker can't lock everyone else out of logging in
const loginLimiter = limiter(
  15,
  10,
  "Too many login attempts, please try again after 15 minutes",
  (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email || "").toLowerCase()}`,
);

const otpLimiter = limiter(10, 5, "Too many requests. Please try again after 10 minutes.");
const passwordResetLimiter = limiter(15, 5, "Too many password reset requests, please try again later");
const googleLimiter = limiter(15, 30, "Too many sign-in attempts, please try again later");
const refreshLimiter = limiter(15, 120, "Too many requests, please try again later");

// Per user after `protect`; the chatbot calls a paid API
const chatLimiter = limiter(1, 10, "Too many requests, please try again later.", (req) =>
  req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip),
);

module.exports = {
  loginLimiter,
  otpLimiter,
  passwordResetLimiter,
  googleLimiter,
  refreshLimiter,
  chatLimiter,
};

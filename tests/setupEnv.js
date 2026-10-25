// Set before server.js loads so config/env.js validation passes and dotenv
// (which never overrides existing vars) can't point tests at a real database.
process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://placeholder-overridden-by-tests";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.JWT_REFRESH_SECRET = "test-jwt-refresh-secret";
process.env.OTP_SECRET = "test-otp-secret";
process.env.TOTP_ENC_KEY = "test-totp-enc-key";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.GEMINI_API_KEY = "test";
process.env.EMAIL_USER = "test@example.com";
process.env.EMAIL_PASS = "test";
process.env.GOOGLE_CLIENT_ID = "test";
process.env.CRYPTO_COMPARE_API_KEY = "test";
process.env.SUPPORT_EMAIL = "support@example.com";

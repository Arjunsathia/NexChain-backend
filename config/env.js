// Required vars stop the server; optional ones only disable a feature.
const REQUIRED = ["MONGO_URI", "JWT_SECRET", "JWT_REFRESH_SECRET", "OTP_SECRET", "TOTP_ENC_KEY"];

const OPTIONAL = {
  CLIENT_URL: "email links and CORS will not point at the frontend",
  GEMINI_API_KEY: "AI chat disabled",
  EMAIL_USER: "emails (OTP, alerts) will fail",
  EMAIL_PASS: "emails (OTP, alerts) will fail",
  GOOGLE_CLIENT_ID: "Google login disabled",
  CRYPTO_COMPARE_API_KEY: "news uses the unauthenticated rate limit",
  SUPPORT_EMAIL: "support requests go to EMAIL_USER",
};

const validateEnv = () => {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
    console.error("[ENV     ] ❌ JWT_SECRET and JWT_REFRESH_SECRET must be different");
    process.exit(1);
  }

  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`[ENV     ] ❌ Missing required variables: ${missing.join(", ")}`);
    console.error("[ENV     ]    Copy .env.example to .env and fill them in.");
    process.exit(1);
  }

  for (const [key, effect] of Object.entries(OPTIONAL)) {
    if (!process.env[key]) console.warn(`[ENV     ] ⚠️  ${key} not set: ${effect}`);
  }
};

module.exports = validateEnv;

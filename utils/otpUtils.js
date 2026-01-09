const crypto = require("crypto");

/**
 * Generates a secure 6-digit OTP.
 */
const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};

/**
 * Hashes an OTP using HMAC-SHA256.
 * @param {string} otp
 * @param {string} secret
 */
const hashOTP = (otp, secret) => {
  return crypto.createHmac("sha256", secret).update(otp).digest("hex");
};

module.exports = {
  generateOTP,
  hashOTP,
};

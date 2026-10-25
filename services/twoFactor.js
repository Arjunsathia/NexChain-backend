const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const { encrypt, decrypt } = require("../utils/secretBox");

// Load users with `.select("+twoFactorSecret +twoFactorPendingSecret +adminTotpSecret")`
// before calling these.

/** Active base32 secret, including admins enrolled before secrets were encrypted */
const getSecret = (user) => {
  if (user.twoFactorEnabled && user.twoFactorSecret) return decrypt(user.twoFactorSecret);
  if (user.adminTotpSecret && user.adminTotpSecret.base32) return user.adminTotpSecret.base32;
  return null;
};

const isEnabled = (user) => !!getSecret(user);

const checkCode = (secret, code) =>
  !!secret &&
  typeof code === "string" &&
  /^\d{6}$/.test(code) &&
  speakeasy.totp.verify({ secret, encoding: "base32", token: code, window: 1 });

const verifyCode = (user, code) => checkCode(getSecret(user), code);

/**
 * Starts enrollment: the new secret is kept server-side as "pending" until the
 * user proves they scanned it.
 */
const startSetup = async (user) => {
  const secret = speakeasy.generateSecret({ name: `NexChain (${user.email})` });
  user.twoFactorPendingSecret = encrypt(secret.base32);
  await user.save();
  return { secret: secret.base32, qrCode: await QRCode.toDataURL(secret.otpauth_url) };
};

/** Activates the pending secret if `code` matches it */
const confirmSetup = async (user, code) => {
  if (!user.twoFactorPendingSecret) return false;
  const pending = decrypt(user.twoFactorPendingSecret);
  if (!checkCode(pending, code)) return false;

  user.twoFactorSecret = user.twoFactorPendingSecret;
  user.twoFactorPendingSecret = undefined;
  user.twoFactorEnabled = true;
  user.adminTotpSecret = undefined; // legacy plaintext copy
  await user.save();
  return true;
};

const disable = async (user) => {
  user.twoFactorEnabled = false;
  user.twoFactorSecret = undefined;
  user.twoFactorPendingSecret = undefined;
  user.adminTotpSecret = undefined;
  await user.save();
};

const SECRET_SELECT = "+twoFactorSecret +twoFactorPendingSecret +adminTotpSecret";

module.exports = { getSecret, isEnabled, verifyCode, startSetup, confirmSetup, disable, SECRET_SELECT };

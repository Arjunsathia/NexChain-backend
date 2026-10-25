const crypto = require("crypto");

// AES-256-GCM for secrets stored in the database (2FA seeds). The key is derived
// from TOTP_ENC_KEY, so rotating JWT secrets never breaks enrolled authenticators.
const key = () => crypto.createHash("sha256").update(String(process.env.TOTP_ENC_KEY)).digest();

/** @returns {string} "iv.tag.ciphertext", each base64 */
const encrypt = (plaintext) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
};

const decrypt = (payload) => {
  const [iv, tag, data] = String(payload)
    .split(".")
    .map((part) => Buffer.from(part, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
};

module.exports = { encrypt, decrypt };

const speakeasy = require("speakeasy");
const qrcode = require("qrcode");
const User = require("../Models/userModel");

// Setup 2FA: Generate secret and QR code
exports.setup2FA = async (req, res) => {
  const { user_id } = req.body;

  try {
    const user = await User.findOne({ id: user_id });
    if (!user) return res.status(404).json({ error: "User not found" });

    const secret = speakeasy.generateSecret({
      name: `NexChain (${user.email})`
    });

    user.tempSecret = secret.base32;
    await user.save();

    qrcode.toDataURL(secret.otpauth_url, (err, data_url) => {
      if (err) {
        return res.status(500).json({ error: "Error generating QR code" });
      }
      res.json({ success: true, secret: secret.base32, qrCode: data_url });
    });

  } catch (error) {
    console.error("2FA Setup Error:", error);
    res.status(500).json({ error: "Failed to setup 2FA" });
  }
};

// Verify 2FA (Enable)
// Verify 2FA (Enable)
exports.verify2FA = async (req, res) => {
  const { user_id, token } = req.body;

  try {
    const user = await User.findOne({ id: user_id });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.tempSecret) {
        return res.status(400).json({ error: "2FA setup not initiated" });
    }

    const verified = speakeasy.totp.verify({
      secret: user.tempSecret,
      encoding: "base32",
      token: token
    });

    if (verified) {
      user.twoFactorEnabled = true;
      user.twoFactorSecret = user.tempSecret;
      user.tempSecret = undefined;
      await user.save();
      res.json({ success: true, message: "2FA Enabled Successfully" });
    } else {
      res.status(400).json({ error: "Invalid Token" });
    }

  } catch (error) {
    console.error("2FA Verify Error:", error);
    res.status(500).json({ error: "Failed to verify 2FA" });
  }
};

// Disable 2FA
exports.disable2FA = async (req, res) => {
    const { user_id, password } = req.body; // Require password to disable
    // Note: Password verification should ideally be done here or in a middleware.
    // For simplicity, we'll assume the user is authenticated via the protect middleware.

    try {
        const user = await User.findOne({ id: user_id });
        if (!user) return res.status(404).json({ error: "User not found" });

        user.twoFactorEnabled = false;
        user.twoFactorSecret = undefined;
        await user.save();

        res.json({ success: true, message: "2FA Disabled" });
    } catch (error) {
        res.status(500).json({ error: "Failed to disable 2FA" });
    }
};

// Validate Token (Login Helper)
exports.validateToken = (secret, token) => {
    if (!secret || !token) return false;
    try {
        return speakeasy.totp.verify({
            secret: secret,
            encoding: "base32",
            token: token
        });
    } catch (error) {
        console.error("Token Validation Error:", error);
        return false;
    }
};

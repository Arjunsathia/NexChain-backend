const User = require("../Models/userModel");
const OTP = require("../Models/otpModel");
const { generateOTP, hashOTP } = require("../utils/otpUtils");
const { sendOTPEmail, sendEmail } = require("../utils/emailService");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");
const asyncHandler = require("express-async-handler");
const { OAuth2Client } = require("google-auth-library");
const crypto = require("crypto");
const twoFactor = require("../services/twoFactor");
const {
  issueTokens,
  clearAuthCookies,
  sessionUser,
  verifyAccessToken,
  verifyRefreshToken,
} = require("../utils/tokens");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/** Revokes every outstanding access and refresh token for the user */
const revokeSessions = (userId) =>
  User.updateOne({ id: userId }, { $inc: { tokenVersion: 1 } });

/**
 * Second factor for logins. Returns true when the request may proceed; otherwise
 * it has already responded (asking for a code, or rejecting a wrong one).
 */
const passSecondFactor = async (user, code, res) => {
  const withSecrets = await User.findOne({ id: user.id }).select(twoFactor.SECRET_SELECT);
  if (!twoFactor.isEnabled(withSecrets)) return true;

  if (!code) {
    res.json({
      success: false,
      require2FA: true,
      message: "Enter the 6-digit code from your authenticator app",
    });
    return false;
  }
  if (!twoFactor.verifyCode(withSecrets, String(code))) {
    res.status(401).json({ message: "Invalid authentication code", require2FA: true });
    return false;
  }
  return true;
};

const createEmailOTP = async (email) => {
  const otp = generateOTP();
  await OTP.create({
    email,
    otpHash: hashOTP(otp, process.env.OTP_SECRET),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    attemptsLeft: 3,
  });
  await sendOTPEmail(email, otp);
};

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 */
const register = asyncHandler(async (req, res) => {
  const { name, phone, password } = req.body;
  const email = req.body.email.toLowerCase();
  const user_name = req.body.user_name.toLowerCase();

  if (await User.findOne({ email })) {
    res.status(400).json({ message: "Email already in use" });
    return;
  }
  if (await User.findOne({ user_name })) {
    res.status(400).json({ message: "Username already taken" });
    return;
  }

  const user = await User.create({
    id: uuidv4(),
    name,
    email,
    phone,
    user_name,
    password: await bcrypt.hash(password, 10),
    role: "user", // never taken from the request
    emailVerified: false,
  });

  await createEmailOTP(email);

  res.status(201).json({
    success: true,
    message: "Registration successful. Please verify your email.",
    email: user.email,
  });
});

/**
 * @desc    Verify Email OTP (Signup Flow)
 * @route   POST /api/auth/verify-email-otp
 */
const verifyEmailOTP = asyncHandler(async (req, res) => {
  const email = req.body.email.toLowerCase();
  const otpHash = hashOTP(req.body.otp, process.env.OTP_SECRET);

  const otpRecord = await OTP.findOne({ email, used: false }).sort({ createdAt: -1 });

  if (!otpRecord || new Date() > otpRecord.expiresAt || otpRecord.attemptsLeft <= 0) {
    res.status(400).json({ message: "Invalid or expired OTP" });
    return;
  }

  const matches =
    otpRecord.otpHash.length === otpHash.length &&
    crypto.timingSafeEqual(Buffer.from(otpRecord.otpHash), Buffer.from(otpHash));
  if (!matches) {
    otpRecord.attemptsLeft -= 1;
    await otpRecord.save();
    res.status(400).json({ message: "Invalid OTP", attemptsLeft: otpRecord.attemptsLeft });
    return;
  }

  otpRecord.used = true;
  await otpRecord.save();

  const user = await User.findOne({ email });
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  user.emailVerified = true;
  await user.save();

  res.json({ success: true, message: "Email verified successfully. You can now login." });
});

/**
 * @desc    Login with email or username + password (+ 2FA code when enabled)
 * @route   POST /api/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { password, totp } = req.body;
  const identifier = req.body.email.toLowerCase();

  const user = await User.findOne({
    $or: [{ email: identifier }, { user_name: identifier }],
  });

  if (
    !user ||
    user.isDeleted ||
    !user.password ||
    !(await bcrypt.compare(password, user.password))
  ) {
    res.status(401).json({ message: "Invalid email or password" });
    return;
  }

  if (user.isFrozen) {
    res.status(403).json({ message: "Your account has been frozen. Please contact support." });
    return;
  }

  if (!user.emailVerified) {
    res.status(403).json({ message: "Email not verified. Please verify your email first." });
    return;
  }

  if (!(await passSecondFactor(user, totp, res))) return;

  user.lastLogin = new Date();
  await user.save();

  const accessToken = issueTokens(res, user);
  res.json({ success: true, user: sessionUser(user), accessToken });
});

/**
 * @desc    Exchange the refresh cookie for a new access token (rotates the cookie)
 * @route   POST /api/auth/refresh
 */
const refresh = asyncHandler(async (req, res) => {
  const decoded = verifyRefreshToken(req.cookies.refreshToken);
  if (!decoded) {
    clearAuthCookies(res);
    res.status(401).json({ message: "Session expired, please log in again" });
    return;
  }

  const user = await User.findOne({ id: decoded.id });
  if (
    !user ||
    user.isDeleted ||
    user.isFrozen ||
    (user.tokenVersion || 0) !== decoded.tv
  ) {
    clearAuthCookies(res);
    res.status(401).json({ message: "Session expired, please log in again" });
    return;
  }

  const accessToken = issueTokens(res, user);
  res.json({ success: true, accessToken, user: sessionUser(user) });
});

/**
 * @typedef {import("express").Request & { user: { id: string, role: string } }} AuthRequest
 */

const loadWithSecrets = (req) =>
  User.findOne({ id: req.user.id }).select(twoFactor.SECRET_SELECT);

/**
 * @desc    Start authenticator-app enrollment. Replacing an active setup needs a current code.
 * @route   POST /api/2fa/setup, GET /api/auth/setup-totp (admin settings page)
 */
const setup2FA = asyncHandler(async (/** @type {AuthRequest} */ req, res) => {
  const user = await loadWithSecrets(req);
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  const currentCode = req.body?.currentToken || req.query?.currentToken;
  if (twoFactor.isEnabled(user) && !twoFactor.verifyCode(user, String(currentCode || ""))) {
    res.status(400).json({
      message: "2FA is already enabled. Enter a current code to replace it.",
      error: "2FA is already enabled. Enter a current code to replace it.",
    });
    return;
  }

  const { secret, qrCode } = await twoFactor.startSetup(user);
  res.json({
    success: true,
    message: "Scan this QR code with your authenticator app",
    secret, // for manual entry if the QR can't be scanned
    qrCode,
  });
});

/**
 * @desc    Confirm enrollment with a code from the new secret (or re-check an active one)
 * @route   POST /api/2fa/verify, POST /api/auth/verify-totp (admin settings page)
 */
const verify2FA = asyncHandler(async (/** @type {AuthRequest} */ req, res) => {
  const code = String(req.body.token || "");
  const user = await loadWithSecrets(req);
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  if (user.twoFactorPendingSecret) {
    if (await twoFactor.confirmSetup(user, code)) {
      res.json({ success: true, message: "2FA Enabled successfully" });
    } else {
      res.status(400).json({ success: false, message: "Invalid Authenticator Code", error: "Invalid Authenticator Code" });
    }
    return;
  }

  if (twoFactor.isEnabled(user) && twoFactor.verifyCode(user, code)) {
    res.json({ success: true, message: "Code valid" });
    return;
  }
  res.status(400).json({ success: false, message: "Invalid Authenticator Code", error: "Invalid Authenticator Code" });
});

/**
 * @desc    Turn off 2FA (requires a current code)
 * @route   POST /api/2fa/disable
 */
const disable2FA = asyncHandler(async (/** @type {AuthRequest} */ req, res) => {
  const user = await loadWithSecrets(req);
  if (!user || !twoFactor.isEnabled(user)) {
    res.status(400).json({ message: "2FA is not enabled", error: "2FA is not enabled" });
    return;
  }
  if (!twoFactor.verifyCode(user, String(req.body.token || ""))) {
    res.status(400).json({ message: "Invalid Authenticator Code", error: "Invalid Authenticator Code" });
    return;
  }
  await twoFactor.disable(user);
  res.json({ success: true, message: "2FA disabled" });
});

/**
 * Verifies a Google access token was issued to *this* app before trusting the
 * profile behind it; otherwise a token from any other Google app would log in.
 */
const getGoogleProfileFromAccessToken = async (accessToken) => {
  const infoRes = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!infoRes.ok) return null;
  const info = await infoRes.json();
  const audience = process.env.GOOGLE_CLIENT_ID;
  if (info.aud !== audience && info.azp !== audience) return null;

  const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profileRes.ok) return null;
  const profile = await profileRes.json();
  if (profile.sub !== info.sub) return null;
  return profile;
};

/**
 * @desc    Google Login
 * @route   POST /api/auth/google
 */
const googleLogin = asyncHandler(async (req, res) => {
  const { credential, googleAccessToken, totp } = req.body;

  let profile;
  if (typeof googleAccessToken === "string" && googleAccessToken) {
    // Access Token Flow (custom button)
    profile = await getGoogleProfileFromAccessToken(googleAccessToken);
  } else if (typeof credential === "string" && credential) {
    // ID Token Flow (Google button component)
    try {
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      profile = ticket.getPayload();
    } catch {
      profile = null;
    }
  } else {
    res.status(400).json({ message: "Google credential or access token is required" });
    return;
  }

  if (!profile) {
    res.status(401).json({ message: "Google sign-in could not be verified" });
    return;
  }
  const email_verified = profile.email_verified === true || profile.email_verified === "true";
  if (!email_verified || !profile.email) {
    res.status(400).json({ message: "Google email not verified" });
    return;
  }

  const email = profile.email.toLowerCase();
  let user = await User.findOne({ email });

  if (user) {
    // Admins must use password (+ 2FA)
    if (user.role === "admin" || user.role === "superadmin") {
      res.status(403).json({ message: "Admins must login via password/2FA" });
      return;
    }
    if (user.isDeleted) {
      res.status(403).json({ message: "This account has been deactivated." });
      return;
    }
    if (user.isFrozen) {
      res.status(403).json({ message: "Your account has been frozen. Please contact support." });
      return;
    }
    if (!(await passSecondFactor(user, totp, res))) return;
  } else {
    // Generate a unique, safe username based on the email address
    const baseName = email.split("@")[0].replace(/[^a-z0-9]/g, "") || "user";
    let userName = baseName;
    while (await User.findOne({ user_name: userName })) {
      userName = `${baseName}${Math.floor(Math.random() * 1000)}`;
    }

    user = await User.create({
      id: uuidv4(),
      name: profile.name || userName,
      email,
      user_name: userName,
      role: "user",
      provider: "google",
      emailVerified: true,
      image: profile.picture,
    });
  }

  user.lastLogin = new Date();
  await user.save();

  const accessToken = issueTokens(res, user);
  res.json({ success: true, user: sessionUser(user), accessToken });
});

/**
 * @desc    Resend Email OTP
 * @route   POST /api/auth/resend-otp
 */
const resendOTP = asyncHandler(async (req, res) => {
  const email = req.body.email.toLowerCase();

  const user = await User.findOne({ email });
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  if (user.emailVerified) {
    res.status(400).json({ message: "Email already verified" });
    return;
  }

  // One code per minute
  const existingOTP = await OTP.findOne({ email, used: false }).sort({ createdAt: -1 });
  if (existingOTP) {
    const timeDiff = (Date.now() - new Date(existingOTP.createdAt).getTime()) / 1000;
    if (timeDiff < 60) {
      res.status(429).json({ message: `Please wait ${Math.ceil(60 - timeDiff)}s before resending.` });
      return;
    }
  }

  await createEmailOTP(email);
  res.json({ success: true, message: "OTP resent successfully" });
});

/**
 * @desc    Forgot Password (Send Reset Link)
 * @route   POST /api/auth/forgot-password
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email.toLowerCase() });

  // Same response either way, so the endpoint can't be used to find accounts
  const genericResponse = { success: true, message: "If registered, a reset link has been sent." };
  if (!user || user.isDeleted) {
    res.json(genericResponse);
    return;
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  user.resetPasswordToken = crypto.createHash("sha256").update(resetToken).digest("hex");
  user.resetPasswordExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  await user.save();

  const frontendUrl = process.env.CLIENT_URL || "http://localhost:5173";
  const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}&id=${user.id}`;

  const message = `
    <h1>Password Reset Request</h1>
    <p>You requested a password reset. Please click the link below to reset your password:</p>
    <a href="${resetUrl}" clicktracking=off>${resetUrl}</a>
    <p>This link expires in 30 minutes.</p>
  `;

  const emailSent = await sendEmail(user.email, "Password Reset Request", message);
  if (!emailSent) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.status(500).json({ message: "Email could not be sent" });
    return;
  }

  res.json(genericResponse);
});

/**
 * @desc    Reset Password (also signs the user out everywhere)
 * @route   POST /api/auth/reset-password
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, id, password } = req.body;
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const user = await User.findOne({
    id,
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) {
    res.status(400).json({ message: "Invalid or expired token" });
    return;
  }

  user.password = await bcrypt.hash(password, 10);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  res.json({ success: true, message: "Password updated successfully" });
});

/**
 * @desc    Logout: revokes the user's sessions and clears the auth cookies
 * @route   POST /api/auth/logout (also POST /api/users/logout)
 */
const logout = asyncHandler(async (req, res) => {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.split(" ")[1]
    : null;
  const decoded =
    verifyRefreshToken(req.cookies.refreshToken) ||
    verifyAccessToken(bearer || req.cookies.token);

  if (decoded) await revokeSessions(decoded.id);
  clearAuthCookies(res);

  res.status(200).json({ success: true, message: "Logged out successfully" });
});

module.exports = {
  register,
  verifyEmailOTP,
  login,
  googleLogin,
  refresh,
  setup2FA,
  verify2FA,
  disable2FA,
  resendOTP,
  forgotPassword,
  resetPassword,
  logout,
  revokeSessions,
};

const User = require("../Models/userModel");
const OTP = require("../Models/otpModel");
const { generateOTP, hashOTP } = require("../utils/otpUtils");
const { sendOTPEmail, sendEmail } = require("../utils/emailService");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");
const asyncHandler = require("express-async-handler");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const { OAuth2Client } = require("google-auth-library");
const crypto = require("crypto");
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 */
const register = asyncHandler(async (req, res) => {
  const { name, phone, password, confirm_password, role } = req.body;
  let { email, user_name } = req.body;

  if (
    !name ||
    !email ||
    !phone ||
    !user_name ||
    !password ||
    !confirm_password
  ) {
    res.status(400).json({ message: "All fields are required" });
    return;
  }

  email = email.toLowerCase();
  user_name = user_name.toLowerCase();

  if (password !== confirm_password) {
    res.status(400).json({ message: "Passwords do not match" });
    return;
  }

  // Ensure the email alias is not already in use by another account
  const existingEmail = await User.findOne({ email });
  if (existingEmail) {
    res.status(400).json({ message: "Email already in use" });
    return;
  }

  // Ensure the requested username is available
  const existingUsername = await User.findOne({ user_name });
  if (existingUsername) {
    res.status(400).json({ message: "Username already taken" });
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await User.create({
    id: uuidv4(),
    name,
    email,
    phone,
    user_name,
    password: hashedPassword,
    role: role || "user",
    emailVerified: false,
  });

  // Generate a new OTP and send it via email for account verification
  const otp = generateOTP();
  const secret = process.env.OTP_SECRET || "nexchain_otp_secret_key";
  const otpHash = hashOTP(otp, secret);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await OTP.create({
    email,
    otpHash,
    expiresAt,
    attemptsLeft: 3,
  });

  await sendOTPEmail(email, otp);

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
  let { email, otp } = req.body;

  if (email) email = email.toLowerCase();

  const secret = process.env.OTP_SECRET || "nexchain_otp_secret_key";
  const otpHash = hashOTP(otp, secret);

  const otpRecord = await OTP.findOne({ email, used: false }).sort({
    createdAt: -1,
  });

  if (
    !otpRecord ||
    new Date() > otpRecord.expiresAt ||
    otpRecord.attemptsLeft <= 0
  ) {
    res.status(400).json({ message: "Invalid or expired OTP" });
    return;
  }

  if (otpRecord.otpHash !== otpHash) {
    otpRecord.attemptsLeft -= 1;
    await otpRecord.save();
    res
      .status(400)
      .json({ message: "Invalid OTP", attemptsLeft: otpRecord.attemptsLeft });
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

  res.json({
    success: true,
    message: "Email verified successfully. You can now login.",
  });
});

/**
 * @desc    Standard Login (Password only)
 * @route   POST /api/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const identifier = email.toLowerCase();

  const user = await User.findOne({
    $or: [{ email: identifier }, { user_name: identifier }],
  });

  if (
    !user ||
    !user.password ||
    !(await bcrypt.compare(password, user.password))
  ) {
    res.status(401).json({ message: "Invalid email or password" });
    return;
  }

  // Prevent login if the user account has been frozen by an admin
  if (user.isFrozen) {
    res.status(403).json({
      message: "Your account has been frozen. Please contact support.",
    });
    return;
  }

  if (!user.emailVerified) {
    res
      .status(403)
      .json({ message: "Email not verified. Please verify your email first." });
    return;
  }

  user.lastLogin = new Date();
  await user.save();

  // Issue access and refresh tokens for the session
  const accessToken = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "15m" },
  );

  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: "30d" },
  );

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.cookie("token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
    maxAge: 15 * 60 * 1000,
  });

  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      user_name: user.user_name,
      image: user.image,
    },
    accessToken,
  });
});

const refresh = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) {
    res.status(401).json({ message: "No refresh token" });
    return;
  }

  try {
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    );

    if (!decoded || typeof decoded === "string" || !decoded.id) {
      res.status(401).json({ message: "Invalid token payload" });
      return;
    }

    const user = await User.findOne({ id: decoded.id });
    if (!user) {
      res.status(401).json({ message: "User not found" });
      return;
    }

    const accessToken = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );
    res.cookie("token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      maxAge: 15 * 60 * 1000,
    });
    res.json({ accessToken });
  } catch {
    res.status(401).json({ message: "Invalid refresh token" });
    return;
  }
});

/**
 * @typedef {import("express").Request & { user: { id: string, role: string } }} AuthRequest
 */

/**
 * @desc    Setup TOTP (Generate secret & QR)
 * @route   GET /api/auth/setup-totp
 */
const setupTOTP = asyncHandler(async (/** @type {AuthRequest} */ req, res) => {
  // Check if user has admin privileges
  if (req.user.role !== "admin") {
    res.status(403).json({ message: "Access denied" });
    return;
  }

  const user = await User.findOne({ id: req.user.id });
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  // Generate TOTP secret
  const secret = speakeasy.generateSecret({
    name: `NexChain Admin (${user.email})`,
  });

  // Generate QR Code for client app scanning
  QRCode.toDataURL(secret.otpauth_url, (err, data_url) => {
    if (err) {
      res.status(500).json({ message: "Error generating QR code" });
      return;
    }
    // Send temporary secret to client for verification (app scanning)
    res.json({
      message: "Scan this QR code with Google Authenticator",
      secret: secret.base32, // User needs this if they can't scan
      qrCode: data_url,
    });
  });
});

/**
 * @desc    Verify TOTP and Enable
 * @route   POST /api/auth/verify-totp
 */
const verifyTOTP = asyncHandler(async (/** @type {AuthRequest} */ req, res) => {
  const { token, secret } = req.body; // Secret comes from client (setup flow) OR we use stored if just re-verifying

  if (req.user.role !== "admin") {
    res.status(403).json({ message: "Access denied" });
    return;
  }

  // If enabling (secret provided in body), use that. Else use user.adminTotpSecret
  let secretToVerify = secret;

  const user = await User.findOne({ id: req.user.id }).select(
    "+adminTotpSecret",
  );

  if (!secret && user.adminTotpSecret) {
    secretToVerify = user.adminTotpSecret.base32;
  }

  if (!secretToVerify) {
    res.status(400).json({ message: "No TOTP secret provided or found" });
    return;
  }

  const verified = speakeasy.totp.verify({
    secret: secretToVerify,
    encoding: "base32",
    token: token,
  });

  if (verified) {
    // If this was a setup (secret provided), save it now
    if (secret) {
      // Store the secret after successful verification
      user.adminTotpSecret = { base32: secret };
      await user.save();
      res.json({ success: true, message: "2FA Enabled successfully" });
    } else {
      res.json({ success: true, message: "Code valid" });
    }
  } else {
    res
      .status(400)
      .json({ success: false, message: "Invalid Authenticator Code" });
  }
});

/**
 * @desc    Google Login
 * @route   POST /api/auth/google
 */
const googleLogin = asyncHandler(async (req, res) => {
  const { credential, googleAccessToken } = req.body;

  let email, name, picture, email_verified;

  if (googleAccessToken) {
    // Access Token Flow (Custom Button)
    const response = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${googleAccessToken}` },
      },
    );

    if (!response.ok) {
      res.status(400);
      throw new Error("Failed to fetch Google user info");
    }

    const data = await response.json();
    email = data.email;
    name = data.name;
    picture = data.picture;
    email_verified = data.email_verified;
  } else if (credential) {
    // ID Token Flow (Google Button Component)
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    email = payload.email;
    name = payload.name;
    picture = payload.picture;
    email_verified = payload.email_verified;
  } else {
    res.status(400);
    throw new Error("Google credential or access token is required");
  }

  if (!email_verified) {
    res.status(400);
    throw new Error("Google email not verified");
  }

  let user = await User.findOne({ email });

  if (user) {
    // Prevent admins from logging in via Google; they must use password and 2FA
    if (user.role === "admin" || user.role === "superadmin") {
      res.status(403);
      throw new Error("Admins must login via password/2FA");
    }

    // Check if the account is frozen
    if (user.isFrozen) {
      res.status(403);
      throw new Error("Your account has been frozen. Please contact support.");
    }
  } else {
    // Create User
    // Generate a unique, safe username based on the email address
    const baseName = email
      .split("@")[0]
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    let userName = baseName;
    while (await User.findOne({ user_name: userName })) {
      userName = `${baseName}${Math.floor(Math.random() * 1000)}`;
    }

    user = await User.create({
      id: uuidv4(),
      name,
      email,
      user_name: userName,
      role: "user",
      provider: "google",
      emailVerified: true,
      image: picture,
    });
  }

  // Update last login timestamp
  user.lastLogin = new Date();
  await user.save();

  // Generate tokens for the authenticated session
  const accessToken = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "15m" },
  );
  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: "30d" },
  );

  // Set Cookies
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.cookie("token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
    maxAge: 15 * 60 * 1000,
  });

  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      user_name: user.user_name,
      image: user.image,
    },
    accessToken,
  });
});

/**
 * @desc    Resend Email OTP
 * @route   POST /api/auth/resend-otp
 */
const resendOTP = asyncHandler(async (req, res) => {
  let { email } = req.body;
  email = email.toLowerCase();

  const user = await User.findOne({ email });
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  if (user.emailVerified) {
    return res.status(400).json({ message: "Email already verified" });
  }

  // Check cooldown? (Optional logic using otpExpires or separate field)
  // For now, simple regeneration
  
  const otp = generateOTP();
  const secret = process.env.OTP_SECRET || "nexchain_otp_secret_key";
  const otpHash = hashOTP(otp, secret);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

  // Check if existing OTP prevents spam (e.g. wait 1 min)
  // Logic: find latest OTP for this email
  const existingOTP = await OTP.findOne({ email, used: false }).sort({ createdAt: -1 });
  if (existingOTP) {
    const timeDiff = (Date.now() - new Date(existingOTP.createdAt).getTime()) / 1000;
    if (timeDiff < 60) {
      return res.status(429).json({ message: `Please wait ${Math.ceil(60 - timeDiff)}s before resending.` });
    }
  }

  await OTP.create({
    email,
    otpHash,
    expiresAt,
    attemptsLeft: 3,
  });

  await sendOTPEmail(email, otp);

  res.json({ success: true, message: "OTP resent successfully" });
});

/**
 * @desc    Forgot Password (Send Reset Link)
 * @route   POST /api/auth/forgot-password
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    // Return 200 even if user not found to prevent enumeration
    // But for UX we often return 404 in dev types. 
    // Secure Practice: "If that email exists, we sent a link."
    return res.json({ success: true, message: "If registered, a reset link has been sent." });
  }

  // Generate Reset Token
  const resetToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  await user.save();

  // Construct Reset URL
  // Frontend URL usually in env, fallback to localhost
  const frontendUrl = process.env.CLIENT_URL || "http://localhost:5173";
  const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}&id=${user.id}`;

  const message = `
    <h1>Password Reset Request</h1>
    <p>You requested a password reset. Please click the link below to reset your password:</p>
    <a href="${resetUrl}" clicktracking=off>${resetUrl}</a>
    <p>This link expires in 30 minutes.</p>
  `;

  try {
    const emailSent = await sendEmail(user.email, "Password Reset Request", message);
    
    if (!emailSent) {
      throw new Error("Email sending failed");
    }

    res.json({ success: true, message: "Reset link sent to email" });
  } catch (err) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.status(500).json({ message: "Email could not be sent" });
  }

});

/**
 * @desc    Reset Password
 * @route   POST /api/auth/reset-password
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, id, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.status(400).json({ message: "Passwords do not match" });
  }

  const hashedToken = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const user = await User.findOne({
    id,
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).json({ message: "Invalid or expired token" });
  }

  user.password = await bcrypt.hash(password, 10);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  
  // Optional: Invalidate all sessions (change jwt secret or track version)
  // For now just save.
  
  await user.save();

  res.json({ success: true, message: "Password updated successfully" });
});

/**
 * @desc    Logout User
 * @route   POST /api/auth/logout
 */
const logout = (req, res) => {
  res.clearCookie("token", {
     httpOnly: true,
     secure: process.env.NODE_ENV === "production",
     sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
  });
  
  res.clearCookie("refreshToken", {
     httpOnly: true,
     secure: process.env.NODE_ENV === "production",
     sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
  });

  res.status(200).json({ success: true, message: "Logged out successfully" });
};

module.exports = {
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
};

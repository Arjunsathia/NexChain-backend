const User = require("../Models/userModel");
const OTP = require("../Models/otpModel");
const { generateOTP, hashOTP } = require("../utils/otpUtils");
const { sendOTPEmail } = require("../utils/emailService");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");
const asyncHandler = require("express-async-handler");

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 */
const register = asyncHandler(async (req, res) => {
  const { name, phone, password, confirm_password, role } = req.body;
  let { email, user_name } = req.body;

  if (!name || !email || !phone || !user_name || !password || !confirm_password) {
    res.status(400).json({ message: "All fields are required" });
    return;
  }

  email = email.toLowerCase();
  user_name = user_name.toLowerCase();

  if (password !== confirm_password) {
    res.status(400).json({ message: "Passwords do not match" });
    return;
  }

  // Check if email exists (case-insensitive safe due to normalization)
  const existingEmail = await User.findOne({ email });
  if (existingEmail) {
    res.status(400).json({ message: "Email already in use" });
    return;
  }

  // Check if username exists
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

  // Generate and send Verification OTP
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

  const otpRecord = await OTP.findOne({ email, used: false }).sort({ createdAt: -1 });

  if (!otpRecord || new Date() > otpRecord.expiresAt || otpRecord.attemptsLeft <= 0) {
    res.status(400).json({ message: "Invalid or expired OTP" });
    return;
  }

  if (otpRecord.otpHash !== otpHash) {
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
 * @desc    Standard Login (Password only)
 * @route   POST /api/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({
    $or: [
      { email: { $regex: new RegExp(`^${email}$`, "i") } },
      { user_name: { $regex: new RegExp(`^${email}$`, "i") } },
    ],
  });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    res.status(401).json({ message: "Invalid email or password" });
    return;
  }

  if (!user.emailVerified) {
    res.status(403).json({ message: "Email not verified. Please verify your email first." });
    return;
  }

  user.lastLogin = new Date();
  await user.save();

  // Issue tokens directly
  const accessToken = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );

  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.cookie("token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
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
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    
    if (!decoded || typeof decoded === "string" || !decoded.id) {
      res.status(401).json({ message: "Invalid token payload" });
      return;
    }

    const user = await User.findOne({ id: decoded.id });
    if (!user) {
      res.status(401).json({ message: "User not found" });
      return;
    }

    const accessToken = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "15m" });
    res.cookie("token", accessToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", maxAge: 15 * 60 * 1000 });
    res.json({ accessToken });
  } catch {
    res.status(401).json({ message: "Invalid refresh token" });
    return;
  }
});

module.exports = {
  register,
  verifyEmailOTP,
  login,
  refresh,
};

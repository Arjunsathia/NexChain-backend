const User = require("../Models/userModel");
const OTP = require("../Models/otpModel");
const { generateOTP, hashOTP } = require("../utils/otpUtils");
const { sendOTPEmail } = require("../utils/emailService");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");
const asyncHandler = require("express-async-handler");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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

  if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
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

/**
 * @typedef {import("express").Request & { user: { id: string, role: string } }} AuthRequest
 */

/**
 * @desc    Setup TOTP (Generate secret & QR)
 * @route   GET /api/auth/setup-totp
 */
const setupTOTP = asyncHandler(async (/** @type {AuthRequest} */ req, res) => {
    // 1. Check if user is admin
    if (req.user.role !== 'admin') {
        res.status(403).json({ message: "Access denied" });
        return;
    }

    const user = await User.findOne({ id: req.user.id });
    if (!user) {
         res.status(404).json({ message: "User not found" });
         return;
    }

    // 2. Generate Secret
    const secret = speakeasy.generateSecret({
        name: `NexChain Admin (${user.email})`
    });

    // 3. Generate QR Code
    QRCode.toDataURL(secret.otpauth_url, (err, data_url) => {
        if (err) {
            res.status(500).json({ message: "Error generating QR code" });
            return;
        }
        // Send secret (valid temporarily, must be verified to trigger enabling)
        // Ideally we don't save it yet OR save it to a temp field.
        // For simplicity, we send it to client, client sends it back with code to verify.
        // Then we save to DB.
        res.json({
            message: "Scan this QR code with Google Authenticator",
            secret: secret.base32, // User needs this if they can't scan
            qrCode: data_url
        });
    });
});

/**
 * @desc    Verify TOTP and Enable
 * @route   POST /api/auth/verify-totp
 */
const verifyTOTP = asyncHandler(async (/** @type {AuthRequest} */ req, res) => {
     const { token, secret } = req.body; // Secret comes from client (setup flow) OR we use stored if just re-verifying
    
     if (req.user.role !== 'admin') {
        res.status(403).json({ message: "Access denied" });
        return;
     }

     // If enabling (secret provided in body), use that. Else use user.adminTotpSecret
     let secretToVerify = secret;

     const user = await User.findOne({ id: req.user.id }).select('+adminTotpSecret');

     if (!secret && user.adminTotpSecret) {
        secretToVerify = user.adminTotpSecret.base32;
     }
     
     if (!secretToVerify) {
        res.status(400).json({ message: "No TOTP secret provided or found" });
        return;
     }

     const verified = speakeasy.totp.verify({
        secret: secretToVerify,
        encoding: 'base32',
        token: token
     });

     if (verified) {
         // If this was a setup (secret provided), save it now
         if (secret) {
             // Re-create proper secret object to store
             // We only got base32 from client usually. But we can just store { base32: secret }
             user.adminTotpSecret = { base32: secret };
             await user.save();
             res.json({ success: true, message: "2FA Enabled successfully" });
         } else {
             res.json({ success: true, message: "Code valid" });
         }
     } else {
         res.status(400).json({ success: false, message: "Invalid Authenticator Code" });
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
        const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${googleAccessToken}` }
        });
        
        if (!response.ok) {
            res.status(400);
            throw new Error('Failed to fetch Google user info');
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
        throw new Error('Google credential or access token is required');
    }

    if (!email_verified) {
        res.status(400);
        throw new Error('Google email not verified');
    }

    let user = await User.findOne({ email });

    if (user) {
        // Block Admin from Google Login
        if (user.role === 'admin' || user.role === 'superadmin') {
            res.status(403);
            throw new Error('Admins must login via password/2FA');
        }
    } else {
        // Create User
        // Generate a safe unique username
        const baseName = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        let userName = baseName;
        while (await User.findOne({ user_name: userName })) {
            userName = `${baseName}${Math.floor(Math.random() * 1000)}`;
        }

        user = await User.create({
            id: uuidv4(),
            name,
            email,
            user_name: userName,
            role: 'user',
            provider: 'google',
            emailVerified: true,
            image: picture,
        });
    }

    // Update login time
    user.lastLogin = new Date();
    await user.save();

    // Generate Tokens
    const accessToken = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "15m" });
    const refreshToken = jwt.sign({ id: user.id }, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, { expiresIn: "30d" });

    // Set Cookies
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

module.exports = {
  register,
  verifyEmailOTP,
  login,
  googleLogin,
  refresh,
  setupTOTP,
  verifyTOTP
};

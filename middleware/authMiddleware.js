const jwt = require("jsonwebtoken");
const speakeasy = require("speakeasy");
const User = require("../Models/userModel");

const protect = (req, res, next) => {
  let token;

  // Attempt to retrieve token from HTTP-only cookies
  if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  // Fallback: Check for Bearer token in the Authorization header
  else if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res
      .status(401)
      .json({ message: "Not authorized, no token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || typeof decoded === "string") {
      res.status(401).json({ message: "Invalid token payload" });
      return;
    }

    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

const adminOnly = (req, res, next) => {
  if (
    req.user &&
    (req.user.role === "admin" || req.user.role === "superadmin")
  ) {
    next();
  } else {
    res.status(403).json({ message: "Access denied: Admins only" });
  }
};

const requireAdmin2FA = async (req, res, next) => {
  // Ensure the user has administrative privileges first
  if (
    !req.user ||
    (req.user.role !== "admin" && req.user.role !== "superadmin")
  ) {
    return res.status(403).json({ message: "Access denied: Admins only" });
  }

  // Retrieve the 2FA code from the request headers
  const code = req.headers["x-admin-2fa-code"];

  if (!code) {
    return res.status(403).json({
      message: "2FA Required",
      require2FA: true,
    });
  }

  try {
    // Verify the provided TOTP code against the stored secret
    const user = await User.findOne({ id: req.user.id }).select(
      "+adminTotpSecret",
    );

    if (!user || !user.adminTotpSecret || !user.adminTotpSecret.base32) {
      return res.status(400).json({ message: "2FA not set up for this admin" });
    }

    const verified = speakeasy.totp.verify({
      secret: user.adminTotpSecret.base32,
      encoding: "base32",
      token: code,
      window: 1, // Allow 30s slack
    });

    if (!verified) {
      return res.status(403).json({ message: "Invalid 2FA Code" });
    }

    next();
  } catch (error) {
    console.error("2FA Error:", error);
    res.status(500).json({ message: "Server error during 2FA check" });
  }
};

module.exports = {
  protect,
  adminOnly,
  requireAdmin2FA,
};

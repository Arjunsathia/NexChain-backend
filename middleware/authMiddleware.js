const User = require("../Models/userModel");
const { verifyAccessToken } = require("../utils/tokens");
const twoFactor = require("../services/twoFactor");

/**
 * Accepts a Bearer access token (or the httpOnly `token` cookie) and checks it
 * against the database, so logout, password changes, freezes and role changes
 * take effect immediately. req.user.role always comes from the database.
 */
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token provided" });
  }

  const decoded = verifyAccessToken(token);
  if (!decoded) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  try {
    const user = await User.findOne({ id: decoded.id })
      .select("id role tokenVersion isDeleted")
      .lean();
    if (!user || user.isDeleted || (user.tokenVersion || 0) !== decoded.tv) {
      return res.status(401).json({ message: "Session expired, please log in again" });
    }

    req.user = { id: user.id, role: user.role };
    next();
  } catch (error) {
    next(error);
  }
};

const isAdmin = (user) =>
  !!user && (user.role === "admin" || user.role === "superadmin");

const adminOnly = (req, res, next) => {
  if (isAdmin(req.user)) {
    next();
  } else {
    res.status(403).json({ message: "Access denied: Admins only" });
  }
};

// Route param must be the caller's own id, unless the caller is an admin
const selfOrAdmin =
  (param = "user_id") =>
  (req, res, next) => {
    if (req.user && (req.params[param] === req.user.id || isAdmin(req.user))) {
      return next();
    }
    res.status(403).json({ message: "Access denied" });
  };

const requireAdmin2FA = async (req, res, next) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ message: "Access denied: Admins only" });
  }

  const code = req.headers["x-admin-2fa-code"];
  if (!code) {
    return res.status(403).json({ message: "2FA Required", require2FA: true });
  }

  try {
    const user = await User.findOne({ id: req.user.id }).select(twoFactor.SECRET_SELECT);
    if (!user || !twoFactor.isEnabled(user)) {
      return res.status(400).json({ message: "2FA not set up for this admin" });
    }
    if (!twoFactor.verifyCode(user, String(code))) {
      return res.status(403).json({ message: "Invalid 2FA Code" });
    }
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  protect,
  isAdmin,
  adminOnly,
  selfOrAdmin,
  requireAdmin2FA,
};

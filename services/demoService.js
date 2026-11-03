// One-click demo accounts: each visitor gets a private sandbox user with the
// normal starting balance. They have no password (so /auth/login can never
// reach them), locked account settings (see blockDemo), are hidden from the
// leaderboard and are deleted, with everything they created, after DEMO_TTL_MS.
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const User = require("../Models/userModel");
const Order = require("../Models/Order");
const PurchasedCoin = require("../Models/PurchasedCoin");
const Transaction = require("../Models/Transaction");
const Alert = require("../Models/Alert");
const Notification = require("../Models/Notification");
const PortfolioSnapshot = require("../Models/PortfolioSnapshot");
const WatchList = require("../Models/watchlistModel");

const DEMO_TTL_MS = 24 * 60 * 60 * 1000;
const DEMO_EMAIL_DOMAIN = "demo.nexchain.invalid"; // .invalid never resolves, so no mail is ever sent

const isEnabled = () => process.env.DEMO_ENABLED !== "false";

const createDemoUser = async () => {
  const user_name = `demo_${crypto.randomBytes(4).toString("hex")}`;
  return User.create({
    id: uuidv4(),
    name: "Demo Trader",
    user_name,
    email: `${user_name}@${DEMO_EMAIL_DOMAIN}`,
    provider: "demo",
    role: "user",
    emailVerified: true,
    isDemo: true,
    demoExpiresAt: new Date(Date.now() + DEMO_TTL_MS),
    lastLogin: new Date(),
  });
};

/** Deletes expired demo users and all their data. Returns how many were removed. */
const purgeExpiredDemos = async (now = new Date()) => {
  const expired = await User.find({ isDemo: true, demoExpiresAt: { $lte: now } })
    .select("_id id")
    .lean();
  if (!expired.length) return 0;

  const ids = expired.map((u) => u.id);
  const objectIds = expired.map((u) => u._id);
  await Promise.all([
    Order.deleteMany({ user_id: { $in: ids } }),
    PurchasedCoin.deleteMany({ user_id: { $in: ids } }),
    Transaction.deleteMany({ user_id: { $in: ids } }),
    Alert.deleteMany({ user_id: { $in: ids } }),
    PortfolioSnapshot.deleteMany({ user_id: { $in: ids } }),
    WatchList.deleteMany({ user_id: { $in: ids } }),
    Notification.deleteMany({ user: { $in: objectIds } }),
  ]);
  // Only delete users still flagged as demo (never a real account)
  await User.deleteMany({ _id: { $in: objectIds }, isDemo: true });
  return expired.length;
};

module.exports = { DEMO_TTL_MS, isEnabled, createDemoUser, purgeExpiredDemos };

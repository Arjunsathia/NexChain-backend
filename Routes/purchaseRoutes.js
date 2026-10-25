const express = require("express");
const router = express.Router();
const {
  getUserPurchases,
  buyCoin,
  sellCoin,
  getUserBalance,
  resetBalance,
  getUserHoldings,
  getUserTransactionHistory,
  getPlatformStats,
  getTodayTransactions,
  getPerformance,
} = require("../Controllers/purchaseController");
const { protect, adminOnly, selfOrAdmin } = require("../middleware/authMiddleware");
const validate = require("../middleware/validation");
const schemas = require("../utils/validationSchemas");

// Admin dashboard
router.get("/platform-stats", protect, adminOnly, getPlatformStats);
router.get("/today-transactions", protect, adminOnly, getTodayTransactions);

// Trading always acts on the logged-in user (any user_id in the body is ignored)
router.post("/buy", protect, validate(schemas.buy), buyCoin);
router.post("/sell", protect, validate(schemas.sell), sellCoin);
router.post("/reset-balance", protect, resetBalance);

// Reads: own data, or any user's for admins
router.get("/balance/:user_id", protect, selfOrAdmin(), getUserBalance);
router.get("/holdings/:user_id", protect, selfOrAdmin(), getUserHoldings);
router.get("/transactions/:user_id", protect, selfOrAdmin(), getUserTransactionHistory);
router.get("/performance/:user_id", protect, selfOrAdmin(), getPerformance);
router.get("/:user_id", protect, selfOrAdmin(), getUserPurchases);

module.exports = router;

// Routes/purchaseRoutes.js - UPDATED
const express = require("express");
const router = express.Router();
const { 
  getUserPurchases,
  buyCoin,
  sellCoin,
  getUserBalance, 
  resetBalance,
  getUserHoldings,
  getUserTransactionHistory
} = require("../Controllers/purchaseController");
const { protect } = require("../middleware/authMiddleware");

// GET /api/purchases/:user_id - Get user purchases
router.get("/:user_id", protect, getUserPurchases);

// POST /api/purchases/buy - Buy coins
router.post("/buy", protect, buyCoin);

// POST /api/purchases/sell - Sell coins
router.post("/sell", protect, sellCoin);

// GET /api/purchases/balance/:user_id - Get user balance
router.get("/balance/:user_id", protect, getUserBalance);

// POST /api/purchases/reset-balance - Reset balance
router.post("/reset-balance", protect, resetBalance);

// GET /api/purchases/holdings/:user_id - Get user holdings
router.get("/holdings/:user_id", protect, getUserHoldings);

// NEW: GET /api/purchases/transactions/:user_id - Get transaction history
router.get("/transactions/:user_id", protect, getUserTransactionHistory);

module.exports = router;
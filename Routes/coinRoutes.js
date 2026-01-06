const express = require("express");
const router = express.Router();
const { getFrozenCoins, freezeCoin, unfreezeCoin } = require("../controllers/coinController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

// Public route to get blacklist
router.get("/frozen", getFrozenCoins);

// Admin-only routes
router.post("/freeze", protect, adminOnly, freezeCoin);
router.post("/unfreeze", protect, adminOnly, unfreezeCoin);

module.exports = router;

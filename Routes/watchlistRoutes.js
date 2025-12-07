const express = require("express");
const router = express.Router();
const {
  addToWatchList,
  getWatchList,
  removeFromWatchList,
  getTrendingCoin
} = require("../Controllers/watchlistController");
const { protect } = require("../middleware/authMiddleware");

router.post("/add", protect, addToWatchList);
router.get("/", protect, getWatchList);
router.get("/trending", protect, getTrendingCoin);
router.delete("/remove", protect, removeFromWatchList);

module.exports = router;

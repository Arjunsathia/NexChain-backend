const express = require("express");
const router = express.Router();
const {
  addToWatchList,
  getWatchList,
  removeFromWatchList
} = require("../Controllers/watchlistController");
const { protect } = require("../middleware/authMiddleware");

router.post("/add", protect, addToWatchList);
router.get("/", protect, getWatchList);
router.delete("/remove", protect, removeFromWatchList);

module.exports = router;

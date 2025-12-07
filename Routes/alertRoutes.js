const express = require("express");
const router = express.Router();
const { createAlert, getAlerts, deleteAlert, checkAlerts } = require("../Controllers/alertController");
const { protect } = require("../middleware/authMiddleware");

router.post("/create", protect, createAlert);
router.get("/:user_id", protect, getAlerts);
router.delete("/:alertId", protect, deleteAlert);
router.post("/check", protect, checkAlerts);

module.exports = router;

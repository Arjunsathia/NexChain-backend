const express = require("express");
const router = express.Router();
const {
  createAlert,
  getAlerts,
  deleteAlert,
  checkAlerts,
} = require("../Controllers/alertController");
const { protect, selfOrAdmin } = require("../middleware/authMiddleware");
const validate = require("../middleware/validation");
const schemas = require("../utils/validationSchemas");

router.post("/create", protect, validate(schemas.createAlert), createAlert);
router.get("/:user_id", protect, selfOrAdmin(), getAlerts);
router.delete("/:alertId", protect, deleteAlert);
router.post("/check", protect, checkAlerts);

module.exports = router;

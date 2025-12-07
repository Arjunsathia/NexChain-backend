const express = require("express");
const router = express.Router();
const { setup2FA, verify2FA, disable2FA } = require("../Controllers/twoFactorController");
const { protect } = require("../middleware/authMiddleware");

router.post("/setup", protect, setup2FA);
router.post("/verify", protect, verify2FA);
router.post("/disable", protect, disable2FA);

module.exports = router;

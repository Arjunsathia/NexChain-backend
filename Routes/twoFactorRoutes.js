const express = require("express");
const router = express.Router();
const { setup2FA, verify2FA, disable2FA } = require("../Controllers/authController");
const { protect } = require("../middleware/authMiddleware");

router.use(protect);

router.post("/setup", setup2FA);
router.post("/verify", verify2FA);
router.post("/disable", disable2FA);

module.exports = router;

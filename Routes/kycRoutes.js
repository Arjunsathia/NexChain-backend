const express = require("express");
const router = express.Router();
const { submitKYC, getKYCStatus, verifyKYC } = require("../Controllers/kycController");
const { protect, admin } = require("../middleware/authMiddleware");

router.post("/submit", protect, submitKYC);
router.get("/status/:user_id", protect, getKYCStatus);
router.post("/verify", protect, verifyKYC); // Should be admin protected in real app

module.exports = router;

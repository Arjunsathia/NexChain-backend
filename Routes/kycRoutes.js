const express = require("express");
const router = express.Router();
const {
  submitKYC,
  getKYCStatus,
  getKYCReview,
  getKYCDocument,
  verifyKYC,
} = require("../Controllers/kycController");
const { protect, adminOnly, selfOrAdmin } = require("../middleware/authMiddleware");
const { singleDocument } = require("../middleware/memoryUpload");
const validate = require("../middleware/validation");
const schemas = require("../utils/validationSchemas");

router.post(
  "/submit",
  protect,
  ...singleDocument("document", { required: true }),
  validate(schemas.kycSubmit),
  submitKYC,
);
router.get("/status/:user_id", protect, selfOrAdmin(), getKYCStatus);

// Admin review
router.get("/review/:userId", protect, adminOnly, getKYCReview);
router.get("/review/:userId/document", protect, adminOnly, getKYCDocument);
router.post("/verify", protect, adminOnly, validate(schemas.kycVerify), verifyKYC);

module.exports = router;

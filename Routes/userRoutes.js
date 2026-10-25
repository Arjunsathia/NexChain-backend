const express = require("express");
const router = express.Router();
const {
  getUsers,
  getUserById,
  updateUser,
  updateProfileImage,
  deleteUser,
  contactUser,
  contactSupport,
  getLeaderboard
} = require("../Controllers/userController");
const {
  protect,
  adminOnly,
  selfOrAdmin,
  requireAdmin2FA,
} = require("../middleware/authMiddleware");
const validate = require("../middleware/validation");
const schemas = require("../utils/validationSchemas");
const upload = require("../middleware/uploadMiddleware");
const { singleDocument } = require("../middleware/memoryUpload");
const { logout } = require("../Controllers/authController");

router.get("/", protect, adminOnly, getUsers);
router.get("/leaderboard", protect, getLeaderboard);
router.get("/:id", protect, getUserById);

// Update Profile Image
router.put(
  "/profile-image/:id",
  protect,
  selfOrAdmin("id"),
  upload.single("image"),
  updateProfileImage,
);

// ✅ PUT ROUTE
router.put("/:id", protect, selfOrAdmin("id"), validate(schemas.updateUser), updateUser);

// ✅ DELETE ROUTE
router.delete("/:id", protect, adminOnly, requireAdmin2FA, deleteUser);

// ✅ CONTACT USER ROUTE
router.post("/contact-user", protect, adminOnly, contactUser);

// ✅ CONTACT SUPPORT ROUTE (User -> Admin)
// Attachments are emailed from memory and never stored
router.post("/contact-support", protect, ...singleDocument("attachment"), contactSupport);

// Kept for older clients; same as /api/auth/logout
router.post("/logout", logout);

module.exports = router;

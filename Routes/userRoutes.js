const express = require("express");
const router = express.Router();
const {
  getUsers,
  getUserById,
  updateUser,
  updateProfileImage,
  deleteUser,
  logoutUser,
  contactUser,
  contactSupport,
} = require("../Controllers/userController");
const {
  protect,
  adminOnly,
  requireAdmin2FA,
} = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

router.get("/", protect, adminOnly, getUsers);
router.get("/:id", getUserById);

// Update Profile Image
router.put(
  "/profile-image/:id",
  protect,
  upload.single("image"),
  updateProfileImage,
);

// ✅ PUT ROUTE
router.put("/:id", protect, updateUser);

// ✅ DELETE ROUTE
router.delete("/:id", protect, adminOnly, requireAdmin2FA, deleteUser);

// ✅ CONTACT USER ROUTE
router.post("/contact-user", protect, adminOnly, contactUser);

// ✅ CONTACT SUPPORT ROUTE (User -> Admin)
router.post("/contact-support", protect, upload.single("attachment"), contactSupport);

router.post("/logout", logoutUser);

module.exports = router;

const express = require("express");
const router = express.Router();
const {
  registerUser,
  getUsers,
  getUserById,
  updateUser, 
  updateProfileImage,
  deleteUser,
  loginUser,
  verifyLogin2FA,
  logoutUser,
} = require("../Controllers/userController");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

router.post("/", registerUser);
router.get("/", protect, adminOnly, getUsers);
router.get("/:id", getUserById);

// Update Profile Image
router.put("/profile-image/:id", protect, upload.single("image"), updateProfileImage);

// ✅ PUT ROUTE (NO IMAGE UPLOAD)
router.put("/:id", protect, updateUser);

// ✅ DELETE ROUTE
router.delete("/:id", protect, adminOnly, deleteUser);

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/verify-login-2fa", verifyLogin2FA);
router.post("/logout", logoutUser);

module.exports = router;
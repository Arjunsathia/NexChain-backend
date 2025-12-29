const express = require("express");
const router = express.Router();
const {
  getUsers,
  getUserById,
  updateUser, 
  updateProfileImage,
  deleteUser,
  logoutUser,
} = require("../Controllers/userController");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

router.get("/", protect, adminOnly, getUsers);
router.get("/:id", getUserById);

// Update Profile Image
router.put("/profile-image/:id", protect, upload.single("image"), updateProfileImage);

// ✅ PUT ROUTE (NO IMAGE UPLOAD)
router.put("/:id", protect, updateUser);

// ✅ DELETE ROUTE
router.delete("/:id", protect, adminOnly, deleteUser);

router.post("/logout", logoutUser);

module.exports = router;
const express = require("express");
const router = express.Router();
const {
  registerUser,
  getUsers,
  getUserById,
  updateUser, // Make sure this is imported from controller
  deleteUser,
  loginUser,
  verifyLogin2FA,
  logoutUser,
} = require("../Controllers/userController");
const { protect, adminOnly } = require("../middleware/authMiddleware");



router.post("/", registerUser);
router.get("/", protect, adminOnly, getUsers);
router.get("/:id", getUserById);

// ✅ PUT ROUTE (NO IMAGE UPLOAD)
router.put("/:id", protect, updateUser);

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/verify-login-2fa", verifyLogin2FA);
router.post("/logout", logoutUser);

module.exports = router;
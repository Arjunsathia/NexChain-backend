const express = require("express");
const router = express.Router();
const {
  registerUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  loginUser,
  logoutUser,
} = require("../Controllers/userController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

router.post("/", registerUser);
router.get("/", protect, adminOnly, getUsers);
router.get("/:id", getUserById);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);
router.post("/login", loginUser);
router.post("/logout", logoutUser);

module.exports = router;

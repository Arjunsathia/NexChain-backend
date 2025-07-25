const {
  findAllUsers,
  findUserById,
  isEmailTaken,
  isPhoneTaken,
  isUsernameTaken,
} = require("../Services/userService");
const User = require("../Models/userModel");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");
const generateToken = require("../utils/generateToken");

const registerUser = async (req, res) => {
  try {
    const { name, email, phone, user_name, password, confirm_password, role } =
      req.body;

    // Check for missing or empty fields
    if (
      !name ||
      !email ||
      !phone ||
      !user_name ||
      !password ||
      !confirm_password ||
      name.trim() === "" ||
      email.trim() === "" ||
      phone.trim() === "" ||
      user_name.trim() === "" ||
      password.trim() === "" ||
      confirm_password.trim() === ""
    ) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Check if passwords match
    if (password !== confirm_password) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    if (await isEmailTaken(email)) {
      return res.status(400).json({ message: "Email already in use" });
    }
    if (await isPhoneTaken(phone)) {
      return res.status(400).json({ message: "Phone number already in use" });
    }
    if (await isUsernameTaken(user_name)) {
      return res.status(400).json({ message: "Username already taken" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      id: uuidv4(),
      name,
      email,
      phone,
      user_name,
      password: hashedPassword,
      role: role || "user",
    });

    res
      .status(201)
      .json({
        message: "User registered successfully",
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          phone: newUser.phone,
          user_name: newUser.user_name,
          createdAt: newUser.createdAt,
        },
      });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const getUsers = async (req, res) => {
  try {
    const users = await findAllUsers();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await findUserById(id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, user_name } = req.body;

    if (
      !name ||
      !email ||
      !phone ||
      !user_name ||
      name.trim() === "" ||
      email.trim() === "" ||
      phone.trim() === "" ||
      user_name.trim() === ""
    ) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const updatedUser = await User.findOneAndUpdate(
      { id },
      { name, email, phone, user_name },
      { new: true, runValidators: true }
    );

    if (!updatedUser) return res.status(404).json({ error: "User not found" });

    res.json({
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedUser = await User.findOneAndDelete({ id });

    if (!deletedUser) return res.status(404).json({ error: "User not found" });

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const loginUser = async (req, res) => {
  const { user_name, password } = req.body;

  const user = await User.findOne({ user_name });
  if (!user) return res.status(404).json({ message: "User not found" });

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

  const token = generateToken(user);

  res
    .cookie("token", token, {
      httpOnly: true,
      secure: false, // 🔐 Set true in production
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
    .json({ message: "Login successful", user, token });
};

const logoutUser = (req, res) => {
  res
    .clearCookie("token", {
      httpOnly: true,
      secure: false, // 🔐 Set true in production
      sameSite: "strict",
    })
    .json({ message: "Logout successful" });
};

module.exports = {
  registerUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  loginUser,
  logoutUser
};

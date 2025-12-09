const User = require("../Models/userModel");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");
const generateToken = require("../utils/generateToken");
const { validateToken } = require("./twoFactorController");

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

    if (await User.findOne({ email })) {
      return res.status(400).json({ message: "Email already in use" });
    }
    if (await User.findOne({ phone })) {
      return res.status(400).json({ message: "Phone number already in use" });
    }
    if (await User.findOne({ user_name })) {
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
    const users = await User.find();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findOne({ id });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
 

    // 1. Get data from Frontend
    const { 
      name, 
      email, 
      phone, 
      user_name, 
      currentPassword, 
      newPassword, 
      confirmPassword,
      confirm_password, 
    } = req.body;

    const user = await User.findOne({ id });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // 2. Update Basic Info
    if (name) user.name = name;
    if (email) user.email = email;
    if (phone) user.phone = phone;
    if (user_name) user.user_name = user_name;

    // 4. Update Password
    const pass = newPassword || req.body.newPassword;
    if (pass && pass.trim() !== "") {
        if (!currentPassword) return res.status(400).json({ message: "Current password required" });
        
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.status(400).json({ message: "Incorrect current password" });

        const conf = confirmPassword || confirm_password || req.body.confirmPassword;
        if (pass !== conf) return res.status(400).json({ message: "Passwords do not match" });

        user.password = await bcrypt.hash(pass, 10);
    }

    // 5. Save
    await user.save();

    res.json({
      message: "Profile updated successfully",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        user_name: user.user_name,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Update User Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Don't forget to export it along with your other functions!
module.exports = {
    // ... other exports
    updateUser
};

const loginUser = async (req, res) => {
  const { email, password } = req.body;


  try {
    // Case-insensitive search for email or username
    const user = await User.findOne({
      $or: [
        { email: { $regex: new RegExp(`^${email}$`, "i") } },
        { user_name: { $regex: new RegExp(`^${email}$`, "i") } },
      ],
    });

    if (!user) {

      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {

      return res.status(401).json({ message: "Invalid email or password" });
    }



    // Check 2FA
    if (user.twoFactorEnabled) {
      return res.json({
        twoFactorRequired: true,
        user_id: user.id,
      });
    }

    const token = generateToken(user);

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      user_name: user.user_name,
      role: user.role,
      token: token,
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: error.message });
  }
};

const verifyLogin2FA = async (req, res) => {
  const { user_id, token } = req.body;

  try {
    const user = await User.findOne({ id: user_id });
    if (!user) return res.status(404).json({ message: "User not found" });

    const verified = validateToken(user.twoFactorSecret, token);

    if (verified) {
      const authToken = generateToken(user);

      res.cookie("token", authToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        user_name: user.user_name,
        role: user.role,
        token: authToken,
      });
    } else {
      res.status(400).json({ message: "Invalid 2FA Code" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
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
  verifyLogin2FA,
  logoutUser
};
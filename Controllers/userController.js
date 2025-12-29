const User = require("../Models/userModel");
const bcrypt = require("bcrypt");


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
        image: user.image,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Update User Error:", error);
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




const updateProfileImage = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const user = await User.findOne({ id });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // If Cloudinary (URL), use path. If local (Disk), construct full URL.
    if (req.file.path && req.file.path.startsWith('http')) {
      user.image = req.file.path;
    } else {
      // Construct absolute URL for local file
      const host = req.get('host');
      let protocol = req.headers['x-forwarded-proto'] || 'http';
      user.image = `${protocol}://${host}/uploads/${req.file.filename}`;
    }

    await user.save();

    res.json({
      message: "Profile image updated successfully",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        user_name: user.user_name,
        role: user.role,
        image: user.image,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Update Image Error:", error);
    res.status(500).json({ error: error.message });
  }
};

const logoutUser = (req, res) => {
  res
    .clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // 🔐 Set true in production
      sameSite: "strict",
    })
    .json({ message: "Logout successful" });
};

module.exports = {
  getUsers,
  getUserById,
  updateUser,
  updateProfileImage, // Export the new function
  deleteUser,
  logoutUser
};
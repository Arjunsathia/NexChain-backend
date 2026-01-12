const User = require("../Models/userModel");
const AuditLog = require("../Models/AuditLog");
const bcrypt = require("bcrypt");
const { sendEmail } = require("../utils/emailService");
const Notification = require("../Models/Notification");

const getUsers = async (req, res) => {
  try {
    const { includeDeleted } = req.query;
    const filter =
      includeDeleted === "true" ? {} : { isDeleted: { $ne: true } };

    const users = await User.find(filter);
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

    // Extract user details from the request body
    const {
      name,
      email,
      phone,
      user_name,
      currentPassword,
      newPassword,
      confirmPassword,
      confirm_password,
      // Admin fields
      role,
      isFrozen,
      isDeleted,
    } = req.body;

    const user = await User.findOne({ id });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update basic user information
    if (name) user.name = name;
    if (email) user.email = email;
    if (phone) user.phone = phone;
    if (user_name) user.user_name = user_name;

    // Handle administrative updates (Role changes and Account Status)
    if (
      req.user &&
      (req.user.role === "admin" || req.user.role === "superadmin")
    ) {
      const actorRole = req.user.role;
      const targetRole = user.role;
      const isSelf = req.user.id === user.id;

      // Security Check: Prevent modification of the primary system superadmin account
      if (user.email === "nexchainsystem@gmail.com") {
        return res.status(403).json({
          error: "Action forbidden: Cannot modify System Super Admin account.",
        });
      }

      // Validate role change permissions
      if (role && role !== targetRole) {
        // Prevent admins from changing their own role
        if (isSelf)
          return res
            .status(403)
            .json({ error: "Cannot change your own role." });

        if (actorRole === "admin") {
          // Admins can only toggle User <-> Admin, they cannot touch Super Admins
          if (targetRole === "superadmin")
            return res
              .status(403)
              .json({ error: "Admins cannot modify Super Admins." });
          if (targetRole === "admin" && role === "superadmin")
            return res
              .status(403)
              .json({ error: "Admins cannot promote to Super Admin." });
          if (role === "superadmin")
            return res
              .status(403)
              .json({ error: "Admins cannot promote to Super Admin." });

          // Allow User -> Admin or Admin -> User
        }

        if (actorRole === "superadmin") {
          // Superadmin can do anything except modify primary superadmin (blocked above)
        }
        user.role = role;
      }

      // Handle Account Status (Archive/Freeze)
      if (typeof isDeleted !== "undefined" || typeof isFrozen !== "undefined") {
        if (isSelf)
          return res
            .status(403)
            .json({ error: "Cannot archive/freeze yourself." });

        if (actorRole === "admin") {
          if (targetRole === "superadmin")
            return res
              .status(403)
              .json({ error: "Admins cannot archive/freeze Super Admins." });
          if (targetRole === "admin")
            return res
              .status(403)
              .json({ error: "Admins cannot archive/freeze other Admins." });
        }

        if (typeof isFrozen !== "undefined") user.isFrozen = isFrozen;
        if (typeof isDeleted !== "undefined") user.isDeleted = isDeleted;
      }
    }

    // Process password update if provided
    const pass = newPassword || req.body.newPassword;
    if (pass && pass.trim() !== "") {
      if (!currentPassword)
        return res.status(400).json({ message: "Current password required" });

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch)
        return res.status(400).json({ message: "Incorrect current password" });

      const conf =
        confirmPassword || confirm_password || req.body.confirmPassword;
      if (pass !== conf)
        return res.status(400).json({ message: "Passwords do not match" });

      user.password = await bcrypt.hash(pass, 10);
    }

    // Persist changes to database
    await user.save();

    // Log this action for auditing purposes
    try {
      if (
        req.user &&
        (req.user.role === "admin" || req.user.role === "superadmin")
      ) {
        const adminUser = await User.findOne({ id: req.user.id });
        if (adminUser) {
          let actionType = "USER_UPDATE";
          let logDetails = {
            previousValue: {},
            newValue: req.body,
            reason: `${req.user.role} Update`,
          };

          if (role && role !== user.role) {
            // Note: 'user.role' is already updated in memory above
            // To get actual "Previous" we would have needed it before update.
            // But simplified:
            actionType = "ROLE_CHANGE";
            logDetails.roleChange = `To ${role}`;
          }

          await AuditLog.create({
            adminId: adminUser._id,
            action: actionType,
            targetId: user._id,
            details: logDetails,
            ipAddress: req.ip || req.headers["x-forwarded-for"] || "0.0.0.0",
          });
        }
      }
    } catch (logErr) {
      console.error("Audit Log Error", logErr);
    }

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

    const userToDelete = await User.findOne({ id });
    if (!userToDelete) return res.status(404).json({ error: "User not found" });

    // Security Check: Protect Super Admin accounts from deletion
    if (
      userToDelete.role === "admin" &&
      userToDelete.email === "admin@nexchain.com"
    ) {
      // Example hardcoded safety
      return res.status(403).json({ error: "Cannot delete Root Admin" });
    }

    userToDelete.isDeleted = true;
    await userToDelete.save();

    // Log this action for auditing purposes
    try {
      if (req.user && req.user.role === "admin") {
        // Find admin's Mongo _id to link in AuditLog
        const adminUser = await User.findOne({ id: req.user.id });

        if (adminUser) {
          await AuditLog.create({
            adminId: adminUser._id,
            action: "USER_DELETE",
            targetId: userToDelete._id,
            details: {
              reason: "Soft Delete via Admin Panel",
            },
            ipAddress: req.ip || req.headers["x-forwarded-for"] || "0.0.0.0",
          });
        }
      }
    } catch (logErr) {
      console.error("Audit Log Error", logErr);
    }

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

    // Determine image source (Cloudinary URL or Local Path)
    if (req.file.path && req.file.path.startsWith("http")) {
      user.image = req.file.path;
    } else {
      // Construct absolute URL for local file
      const host = req.get("host");
      let protocol = req.headers["x-forwarded-proto"] || "http";
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

const contactUser = async (req, res) => {
  try {
    const { userId, type, subject, message } = req.body;

    // Validation
    if (!userId || !type || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const user = await User.findOne({ id: userId });
    let targetUser = user;

    // Fallback if userId is MongoDB _id
    if (!targetUser && userId.match(/^[0-9a-fA-F]{24}$/)) {
      targetUser = await User.findById(userId);
    }

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Handle Email Communication
    if (type === "email") {
      if (!subject)
        return res.status(400).json({ error: "Subject required for emails" });

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #4A90E2;">Message from Admin</h2>
          <p>Hello ${targetUser.name},</p>
          <p>${message.replace(/\n/g, "<br>")}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #888;">&copy; 2025 NexChain Support</p>
        </div>
      `;

      const sent = await sendEmail(targetUser.email, subject, emailHtml);
      if (!sent) return res.status(500).json({ error: "Failed to send email" });

      // Notify user about the email
      await Notification.create({
        user: targetUser._id,
        title: "New Email from Support",
        message:
          "We have sent you an important email. Please check your inbox.",
        type: "info",
      });
    }

    // Handle Internal Messaging
    else if (type === "internal") {
      // Send internal notification
      await Notification.create({
        user: targetUser._id,
        title: "Message from Admin",
        message: message,
        type: "info",
      });
    }

    // Log this action for auditing purposes
    try {
      if (req.user) {
        const adminUser = await User.findOne({ id: req.user.id });
        if (adminUser) {
          await AuditLog.create({
            adminId: adminUser._id,
            action: "USER_CONTACT",
            targetId: targetUser._id,
            details: {
              type: type,
              subject: subject || "Internal Message",
              messageLength: message.length,
            },
            ipAddress: req.ip || req.headers["x-forwarded-for"] || "0.0.0.0",
          });
        }
      }
    } catch (logErr) {
      console.error("Audit Log Error", logErr);
    }

    res.json({ message: "Message sent successfully" });
  } catch (error) {
    console.error("Contact User Error:", error);
    res.status(500).json({ error: error.message });
  }
};

const contactSupport = async (req, res) => {
  try {
    const { subject, message } = req.body;
    // user contains the decoded token (likely just id, role, etc.)
    // We need to fetch the full user details to get name and email
    const user = await User.findOne({ id: req.user.id });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!subject || !message) {
      return res.status(400).json({ error: "Subject and message are required" });
    }

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
        <h2 style="color: #4A90E2;">New Support Request</h2>
        <p><strong>From:</strong> ${user.name} (${user.email})</p>
        <p><strong>User Name:</strong> ${user.name}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <h3 style="color: #333;">Message:</h3>
        <p style="white-space: pre-wrap;">${message}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #888;">Sent from NexChain Platform</p>
      </div>
    `;

    // Handle Attachments
    let attachments = [];
    if (req.file) {
      attachments.push({
        filename: req.file.originalname,
        path: req.file.path, // Works for both Cloudinary URL and local path
      });
    }

    // Send email to Super Admin
    const sent = await sendEmail(
      "nexchainsystem@gmail.com",
      `Support Request: ${subject}`,
      emailHtml,
      attachments
    );

    if (!sent) {
      return res.status(500).json({ error: "Failed to send email" });
    }

    // Notify the administration team
    // Try to find superadmin first, else any admin
    const adminUser = await User.findOne({ role: "superadmin" });
    const targetAdmin = adminUser || (await User.findOne({ role: "admin" }));

    if (targetAdmin) {
      await Notification.create({
        user: targetAdmin._id, // Must be ObjectId
        title: "New Support Mail",
        message: `${user.name} sent a mail: "${subject}"`,
        type: "info",
      });
    }

    res.json({ message: "Your support mail has been sent successfully." });
  } catch (error) {
    console.error("Contact Support Error:", error);
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
  logoutUser,
  contactUser,
  contactSupport,
};

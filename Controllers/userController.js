const User = require("../Models/userModel");
const AuditLog = require("../Models/AuditLog");
const bcrypt = require("bcrypt");
const { sendEmail } = require("../utils/emailService");
const Notification = require("../Models/Notification");
const { isAdmin } = require("../middleware/authMiddleware");
const { issueTokens } = require("../utils/tokens");
const escapeHtml = require("../utils/escapeHtml");

const supportInbox = () => process.env.SUPPORT_EMAIL || process.env.EMAIL_USER;

// Fields any logged-in user may see about another user
const PUBLIC_FIELDS = ["id", "name", "user_name", "image", "role", "createdAt"];

const getUsers = async (req, res) => {
  try {
    const { includeDeleted } = req.query;
    const filter =
      includeDeleted === "true" ? {} : { isDeleted: { $ne: true } };

    const users = await User.find(filter);
    res.status(200).json(users);
  } catch (error) {
    console.error("User Controller Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findOne({ id });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (req.user.id === id || isAdmin(req.user)) return res.json(user);

    const publicProfile = {};
    PUBLIC_FIELDS.forEach((field) => (publicProfile[field] = user[field]));
    res.json(publicProfile);
  } catch (error) {
    console.error("User Controller Error:", error);
    res.status(500).json({ error: "Server error" });
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
    let revokeSessions = false;

    // An email change on a password account requires the current password,
    // so a hijacked session can't redirect password resets to a new inbox.
    const emailChanged =
      email && email.toLowerCase() !== String(user.email).toLowerCase();
    if (emailChanged && !isAdmin(req.user)) {
      if (!user.password) {
        return res
          .status(400)
          .json({ message: "Email is managed by your Google account" });
      }
      if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password))) {
        return res
          .status(400)
          .json({ message: "Enter your current password to change your email" });
      }
    }

    if (emailChanged && (await User.exists({ email, id: { $ne: user.id } }))) {
      return res.status(409).json({ message: "Email already in use" });
    }
    if (
      user_name &&
      user_name !== user.user_name &&
      (await User.exists({ user_name, id: { $ne: user.id } }))
    ) {
      return res.status(409).json({ message: "Username already taken" });
    }

    // Update basic user information
    if (name) user.name = name;
    if (emailChanged) user.email = email;
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

      // Superadmin accounts can only be changed by their owner
      if (targetRole === "superadmin" && !isSelf) {
        return res.status(403).json({
          error: "Action forbidden: Super Admin accounts can't be modified by others.",
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
        revokeSessions = true;
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
        if (isFrozen || isDeleted) revokeSessions = true;
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
      revokeSessions = true;
    }

    // Role changes, freezes and password changes sign the user out everywhere
    if (revokeSessions) user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    // Changing your own password keeps this session alive with fresh tokens
    const accessToken =
      revokeSessions && req.user.id === user.id ? issueTokens(res, user) : undefined;

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
      accessToken,
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
    res.status(500).json({ error: "Failed to update user" });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const userToDelete = await User.findOne({ id });
    if (!userToDelete) return res.status(404).json({ error: "User not found" });

    if (userToDelete.role === "superadmin") {
      return res.status(403).json({ error: "Super Admin accounts can't be deleted" });
    }
    if (userToDelete.id === req.user.id) {
      return res.status(403).json({ error: "You can't delete your own account here" });
    }
    if (userToDelete.role === "admin" && req.user.role !== "superadmin") {
      return res.status(403).json({ error: "Only a Super Admin can delete admins" });
    }

    userToDelete.isDeleted = true;
    userToDelete.tokenVersion = (userToDelete.tokenVersion || 0) + 1;
    await userToDelete.save();

    // Log this action for auditing purposes
    try {
      if (isAdmin(req.user)) {
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
    console.error("User Controller Error:", error);
    res.status(500).json({ error: "Server error" });
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
      // Local file: Store only the filename.
      // The frontend constructs the full URL using its configured SERVER_URL.
      // This prevents issues where 'localhost' is stored but accessed from another device.
      user.image = req.file.filename;
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
    res.status(500).json({ error: "Server error" });
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
          <p>Hello ${escapeHtml(targetUser.name)},</p>
          <p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
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
    res.status(500).json({ error: "Server error" });
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
        <p><strong>From:</strong> ${escapeHtml(user.name)} (${escapeHtml(user.email)})</p>
        <p><strong>Username:</strong> ${escapeHtml(user.user_name)}</p>
        <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <h3 style="color: #333;">Message:</h3>
        <p style="white-space: pre-wrap;">${escapeHtml(message)}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #888;">Sent from NexChain Platform</p>
      </div>
    `;

    // Handle Attachments
    let attachments = [];
    if (req.file) {
      attachments.push({
        filename: `attachment.${req.file.detected.ext}`,
        content: req.file.buffer,
        contentType: req.file.detected.mime,
      });
    }

    // Send email to Super Admin
    const sent = await sendEmail(
      supportInbox(),
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
    res.status(500).json({ error: "Server error" });
  }
};

const LEADERBOARD_TTL_MS = 60 * 1000;
const RESET_EXCLUSION_MS = 24 * 60 * 60 * 1000;
let leaderboardCache = { at: 0, data: null };

// Ranks traders by equity: cash plus holdings at the engine's cached live price
// (falling back to average cost). Accounts reset in the last 24h are left out.
const getLeaderboard = async (req, res) => {
  try {
    if (leaderboardCache.data && Date.now() - leaderboardCache.at < LEADERBOARD_TTL_MS) {
      return res.json(leaderboardCache.data);
    }

    const Transaction = require("../Models/Transaction");
    const { valueHoldings } = require("../services/equityService");

    const activeUserIds = await Transaction.distinct("user_id");
    const users = await User.find({
      isDeleted: { $ne: true },
      id: { $in: activeUserIds },
      $or: [
        { lastResetAt: { $exists: false } },
        { lastResetAt: null },
        { lastResetAt: { $lt: new Date(Date.now() - RESET_EXCLUSION_MS) } },
      ],
    })
      .select("name user_name image virtualBalance role id")
      .lean();

    const holdingsValue = await valueHoldings(users.map((u) => u.id));

    const ranked = users
      .map((u) => ({ ...u, equity: u.virtualBalance + (holdingsValue.get(u.id)?.holdingsValue || 0) }))
      .sort((a, b) => b.equity - a.equity)
      .slice(0, 10);

    leaderboardCache = { at: Date.now(), data: ranked };
    res.json(ranked);
  } catch (error) {
    console.error("Leaderboard Error:", error);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
};

module.exports = {
  getUsers,
  getUserById,
  updateUser,
  updateProfileImage, // Export the new function
  deleteUser,
  contactUser,
  contactSupport,
  getLeaderboard,
};

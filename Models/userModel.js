const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, unique: true, sparse: true },
    user_name: { type: String, required: true, unique: true },
    password: { type: String },
    role: {
      type: String,
      enum: ["user", "admin", "superadmin"],
      default: "user",
    },
    provider: {
      type: String,
      default: "local",
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },

    kycStatus: {
      type: String,
      enum: ["unverified", "pending", "verified", "rejected"],
      default: "unverified",
    },
    kycData: {
      fullName: String,
      dob: Date,
      address: String,
      idType: String,
      idNumber: String,
      documentImage: String,
      rejectionReason: String,
    },

    image: {
      type: String, // Stores filename of the uploaded profile image
    },
    // Add virtual wallet field
    virtualBalance: {
      type: Number,
      default: 10000, // $10,000 virtual money
      min: 0,
    },
    lastLogin: {
      type: Date,
      default: Date.now,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    isFrozen: {
      type: Boolean,
      default: false,
    },
    adminTotpSecret: {
      type: Object, // Stores ASCII, Hex, Base32, OTPAuth URL
      select: false, // Do not return by default
    },
    // Password Reset Fields
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },
    // OTP Fields for Email Verification / 2FA
    otp: {
      type: String,
      select: false,
    },
    otpExpires: {
      type: Date,
      select: false,
    },
  },
  { timestamps: true },
);

// Index for password reset token
userSchema.index({ resetPasswordToken: 1 });

module.exports = mongoose.model("User", userSchema);

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
    lastResetAt: {
      type: Date,
    },
    // Bumped inside trading transactions so concurrent ones for the same user
    // conflict and retry instead of both passing the same balance/holdings check
    lockVersion: {
      type: Number,
      default: 0,
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
    // Legacy plaintext admin 2FA secret; migrated to twoFactorSecret on next enrollment
    adminTotpSecret: {
      type: Object,
      select: false,
    },
    // Authenticator-app 2FA (any role). Secrets are AES-GCM encrypted.
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorSecret: {
      type: String,
      select: false,
    },
    twoFactorPendingSecret: {
      type: String,
      select: false,
    },
    // Embedded in every token; bumping it revokes all of the user's sessions
    tokenVersion: {
      type: Number,
      default: 0,
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
  },
  { timestamps: true },
);

// Index for password reset token
userSchema.index({ resetPasswordToken: 1 });

// Secrets never leave the server; KYC id numbers are masked to the last 4 chars
const SECRET_FIELDS = [
  "password",
  "resetPasswordToken",
  "resetPasswordExpires",
  "adminTotpSecret",
  "twoFactorSecret",
  "twoFactorPendingSecret",
  "tokenVersion",
  "lockVersion",
  "__v",
];

userSchema.set("toJSON", {
  transform: (doc, ret) => {
    SECRET_FIELDS.forEach((field) => delete ret[field]);
    if (ret.kycData) {
      if (ret.kycData.idNumber) {
        ret.kycData.idNumber = `••••${String(ret.kycData.idNumber).slice(-4)}`;
      }
      // The storage reference is internal; admins fetch the file via /api/kyc/review
      ret.kycData.hasDocument = !!ret.kycData.documentImage;
      delete ret.kycData.documentImage;
    }
    return ret;
  },
});

module.exports = mongoose.model("User", userSchema);

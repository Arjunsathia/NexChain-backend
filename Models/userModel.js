const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  user_name: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ["user", "admin"],
    default: "user",
  },

  kycStatus: {
    type: String,
    enum: ['unverified', 'pending', 'verified', 'rejected'],
    default: 'unverified'
  },
  kycData: {
    fullName: String,
    dob: Date,
    address: String,
    idType: String,
    idNumber: String,
    documentImage: String,
    rejectionReason: String
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  twoFactorSecret: {
    type: String,
  },
  tempSecret: {
    type: String,
  },
  // Add virtual wallet field
  virtualBalance: {
    type: Number,
    default: 100000, // $100,000 virtual money
    min: 0
  }
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
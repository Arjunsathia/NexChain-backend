const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  action: {
    type: String,
    required: true,
    enum: [
      "USER_UPDATE",
      "USER_DELETE",
      "USER_FREEZE",
      "USER_UNFREEZE",
      "USER_ROLE_CHANGE",
      "USER_BALANCE_UPDATE",
    ],
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  details: {
    previousValue: { type: mongoose.Schema.Types.Mixed },
    newValue: { type: mongoose.Schema.Types.Mixed },
    reason: { type: String },
    fieldChanged: { type: String }, // Optional: specific field changed
  },
  ipAddress: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

module.exports = mongoose.model("AuditLog", auditLogSchema);

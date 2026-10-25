const mongoose = require("mongoose");

// Hourly value of a user's holdings, used for the portfolio performance chart.
// Kept for 90 days.
const portfolioSnapshotSchema = new mongoose.Schema({
  user_id: { type: String, required: true },
  at: { type: Date, required: true }, // start of the hour
  holdingsValue: { type: Number, required: true },
  invested: { type: Number, required: true }, // cost basis of the holdings
  cash: { type: Number, required: true },
});

portfolioSnapshotSchema.index({ user_id: 1, at: 1 }, { unique: true });
portfolioSnapshotSchema.index({ at: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model("PortfolioSnapshot", portfolioSnapshotSchema);

const mongoose = require("mongoose");

const frozenCoinSchema = new mongoose.Schema(
  {
    coinId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    symbol: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    frozenAt: {
      type: Date,
      default: Date.now,
    },
    frozenBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("FrozenCoin", frozenCoinSchema);

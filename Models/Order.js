const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    user_id: {
      type: String,
      required: true,
      index: true,
    },
    coin_id: {
      type: String,
      required: true,
    },
    coin_symbol: {
      type: String,
      required: true,
    },
    coin_name: {
      type: String,
      required: true,
    },
    coin_image: {
      type: String,
    },
    type: {
      type: String,
      enum: ["buy", "sell"],
      required: true,
    },
    category: {
      type: String,
      enum: ["market", "limit", "stop_limit", "stop_market"],
      default: "limit",
    },
    status: {
      type: String,
      enum: ["pending", "triggered", "filled", "cancelled", "failed"],
      default: "pending",
      index: true,
    },
    limit_price: {
      type: Number,
      // required if category is limit or stop_limit
    },
    stop_price: {
      type: Number,
      // required if category is stop_limit or stop_market
    },
    quantity: {
      type: Number,
      required: true,
    },
    filled_quantity: {
      type: Number,
      default: 0,
    },
    total_value: {
      type: Number,
      required: true,
    },
    oco_group_id: {
      type: String, // ID to link OCO pairs
      index: true,
    },
    // Balance reserved by this order (buy side). For a buy OCO the whole
    // reservation sits on one leg and the other leg holds 0.
    locked_amount: {
      type: Number,
    },
    failure_reason: {
      type: String,
    },
  },
  { timestamps: true },
);

// Compound index for the Trading Engine query (active orders per symbol, oldest first)
orderSchema.index({ status: 1, coin_symbol: 1, createdAt: 1 });

module.exports = mongoose.model("Order", orderSchema);

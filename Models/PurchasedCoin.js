// Models/PurchasedCoin.js - CLEAN VERSION
const mongoose = require("mongoose");

const purchasedCoinSchema = new mongoose.Schema({
  user_id: {
    type: String,
    required: true,
  },
  coin_id: {
    type: String,
    required: true,
  },
  coinName: {
    type: String,
    required: true,
  },
  coinSymbol: {
    type: String,
    required: true,
  },
  coinPriceUSD: {
    type: Number,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    default: 1
  },
  totalCost: {
    type: Number,
    required: true
  },
  fees: {
    type: Number,
    default: 0
  },
  image: {
    type: String,
  },
  purchaseDate: {
    type: Date,
    default: Date.now,
  },
});

// Compound index for efficient queries
purchasedCoinSchema.index({ user_id: 1, coin_id: 1 });
purchasedCoinSchema.index({ user_id: 1, purchaseDate: -1 });

module.exports = mongoose.model("PurchasedCoin", purchasedCoinSchema);
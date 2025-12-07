// Models/Transaction.js
const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
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
  type: {
    type: String,
    enum: ['buy', 'sell'],
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  totalValue: {
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
  transactionDate: {
    type: Date,
    default: Date.now,
  },
  purchaseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchasedCoin'
  }
});

// Index for efficient queries
transactionSchema.index({ user_id: 1, transactionDate: -1 });
transactionSchema.index({ user_id: 1, coin_id: 1 });

module.exports = mongoose.model("Transaction", transactionSchema);
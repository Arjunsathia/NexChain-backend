const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  user_id: {
    type: String,
    required: true,
    index: true
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
    enum: ['buy', 'sell'],
    required: true
  },
  category: {
    type: String,
    enum: ['market', 'limit', 'stop_limit', 'stop_market'],
    default: 'limit'
  },
  status: {
    type: String,
    enum: ['pending', 'filled', 'cancelled', 'triggered'],
    default: 'pending'
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
    required: true
  },
  filled_quantity: {
    type: Number,
    default: 0
  },
  total_value: {
    type: Number,
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.model("Order", orderSchema);

const mongoose = require("mongoose");

const alertSchema = new mongoose.Schema({
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
  target_price: {
    type: Number,
    required: true
  },
  condition: {
    type: String,
    enum: ['above', 'below'],
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'triggered'],
    default: 'active'
  },
  triggered_at: {
    type: Date
  }
}, { timestamps: true });

module.exports = mongoose.model("Alert", alertSchema);

const mongoose = require("mongoose");

const watchListSchema = new mongoose.Schema(
  {
    user_id: { type: String, ref: "User" },
    id: { type: String, required: true },
    image: { type: String, required: true },
    symbol: { type: String, required: true },
    current_price: { type: Number, required: true },
    price_change_percentage_1h_in_currency: { type: Number },
    price_change_percentage_24h_in_currency: { type: Number },
    price_change_percentage_24h: { type: Number },
    price_change_percentage_7d_in_currency: { type: Number },
    market_cap: { type: Number },
    total_volume: { type: Number },
    sparkline_in_7d: {
      price: [Number],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WatchList", watchListSchema);

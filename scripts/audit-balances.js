// Read-only report of data that the Phase 1 exploits (negative amounts, spoofed
// symbols, OCO double refunds) would have left behind. Changes nothing.
// Usage: npm run audit:balances
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const User = require("../Models/userModel");
const PurchasedCoin = require("../Models/PurchasedCoin");
const Transaction = require("../Models/Transaction");
const Order = require("../Models/Order");
const { COINS } = require("../config/coins");

const SUSPICIOUS_BALANCE = 1_000_000; // 100x the starting $10,000

const section = (title, rows) => {
  console.log(`\n== ${title}: ${rows.length}`);
  rows.slice(0, 50).forEach((row) => console.log("  ", JSON.stringify(row)));
  if (rows.length > 50) console.log(`   ...and ${rows.length - 50} more`);
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  section(
    "Users with negative or very large balances",
    await User.find({
      $or: [{ virtualBalance: { $lt: 0 } }, { virtualBalance: { $gt: SUSPICIOUS_BALANCE } }],
    })
      .select("id email user_name virtualBalance -_id")
      .lean(),
  );

  section(
    "Transactions with non-positive quantity or value",
    await Transaction.find({ $or: [{ quantity: { $lte: 0 } }, { totalValue: { $lte: 0 } }] })
      .select("user_id coin_id type quantity totalValue transactionDate -_id")
      .lean(),
  );

  section(
    "Orders with non-positive quantity or value",
    await Order.find({ $or: [{ quantity: { $lte: 0 } }, { total_value: { $lte: 0 } }] })
      .select("user_id coin_id type status quantity total_value -_id")
      .lean(),
  );

  const expected = new Map(COINS.map((c) => [c.coinId, c.symbol]));
  const holdings = await PurchasedCoin.find({ coin_id: { $in: [...expected.keys()] } })
    .select("user_id coin_id coinSymbol quantity coinPriceUSD -_id")
    .lean();
  section(
    "Holdings whose symbol doesn't match their coin (spoofed pricing)",
    holdings.filter((h) => String(h.coinSymbol).toLowerCase() !== expected.get(h.coin_id)),
  );

  section(
    "Buy OCO groups where both legs were cancelled (possible double refund)",
    await Order.aggregate([
      { $match: { oco_group_id: { $ne: null }, type: "buy" } },
      {
        $group: {
          _id: "$oco_group_id",
          user_id: { $first: "$user_id" },
          legs: { $sum: 1 },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
          refunded: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, "$total_value", 0] } },
        },
      },
      { $match: { legs: 2, cancelled: 2 } },
    ]),
  );
};

run()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

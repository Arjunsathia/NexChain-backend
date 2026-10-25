// One-time migration for orders created before Phase 2:
// - sets `locked_amount` on open buy orders (plain: total_value; OCO: the larger
//   leg's value on the earliest leg, 0 on the other)
// - lowercases `coin_symbol` so the engine's per-symbol query finds them
// Dry run by default. Usage: npm run migrate:orders [-- --apply]
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const Order = require("../Models/Order");
const { ACTIVE_STATUSES } = require("../utils/orderLocks");

const APPLY = process.argv.includes("--apply");

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const ops = [];

  const buys = await Order.find({
    type: "buy",
    status: { $in: ACTIVE_STATUSES },
    locked_amount: { $exists: false },
  }).sort({ createdAt: 1 });

  const groups = {};
  for (const order of buys) {
    if (order.oco_group_id) {
      (groups[order.oco_group_id] ||= []).push(order);
    } else {
      ops.push({ id: order._id, set: { locked_amount: order.total_value } });
    }
  }
  for (const legs of Object.values(groups)) {
    const lock = Math.max(...legs.map((leg) => leg.total_value));
    legs.forEach((leg, i) => ops.push({ id: leg._id, set: { locked_amount: i === 0 ? lock : 0 } }));
  }

  const mixedCase = await Order.find({
    status: { $in: ACTIVE_STATUSES },
    coin_symbol: { $regex: /[A-Z]/ },
  }).select("coin_symbol");
  for (const order of mixedCase) {
    ops.push({ id: order._id, set: { coin_symbol: order.coin_symbol.toLowerCase() } });
  }

  console.log(`${ops.length} order updates (${APPLY ? "applying" : "dry run, pass --apply to write"})`);
  ops.slice(0, 50).forEach((op) => console.log("  ", String(op.id), JSON.stringify(op.set)));

  if (APPLY && ops.length) {
    const result = await Order.bulkWrite(
      ops.map((op) => ({ updateOne: { filter: { _id: op.id }, update: { $set: op.set } } })),
    );
    console.log(`modified ${result.modifiedCount}`);
  }
};

run()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

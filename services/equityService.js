const User = require("../Models/userModel");
const PurchasedCoin = require("../Models/PurchasedCoin");
const PortfolioSnapshot = require("../Models/PortfolioSnapshot");

// Values holdings at the trading engine's cached live price, falling back to
// average cost for coins it isn't streaming.
const priceOf = (holding) => {
  const tradingEngine = require("./tradingEngine"); // lazy: the engine requires this module's callers
  const cached = tradingEngine.prices[`${String(holding.coinSymbol).toLowerCase()}usdt`];
  return cached ? cached.price : holding.coinPriceUSD;
};

/** @returns {Promise<Map<string, { holdingsValue: number, invested: number }>>} by user id */
const valueHoldings = async (userIds) => {
  const holdings = await PurchasedCoin.find(userIds ? { user_id: { $in: userIds } } : {})
    .select("user_id coinSymbol quantity coinPriceUSD totalCost")
    .lean();

  const byUser = new Map();
  for (const h of holdings) {
    const entry = byUser.get(h.user_id) || { holdingsValue: 0, invested: 0 };
    entry.holdingsValue += h.quantity * priceOf(h);
    entry.invested += h.totalCost;
    byUser.set(h.user_id, entry);
  }
  return byUser;
};

const startOfHour = (date = new Date()) => {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
};

/** Records this hour's snapshot for every user holding coins (idempotent per hour) */
const snapshotAll = async () => {
  const values = await valueHoldings();
  if (values.size === 0) return 0;

  const cash = new Map(
    (await User.find({ id: { $in: [...values.keys()] } }).select("id virtualBalance").lean()).map((u) => [
      u.id,
      u.virtualBalance,
    ]),
  );
  const at = startOfHour();
  await PortfolioSnapshot.bulkWrite(
    [...values].map(([user_id, v]) => ({
      updateOne: {
        filter: { user_id, at },
        update: { $set: { ...v, cash: cash.get(user_id) ?? 0 } },
        upsert: true,
      },
    })),
  );
  return values.size;
};

module.exports = { valueHoldings, snapshotAll, startOfHour };

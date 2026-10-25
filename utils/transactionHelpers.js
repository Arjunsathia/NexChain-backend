const mongoose = require("mongoose");
const PurchasedCoin = require("../Models/PurchasedCoin");
const Transaction = require("../Models/Transaction");
const User = require("../Models/userModel");
const { normalizeCoinImage } = require("./imageUtils");
const { getLockedSellQuantity } = require("./orderLocks");

/**
 * Runs `fn(session)` in a transaction. withTransaction retries on transient
 * errors (write conflicts, lock timeouts), so `fn` must only write through the session.
 */
const runInTransaction = async (fn) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

/**
 * Writes to the user document so two trading transactions for the same user
 * conflict (one retries and sees the other's result) instead of both passing
 * the same holdings check.
 */
const lockUser = (session, userId) =>
  User.updateOne({ id: userId }, { $inc: { lockVersion: 1 } }, { session });

/**
 * Atomically changes a balance. Debits only succeed if the balance covers them.
 * @returns {Promise<number>} the new balance
 */
const adjustBalance = async (session, userId, amount) => {
  const filter = { id: userId };
  if (amount < 0) filter.virtualBalance = { $gte: -amount };

  const user = await User.findOneAndUpdate(
    filter,
    { $inc: { virtualBalance: amount, lockVersion: 1 } },
    { session, new: true },
  );
  if (!user) {
    const exists = await User.exists({ id: userId }).session(session);
    throw new Error(exists ? "Insufficient balance" : "User not found");
  }
  return user.virtualBalance;
};

/**
 * Buy inside an existing transaction.
 * @param {boolean} deductBalance false when the funds were already locked by an order
 */
const buyInSession = async (
  session,
  userId,
  coinData,
  quantity,
  price,
  totalCost,
  fees,
  deductBalance = true,
) => {
  const { coinId, coinName, coinSymbol, image: rawImage } = coinData;
  const image = normalizeCoinImage(rawImage);

  const newBalance = deductBalance
    ? await adjustBalance(session, userId, -totalCost)
    : undefined;

  // Merge into the user's existing holding for this coin, if any
  let purchasedCoin = await PurchasedCoin.findOne({
    user_id: userId,
    coin_id: coinId,
  }).session(session);

  if (purchasedCoin) {
    purchasedCoin.quantity += quantity;
    purchasedCoin.totalCost += totalCost;
    purchasedCoin.coinPriceUSD = purchasedCoin.totalCost / purchasedCoin.quantity;
    purchasedCoin.image = image;
    purchasedCoin.purchaseDate = new Date();
    await purchasedCoin.save({ session });
  } else {
    [purchasedCoin] = await PurchasedCoin.create(
      [
        {
          user_id: userId,
          coin_id: coinId,
          coinName,
          coinSymbol,
          coinPriceUSD: price,
          quantity,
          totalCost,
          fees: fees || 0,
          image,
          purchaseDate: new Date(),
        },
      ],
      { session },
    );
  }

  await Transaction.create(
    [
      {
        user_id: userId,
        coin_id: coinId,
        coinName,
        coinSymbol,
        type: "buy",
        quantity,
        price,
        totalValue: totalCost,
        fees: fees || 0,
        image,
        transactionDate: new Date(),
        purchaseId: purchasedCoin._id,
      },
    ],
    { session },
  );

  return { success: true, purchasedCoin, newBalance };
};

/**
 * Sell inside an existing transaction. Coins reserved by open sell orders can't
 * be sold, except by the order (or OCO group) passed in `exclude`.
 * @param {{ orderId?: any, ocoGroupId?: string }} [exclude]
 */
const sellInSession = async (session, userId, coinId, quantity, price, exclude = {}) => {
  const purchases = await PurchasedCoin.find({
    user_id: userId,
    coin_id: coinId,
  })
    .sort({ purchaseDate: 1 })
    .session(session);

  if (purchases.length === 0) {
    throw new Error("No holdings found for this coin");
  }

  const totalOwned = purchases.reduce((sum, p) => sum + p.quantity, 0);
  const reserved = await getLockedSellQuantity(userId, coinId, session, exclude);
  const available = totalOwned - reserved;

  // Small epsilon for float comparison safety
  if (available < quantity - 0.00000001) {
    throw new Error(
      reserved > 0
        ? `Insufficient coin quantity. Available: ${available} (${reserved} reserved by open sell orders), trying to sell: ${quantity}`
        : `Insufficient coin quantity. Owned: ${totalOwned}, trying to sell: ${quantity}`,
    );
  }

  const saleAmount = quantity * price;
  const newBalance = await adjustBalance(session, userId, saleAmount);

  // Older data can hold several lots per coin; consume them oldest first
  let remainingToSell = quantity;
  const updatedPurchases = [];
  const deletedPurchases = [];
  const { coinName, coinSymbol } = purchases[0];
  const image = normalizeCoinImage(purchases[0].image);

  for (const purchase of purchases) {
    if (remainingToSell <= 0) break;

    const sellQuantity = Math.min(purchase.quantity, remainingToSell);
    const averageCost = purchase.totalCost / purchase.quantity;
    purchase.quantity -= sellQuantity;
    purchase.totalCost -= sellQuantity * averageCost;

    if (purchase.quantity <= 0.00000001) {
      deletedPurchases.push(purchase._id);
    } else {
      await purchase.save({ session });
      updatedPurchases.push(purchase);
    }

    remainingToSell -= sellQuantity;
  }

  if (deletedPurchases.length > 0) {
    await PurchasedCoin.deleteMany({ _id: { $in: deletedPurchases } }, { session });
  }

  await Transaction.create(
    [
      {
        user_id: userId,
        coin_id: coinId,
        coinName,
        coinSymbol,
        type: "sell",
        quantity,
        price,
        totalValue: saleAmount,
        fees: 0,
        image,
        transactionDate: new Date(),
      },
    ],
    { session },
  );

  return { success: true, newBalance, saleAmount, deletedPurchases, updatedPurchases };
};

/** Market buy in its own transaction (same signature as before) */
const executeBuy = (...args) => runInTransaction((session) => buyInSession(session, ...args));

/** Market sell in its own transaction (same signature as before) */
const executeSell = (userId, coinId, quantity, price) =>
  runInTransaction((session) => sellInSession(session, userId, coinId, quantity, price));

module.exports = {
  runInTransaction,
  lockUser,
  adjustBalance,
  buyInSession,
  sellInSession,
  executeBuy,
  executeSell,
};

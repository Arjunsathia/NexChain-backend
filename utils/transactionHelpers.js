const mongoose = require("mongoose");
const PurchasedCoin = require("../Models/PurchasedCoin");
const Transaction = require("../Models/Transaction");
const User = require("../Models/userModel");

/**
 * Helper to execute a Buy Transaction atomically
 * @param {string} userId - User ID
 * @param {Object} coinData - { coinId, coinName, coinSymbol, image }
 * @param {number} quantity - Quantity to buy
 * @param {number} price - Price per unit
 * @param {number} totalCost - Total cost (quantity * price)
 * @param {number} fees - Fees if any
 * @param {boolean} deductBalance - Whether to deduct balance from user
 */
const executeBuy = async (
  userId,
  coinData,
  quantity,
  price,
  totalCost,
  fees,
  deductBalance = true,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { coinId, coinName, coinSymbol, image } = coinData;

    let user;
    if (deductBalance) {
      user = await User.findOne({ id: userId }).session(session);
      if (!user) throw new Error("User not found");

      if (user.virtualBalance < totalCost) {
        throw new Error("Insufficient balance");
      }
      user.virtualBalance -= totalCost;
      await user.save({ session });
    }

    // Check if user already owns this coin
    let purchasedCoin = await PurchasedCoin.findOne({
      user_id: userId,
      coin_id: coinId,
    }).session(session);

    if (purchasedCoin) {
      // Update existing record (Merge)
      purchasedCoin.quantity += quantity;
      purchasedCoin.totalCost += totalCost;
      // Update average price
      purchasedCoin.coinPriceUSD =
        purchasedCoin.totalCost / purchasedCoin.quantity;
      purchasedCoin.image = image;
      purchasedCoin.purchaseDate = new Date();
      await purchasedCoin.save({ session });
    } else {
      // Create new purchase record
      const [newCoin] = await PurchasedCoin.create(
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
      purchasedCoin = newCoin;
    }

    // Create transaction record
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

    await session.commitTransaction();
    session.endSession();

    return {
      success: true,
      purchasedCoin,
      newBalance: user ? user.virtualBalance : undefined,
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

/**
 * Helper to execute a Sell Transaction atomically
 * @param {string} userId - User ID
 * @param {string} coinId - Coin ID
 * @param {number} quantity - Quantity to sell
 * @param {number} price - Price per unit
 */
const executeSell = async (userId, coinId, quantity, price) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Find user's purchases for this coin
    const purchases = await PurchasedCoin.find({
      user_id: userId,
      coin_id: coinId,
    })
      .sort({ purchaseDate: 1 })
      .session(session);

    if (purchases.length === 0) {
      throw new Error("No holdings found for this coin");
    }

    // Calculate total available quantity
    const totalAvailable = purchases.reduce((sum, p) => sum + p.quantity, 0);

    // Use a small epsilon for float comparison safety
    if (totalAvailable < quantity - 0.00000001) {
      throw new Error(
        `Insufficient coin quantity. Owned: ${totalAvailable}, Trying to sell: ${quantity}`,
      );
    }

    const saleAmount = quantity * price;

    // Add to user's wallet
    const user = await User.findOne({ id: userId }).session(session);
    if (!user) throw new Error("User not found");

    user.virtualBalance += saleAmount;
    await user.save({ session });

    // FIFO Logic
    let remainingToSell = quantity;
    const purchasesToUpdate = [];
    const purchasesToDelete = [];

    // We need coin details for transaction record, get from first purchase
    const firstPurchase = purchases[0];
    const coinName = firstPurchase.coinName;
    const coinSymbol = firstPurchase.coinSymbol;
    const image = firstPurchase.image;

    for (let purchase of purchases) {
      if (remainingToSell <= 0) break;

      const sellQuantity = Math.min(purchase.quantity, remainingToSell);

      // Update purchase
      const averageCost = purchase.totalCost / purchase.quantity;
      purchase.quantity -= sellQuantity;
      purchase.totalCost -= sellQuantity * averageCost;

      if (purchase.quantity <= 0.00000001) {
        purchasesToDelete.push(purchase._id);
      } else {
        purchasesToUpdate.push(purchase);
      }

      remainingToSell -= sellQuantity;
    }

    // Update partially sold purchases
    for (let p of purchasesToUpdate) {
      await p.save({ session });
    }

    // Delete fully sold purchases
    if (purchasesToDelete.length > 0) {
      await PurchasedCoin.deleteMany(
        { _id: { $in: purchasesToDelete } },
        { session },
      );
    }

    // Create transaction record
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

    await session.commitTransaction();
    session.endSession();

    return {
      success: true,
      newBalance: user.virtualBalance,
      saleAmount,
      deletedPurchases: purchasesToDelete.length,
      updatedPurchases: purchasesToUpdate.length,
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

module.exports = { executeBuy, executeSell };

const PurchasedCoin = require("../Models/PurchasedCoin");
const Transaction = require("../Models/Transaction");
const User = require("../Models/userModel");
const FrozenCoin = require("../Models/frozenCoinModel");
const Order = require("../Models/Order");
const { executeBuy, executeSell, runInTransaction } = require("../utils/transactionHelpers");
const { ACTIVE_STATUSES } = require("../utils/orderLocks");
const { resolveCoin } = require("../services/coinRegistry");
const tradingEngine = require("../services/tradingEngine");

// GET /api/purchases/:user_id - Get user's purchased coins
exports.getUserPurchases = async (req, res) => {
  try {
    const userId = req.params.user_id;
    const purchases = await PurchasedCoin.find({
      user_id: userId,
    }).sort({ purchaseDate: -1 });

    res.status(200).json({
      success: true,
      purchases,
    });
  } catch (error) {
    console.error("Error fetching user purchases:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// Business-rule failures from the transaction helpers are client errors, not 500s
const CLIENT_ERRORS = [
  "Insufficient balance",
  "No holdings found for this coin",
  "Insufficient coin quantity",
];
const isClientError = (err) =>
  CLIENT_ERRORS.some((msg) => err.message && err.message.startsWith(msg));

// Resolve the coin server-side. For sells, fall back to the symbol stored on the
// user's holding so coins outside the registry can still be closed out.
const resolveTradableCoin = async (coinId, userId) => {
  const coin = await resolveCoin(coinId);
  if (coin || !userId) return coin;
  const holding = await PurchasedCoin.findOne({ user_id: userId, coin_id: coinId });
  if (!holding) return null;
  const symbol = holding.coinSymbol.toLowerCase();
  return { coinId, symbol, name: holding.coinName, pair: `${symbol}usdt` };
};

// POST /api/purchases/buy - Buy coins using virtual wallet
exports.buyCoin = async (req, res) => {
  const { coin_id, coin_name, quantity, image } = req.body;
  const userId = req.user.id;

  try {
    const user = await User.findOne({ id: userId });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.isFrozen) {
      return res
        .status(403)
        .json({ error: "Account is frozen. Trading disabled." });
    }

    const coin = await resolveTradableCoin(coin_id);
    if (!coin) {
      return res.status(400).json({ error: "This coin is not available for trading" });
    }
    if (await FrozenCoin.exists({ coinId: coin.coinId })) {
      return res.status(403).json({ error: "Trading for this coin is currently frozen" });
    }

    const currentPrice = await tradingEngine.waitForPrice(coin.pair);
    if (!currentPrice) {
      return res.status(400).json({
        error: "Market data currently unavailable for this asset. Please try again.",
      });
    }

    const total_cost = currentPrice * quantity;
    const result = await executeBuy(
      userId,
      {
        coinId: coin.coinId,
        coinName: coin.name || coin_name,
        coinSymbol: coin.symbol,
        image,
      },
      quantity,
      currentPrice,
      total_cost,
      0, // fees
      true, // deductBalance
    );

    res.status(201).json({
      success: true,
      message: "Purchase successful",
      purchase: {
        _id: result.purchasedCoin._id,
        coinId: result.purchasedCoin.coin_id,
        coinName: result.purchasedCoin.coinName,
        coinSymbol: result.purchasedCoin.coinSymbol,
        coinPriceUSD: result.purchasedCoin.coinPriceUSD,
        quantity: result.purchasedCoin.quantity,
        totalCost: result.purchasedCoin.totalCost,
        fees: result.purchasedCoin.fees,
        image: result.purchasedCoin.image,
        purchaseDate: result.purchasedCoin.purchaseDate,
        userId: result.purchasedCoin.user_id,
      },
      newBalance: result.newBalance,
    });
  } catch (err) {
    console.error("Purchase Error", err);
    res.status(isClientError(err) ? 400 : 500).json({
      success: false,
      error: isClientError(err) ? err.message : "Unable to process purchase",
    });
  }
};

// POST /api/purchases/sell - Sell coins
exports.sellCoin = async (req, res) => {
  const { coin_id, quantity } = req.body;
  const userId = req.user.id;

  try {
    const user = await User.findOne({ id: userId });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.isFrozen) {
      return res
        .status(403)
        .json({ error: "Account is frozen. Trading disabled." });
    }

    const coin = await resolveTradableCoin(coin_id, userId);
    if (!coin) {
      return res.status(400).json({ error: "No holdings found for this coin" });
    }

    const currentPrice = await tradingEngine.waitForPrice(coin.pair);
    if (!currentPrice) {
      return res.status(400).json({
        error: "Market data currently unavailable for this asset. Please try again.",
      });
    }

    const result = await executeSell(userId, coin.coinId, quantity, currentPrice);

    res.json({
      success: true,
      message: "Sale successful",
      newBalance: result.newBalance,
      saleAmount: result.saleAmount,
      quantitySold: quantity,
      deletedPurchases: result.deletedPurchases,
      updatedPurchases: result.updatedPurchases,
      executionPrice: currentPrice,
    });
  } catch (error) {
    console.error("Error processing sale:", error);
    res.status(isClientError(error) ? 400 : 500).json({
      success: false,
      error: isClientError(error) ? error.message : "Failed to process sale",
    });
  }
};

// GET /api/purchases/balance/:user_id - Get user's virtual balance
exports.getUserBalance = async (req, res) => {
  try {
    const { user_id } = req.params;
    const user = await User.findOne({ id: user_id }).select("virtualBalance");

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.json({
      success: true,
      virtualBalance: user.virtualBalance,
    });
  } catch (err) {
    console.error("Balance fetch error:", err);
    res.status(500).json({
      success: false,
      error: "Unable to fetch balance",
    });
  }
};

const STARTING_BALANCE = 10000;
const RESET_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// POST /api/purchases/reset-balance - Reset cash to 10,000 and clear holdings and
// open orders, at most once per 24 hours
exports.resetBalance = async (req, res) => {
  try {
    const result = await runInTransaction(async (session) => {
      const user = await User.findOne({ id: req.user.id }).session(session);
      if (!user) return { status: 404, body: { success: false, error: "User not found" } };

      const elapsed = user.lastResetAt ? Date.now() - user.lastResetAt.getTime() : Infinity;
      if (elapsed < RESET_COOLDOWN_MS) {
        const hours = Math.ceil((RESET_COOLDOWN_MS - elapsed) / (60 * 60 * 1000));
        return {
          status: 429,
          body: {
            success: false,
            error: `You can reset your account again in ${hours} hour${hours === 1 ? "" : "s"}`,
            nextResetAt: new Date(user.lastResetAt.getTime() + RESET_COOLDOWN_MS),
          },
        };
      }

      // A reset is a fresh start: cash, holdings and open orders all go together,
      // so locked funds and coins can't survive into the new balance.
      await PurchasedCoin.deleteMany({ user_id: user.id }, { session });
      await Order.updateMany(
        { user_id: user.id, status: { $in: ACTIVE_STATUSES } },
        { status: "cancelled", locked_amount: 0 },
        { session },
      );
      user.virtualBalance = STARTING_BALANCE;
      user.lastResetAt = new Date();
      user.lockVersion += 1;
      await user.save({ session });

      return {
        status: 200,
        body: {
          success: true,
          message: "Account reset successfully",
          newBalance: user.virtualBalance,
          nextResetAt: new Date(user.lastResetAt.getTime() + RESET_COOLDOWN_MS),
        },
      };
    });

    res.status(result.status).json(result.body);
  } catch (err) {
    console.error("Reset balance error:", err);
    res.status(500).json({
      success: false,
      error: "Unable to reset balance",
    });
  }
};

// GET /api/purchases/holdings/:user_id - Get user's coin holdings summary
exports.getUserHoldings = async (req, res) => {
  try {
    const { user_id } = req.params;

    const holdings = await PurchasedCoin.aggregate([
      {
        $match: {
          user_id,
        },
      },
      {
        $group: {
          _id: "$coin_id",
          coinName: { $first: "$coinName" },
          coinSymbol: { $first: "$coinSymbol" },
          totalQuantity: { $sum: "$quantity" },
          averagePrice: { $avg: "$coinPriceUSD" },
          image: { $first: "$image" },
          totalInvested: { $sum: "$totalCost" },
        },
      },
    ]);

    res.json({
      success: true,
      holdings,
    });
  } catch (error) {
    console.error("Error fetching holdings:", error);
    res.status(500).json({
      success: false,
      error: "Unable to fetch holdings",
    });
  }
};

const PERFORMANCE_RANGES = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 };

// GET /api/purchases/performance/:user_id?range=7d - holdings value history.
// 1d returns hourly points, longer ranges the last point of each day, plus a
// live "now" point at the end.
exports.getPerformance = async (req, res) => {
  try {
    const { user_id } = req.params;
    const range = PERFORMANCE_RANGES[req.query.range] ? req.query.range : "7d";
    const since = new Date(Date.now() - PERFORMANCE_RANGES[range] * 24 * 60 * 60 * 1000);

    const PortfolioSnapshot = require("../Models/PortfolioSnapshot");
    const { valueHoldings } = require("../services/equityService");

    let points;
    if (range === "1d") {
      points = await PortfolioSnapshot.find({ user_id, at: { $gte: since } })
        .sort({ at: 1 })
        .select("at holdingsValue invested -_id")
        .lean();
    } else {
      points = await PortfolioSnapshot.aggregate([
        { $match: { user_id, at: { $gte: since } } },
        { $sort: { at: 1 } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$at" } },
            at: { $last: "$at" },
            holdingsValue: { $last: "$holdingsValue" },
            invested: { $last: "$invested" },
          },
        },
        { $sort: { at: 1 } },
        { $project: { _id: 0, at: 1, holdingsValue: 1, invested: 1 } },
      ]);
    }

    const now = (await valueHoldings([user_id])).get(user_id);
    if (now) points.push({ at: new Date(), ...now, live: true });

    const first = await PortfolioSnapshot.findOne({ user_id }).sort({ at: 1 }).select("at").lean();
    res.json({ success: true, range, points, historySince: first?.at || null });
  } catch (error) {
    console.error("Error fetching performance:", error);
    res.status(500).json({ success: false, error: "Unable to fetch performance" });
  }
};

// Get all transactions (both buys and sells) for a user
exports.getUserTransactionHistory = async (req, res) => {
  try {
    const { user_id } = req.params;

    // Get all transactions from Transaction collection
    const transactions = await Transaction.find({ user_id }).sort({
      transactionDate: -1,
    });

    res.json({
      success: true,
      transactions,
    });
  } catch (error) {
    console.error("Error fetching transaction history:", error);
    res.status(500).json({
      success: false,
      error: "Unable to fetch transaction history",
    });
  }
};

// Get platform-wide statistics (for Admin Dashboard)
exports.getPlatformStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Total daily trade count
    const tradesToday = await Transaction.countDocuments({
      transactionDate: { $gte: today },
    });

    // Unique users who have traded today
    const activeTraders = await Transaction.distinct("user_id", {
      transactionDate: { $gte: today },
    });

    // Calculate total platform volume for the day
    const volumeResult = await Transaction.aggregate([
      { $match: { transactionDate: { $gte: today } } },
      { $group: { _id: null, totalVolume: { $sum: "$totalValue" } } },
    ]);
    const volumeToday =
      volumeResult.length > 0 ? volumeResult[0].totalVolume : 0;

    // Total user count
    const totalUsers = await User.countDocuments({});

    res.json({
      success: true,
      stats: {
        tradesToday,
        activeTradersToday: activeTraders.length,
        volumeToday,
        totalUsers,
      },
    });
  } catch (error) {
    console.error("Error fetching platform stats:", error);
    res.status(500).json({
      success: false,
      error: "Unable to fetch platform stats",
    });
  }
};

// Get detailed list of today's transactions
exports.getTodayTransactions = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const transactions = await Transaction.aggregate([
      {
        $match: {
          transactionDate: { $gte: today },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "user_id",
          foreignField: "id",
          as: "userDetails",
        },
      },
      {
        $unwind: {
          path: "$userDetails",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $sort: { transactionDate: -1 },
      },
      {
        $project: {
          _id: 1,
          transactionDate: 1,
          type: 1,
          coinName: 1,
          coinSymbol: 1,
          quantity: 1,
          price: 1,
          totalValue: 1,
          image: 1,
          user_id: 1,
          userName: { $ifNull: ["$userDetails.name", "Unknown User"] },
          userEmail: { $ifNull: ["$userDetails.email", "No Email"] },
          userRole: { $ifNull: ["$userDetails.role", "user"] },
        },
      },
    ]);

    res.json({
      success: true,
      data: transactions,
    });
  } catch (error) {
    console.error("Error fetching today's transactions:", error);
    res.status(500).json({
      success: false,
      error: "Unable to fetch transactions",
    });
  }
};

const PurchasedCoin = require("../Models/PurchasedCoin");
const Transaction = require("../Models/Transaction");
const User = require("../Models/userModel");
const { executeBuy, executeSell } = require("../utils/transactionHelpers");

// GET /api/purchases/:user_id - Get user's purchased coins
exports.getUserPurchases = async (req, res) => {
  try {
    const userId = req.params.user_id;
    const purchases = await PurchasedCoin.find({ 
      user_id: userId 
    }).sort({ purchaseDate: -1 });
    
    res.status(200).json({ 
      success: true,
      purchases 
    });
  } catch (error) {
    console.error("Error fetching user purchases:", error.message);
    res.status(500).json({ 
      success: false,
      message: "Server error" 
    });
  }
};

// POST /api/purchases/buy - Buy coins using virtual wallet
exports.buyCoin = async (req, res) => {
  const { 
    user_id, 
    coin_id, 
    coin_name, 
    coin_symbol, 
    coin_price_usd, 
    quantity, 
    total_cost, 
    fees, 
    image 
  } = req.body;

  try {
    const result = await executeBuy(
        user_id,
        { coinId: coin_id, coinName: coin_name, coinSymbol: coin_symbol, image },
        quantity,
        coin_price_usd,
        total_cost,
        fees,
        true // deductBalance
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
        userId: result.purchasedCoin.user_id
        },
      newBalance: result.newBalance 
    });

  } catch (err) {
    console.error("Purchase Error", err);
    res.status(err.message === "Insufficient balance" ? 400 : 500).json({ 
      success: false,
      error: err.message || "Unable to process purchase" 
    });
  }
};

// POST /api/purchases/sell - Sell coins
exports.sellCoin = async (req, res) => {
  const { 
    user_id, 
    coin_id, 
    quantity, 
    current_price 
  } = req.body;

  try {
    const result = await executeSell(user_id, coin_id, quantity, current_price);

    res.json({
      success: true,
      message: "Sale successful",
      newBalance: result.newBalance,
      saleAmount: result.saleAmount,
      quantitySold: quantity,
      deletedPurchases: result.deletedPurchases,
      updatedPurchases: result.updatedPurchases
    });
  } catch (error) {
    console.error('Error processing sale:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to process sale' 
    });
  }
};

// GET /api/purchases/balance/:user_id - Get user's virtual balance
exports.getUserBalance = async (req, res) => {
  try {
    const { user_id } = req.params;
    const user = await User.findOne({ id: user_id }).select('virtualBalance');
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: "User not found" 
      });
    }

    res.json({ 
      success: true,
      virtualBalance: user.virtualBalance 
    });
  } catch (err) {
    console.error("Balance fetch error:", err);
    res.status(500).json({ 
      success: false,
      error: "Unable to fetch balance" 
    });
  }
};

// POST /api/purchases/reset-balance - Reset user's virtual balance to 10,000
exports.resetBalance = async (req, res) => {
  try {
    const { user_id } = req.body;
    const user = await User.findOne({ id: user_id });
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: "User not found" 
      });
    }

    user.virtualBalance = 10000;
    await user.save();

    res.json({ 
      success: true,
      message: "Balance reset successfully", 
      newBalance: user.virtualBalance 
    });
  } catch (err) {
    console.error("Reset balance error:", err);
    res.status(500).json({ 
      success: false,
      error: "Unable to reset balance" 
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
          user_id
        } 
      },
      {
        $group: {
          _id: "$coin_id",
          coinName: { $first: "$coinName" },
          coinSymbol: { $first: "$coinSymbol" },
          totalQuantity: { $sum: "$quantity" },
          averagePrice: { $avg: "$coinPriceUSD" },
          image: { $first: "$image" },
          totalInvested: { $sum: "$totalCost" }
        }
      }
    ]);

    res.json({
      success: true,
      holdings
    });
  } catch (error) {
    console.error("Error fetching holdings:", error);
    res.status(500).json({
      success: false,
      error: "Unable to fetch holdings"
    });
  }
};

// Get all transactions (both buys and sells) for a user
exports.getUserTransactionHistory = async (req, res) => {
  try {
    const { user_id } = req.params;
    
    // Get all transactions from Transaction collection
    const transactions = await Transaction.find({ user_id })
      .sort({ transactionDate: -1 });

    res.json({
      success: true,
      transactions
    });
  } catch (error) {
    console.error("Error fetching transaction history:", error);
    res.status(500).json({
      success: false,
      error: "Unable to fetch transaction history"
    });
  }
};

// Get platform-wide statistics (for Admin Dashboard)
exports.getPlatformStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Total Trades Today
    const tradesToday = await Transaction.countDocuments({
      transactionDate: { $gte: today }
    });

    // 2. Active Traders Today (Unique users who traded today)
    const activeTraders = await Transaction.distinct('user_id', {
      transactionDate: { $gte: today }
    });

    // 3. Platform Total Volume Today
    const volumeResult = await Transaction.aggregate([
      { $match: { transactionDate: { $gte: today } } },
      { $group: { _id: null, totalVolume: { $sum: "$totalValue" } } }
    ]);
    const volumeToday = volumeResult.length > 0 ? volumeResult[0].totalVolume : 0;

    // 4. Total Users Count (Overall)
    const totalUsers = await User.countDocuments({});

    res.json({
      success: true,
      stats: {
        tradesToday,
        activeTradersToday: activeTraders.length,
        volumeToday,
        totalUsers
      }
    });
  } catch (error) {
    console.error("Error fetching platform stats:", error);
    res.status(500).json({
      success: false,
      error: "Unable to fetch platform stats"
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
          transactionDate: { $gte: today } 
        } 
      },
      {
        $lookup: {
          from: "users",
          localField: "user_id",
          foreignField: "id",
          as: "userDetails"
        }
      },
      { 
        $unwind: { 
          path: "$userDetails", 
          preserveNullAndEmptyArrays: true 
        } 
      },
      { 
        $sort: { transactionDate: -1 } 
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
          userRole: { $ifNull: ["$userDetails.role", "user"] }
        }
      }
    ]);

    res.json({
      success: true,
      data: transactions
    });
  } catch (error) {
    console.error("Error fetching today's transactions:", error);
    res.status(500).json({
      success: false,
      error: "Unable to fetch transactions"
    });
  }
};
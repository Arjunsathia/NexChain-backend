// Controllers/purchaseController.js - COMPLETE UPDATED VERSION
const PurchasedCoin = require("../Models/PurchasedCoin");
const Transaction = require("../Models/Transaction");
const User = require("../Models/userModel");

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
    const user = await User.findOne({ id: user_id });
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: "User not found" 
      });
    }

    // Check if user has sufficient balance
    if (user.virtualBalance < total_cost) {
      return res.status(400).json({ 
        success: false,
        error: "Insufficient balance", 
        currentBalance: user.virtualBalance,
        required: total_cost 
      });
    }

    // Deduct from virtual wallet
    user.virtualBalance -= total_cost;
    await user.save();

    // Check if user already owns this coin
    let purchasedCoin = await PurchasedCoin.findOne({ user_id, coin_id });

    if (purchasedCoin) {
      // Update existing record (Merge)
      purchasedCoin.quantity += quantity;
      purchasedCoin.totalCost += total_cost;
      // Update average price
      purchasedCoin.coinPriceUSD = purchasedCoin.totalCost / purchasedCoin.quantity;
      // Update other fields if necessary (e.g., latest image)
      purchasedCoin.image = image;
      purchasedCoin.purchaseDate = new Date(); // Update last purchase date
      
      await purchasedCoin.save();
    } else {
      // Create new purchase record
      purchasedCoin = await PurchasedCoin.create({
        user_id,
        coin_id,
        coinName: coin_name,
        coinSymbol: coin_symbol,
        coinPriceUSD: coin_price_usd,
        quantity,
        totalCost: total_cost,
        fees: fees || 0,
        image,
        purchaseDate: new Date()
      });
    }

    // Create transaction record for buy
    await Transaction.create({
      user_id,
      coin_id,
      coinName: coin_name,
      coinSymbol: coin_symbol,
      type: 'buy',
      quantity: quantity,
      price: coin_price_usd,
      totalValue: total_cost,
      fees: fees || 0,
      image,
      transactionDate: new Date(),
      purchaseId: purchasedCoin._id
    });

    res.status(201).json({ 
      success: true,
      message: "Purchase successful", 
      purchase: {
        _id: purchasedCoin._id,
        coinId: purchasedCoin.coin_id,
        coinName: purchasedCoin.coinName,
        coinSymbol: purchasedCoin.coinSymbol,
        coinPriceUSD: purchasedCoin.coinPriceUSD,
        quantity: purchasedCoin.quantity,
        totalCost: purchasedCoin.totalCost,
        fees: purchasedCoin.fees,
        image: purchasedCoin.image,
        purchaseDate: purchasedCoin.purchaseDate,
        userId: purchasedCoin.user_id
      },
      newBalance: user.virtualBalance 
    });

  } catch (err) {
    console.error("Purchase Error", err);
    res.status(500).json({ 
      success: false,
      error: "Unable to process purchase" 
    });
  }
};

// POST /api/purchases/sell - Sell coins (UPDATED to delete and track transactions)
exports.sellCoin = async (req, res) => {
  const { 
    user_id, 
    coin_id, 
    quantity, 
    current_price 
  } = req.body;

  try {
    // Find user's purchases for this coin
    const purchases = await PurchasedCoin.find({ 
      user_id, 
      coin_id
    }).sort({ purchaseDate: 1 });

    if (purchases.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'No holdings found for this coin' 
      });
    }

    // Calculate total available quantity
    const totalAvailable = purchases.reduce((sum, purchase) => sum + purchase.quantity, 0);
    
    if (totalAvailable < quantity) {
      return res.status(400).json({ 
        success: false,
        error: 'Insufficient coin quantity',
        owned: totalAvailable,
        tryingToSell: quantity 
      });
    }

    // Calculate sale amount
    const saleAmount = quantity * current_price;
    
    // Add to user's wallet
    const user = await User.findOne({ id: user_id });
    user.virtualBalance += saleAmount;
    await user.save();

    // Process sales (FIFO method)
    let remainingToSell = quantity;
    const purchasesToUpdate = [];
    const purchasesToDelete = [];

    for (let purchase of purchases) {
      if (remainingToSell <= 0) break;

      const sellQuantity = Math.min(purchase.quantity, remainingToSell);
      const sellTotal = sellQuantity * current_price;

      // Create transaction record for sell
      await Transaction.create({
        user_id,
        coin_id,
        coinName: purchase.coinName,
        coinSymbol: purchase.coinSymbol,
        type: 'sell',
        quantity: sellQuantity,
        price: current_price,
        totalValue: sellTotal,
        fees: 0,
        image: purchase.image,
        transactionDate: new Date(),
        purchaseId: purchase._id
      });

      // Calculate cost basis to reduce
      // Average cost per unit for this specific purchase record
      const averageCost = purchase.totalCost / purchase.quantity;
      const costToReduce = sellQuantity * averageCost;

      // Update purchase quantity and total cost
      purchase.quantity -= sellQuantity;
      purchase.totalCost -= costToReduce;
      
      if (purchase.quantity <= 0) { // Safety check using <=
        // Mark for deletion if fully sold
        purchasesToDelete.push(purchase._id);
      } else {
        // Save updated purchase if partially sold
        purchasesToUpdate.push(purchase);
      }

      remainingToSell -= sellQuantity;
    }

    // Update partially sold purchases
    for (let purchase of purchasesToUpdate) {
      await purchase.save();
    }

    // Delete fully sold purchases
    if (purchasesToDelete.length > 0) {
      await PurchasedCoin.deleteMany({ 
        _id: { $in: purchasesToDelete } 
      });
    }

    res.json({
      success: true,
      message: "Sale successful",
      newBalance: user.virtualBalance,
      saleAmount,
      quantitySold: quantity,
      deletedPurchases: purchasesToDelete.length,
      updatedPurchases: purchasesToUpdate.length
    });
  } catch (error) {
    console.error('Error processing sale:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to process sale' 
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

// POST /api/purchases/reset-balance - Reset user's virtual balance to 100,000
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

    user.virtualBalance = 100000;
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

// NEW: Get all transactions (both buys and sells) for a user
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
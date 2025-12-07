const Order = require("../Models/Order");
const User = require("../Models/userModel");
const PurchasedCoin = require("../Models/PurchasedCoin");
const Transaction = require("../Models/Transaction");
const { v4: uuidv4 } = require("uuid");

// Create a new limit order
exports.createOrder = async (req, res) => {
  const {
    user_id,
    coin_id,
    coin_symbol,
    coin_name,
    coin_image,
    type, // 'buy' or 'sell'
    category = 'limit', // 'market', 'limit', 'stop_limit', 'stop_market'
    limit_price,
    stop_price,
    quantity
  } = req.body;

  try {
    const user = await User.findOne({ id: user_id });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Determine price for value calculation
    // For Limit/Stop-Limit: use limit_price
    // For Market/Stop-Market: use current market price (approx) or stop_price?
    // For simplicity in this MVP, we require limit_price for all except pure market (which isn't handled here yet).
    // If Stop-Market, we might estimate value based on stop_price.
    
    let priceForCalc = limit_price;
    if (category === 'stop_market') priceForCalc = stop_price;
    
    const total_value = priceForCalc * quantity;

    if (type === 'buy') {
      // Check Balance
      if (user.virtualBalance < total_value) {
        return res.status(400).json({ error: "Insufficient balance for order" });
      }

      // Lock Funds
      user.virtualBalance -= total_value;
      await user.save();
    } else if (type === 'sell') {
      // Check Holdings
      const purchases = await PurchasedCoin.find({ user_id, coin_id });
      const totalOwned = purchases.reduce((sum, p) => sum + p.quantity, 0);

      const pendingOrders = await Order.find({ 
        user_id, 
        coin_id, 
        type: 'sell', 
        status: 'pending' 
      });
      const lockedQuantity = pendingOrders.reduce((sum, o) => sum + (o.quantity - o.filled_quantity), 0);

      if (totalOwned - lockedQuantity < quantity) {
        return res.status(400).json({ error: "Insufficient available holdings (check open orders)" });
      }
    }

    const newOrder = await Order.create({
      user_id,
      coin_id,
      coin_symbol,
      coin_name,
      coin_image,
      type,
      category,
      limit_price,
      stop_price,
      quantity,
      total_value,
      status: 'pending'
    });

    res.status(201).json({ success: true, order: newOrder, newBalance: user.virtualBalance });

  } catch (error) {
    console.error("Create Order Error:", error);
    res.status(500).json({ error: "Failed to create order" });
  }
};

// Get pending orders for a user
exports.getOpenOrders = async (req, res) => {
  try {
    const { user_id } = req.params;
    const orders = await Order.find({ user_id, status: 'pending' }).sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch orders" });
  }
};

// Cancel an order
exports.cancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== 'pending') return res.status(400).json({ error: "Cannot cancel non-pending order" });

    // Refund if Buy order
    if (order.type === 'buy') {
      const user = await User.findOne({ id: order.user_id });
      if (user) {
        // Refund the remaining value (total - filled value)
        // For simplicity assuming no partial fills yet in this version
        user.virtualBalance += order.total_value; 
        await user.save();
      }
    }

    order.status = 'cancelled';
    await order.save();

    res.json({ success: true, message: "Order cancelled" });

  } catch (error) {
    res.status(500).json({ error: "Failed to cancel order" });
  }
};

// Execute an order (triggered by price match)
exports.executeOrder = async (req, res) => {
  const { orderId, current_price } = req.body;

  try {
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== 'pending') return res.status(400).json({ error: "Order already processed" });

    // Verify Price Condition
    let executed = false;
    let triggered = false;

    // STOP ORDER LOGIC
    if (order.category === 'stop_limit' || order.category === 'stop_market') {
        // Stop Buy: Trigger when price >= stop_price
        // Stop Sell: Trigger when price <= stop_price
        // (Standard Stop Loss behavior)
        
        let stopHit = false;
        if (order.type === 'buy' && current_price >= order.stop_price) stopHit = true;
        if (order.type === 'sell' && current_price <= order.stop_price) stopHit = true;

        if (stopHit) {
            if (order.category === 'stop_market') {
                executed = true; // Execute immediately as market
            } else {
                // Convert to Limit Order
                order.category = 'limit';
                await order.save();
                return res.json({ success: true, message: "Stop Limit Triggered - Order is now Limit", order });
            }
        } else {
             return res.status(400).json({ error: "Stop price not reached" });
        }
    } 
    // LIMIT ORDER LOGIC
    else if (order.category === 'limit') {
        if (order.type === 'buy' && current_price <= order.limit_price) {
            executed = true;
        } else if (order.type === 'sell' && current_price >= order.limit_price) {
            executed = true;
        }
    }

    if (!executed) {
      return res.status(400).json({ error: "Price condition not met" });
    }

    const user = await User.findOne({ id: order.user_id });

    if (order.type === 'buy') {
      // Logic similar to buyCoin but balance was already deducted.
      // We just need to add the coins.
      
      let purchasedCoin = await PurchasedCoin.findOne({ user_id: order.user_id, coin_id: order.coin_id });

      if (purchasedCoin) {
        purchasedCoin.quantity += order.quantity;
        purchasedCoin.totalCost += order.total_value;
        purchasedCoin.coinPriceUSD = purchasedCoin.totalCost / purchasedCoin.quantity; // Update avg
        purchasedCoin.purchaseDate = new Date();
        await purchasedCoin.save();
      } else {
        await PurchasedCoin.create({
          user_id: order.user_id,
          coin_id: order.coin_id,
          coinName: order.coin_name,
          coinSymbol: order.coin_symbol,
          coinPriceUSD: order.limit_price, // Use limit price as cost basis
          quantity: order.quantity,
          totalCost: order.total_value,
          fees: 0,
          image: order.coin_image,
          purchaseDate: new Date()
        });
      }

      // Transaction Record
      await Transaction.create({
        user_id: order.user_id,
        coin_id: order.coin_id,
        coinName: order.coin_name,
        coinSymbol: order.coin_symbol,
        type: 'buy',
        quantity: order.quantity,
        price: order.limit_price,
        totalValue: order.total_value,
        fees: 0,
        image: order.coin_image,
        transactionDate: new Date()
      });

    } else if (order.type === 'sell') {
      // Logic similar to sellCoin.
      // 1. Deduct holdings (FIFO).
      // 2. Add balance.
      
      const saleAmount = order.quantity * order.limit_price; // Executed at limit price (or better, but using limit for simplicity)
      user.virtualBalance += saleAmount;
      await user.save();

      const purchases = await PurchasedCoin.find({ user_id: order.user_id, coin_id: order.coin_id }).sort({ purchaseDate: 1 });
      
      let remainingToSell = order.quantity;
      const purchasesToDelete = [];
      
      for (let purchase of purchases) {
        if (remainingToSell <= 0) break;

        const sellQuantity = Math.min(purchase.quantity, remainingToSell);
        
        // Update purchase
        const averageCost = purchase.totalCost / purchase.quantity;
        purchase.quantity -= sellQuantity;
        purchase.totalCost -= (sellQuantity * averageCost);

        if (purchase.quantity <= 0.00000001) { // Float safety
             purchasesToDelete.push(purchase._id);
        } else {
             await purchase.save();
        }
        
        remainingToSell -= sellQuantity;
      }

      if (purchasesToDelete.length > 0) {
        await PurchasedCoin.deleteMany({ _id: { $in: purchasesToDelete } });
      }

      // Transaction Record
      await Transaction.create({
        user_id: order.user_id,
        coin_id: order.coin_id,
        coinName: order.coin_name,
        coinSymbol: order.coin_symbol,
        type: 'sell',
        quantity: order.quantity,
        price: order.limit_price,
        totalValue: saleAmount,
        fees: 0,
        image: order.coin_image,
        transactionDate: new Date()
      });
    }

    order.status = 'filled';
    order.filled_quantity = order.quantity; // Fully filled for simplicity
    await order.save();

    res.json({ success: true, message: "Order executed", order });

  } catch (error) {
    console.error("Execute Order Error:", error);
    res.status(500).json({ error: "Failed to execute order" });
  }
};

const Order = require("../Models/Order");
const User = require("../Models/userModel");
const PurchasedCoin = require("../Models/PurchasedCoin");
const { executeBuy, executeSell } = require("../utils/transactionHelpers");

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
    
    // Check Freeze Status
    if (user.isFrozen) {
        return res.status(403).json({ error: "Account is frozen. Trading disabled." });
    }

    // Determine price for value calculation
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
    console.error("Fetch Open Orders Error:", error);
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
    console.error("Cancel Order Error:", error);
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

    if (order.type === 'buy') {
      await executeBuy(
          order.user_id,
          { 
            coinId: order.coin_id, 
            coinName: order.coin_name, 
            coinSymbol: order.coin_symbol, 
            image: order.coin_image 
          },
          order.quantity,
          order.category === 'stop_market' ? current_price : order.limit_price,
          order.total_value,
          0,
          false // Do not deduct balance (already locked)
      );

    } else if (order.type === 'sell') {
       await executeSell(
           order.user_id, 
           order.coin_id, 
           order.quantity, 
           order.category === 'stop_market' ? current_price : order.limit_price
       );
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

const Order = require("../Models/Order");
const User = require("../Models/userModel");
const PurchasedCoin = require("../Models/PurchasedCoin");

// Create a new limit order
exports.createOrder = async (req, res) => {
  const {
    user_id,
    coin_id,
    coin_symbol,
    coin_name,
    coin_image,
    type, // 'buy' or 'sell'
    category = "limit", // 'market', 'limit', 'stop_limit', 'stop_market'
    limit_price,
    stop_price,
    quantity,
  } = req.body;

  try {
    const user = await User.findOne({ id: user_id });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Check Freeze Status
    if (user.isFrozen) {
      return res
        .status(403)
        .json({ error: "Account is frozen. Trading disabled." });
    }

    // Determine price for value calculation
    let priceForCalc = limit_price;
    if (category === "stop_market") priceForCalc = stop_price;

    const total_value = priceForCalc * quantity;

    if (type === "buy") {
      // Check Balance
      if (user.virtualBalance < total_value) {
        return res
          .status(400)
          .json({ error: "Insufficient balance for order" });
      }

      // Lock Funds
      user.virtualBalance -= total_value;
      await user.save();
    } else if (type === "sell") {
      // Check Holdings
      const purchases = await PurchasedCoin.find({ user_id, coin_id });
      const totalOwned = purchases.reduce((sum, p) => sum + p.quantity, 0);

      const pendingOrders = await Order.find({
        user_id,
        coin_id,
        type: "sell",
        status: "pending",
      });
      const lockedQuantity = pendingOrders.reduce(
        (sum, o) => sum + (o.quantity - o.filled_quantity),
        0,
      );

      if (totalOwned - lockedQuantity < quantity) {
        return res.status(400).json({
          error: "Insufficient available holdings (check open orders)",
        });
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
      status: "pending",
    });

    res.status(201).json({
      success: true,
      order: newOrder,
      newBalance: user.virtualBalance,
    });
  } catch (error) {
    console.error("Create Order Error:", error);
    res.status(500).json({ error: "Failed to create order" });
  }
};

// Get pending orders for a user
exports.getOpenOrders = async (req, res) => {
  try {
    const { user_id } = req.params;
    const orders = await Order.find({
      user_id,
      status: { $in: ["pending", "triggered"] },
    }).sort({
      createdAt: -1,
    });
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
    if (order.status !== "pending")
      return res.status(400).json({ error: "Cannot cancel non-pending order" });

    // Refund if Buy order
    if (order.type === "buy") {
      const user = await User.findOne({ id: order.user_id });
      if (user) {
        // Refund the remaining value (total - filled value)
        // For simplicity assuming no partial fills yet in this version
        user.virtualBalance += order.total_value;
        await user.save();
      }
    }

    order.status = "cancelled";
    await order.save();

    res.json({ success: true, message: "Order cancelled" });
  } catch (error) {
    console.error("Cancel Order Error:", error);
    res.status(500).json({ error: "Failed to cancel order" });
  }
};

// Update an existing order
exports.updateOrder = async (req, res) => {
  const { orderId } = req.params;
  const { limit_price, stop_price, quantity } = req.body;

  try {
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "pending") {
      return res.status(400).json({ error: "Only pending orders can be updated" });
    }

    const user = await User.findOne({ id: order.user_id });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Determine new price for value calculation
    let priceForCalc = limit_price !== undefined ? limit_price : order.limit_price;
    if (order.category === "stop_market") {
      priceForCalc = stop_price !== undefined ? stop_price : order.stop_price;
    }

    const newQuantity = quantity !== undefined ? quantity : order.quantity;
    const newTotalValue = priceForCalc * newQuantity;
    const valueDifference = newTotalValue - order.total_value;

    if (order.type === "buy") {
      // If order is now more expensive, check and deduct balance
      if (valueDifference > 0) {
        if (user.virtualBalance < valueDifference) {
          return res.status(400).json({ error: "Insufficient balance for the update" });
        }
        user.virtualBalance -= valueDifference;
      } else if (valueDifference < 0) {
        // Refund the difference
        user.virtualBalance += Math.abs(valueDifference);
      }
      await user.save();
    } else if (order.type === "sell") {
      // If quantity increased, check holdings
      if (newQuantity > order.quantity) {
        const purchases = await PurchasedCoin.find({ user_id: order.user_id, coin_id: order.coin_id });
        const totalOwned = purchases.reduce((sum, p) => sum + p.quantity, 0);

        const pendingOrders = await Order.find({
          user_id: order.user_id,
          coin_id: order.coin_id,
          type: "sell",
          status: "pending",
          _id: { $ne: orderId } // Exclude current order
        });
        const lockedQuantity = pendingOrders.reduce((sum, o) => sum + (o.quantity - o.filled_quantity), 0);

        if (totalOwned - lockedQuantity < newQuantity) {
          return res.status(400).json({
            error: "Insufficient available holdings for this quantity increase",
          });
        }
      }
    }

    // Update the order fields
    if (limit_price !== undefined) order.limit_price = limit_price;
    if (stop_price !== undefined) order.stop_price = stop_price;
    if (quantity !== undefined) order.quantity = quantity;
    order.total_value = newTotalValue;

    await order.save();

    res.json({
      success: true,
      message: "Order updated successfully",
      order,
      newBalance: user.virtualBalance
    });
  } catch (error) {
    console.error("Update Order Error:", error);
    res.status(500).json({ error: "Failed to update order" });
  }
};

const { processOrderExecution } = require("../services/orderExecutionService");

// Execute an order (triggered by price match or manual request)
exports.executeOrder = async (req, res) => {
  const { orderId } = req.body;
  const tradingEngine = require("../services/tradingEngine");

  try {
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    
    // Only allow processing if pending or triggered
    if (order.status !== "pending" && order.status !== "triggered") {
      return res.status(400).json({ error: "Order is not in an executable state" });
    }

    if (!order.coin_symbol) {
      return res.status(400).json({ error: "Order is missing a coin symbol and cannot be processed" });
    }
    const symbol = order.coin_symbol.toLowerCase() + "usdt";
    const priceData = tradingEngine.prices[symbol];

    if (!priceData) {
      return res.status(400).json({ error: "Market data currently unavailable for this asset" });
    }

    // Freshness check: 10 seconds
    const isFresh = (Date.now() - priceData.timestamp) < 10000;
    if (!isFresh) {
      return res.status(400).json({ error: "System is waiting for fresh price data. Please try again in 2s." });
    }

    const currentPrice = priceData.price;

    const result = await processOrderExecution(order, currentPrice);
    res.json(result);
  } catch (error) {
    console.error("Execute Order Error:", error.message);
    res.status(500).json({ error: error.message || "Failed to execute order" });
  }
};

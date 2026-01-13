const User = require("../Models/userModel");
const Notification = require("../Models/Notification");
const { executeBuy, executeSell } = require("../utils/transactionHelpers");
const socketService = require("./socketService");

/**
 * Core logic for evaluating and executing a pending or triggered order.
 * @param {Object} order - The Mongoose Order document
 * @param {number} current_price - The current market price from a trusted source
 * @returns {Promise<Object>} - Execution result { success, message, order, triggered }
 */
const processOrderExecution = async (order, current_price) => {
  let executed = false;

  // 1. STOP ORDER LOGIC (Trigger Phase)
  if (order.category === "stop_limit" || order.category === "stop_market") {
    let stopHit = false;
    
    // Safety check: ensure stop_price exists
    if (order.stop_price === undefined || order.stop_price === null) {
      throw new Error(`Order ${order._id} stop_limit/stop_market missing stop_price`);
    }

    if (order.type === "buy" && current_price >= order.stop_price) stopHit = true;
    if (order.type === "sell" && current_price <= order.stop_price) stopHit = true;

    if (stopHit) {
      if (order.category === "stop_market") {
        executed = true; // Execute immediately as market price
      } else {
        // Convert to Limit Order and set status to triggered
        order.category = "limit";
        order.status = "triggered";
        await order.save();

        console.log(`[Order Service] 🔔 Triggered: ${order.type.toUpperCase()} ${order.coin_symbol} (Stop: ${order.stop_price})`);

        // Create persistent notification
        try {
          const userDoc = await User.findOne({ id: order.user_id });
          if (userDoc) {
            await Notification.create({
              user: userDoc._id,
              title: "Stop Order Triggered",
              message: `The stop price for your ${order.coin_symbol.toUpperCase()} order was hit. Your limit order is now active at $${order.limit_price.toLocaleString()}.`,
              type: "info"
            });
          }
        } catch (notifyError) {
          console.error("[Order Service] ⚠️ Notification Error:", notifyError.message);
        }

        // Notify via WebSocket
        socketService.sendToUser(order.user_id, "ORDER_TRIGGERED", {
          orderId: order._id,
          symbol: order.coin_symbol,
          type: order.type,
          limit_price: order.limit_price
        });

        return {
          success: true,
          message: "Stop Limit Triggered - Order is now active Limit",
          order,
          triggered: true
        };
      }
    } else {
      // Not triggered yet - this is expected in frequent polling
      throw new Error("Stop price not reached");
    }
  }
  
  // 2. LIMIT ORDER LOGIC (Execution Phase)
  else if (order.category === "limit") {
    const isBuyMatch = order.type === "buy" && current_price <= order.limit_price;
    const isSellMatch = order.type === "sell" && current_price >= order.limit_price;
    
    if (isBuyMatch || isSellMatch) {
      executed = true;
    } else {
      throw new Error("Price condition not met");
    }
  }

  // 3. EXECUTION PHASE
  if (executed) {
    console.log(`[Order Service] 💰 Executing: ${order.type.toUpperCase()} ${order.coin_symbol} (Price: ${current_price})`);

    if (order.type === "buy") {
      // Finance optimization: Execute at current_price if it's better than limit_price
      const executionPrice = order.category === "stop_market" ? current_price : Math.min(order.limit_price || current_price, current_price);
      const executionTotal = executionPrice * order.quantity;
      
      await executeBuy(
        order.user_id,
        {
          coinId: order.coin_id,
          coinName: order.coin_name,
          coinSymbol: order.coin_symbol,
          image: order.coin_image,
        },
        order.quantity,
        executionPrice,
        executionTotal,
        0,
        false, // Do not deduct balance (already locked)
      );

      // REFUND LOGIC: If we bought cheaper than the locked total_value, refund the difference
      const refundAmount = order.total_value - executionTotal;
      if (refundAmount > 0.0001) { // Threshold to avoid tiny dust adjustments
        try {
          const userDoc = await User.findOne({ id: order.user_id });
          if (userDoc) {
            userDoc.virtualBalance += refundAmount;
            await userDoc.save();
            console.log(`[Order Service] 💸 Refunded: $${refundAmount.toFixed(4)} to user ${order.user_id}`);
          }
        } catch (refundErr) {
          console.error("[Order Service] ⚠️ Refund Error:", refundErr.message);
        }
      }
    } else if (order.type === "sell") {
      // Finance optimization: Execute at current_price if it's better than limit_price
      const executionPrice = order.category === "stop_market" ? current_price : Math.max(order.limit_price || current_price, current_price);

      await executeSell(
        order.user_id,
        order.coin_id,
        order.quantity,
        executionPrice,
      );
    }

    order.status = "filled";
    order.filled_quantity = order.quantity;
    await order.save();

    // Create persistent notification in DB
    try {
      const userDoc = await User.findOne({ id: order.user_id });
      if (userDoc) {
        await Notification.create({
          user: userDoc._id,
          title: "Order Filled",
          message: `Your ${order.type.toUpperCase()} order for ${order.quantity} ${order.coin_symbol.toUpperCase()} was filled at $${current_price.toLocaleString()}. (Best Price Applied)`,
          type: "success"
        });
      }
    } catch (notifyError) {
      console.error("[Order Service] ⚠️ Success Notification Error:", notifyError.message);
    }

    // Notify via WebSocket
    socketService.sendToUser(order.user_id, "ORDER_FILLED", {
      orderId: order._id,
      symbol: order.coin_symbol,
      type: order.type,
      fillPrice: current_price
    });

    return { success: true, message: "Order executed", order };
  }

  throw new Error("Unknown execution state");
};

module.exports = {
  processOrderExecution
};

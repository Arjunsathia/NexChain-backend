const User = require("../Models/userModel");
const Order = require("../Models/Order");
const Notification = require("../Models/Notification");
const {
  runInTransaction,
  adjustBalance,
  buyInSession,
  sellInSession,
} = require("../utils/transactionHelpers");
const { ACTIVE_STATUSES, getBuyGroupLock, getActiveGroup } = require("../utils/orderLocks");
const socketService = require("./socketService");

// Errors that mean the order can never fill as placed; it is marked failed
// (and its funds released) instead of being retried every engine tick.
const TERMINAL_ERRORS = ["Insufficient coin quantity", "No holdings found for this coin", "Insufficient balance"];
const isTerminalError = (err) => TERMINAL_ERRORS.some((msg) => err.message?.startsWith(msg));

const notifyUser = async (userId, notification) => {
  try {
    const userDoc = await User.findOne({ id: userId }).select("_id");
    if (userDoc) await Notification.create({ user: userDoc._id, ...notification });
  } catch (notifyError) {
    console.error("[Order Service] ⚠️ Notification Error:", notifyError.message);
  }
};

/**
 * Marks the order (and its OCO siblings) failed and releases a buy group's lock.
 */
const failOrder = async (order, reason) => {
  const failed = await runInTransaction(async (session) => {
    const legs = await getActiveGroup(
      await Order.findById(order._id).session(session),
      session,
    );
    if (legs.length === 0) return false;

    await Order.updateMany(
      { _id: { $in: legs.map((leg) => leg._id) }, status: { $in: ACTIVE_STATUSES } },
      { status: "failed", failure_reason: reason, locked_amount: 0 },
      { session },
    );
    const lock = getBuyGroupLock(legs);
    if (lock > 0) await adjustBalance(session, order.user_id, lock);
    return true;
  });
  if (!failed) return;

  await notifyUser(order.user_id, {
    title: "Order Could Not Be Filled",
    message: `Your ${order.type.toUpperCase()} order for ${order.quantity} ${order.coin_symbol.toUpperCase()} was cancelled: ${reason}`,
    type: "warning",
    category: order.category,
  });
  socketService.sendToUser(order.user_id, "ORDER_CANCELLED", { orderId: order._id, reason: "FAILED" });
};

/**
 * Evaluates a pending or triggered order against a trusted price and executes it
 * if its condition is met. Safe to call concurrently: the fill claims the order
 * inside the same transaction, so only one caller can fill it.
 * @param {Object} order - The Mongoose Order document
 * @param {number} current_price - The current market price from a trusted source
 * @returns {Promise<Object>} - { success, message, order, triggered? }
 */
const processOrderExecution = async (order, current_price) => {
  // 1. STOP ORDER LOGIC (Trigger Phase)
  if (order.category === "stop_limit" || order.category === "stop_market") {
    if (order.stop_price === undefined || order.stop_price === null) {
      throw new Error(`Order ${order._id} stop_limit/stop_market missing stop_price`);
    }

    const stopHit =
      (order.type === "buy" && current_price >= order.stop_price) ||
      (order.type === "sell" && current_price <= order.stop_price);
    if (!stopHit) throw new Error("Stop price not reached");

    // Stop-limit becomes an active limit order; OCO siblings stay until a leg fills
    if (order.category === "stop_limit") {
      const triggered = await Order.findOneAndUpdate(
        { _id: order._id, status: "pending", category: "stop_limit" },
        { category: "limit", status: "triggered" },
        { new: true },
      );
      if (!triggered) throw new Error("Order already processed");

      await notifyUser(order.user_id, {
        title: "Stop Order Triggered",
        message: `The stop price for your ${order.coin_symbol.toUpperCase()} order was hit. Your limit order is now active at $${triggered.limit_price.toLocaleString()}.`,
        type: "info",
        category: triggered.category,
      });
      socketService.sendToUser(order.user_id, "ORDER_TRIGGERED", {
        orderId: order._id,
        symbol: order.coin_symbol,
        type: order.type,
        limit_price: triggered.limit_price,
      });

      return {
        success: true,
        message: "Stop Limit Triggered - Order is now active Limit",
        order: triggered,
        triggered: true,
      };
    }
  }
  // 2. LIMIT ORDER LOGIC
  else if (order.category === "limit") {
    const isBuyMatch = order.type === "buy" && current_price <= order.limit_price;
    const isSellMatch = order.type === "sell" && current_price >= order.limit_price;
    if (!isBuyMatch && !isSellMatch) throw new Error("Price condition not met");
  } else {
    throw new Error("Unknown execution state");
  }

  // 3. EXECUTION PHASE
  // Stop-market fills at market; limits fill at the better of market and limit
  let executionPrice = current_price;
  if (order.category !== "stop_market" && order.limit_price) {
    executionPrice =
      order.type === "buy"
        ? Math.min(order.limit_price, current_price)
        : Math.max(order.limit_price, current_price);
  }

  let filled;
  try {
    filled = await runInTransaction(async (session) => {
      // Load the group before claiming so the lock is computed from active legs
      const fresh = await Order.findById(order._id).session(session);
      if (!fresh || !ACTIVE_STATUSES.includes(fresh.status)) {
        throw new Error("Order already processed");
      }
      const legs = await getActiveGroup(fresh, session);

      const claimed = await Order.findOneAndUpdate(
        { _id: order._id, status: { $in: ACTIVE_STATUSES } },
        { status: "filled", filled_quantity: fresh.quantity, locked_amount: 0 },
        { session, new: true },
      );
      if (!claimed) throw new Error("Order already processed");

      const siblings = legs.filter((leg) => !leg._id.equals(claimed._id));
      if (siblings.length > 0) {
        await Order.updateMany(
          { _id: { $in: siblings.map((s) => s._id) }, status: { $in: ACTIVE_STATUSES } },
          { status: "cancelled", locked_amount: 0 },
          { session },
        );
      }

      if (claimed.type === "buy") {
        const executionTotal = executionPrice * claimed.quantity;
        await buyInSession(
          session,
          claimed.user_id,
          {
            coinId: claimed.coin_id,
            coinName: claimed.coin_name,
            coinSymbol: claimed.coin_symbol,
            image: claimed.coin_image,
          },
          claimed.quantity,
          executionPrice,
          executionTotal,
          0,
          false, // funds were locked when the order was placed
        );

        // Return what the group reserved beyond the fill cost. A stop-market can
        // fill above its stop price; the shortfall is charged (and fails the order
        // if the balance can't cover it).
        const difference = getBuyGroupLock(legs) - executionTotal;
        if (Math.abs(difference) > 0.0001) {
          await adjustBalance(session, claimed.user_id, difference);
        }
      } else {
        await sellInSession(session, claimed.user_id, claimed.coin_id, claimed.quantity, executionPrice, {
          orderId: claimed._id,
          ocoGroupId: claimed.oco_group_id,
        });
      }

      return { claimed, siblings };
    });
  } catch (err) {
    if (isTerminalError(err)) await failOrder(order, err.message);
    throw err;
  }

  const { claimed, siblings } = filled;

  for (const sibling of siblings) {
    console.log(`[Order Service] 🔗 OCO: Order ${claimed._id} filled. Cancelled sibling ${sibling._id}`);
    socketService.sendToUser(claimed.user_id, "ORDER_CANCELLED", {
      orderId: sibling._id,
      reason: "OCO_FILLED",
    });
  }

  const isBetterPrice =
    order.category !== "stop_market" && executionPrice !== order.limit_price;
  const priceLabel = isBetterPrice
    ? `at a better price of $${executionPrice.toLocaleString()} (Best Price Applied)`
    : `at $${executionPrice.toLocaleString()}`;

  await notifyUser(claimed.user_id, {
    title: "Order Filled",
    message: `Your ${claimed.type.toUpperCase()} order for ${claimed.quantity} ${claimed.coin_symbol.toUpperCase()} was filled ${priceLabel}.`,
    type: "success",
    category: claimed.category,
  });

  socketService.sendToUser(claimed.user_id, "ORDER_FILLED", {
    orderId: claimed._id,
    symbol: claimed.coin_symbol,
    type: claimed.type,
    fillPrice: executionPrice,
  });

  return { success: true, message: "Order executed", order: claimed };
};

module.exports = {
  processOrderExecution,
};

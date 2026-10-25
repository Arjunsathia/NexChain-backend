const crypto = require("crypto");
const mongoose = require("mongoose");
const Order = require("../Models/Order");
const User = require("../Models/userModel");
const PurchasedCoin = require("../Models/PurchasedCoin");
const FrozenCoin = require("../Models/frozenCoinModel");
const { normalizeCoinImage } = require("../utils/imageUtils");
const { resolveCoin } = require("../services/coinRegistry");
const { processOrderExecution } = require("../services/orderExecutionService");
const tradingEngine = require("../services/tradingEngine");
const { runInTransaction, lockUser, adjustBalance } = require("../utils/transactionHelpers");
const {
  ACTIVE_STATUSES,
  getLockedSellQuantity,
  getBuyGroupLock,
  getActiveGroup,
} = require("../utils/orderLocks");

// Server-side coin lookup shared by order creation. Buys of frozen coins are
// blocked; sells stay allowed so users can exit positions.
const resolveOrderCoin = async (coinId, type, res) => {
  const coin = await resolveCoin(coinId);
  if (!coin) {
    res.status(400).json({ error: "This coin is not available for trading" });
    return null;
  }
  if (type === "buy" && (await FrozenCoin.exists({ coinId: coin.coinId }))) {
    res.status(403).json({ error: "Trading for this coin is currently frozen" });
    return null;
  }
  return coin;
};

// Orders can only be read or changed by their owner
const findOwnOrder = (orderId, userId, session) =>
  mongoose.isValidObjectId(orderId)
    ? Order.findOne({ _id: orderId, user_id: userId }).session(session || null)
    : null;

/** Throws if the user can't cover `quantity` coins on top of their open sell orders */
const assertSellableQuantity = async (session, userId, coinId, quantity, exclude, message) => {
  const purchases = await PurchasedCoin.find({ user_id: userId, coin_id: coinId }).session(session);
  const owned = purchases.reduce((sum, p) => sum + p.quantity, 0);
  const reserved = await getLockedSellQuantity(userId, coinId, session, exclude);
  if (owned - reserved < quantity - 0.00000001) throw new Error(message);
};

const INSUFFICIENT_HOLDINGS = "Insufficient available holdings (check open orders)";

// Business-rule failures thrown inside transactions, mapped to 400s
const sendTradeError = (res, error, fallback, balanceMessage) => {
  if (error.message === "Insufficient balance") {
    return res.status(400).json({ error: balanceMessage });
  }
  if (error.message.startsWith("Insufficient")) {
    return res.status(400).json({ error: error.message });
  }
  console.error(`${fallback}:`, error);
  res.status(500).json({ error: fallback });
};

// Create a new limit / stop order
exports.createOrder = async (req, res) => {
  const user_id = req.user.id;
  const {
    coin_id,
    coin_name,
    coin_image: rawImage,
    type, // 'buy' or 'sell'
    category, // 'limit', 'stop_limit', 'stop_market'
    limit_price,
    stop_price,
    quantity,
  } = req.body;

  try {
    const coin_image = normalizeCoinImage(rawImage);
    const user = await User.findOne({ id: user_id });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.isFrozen) {
      return res
        .status(403)
        .json({ error: "Account is frozen. Trading disabled." });
    }

    const coin = await resolveOrderCoin(coin_id, type, res);
    if (!coin) return;

    const priceForCalc = category === "stop_market" ? stop_price : limit_price;
    const total_value = priceForCalc * quantity;

    const { newOrder, newBalance } = await runInTransaction(async (session) => {
      await lockUser(session, user_id);

      let balance;
      if (type === "buy") {
        // Lock the funds now; virtualBalance is the available balance
        balance = await adjustBalance(session, user_id, -total_value);
      } else {
        await assertSellableQuantity(session, user_id, coin.coinId, quantity, {}, INSUFFICIENT_HOLDINGS);
      }

      const [created] = await Order.create(
        [
          {
            user_id,
            coin_id: coin.coinId,
            coin_symbol: coin.symbol,
            coin_name: coin.name || coin_name,
            coin_image,
            type,
            category,
            limit_price,
            stop_price,
            quantity,
            total_value,
            locked_amount: type === "buy" ? total_value : 0,
            status: "pending",
          },
        ],
        { session },
      );
      return { newOrder: created, newBalance: balance };
    });

    tradingEngine.ensureTracking(`${coin.symbol}usdt`);

    res.status(201).json({
      success: true,
      order: newOrder,
      newBalance: newBalance ?? user.virtualBalance,
    });
  } catch (error) {
    sendTradeError(res, error, "Failed to create order", "Insufficient balance for order");
  }
};

// Create OCO Order (One Cancels the Other)
exports.createOCOOrder = async (req, res) => {
  const user_id = req.user.id;
  const {
    coin_id,
    coin_name: clientCoinName,
    coin_image: rawImage,
    type, // 'buy' or 'sell'
    quantity,
    tp_limit_price, // Leg 1: Take Profit (Limit)
    sl_stop_price, // Leg 2: Stop Loss (Stop Limit or Stop Market)
    sl_limit_price, // Optional: if provided = Stop Limit, else Stop Market
  } = req.body;

  try {
    const coin_image = normalizeCoinImage(rawImage);
    const user = await User.findOne({ id: user_id });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.isFrozen) return res.status(403).json({ error: "Account frozen" });

    const coin = await resolveOrderCoin(coin_id, type, res);
    if (!coin) return;

    const oco_group_id = crypto.randomUUID();
    const base = {
      user_id,
      coin_id: coin.coinId,
      coin_symbol: coin.symbol,
      coin_name: coin.name || clientCoinName,
      coin_image,
      type,
      quantity,
      status: "pending",
      oco_group_id,
    };

    const tpOrder = {
      ...base,
      category: "limit",
      limit_price: tp_limit_price,
      total_value: tp_limit_price * quantity,
    };
    const slOrder = {
      ...base,
      category: sl_limit_price ? "stop_limit" : "stop_market",
      stop_price: sl_stop_price,
      limit_price: sl_limit_price || undefined,
      total_value: (sl_limit_price || sl_stop_price) * quantity,
    };

    // Only one leg can fill, so a buy OCO reserves the larger leg's value once
    // (held on the take-profit leg) and a sell OCO reserves the quantity once.
    const maxRequired = Math.max(tpOrder.total_value, slOrder.total_value);
    tpOrder.locked_amount = type === "buy" ? maxRequired : 0;
    slOrder.locked_amount = 0;

    const { createdOrders, newBalance } = await runInTransaction(async (session) => {
      await lockUser(session, user_id);

      let balance;
      if (type === "buy") {
        balance = await adjustBalance(session, user_id, -maxRequired);
      } else {
        await assertSellableQuantity(
          session,
          user_id,
          coin.coinId,
          quantity,
          {},
          "Insufficient holdings for OCO order",
        );
      }

      const created = await Order.create([tpOrder, slOrder], { session, ordered: true });
      return { createdOrders: created, newBalance: balance };
    });

    tradingEngine.ensureTracking(`${coin.symbol}usdt`);

    res.status(201).json({
      success: true,
      orders: createdOrders,
      message: "OCO Order placed successfully",
      newBalance: newBalance ?? user.virtualBalance,
    });
  } catch (error) {
    sendTradeError(res, error, "Failed to create OCO order", "Insufficient balance for OCO order");
  }
};

// Get open orders for a user
exports.getOpenOrders = async (req, res) => {
  try {
    const { user_id } = req.params;
    const orders = await Order.find({
      user_id,
      status: { $in: ACTIVE_STATUSES },
    }).sort({
      createdAt: -1,
    });
    res.json({ success: true, orders });
  } catch (error) {
    console.error("Fetch Open Orders Error:", error);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
};

// Cancel an order. Cancelling either leg of an OCO cancels the whole group,
// and a buy group's reservation is refunded exactly once.
exports.cancelOrder = async (req, res) => {
  try {
    const result = await runInTransaction(async (session) => {
      const order = await findOwnOrder(req.params.orderId, req.user.id, session);
      if (!order) return { status: 404, body: { error: "Order not found" } };
      if (!ACTIVE_STATUSES.includes(order.status)) {
        return { status: 400, body: { error: "Cannot cancel an order that is no longer open" } };
      }

      const legs = await getActiveGroup(order, session);
      await Order.updateMany(
        { _id: { $in: legs.map((leg) => leg._id) }, status: { $in: ACTIVE_STATUSES } },
        { status: "cancelled", locked_amount: 0 },
        { session },
      );

      const refund = getBuyGroupLock(legs);
      const newBalance = refund > 0 ? await adjustBalance(session, order.user_id, refund) : undefined;

      return {
        status: 200,
        body: {
          success: true,
          message: legs.length > 1 ? "OCO order cancelled" : "Order cancelled",
          cancelledOrderIds: legs.map((leg) => leg._id),
          newBalance,
        },
      };
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    console.error("Cancel Order Error:", error);
    res.status(500).json({ error: "Failed to cancel order" });
  }
};

// Update an existing pending order
exports.updateOrder = async (req, res) => {
  const { limit_price, stop_price, quantity } = req.body;

  try {
    const result = await runInTransaction(async (session) => {
      const order = await findOwnOrder(req.params.orderId, req.user.id, session);
      if (!order) return { status: 404, body: { error: "Order not found" } };
      if (order.status !== "pending") {
        return { status: 400, body: { error: "Only pending orders can be updated" } };
      }
      // The two legs share one reservation, so editing a single leg isn't supported
      if (order.oco_group_id) {
        return {
          status: 400,
          body: { error: "OCO orders can't be edited. Cancel it and place a new one." },
        };
      }

      const newLimit = limit_price !== undefined ? limit_price : order.limit_price;
      const newStop = stop_price !== undefined ? stop_price : order.stop_price;
      const newQuantity = quantity !== undefined ? quantity : order.quantity;
      const priceForCalc = order.category === "stop_market" ? newStop : newLimit;
      const newTotalValue = priceForCalc * newQuantity;

      await lockUser(session, order.user_id);

      let newBalance;
      if (order.type === "buy") {
        // Charge or refund only the difference against what's already reserved
        const difference = newTotalValue - getBuyGroupLock([order]);
        if (Math.abs(difference) > 0.0001) {
          newBalance = await adjustBalance(session, order.user_id, -difference);
        }
        order.locked_amount = newTotalValue;
      } else if (newQuantity > order.quantity) {
        await assertSellableQuantity(
          session,
          order.user_id,
          order.coin_id,
          newQuantity,
          { orderId: order._id },
          "Insufficient available holdings for this quantity increase",
        );
      }

      order.limit_price = newLimit;
      order.stop_price = newStop;
      order.quantity = newQuantity;
      order.total_value = newTotalValue;
      await order.save({ session });

      if (newBalance === undefined) {
        newBalance = (await User.findOne({ id: order.user_id }).session(session)).virtualBalance;
      }

      return {
        status: 200,
        body: { success: true, message: "Order updated successfully", order, newBalance },
      };
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    sendTradeError(res, error, "Failed to update order", "Insufficient balance for the update");
  }
};

// Execute an order (triggered by price match or manual request)
exports.executeOrder = async (req, res) => {
  const { orderId } = req.body;

  try {
    const order = await findOwnOrder(orderId, req.user.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (!ACTIVE_STATUSES.includes(order.status)) {
      return res.status(400).json({ error: "Order is not in an executable state" });
    }

    if (!order.coin_symbol) {
      return res.status(400).json({ error: "Order is missing a coin symbol and cannot be processed" });
    }
    const symbol = order.coin_symbol.toLowerCase() + "usdt";
    const currentPrice = await tradingEngine.waitForPrice(symbol);

    if (!currentPrice) {
      return res.status(400).json({ error: "Market data currently unavailable for this asset" });
    }

    const result = await processOrderExecution(order, currentPrice);
    res.json(result);
  } catch (error) {
    const clientErrors = {
      "Price condition not met": 400,
      "Stop price not reached": 400,
      "Order already processed": 409,
    };
    const status =
      clientErrors[error.message] || (error.message?.startsWith("Insufficient") ? 400 : 500);
    if (status === 500) console.error("Execute Order Error:", error.message);
    res
      .status(status)
      .json({ error: status === 500 ? "Failed to execute order" : error.message });
  }
};

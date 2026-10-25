const Order = require("../Models/Order");

// Orders that still reserve funds or coins
const ACTIVE_STATUSES = ["pending", "triggered"];

/**
 * Coins reserved by the user's open sell orders. Both legs of a sell OCO sell
 * the same coins, so each group counts once (its largest leg).
 * @param {{ orderId?: any, ocoGroupId?: string }} [exclude] order/group being executed or edited
 */
const getLockedSellQuantity = async (userId, coinId, session, exclude = {}) => {
  const orders = await Order.find({
    user_id: userId,
    coin_id: coinId,
    type: "sell",
    status: { $in: ACTIVE_STATUSES },
  }).session(session || null);

  const groups = {};
  let locked = 0;
  for (const order of orders) {
    if (exclude.orderId && order._id.equals(exclude.orderId)) continue;
    if (exclude.ocoGroupId && order.oco_group_id === exclude.ocoGroupId) continue;

    const remaining = order.quantity - (order.filled_quantity || 0);
    if (order.oco_group_id) {
      groups[order.oco_group_id] = Math.max(groups[order.oco_group_id] || 0, remaining);
    } else {
      locked += remaining;
    }
  }
  return locked + Object.values(groups).reduce((sum, q) => sum + q, 0);
};

/**
 * Balance reserved by the active legs of one buy order or buy OCO group.
 * Orders created before `locked_amount` existed fall back to the old rules:
 * a plain buy locked its total_value, a buy OCO locked the larger leg's value.
 */
const getBuyGroupLock = (legs) => {
  const buys = legs.filter((leg) => leg.type === "buy");
  if (buys.length === 0) return 0;
  if (buys.every((leg) => typeof leg.locked_amount === "number")) {
    return buys.reduce((sum, leg) => sum + leg.locked_amount, 0);
  }
  return buys[0].oco_group_id
    ? Math.max(...buys.map((leg) => leg.total_value))
    : buys.reduce((sum, leg) => sum + leg.total_value, 0);
};

/** The order plus its still-active OCO siblings */
const getActiveGroup = async (order, session) =>
  order.oco_group_id
    ? Order.find({ oco_group_id: order.oco_group_id, status: { $in: ACTIVE_STATUSES } }).session(
        session || null,
      )
    : ACTIVE_STATUSES.includes(order.status)
      ? [order]
      : [];

module.exports = { ACTIVE_STATUSES, getLockedSellQuantity, getBuyGroupLock, getActiveGroup };

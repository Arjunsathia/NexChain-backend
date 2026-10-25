const mongoose = require("mongoose");
const Alert = require("../Models/Alert");
const User = require("../Models/userModel");
const Notification = require("../Models/Notification");
const { normalizeCoinImage } = require("../utils/imageUtils");
const { resolveCoin } = require("../services/coinRegistry");

// Create a new price alert
exports.createAlert = async (req, res) => {
  const {
    coin_id,
    coin_name,
    coin_image: rawImage,
    target_price,
    condition, // 'above' or 'below'
  } = req.body;

  try {
    const coin = await resolveCoin(coin_id);
    if (!coin) {
      return res.status(400).json({ error: "Alerts are not available for this coin" });
    }
    const coin_image = normalizeCoinImage(rawImage);

    const newAlert = await Alert.create({
      user_id: req.user.id,
      coin_id: coin.coinId,
      coin_symbol: coin.symbol,
      coin_name: coin.name || coin_name,
      coin_image,
      target_price,
      condition,
      status: "active",
    });

    res.status(201).json({ success: true, alert: newAlert });
  } catch (error) {
    console.error("Create Alert Error:", error);
    res.status(500).json({ error: "Failed to create alert" });
  }
};

// Get active alerts for a user
exports.getAlerts = async (req, res) => {
  try {
    const { user_id } = req.params;
    const alerts = await Alert.find({ user_id, status: "active" }).sort({
      createdAt: -1,
    });
    res.json({ success: true, alerts });
  } catch {
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
};

// Delete an alert
exports.deleteAlert = async (req, res) => {
  try {
    const { alertId } = req.params;
    if (!mongoose.isValidObjectId(alertId)) {
      return res.status(404).json({ error: "Alert not found" });
    }
    const deleted = await Alert.findOneAndDelete({ _id: alertId, user_id: req.user.id });
    if (!deleted) return res.status(404).json({ error: "Alert not found" });
    res.json({ success: true, message: "Alert deleted" });
  } catch {
    res.status(500).json({ error: "Failed to delete alert" });
  }
};

// Check alerts (triggered by frontend or cron)
exports.checkAlerts = async (req, res) => {
  const user_id = req.user.id;
  const current_prices = req.body.current_prices || {}; // { coin_id: price, ... }

  try {
    const alerts = await Alert.find({ user_id, status: "active" });
    const userDoc = await User.findOne({ id: user_id }).select("_id");
    const triggeredAlerts = [];

    for (let alert of alerts) {
      const currentPrice = Number(current_prices[alert.coin_id]);
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) continue;

      let triggered = false;
      if (alert.condition === "above" && currentPrice >= alert.target_price) {
        triggered = true;
      } else if (
        alert.condition === "below" &&
        currentPrice <= alert.target_price
      ) {
        triggered = true;
      }

      if (triggered) {
        alert.status = "triggered";
        alert.triggered_at = new Date();
        await alert.save();
        triggeredAlerts.push(alert);

        // Notification.user is the Mongo _id, not the UUID
        await Notification.create({
          user: userDoc._id,
          title: "Price Alert Triggered",
          message: `${alert.coin_symbol.toUpperCase()} has reached your target price of $${alert.target_price.toLocaleString()}`,
          type: "alert",
          isRead: false,
        });
      }
    }

    res.json({ success: true, triggered: triggeredAlerts });
  } catch (error) {
    console.error("Check Alerts Error:", error);
    res.status(500).json({ error: "Failed to check alerts" });
  }
};

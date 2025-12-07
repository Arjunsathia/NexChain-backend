const Alert = require("../Models/Alert");
const User = require("../Models/userModel");

// Create a new price alert
exports.createAlert = async (req, res) => {
  const {
    user_id,
    coin_id,
    coin_symbol,
    coin_name,
    coin_image,
    target_price,
    condition // 'above' or 'below'
  } = req.body;

  try {
    const newAlert = await Alert.create({
      user_id,
      coin_id,
      coin_symbol,
      coin_name,
      coin_image,
      target_price,
      condition,
      status: 'active'
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
    const alerts = await Alert.find({ user_id, status: 'active' }).sort({ createdAt: -1 });
    res.json({ success: true, alerts });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
};

// Delete an alert
exports.deleteAlert = async (req, res) => {
  try {
    const { alertId } = req.params;
    await Alert.findByIdAndDelete(alertId);
    res.json({ success: true, message: "Alert deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete alert" });
  }
};

// Check alerts (triggered by frontend or cron)
exports.checkAlerts = async (req, res) => {
  const { user_id, current_prices } = req.body; // current_prices: { coin_id: price, ... }

  try {
    const alerts = await Alert.find({ user_id, status: 'active' });
    const triggeredAlerts = [];

    for (let alert of alerts) {
      const currentPrice = current_prices[alert.coin_id];
      if (!currentPrice) continue;

      let triggered = false;
      if (alert.condition === 'above' && currentPrice >= alert.target_price) {
        triggered = true;
      } else if (alert.condition === 'below' && currentPrice <= alert.target_price) {
        triggered = true;
      }

      if (triggered) {
        alert.status = 'triggered';
        alert.triggered_at = new Date();
        await alert.save();
        triggeredAlerts.push(alert);

        // Create Notification
        const Notification = require("../Models/Notification");
        await Notification.create({
          user: user_id,
          title: "Price Alert Triggered",
          message: `${alert.coin_symbol.toUpperCase()} has reached your target price of $${alert.target_price.toLocaleString()}`,
          type: "alert",
          isRead: false
        });
      }
    }

    res.json({ success: true, triggered: triggeredAlerts });
  } catch (error) {
    console.error("Check Alerts Error:", error);
    res.status(500).json({ error: "Failed to check alerts" });
  }
};

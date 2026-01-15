const Alert = require("../Models/Alert");
const Notification = require("../Models/Notification");
const User = require("../Models/userModel");
const emailService = require("../utils/emailService");
const socketService = require("./socketService");

class AlertService {
  constructor() {
    this.processing = false;
    this.lastChecked = {}; // Cache to prevent spamming triggers
  }

  /**
   * Process price updates and check for triggered alerts
   * @param {string} symbol - e.g. "btcusdt"
   * @param {number} price - Current price
   */
  async processPriceUpdate(symbol, price) {
    if (!symbol || !price) return;
    
    // Optimization: Don't query DB if we checked this symbol very recently (e.g. < 2 sec)
    // unless you want tick-perfect precision. For a simulation, throttling is safer.
    const now = Date.now();
    if (this.lastChecked[symbol] && (now - this.lastChecked[symbol] < 2000)) {
        return;
    }
    this.lastChecked[symbol] = now;

    try {
      // Find active alerts for this symbol
      // We search by coin_symbol (case insensitive usually, but storing lower case is best practice)
      const alerts = await Alert.find({ 
        coin_symbol: symbol.toLowerCase(), 
        status: "active" 
      });

      if (!alerts.length) return;

      const triggeredAlerts = [];

      for (const alert of alerts) {
        let isTriggered = false;

        if (alert.condition === "above" && price >= alert.target_price) {
          isTriggered = true;
        } else if (alert.condition === "below" && price <= alert.target_price) {
          isTriggered = true;
        }

        if (isTriggered) {
          triggeredAlerts.push(alert);
        }
      }

      if (triggeredAlerts.length > 0) {
        await this.handleTriggeredAlerts(triggeredAlerts, price);
      }

    } catch (error) {
      console.error(`[Alert Service] Error checking ${symbol}:`, error.message);
    }
  }

  async handleTriggeredAlerts(alerts, currentPrice) {
    for (const alert of alerts) {
      try {
        // 1. Update Alert Status
        alert.status = "triggered";
        alert.triggered_at = new Date();
        await alert.save();

        // 2. Fetch User for Email/Notifications
        const user = await User.findOne({ id: alert.user_id });
        if (!user) continue;

        // 3. Create Persistent Notification
        const message = `${alert.coin_symbol.toUpperCase()} has reached your target of $${alert.target_price.toLocaleString()}. Current: $${currentPrice.toLocaleString()}`;
        
        await Notification.create({
          user: user._id,
          title: "Price Alert Triggered",
          message,
          type: "alert", // Special type we can style differently if needed
          isRead: false
        });

        // 4. Send Real-Time Socket Event
        socketService.sendToUser(alert.user_id, "ALERT_TRIGGERED", {
          alertId: alert._id,
          symbol: alert.coin_symbol,
          targetPrice: alert.target_price,
          currentPrice: currentPrice,
          message
        });

        // 5. Send Email
        if (user.email) {
            const emailHtml = `
            <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f9fafb;">
                <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                    <div style="background: #2563eb; padding: 20px; text-align: center;">
                        <h2 style="color: white; margin: 0;">Price Alert Hit! 🚀</h2>
                    </div>
                    <div style="padding: 30px;">
                        <h3 style="color: #1f2937; margin-top: 0;">Your alert for ${alert.coin_name} was triggered.</h3>
                        <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
                            The price of <strong>${alert.coin_symbol.toUpperCase()}</strong> has ${alert.condition === 'above' ? 'risen above' : 'dropped below'} your target.
                        </p>
                        
                        <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 15px; margin: 20px 0;">
                            <p style="margin: 5px 0; color: #1e40af; font-size: 14px;">Target Price</p>
                            <p style="margin: 0; color: #1e3a8a; font-size: 24px; font-weight: bold;">$${alert.target_price.toLocaleString()}</p>
                        </div>
                        
                        <div style="background: #f3f4f6; border-left: 4px solid #6b7280; padding: 15px; margin: 0 0 20px 0;">
                            <p style="margin: 5px 0; color: #374151; font-size: 14px;">Current Market Price</p>
                            <p style="margin: 0; color: #111827; font-size: 24px; font-weight: bold;">$${currentPrice.toLocaleString()}</p>
                        </div>

                        <div style="text-align: center; margin-top: 30px;">
                            <a href="${process.env.CLIENT_URL || '#'}" style="background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">View Market</a>
                        </div>
                    </div>
                    <div style="background: #f9fafb; padding: 15px; text-align: center; border-top: 1px solid #e5e7eb;">
                        <p style="color: #9ca3af; font-size: 12px; margin: 0;">NexChain Mock Exchange • Automated Alert</p>
                    </div>
                </div>
            </div>
            `;
            
            // Fire and forget email to not block the thread
            emailService.sendEmail(user.email, `Price Alert: ${alert.coin_symbol.toUpperCase()}`, emailHtml).catch(err => {
                console.error(`[Alert Service] Failed to send email to ${user.email}:`, err.message);
            });
        }

        console.log(`[Alert Service] Triggered ${alert.coin_symbol} for user ${user.id}`);

      } catch (error) {
        console.error(`[Alert Service] Error handling trigger for ${alert._id}:`, error.message);
      }
    }
  }
}

const alertService = new AlertService();
module.exports = alertService;

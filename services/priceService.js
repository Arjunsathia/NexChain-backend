const axios = require("axios");

const priceService = {
  /**
   * Fetches the current price of a cryptocurrency.
   * @param {string} symbol - The coin symbol (e.g., "BTC", "ETH").
   * @param {string} currency - The quote currency (default: "USDT").
   * @returns {Promise<number|null>} - The price or null if not found.
   */
  async getPrice(symbol, currency = "USDT") {
    try {
      const pair = `${symbol.toUpperCase()}${currency.toUpperCase()}`;
      
      // Using Binance API as primary source (same as TradingEngine)
      // Tries main API first, then US/Backup if needed
      const endpoints = [
        `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`,
        `https://api.binance.us/api/v3/ticker/price?symbol=${pair}`,
        `https://data-api.binance.vision/api/v3/ticker/price?symbol=${pair}`
      ];

      for (const url of endpoints) {
        try {
          const response = await axios.get(url, { timeout: 3000 });
          if (response.data && response.data.price) {
            return parseFloat(response.data.price);
          }
        } catch (e) {
             // Continue to next endpoint
        }
      }
      
      console.warn(`[PriceService] ⚠️ Could not fetch price for ${pair}`);
      return null;

    } catch (error) {
      console.error("[PriceService] Error:", error.message);
      return null;
    }
  }
};

module.exports = priceService;

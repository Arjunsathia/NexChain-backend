const WebSocket = require("ws");
const https = require("https");
const Order = require("../Models/Order");
const Alert = require("../Models/Alert");
const { processOrderExecution } = require("./orderExecutionService");
const cron = require("node-cron");

// WebSocket ready states
const WS_OPEN = 1;
const WS_CLOSED = 3;

const { CORE_SYMBOLS } = require("../config/coins");

class TradingEngine {
  constructor() {
    this.prices = {};
    this.ws = null;
    this.activeSymbols = new Set(); // Start empty to force sync on first run
    this.reconnectAttempts = 0;
    this.isProcessing = false;
  }

  start() {
    console.log("🚀 [TRADING ]  Initializing engine...");
    
    // 1. Initial subscription and DB sync
    this.syncWithDatabase().catch(err => console.error("❌ [TRADING ]  Sync Error:", err.message));

    // 2. Schedule regular DB syncs
    cron.schedule("*/30 * * * * *", async () => {
      try {
        await this.syncWithDatabase();
      } catch (err) {
        console.error("❌ [TRADING ]  Cron Sync Error:", err.message);
      }
    });

    // 3. Schedule order execution check
    cron.schedule("*/5 * * * * *", async () => {
      try {
        await this.checkAndExecuteOrders();
      } catch (err) {
        console.error("❌ [TRADING ]  Execution Error:", err.message);
      }
    });

    console.log("✅ [TRADING ]  Engine active and running.");
  }

  async syncWithDatabase() {
    try {
      const orders = await Order.find({ status: { $in: ["pending", "triggered"] } });
      const orderSymbols = orders
        .filter(o => o.coin_symbol)
        .map(o => o.coin_symbol.toLowerCase().endsWith("usdt") ? o.coin_symbol.toLowerCase() : o.coin_symbol.toLowerCase() + "usdt");
      
      const alerts = await Alert.find({ status: "active" });
      const alertSymbols = alerts
        .filter(a => a.coin_symbol)
        .map(a => a.coin_symbol.toLowerCase().endsWith("usdt") ? a.coin_symbol.toLowerCase() : a.coin_symbol.toLowerCase() + "usdt");

      const currentSymbols = new Set([...CORE_SYMBOLS, ...orderSymbols, ...alertSymbols]);

      // Check if any NEW symbols need to be tracked
      const newSymbols = [...currentSymbols].filter(s => !this.activeSymbols.has(s));

      if (newSymbols.length > 0) {
        console.log(`➕ [TRADING ]  Subscribing to ${newSymbols.length} new symbols...`);
        newSymbols.forEach(s => this.activeSymbols.add(s));
        
        // If WS is open, send SUBSCRIBE message instead of reconnecting
        if (this.ws && this.ws.readyState === WS_OPEN) {
          try {
            const params = newSymbols.map(s => `${s}@ticker`);
            this.ws.send(JSON.stringify({
              method: "SUBSCRIBE",
              params: params,
              id: Date.now()
            }));
          } catch (sendErr) {
            console.error("[TRADING ] 📡 Subscription send failed:", sendErr.message);
            this.connectWebSocket(); // Reconnect on failed send
          }
        } else {
          this.connectWebSocket();
        }
      }
    } catch (error) {
      console.error("[TRADING ] ❌ Sync Error:", error.message);
    }
  }

  async ensureTracking(symbol) {
    if (!symbol) return;
    const s = symbol.toLowerCase();
    if (!this.activeSymbols.has(s)) {
      console.log(`[TRADING ] 🔍 Request to track ${s}`);
      this.activeSymbols.add(s) ;
      
      if (this.ws && this.ws.readyState === WS_OPEN) {
        try {
          console.log(`[TRADING ] 📡 Sending SUBSCRIBE for ${s}`);
          this.ws.send(JSON.stringify({
            method: "SUBSCRIBE",
            params: [`${s}@ticker`],
            id: Date.now()
          }));
        } catch (sendErr) {
          console.error("[TRADING ] 📡 Manual subscription send failed:", sendErr.message);
          this.connectWebSocket();
        }
      } else if (!this.ws || this.ws.readyState === WS_CLOSED) {
        // Only trigger connect if it's NOT currently connecting
        this.connectWebSocket();
      } else if (this.ws.readyState === 0) { // CONNECTING
        console.log(`[TRADING ] ⏳ Socket connecting... ${s} will be tracked once open.`);
      }
    }
  }

  /**
   * Robust price retrieval with REST fallback
   */
  async getPrice(symbol) {
    const s = symbol.toLowerCase();
    
    // 0. Special Case: USDT/USDT (Tether is always 1.0)
    if (s === "usdtusdt") return 1.0;

    // 1. Try WebSocket cache (Freshness: 10s)
    if (this.prices[s] && (Date.now() - this.prices[s].timestamp < 60000)) {
      return this.prices[s].price;
    }

    // 2. Try REST API Fallback
    // 2. Try REST API Fallback
    // console.debug(`[TRADING ] 🌐 Fetching REST fallback for ${s}`); 
    try {
      const price = await this.fetchPriceREST(s);
      if (price) {
        this.prices[s] = { price, timestamp: Date.now() };
        return price;
      } else {
        // console.warn(`[TRADING ] ⚠️ Binance REST returned null for ${s}`);
      }
    } catch {
      // console.error(`[TRADING ] ❌ REST Fallback Failed for ${s}:`, err.message);
    }
    return null;
  }

  /**
   * Wait for a price to become available
   */
  async waitForPrice(symbol, maxWaitMs = 5000) {
    const s = symbol.toLowerCase();
    this.ensureTracking(s);

    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const price = await this.getPrice(s);
      if (price) return price;
      
      console.log(`[TRADING ] ⏳ Waiting for ${s} price (${Math.round((Date.now() - start)/1000)}s)...`);
      await new Promise(r => setTimeout(r, 200));
    }
    
    console.error(`[TRADING ] ❌ Timeout waiting for ${s}`);
    return null;
  }

  async fetchPriceREST(symbol) {
    const s = symbol.toUpperCase();
    // Try multiple endpoints to handle region-blocking (e.g. Render US servers blocked by Global Binance)
    const endpoints = [
      `https://api.binance.com/api/v3/ticker/price?symbol=${s}`,
      `https://api.binance.us/api/v3/ticker/price?symbol=${s}`,
      `https://data-api.binance.vision/api/v3/ticker/price?symbol=${s}`
    ];

    for (const url of endpoints) {
      try {
        const price = await this._performRequest(url);
        if (price) return price;
      } catch {
        // Continue to next endpoint if this one fails
      }
    }
    return null;
  }

  _performRequest(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 2500 }, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`Status ${res.statusCode}`));
              return;
            }
            const body = JSON.parse(data);
            if (body && body.price) {
              resolve(parseFloat(body.price));
            } else {
              resolve(null);
            }
          } catch {
            reject(new Error("Parse error"));
          }
        });
      });
      
      req.on("error", (err) => reject(err));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Timeout"));
      });
    });
  }

  connectWebSocket() {
    if (this.ws) {
      // If already open or connecting, don't start a second one
      if (this.ws.readyState === 0 || this.ws.readyState === 1) {
        return;
      }
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }

    if (this.activeSymbols.size === 0) return;

    const streams = [...this.activeSymbols].map(s => `${s}@ticker`).join("/");
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      this.reconnectAttempts = 0;
    });

      const alertService = require("./alertService"); // Lazy load or move to top

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.stream && msg.data) {
          const symbol = msg.data.s.toLowerCase();
          const price = parseFloat(msg.data.c);
          
          this.prices[symbol] = {
            price,
            timestamp: Date.now()
          };

          // CHECK ALERTS
          alertService.processPriceUpdate(symbol, price);
        }
      } catch { /* silent */ }
    });

    this.ws.on("error", (err) => {
      console.error("[TRADING ] ⚠️ WebSocket Error:", err.message);
    });

    this.ws.on("close", () => {
      // Avoid log spam if we closed it ourselves via sync
      if (this.ws === null) return; 

      console.log("[TRADING ] 🔌 WebSocket Closed. Reconnecting...");
      setTimeout(() => {
        this.reconnectAttempts++;
        if (this.reconnectAttempts < 5) this.connectWebSocket();
      }, Math.min(30000, 2000 * Math.pow(2, this.reconnectAttempts))); // Exponential backoff
    });
  }

  async checkAndExecuteOrders() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Find orders that are pending or triggered (waiting for price match)
      // Limit to 100 to prevent memory bloating per tick if backlog grows
      const activeOrders = await Order.find({ status: { $in: ["pending", "triggered"] } }).limit(100);
      
      // Process in chunks of 10 to avoid overwhelming DB/Event Loop but faster than sequential
      const CHUNK_SIZE = 10;
      for (let i = 0; i < activeOrders.length; i += CHUNK_SIZE) {
        const chunk = activeOrders.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(order => this.processSingleOrder(order)));
      }

    } catch (error) {
      console.error("[TRADING ] ❌ Loop Error:", error.message);
    } finally {
      this.isProcessing = false;
    }
  }

  async processSingleOrder(order) {
    if (!order.coin_symbol) return;
    const symbol = order.coin_symbol.toLowerCase() + "usdt";
    const priceData = this.prices[symbol];

    if (!priceData) return;

    // Freshness check: 20 seconds
    const isFresh = (Date.now() - priceData.timestamp) < 20000;
    if (!isFresh) return;

    const currentPrice = priceData.price;

    try {
      // processOrderExecution is now robust but we catch internal errors here to not stop the loop
      await processOrderExecution(order, currentPrice);
    } catch (error) {
      // Ignore common non-errors
      if (error.message !== "Price condition not met" && error.message !== "Stop price not reached") {
        console.error(`[Trading Engine] ❌ Execution Error (${order._id}):`, error.message);
      }
    }
  }
}

const engine = new TradingEngine();
module.exports = engine;

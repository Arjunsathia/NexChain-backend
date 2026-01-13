const WebSocket = require("ws");
const Order = require("../Models/Order");
const { processOrderExecution } = require("./orderExecutionService");
const cron = require("node-cron");

const CORE_SYMBOLS = [
  "btcusdt", "ethusdt", "bnbusdt", "xrpusdt", "adausdt", "solusdt",
  "dogeusdt", "dotusdt", "maticusdt", "ltcusdt", "linkusdt", "xlmusdt",
  "atomusdt", "xmusdt", "etcusdt", "bchusdt", "filusdt", "thetausdt",
  "vetusdt", "trxusdt", "avaxusdt", "shibusdt", "tonusdt", "usdcusdt",
  "usdtusdt", "arbusdt", "opusdt", "nearusdt", "aptusdt", "ftmusdt"
];

class TradingEngine {
  constructor() {
    this.prices = {};
    this.ws = null;
    this.activeSymbols = new Set(); // Start empty to force sync on first run
    this.reconnectAttempts = 0;
    this.isProcessing = false;
  }

  start() {
    console.log("🚀 [Trading Engine] Initializing...");
    
    // 1. Initial subscription and DB sync
    this.syncWithDatabase();

    // 2. Schedule regular DB syncs (check for new symbols every 30 seconds)
    cron.schedule("*/30 * * * * *", () => {
      this.syncWithDatabase();
    });

    // 3. Schedule order execution check every 5 seconds
    // We check prices against orders periodically to avoid overwhelming the CPU on Every tick
    cron.schedule("*/5 * * * * *", () => {
      this.checkAndExecuteOrders();
    });

    console.log("✅ [Trading Engine] Running.");
  }

  async syncWithDatabase() {
    try {
      const orders = await Order.find({ status: { $in: ["pending", "triggered"] } });
      const orderSymbols = orders
        .filter(o => o.coin_symbol)
        .map(o => o.coin_symbol.toLowerCase() + "usdt");
      
      const currentSymbols = new Set([...CORE_SYMBOLS, ...orderSymbols]);

      // Check if any symbols are DIFFERENT from what we currently track
      const needsUpdate = 
        currentSymbols.size !== this.activeSymbols.size || 
        [...currentSymbols].some(s => !this.activeSymbols.has(s));

      if (needsUpdate) {
        const added = [...currentSymbols].filter(s => !this.activeSymbols.has(s));
        const removed = [...this.activeSymbols].filter(s => !currentSymbols.has(s));
        
        console.log(`[Trading Engine] 🔄 Syncing stream (+${added.length} / -${removed.length})`);
        this.activeSymbols = currentSymbols;
        this.connectWebSocket();
      }
    } catch (error) {
      console.error("[Trading Engine] ❌ Sync Error:", error.message);
    }
  }

  async ensureTracking(symbol) {
    if (!symbol) return;
    const s = symbol.toLowerCase();
    if (!this.activeSymbols.has(s)) {
      console.log(`[Trading Engine] 📡 Adding dynamic tracking for: ${s}`);
      this.activeSymbols.add(s);
      this.connectWebSocket();
    }
  }

  connectWebSocket() {
    if (this.ws) {
      // Clean cleanup: remove listeners before terminating to avoid "close" firing during manual restart
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }

    if (this.activeSymbols.size === 0) return;

    const streams = [...this.activeSymbols].map(s => `${s}@ticker`).join("/");
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log(`[Trading Engine] 🌐 WebSocket Connected (${this.activeSymbols.size} symbols)`);
      this.reconnectAttempts = 0;
    });

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
        }
      } catch { /* silent */ }
    });

    this.ws.on("error", (err) => {
      console.error("[Trading Engine] ⚠️ WebSocket Error:", err.message);
    });

    this.ws.on("close", () => {
      // Avoid log spam if we closed it ourselves via sync
      if (this.ws === null) return; 

      console.log("[Trading Engine] 🔌 WebSocket Closed. Reconnecting...");
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
      const activeOrders = await Order.find({ status: { $in: ["pending", "triggered"] } });
      
      for (const order of activeOrders) {
        if (!order.coin_symbol) continue;
        const symbol = order.coin_symbol.toLowerCase() + "usdt";
        const priceData = this.prices[symbol];

        if (!priceData) continue;

        // Freshness check: 20 seconds (flexible for production network variance)
        const isFresh = (Date.now() - priceData.timestamp) < 20000;
        if (!isFresh) continue;

        const currentPrice = priceData.price;

        try {
          const result = await processOrderExecution(order, currentPrice);
          if (result.success) {
            const coin = order.coin_symbol.toUpperCase();
            if (result.triggered) {
              console.log(`[Trading Engine] 🔔 Triggered: ${coin} at $${currentPrice}`);
            } else {
              console.log(`[Trading Engine] 💰 Filled: ${order.type.toUpperCase()} ${coin} at $${currentPrice}`);
            }
          }
        } catch (error) {
          if (error.message !== "Price condition not met" && error.message !== "Stop price not reached") {
            console.error(`[Trading Engine] ❌ Execution Error (${order._id}):`, error.message);
          }
        }
      }
    } catch (error) {
      console.error("[Trading Engine] ❌ Loop Error:", error.message);
    } finally {
      this.isProcessing = false;
    }
  }
}

const engine = new TradingEngine();
module.exports = engine;

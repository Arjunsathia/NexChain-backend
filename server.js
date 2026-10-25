// server.js
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const path = require("path");
const helmet = require("helmet").default;
const mongoSanitize = require("express-mongo-sanitize");

// Load environment config
dotenv.config({ path: path.join(__dirname, ".env") });
require("./config/env")();

const fs = require("fs");
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const connectDB = require("./config/db");
const tradingEngine = require("./services/tradingEngine");

// Route imports
const userRoutes = require("./Routes/userRoutes");
const watchListRoutes = require("./Routes/watchlistRoutes");
const purchaseRoutes = require("./Routes/purchaseRoutes");
const feedbackRoutes = require("./Routes/feedbackRoutes");
const orderRoutes = require("./Routes/orderRoutes");
const alertRoutes = require("./Routes/alertRoutes");
const kycRoutes = require("./Routes/kycRoutes");
const notificationRoutes = require("./Routes/notificationRoutes");
const authRoutes = require("./Routes/authRoutes");
const coinRoutes = require("./Routes/coinRoutes");
const newsRoutes = require("./Routes/newsRoutes");
const chatRoutes = require("./Routes/chatRoutes");
const twoFactorRoutes = require("./Routes/twoFactorRoutes");


const app = express();

// Behind Render's proxy: use X-Forwarded-For for req.ip (rate limits, audit logs)
app.set("trust proxy", 1);

// CORS configuration (CORS_ORIGINS: comma-separated extra origins)
const allowedOrigins = [
  process.env.CLIENT_URL,
  ...(process.env.CORS_ORIGINS || "").split(","),
]
  .map((origin) => origin && origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Admin-2FA-Code"],
  credentials: true,
};

// Structured request logs in production (Render log stream)
if (process.env.NODE_ENV === "production") {
  app.use(
    require("pino-http").pinoHttp({
      autoLogging: { ignore: (req) => req.url === "/api/health" },
      redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
    }),
  );
}

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: "100kb" }));

// Serve the uploads directory statically for image access
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Security Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow images to be loaded by frontend
  })
);

// Manual Mongo Sanitize: Express 5 exposes req.query as a getter, so it is
// redefined with the sanitized copy instead of assigned.
app.use((req, res, next) => {
  if (req.body) req.body = mongoSanitize.sanitize(req.body);
  if (req.params) req.params = mongoSanitize.sanitize(req.params);
  if (req.query) {
    Object.defineProperty(req, "query", {
      value: mongoSanitize.sanitize({ ...req.query }),
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  next();
});

// Rate limits live next to their routes (middleware/rateLimiters.js)

// Health check (Render probes it; the admin dashboard shows it). Public, so it
// only exposes operational status. 503 when the database is unreachable.
app.get("/api/health", async (req, res) => {
  const mongoose = require("mongoose");
  const started = Date.now();
  let dbOk = false;
  try {
    dbOk = mongoose.connection.readyState === 1 && !!(await mongoose.connection.db.admin().ping());
  } catch {
    dbOk = false;
  }
  const dbLatencyMs = Date.now() - started;

  const prices = Object.values(tradingEngine.prices);
  const freshSymbols = prices.filter((p) => Date.now() - p.timestamp < 60000).length;

  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? "ok" : "degraded",
    uptimeSeconds: Math.round(process.uptime()),
    db: { ok: dbOk, latencyMs: dbLatencyMs },
    priceFeed: {
      connected: tradingEngine.ws?.readyState === 1,
      freshSymbols,
      trackedSymbols: tradingEngine.activeSymbols.size,
    },
  });
});

// Routes 
app.use("/api/users", userRoutes);
app.use("/api/watchlist", watchListRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/kyc", kycRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/coins", coinRoutes);
app.use("/api/news", newsRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/2fa", twoFactorRoutes);


// Global Error Handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Server Error:", err.message);

  // Joi errors are normally answered by middleware/validation.js
  if (err.isJoi) {
    return res.status(400).json({
      success: false,
      message: "Validation Error",
      errors: err.details.map((d) => d.message),
    });
  }

  // Handle MongoDB Duplicate Key Error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(409).json({
      success: false,
      message: `Duplicate field value entered: ${field}`,
    });
  }

  // Handle MongoDB Cast Error (Invalid ID)
  if (err.name === "CastError") {
    return res.status(400).json({
      success: false,
      message: `Resource not found. Invalid: ${err.path}`,
    });
  }

  // Internal error details stay in the logs in production
  const status = err.status || (res.statusCode >= 400 ? res.statusCode : 500);
  const hide = status >= 500 && process.env.NODE_ENV === "production";
  res.status(status).json({
    success: false,
    message: hide ? "Internal Server Error" : err.message || "Internal Server Error",
    errors: hide ? undefined : err.errors || undefined,
  });
});

const PORT = process.env.PORT || 4001;

// Only connect and start background jobs when run directly (not when imported by tests)
if (require.main === module) {
  const mongoose = require("mongoose");
  const socketService = require("./services/socketService");

  // ENGINE_ENABLED=false runs the API without the order engine and cron jobs.
  // Only one running instance may have the engine on, or orders are processed twice.
  const engineEnabled = process.env.ENGINE_ENABLED !== "false";

  connectDB().then(() => {
    if (engineEnabled) tradingEngine.start();
    else console.log("[TRADING ] ⏸  Engine disabled (ENGINE_ENABLED=false)");
  });

  const server = app.listen(PORT, () => {
    console.log(`[SERVER  ] ✅ Running on port ${PORT}`);
    console.log(`[SERVER  ]  Environment: ${process.env.NODE_ENV || "development"}`);
  });
  socketService.init(server);

  // Render sends SIGTERM on every deploy: stop taking work, let in-flight
  // requests and trades finish, then exit
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[SERVER  ] ${signal} received, shutting down...`);
    tradingEngine.stop();
    socketService.close();
    server.close(async () => {
      await mongoose.disconnect().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = app; // Export for testing

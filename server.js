// server.js
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const path = require("path");
const helmet = require("helmet").default;
const mongoSanitize = require("express-mongo-sanitize");

// Load environment config early to ensure variables are available
dotenv.config({ path: path.join(__dirname, ".env") });

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


const app = express();

// connection to MongoDB Atlas
connectDB().then(() => {
  // Start the background trading engine
  tradingEngine.start();
});

// CORS configuration
const corsOptions = {
  origin: [process.env.CLIENT_URL, "https://nexchain-black.vercel.app", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());

// Serve the uploads directory statically for image access
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Security Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow images to be loaded by frontend
  })
);

// Manual Mongo Sanitize to handle Express 5 read-only properties
app.use((req, res, next) => {
  if (req.body) req.body = mongoSanitize.sanitize(req.body);
  if (req.params) req.params = mongoSanitize.sanitize(req.params);
  
  // Clean query safely (ignore if read-only getter)
  try {
    if (req.query) req.query = mongoSanitize.sanitize(req.query);
  } catch (err) {
    // console.warn("Could not sanitize query:", err.message);
  }
  next();
});

// Rate Limiting for Auth Routes is handled in authRoutes.js with specific limiters
// const authLimiter = ... (removed to avoid conflict)

// app.use("/api/auth", authLimiter); // Removed

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


// Global Error Handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Server Error:", err.message);

  // Handle Joi Validation Errors (fallback if middleware didn't catch it, though check used there)
  // Actually, Joi errors are usually handled in the middleware, but if thrown:
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

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
    errors: err.errors || undefined, // For other structured errors
  });
});

const PORT = process.env.PORT || 5000;

let server;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app; // Export for testing

// Initialize real-time socket updates
const socketService = require("./services/socketService");
if (server) {
  socketService.init(server);
}

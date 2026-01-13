// server.js
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const path = require("path"); 

// Load environment config early to ensure variables are available
dotenv.config();

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

const app = express();

// connection to MongoDB Atlas
connectDB().then(() => {
  // Start the background trading engine
  tradingEngine.start();
});

// CORS configuration
const corsOptions = {
  origin: process.env.CLIENT_URL,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());

// Serve the uploads directory statically for image access
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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

// Global Error Handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Server Error:", err.message);
  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

const PORT = process.env.PORT || 5050;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Initialize real-time socket updates
const socketService = require("./services/socketService");
socketService.init(server);

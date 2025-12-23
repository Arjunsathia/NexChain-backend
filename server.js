// server.js
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const path = require("path"); // ✅ For handling file paths

// ✅ Load environment variables BEFORE using them anywhere
dotenv.config();

const fs = require("fs");
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const connectDB = require("./config/db");

// Route imports
const userRoutes = require("./Routes/userRoutes");
const watchListRoutes = require("./Routes/watchlistRoutes");
const purchaseRoutes = require("./Routes/purchaseRoutes");
const feedbackRoutes = require("./Routes/feedbackRoutes");
const orderRoutes = require("./Routes/orderRoutes");
const alertRoutes = require("./Routes/alertRoutes");
const kycRoutes = require("./Routes/kycRoutes");
const twoFactorRoutes = require("./Routes/twoFactorRoutes");
const notificationRoutes = require("./Routes/notificationRoutes");

const app = express();

// ✅ Connect to MongoDB Atlas
connectDB();

// CORS setup
const corsOptions = {
  origin: process.env.CLIENT_URL,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());

// ✅ EXPOSE UPLOADS FOLDER (Images won't load without this)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.use("/api/users", userRoutes);
app.use("/api/watchlist", watchListRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/kyc", kycRoutes);
app.use("/api/2fa", twoFactorRoutes);
app.use("/api/notifications", notificationRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("🔥 Error:", err.message);
  res.status(500).json({ 
    success: false, 
    message: err.message || "Internal Server Error" 
  });
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
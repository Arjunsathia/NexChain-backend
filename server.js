const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();

const connectDB = require("./config/db");
const userRoutes = require("./Routes/userRoutes");
const watchListRoutes = require("./Routes/watchlistRoutes");
const paymentRoutes = require("./Routes/paymentRoutes");

connectDB();

const corsOptions = {
  origin: "http://localhost:5173", 
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true, // optional
};

app.use(cors(corsOptions));
app.use(express.json());
const cookieParser = require("cookie-parser");
app.use(cookieParser()); 

app.use("/api/users", userRoutes);
app.use("/api/watchlist", watchListRoutes);
app.use("/api/payment", paymentRoutes);

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
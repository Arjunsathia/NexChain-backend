const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("[DATABASE] ✅ Connected successfully");
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    if (process.env.NODE_ENV !== "production") {
      console.error("No MongoDB at MONGO_URI? Use `npm run dev:local`, which starts its own local database.");
    }
    process.exit(1);
  }
};

module.exports = connectDB;

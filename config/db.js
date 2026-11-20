const mongoose = require("mongoose");

/** True only while the connection is open, so background jobs can skip work during an outage */
const isDbReady = () => mongoose.connection.readyState === 1;

let listenersAttached = false;
const attachConnectionListeners = () => {
  if (listenersAttached) return;
  listenersAttached = true;
  const conn = mongoose.connection;
  conn.on("disconnected", () => console.warn("[DATABASE] ⚠️ Disconnected, background jobs paused until it's back"));
  conn.on("reconnected", () => console.log("[DATABASE] ✅ Reconnected, background jobs resumed"));
  conn.on("error", (err) => console.error("[DATABASE] ❌ Connection error:", err.message));
};

const connectDB = async () => {
  attachConnectionListeners();
  try {
    // Fail fast when the server is unreachable instead of letting queries queue for 30s
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    console.log("[DATABASE] ✅ Connected successfully");
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    if (process.env.NODE_ENV !== "production") {
      console.error(
        "No MongoDB at MONGO_URI? Run `npm run dev`, which starts its own local database.\n" +
          "(`npm run dev:own-db` is only for your own MongoDB or Atlas, set in MONGO_URI.)",
      );
    }
    process.exit(1);
  }
};

module.exports = connectDB;
module.exports.isDbReady = isDbReady;

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../Models/userModel");
const tradingEngine = require("../services/tradingEngine");
const { signAccessToken } = require("../utils/tokens");

let replSet;

// Replica set (not a standalone server) because buy/sell use transactions
const startDb = async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  // Collections can't be created implicitly inside a transaction without lock errors
  require("../Models/PurchasedCoin");
  require("../Models/Transaction");
  require("../Models/Order");
  require("../Models/Notification");
  await Promise.all(Object.values(mongoose.models).map((m) => m.createCollection()));
  // Wait for index builds; they take collection locks that make transactions fail
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
};

const stopDb = async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
};

const clearDb = async () => {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
};

let userCounter = 0;

const createUser = async (overrides = {}) => {
  userCounter += 1;
  const password = overrides.password || "Password123";
  const user = await User.create({
    id: uuidv4(),
    name: `Test User ${userCounter}`,
    email: `user${userCounter}@test.com`,
    user_name: `user${userCounter}`,
    password: await bcrypt.hash(password, 4),
    emailVerified: true,
    ...overrides,
    ...(overrides.password ? { password: await bcrypt.hash(password, 4) } : {}),
  });
  const token = signAccessToken(user);
  return { user, token, password };
};

// Replace live Binance pricing with fixed prices keyed by pair, e.g. { btcusdt: 50000 }
const mockPrices = (prices) => {
  jest.spyOn(tradingEngine, "ensureTracking").mockImplementation(() => {});
  jest
    .spyOn(tradingEngine, "waitForPrice")
    .mockImplementation(async (symbol) => prices[symbol.toLowerCase()] ?? null);
  jest
    .spyOn(tradingEngine, "getPrice")
    .mockImplementation(async (symbol) => prices[symbol.toLowerCase()] ?? null);
};

module.exports = { startDb, stopDb, clearDb, createUser, mockPrices };

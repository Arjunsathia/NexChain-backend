// Trading integrity (Phase 2): atomic balances, single fills, OCO reservations,
// sell-side reservations, failed orders, reset rules and the equity leaderboard.
const request = require("supertest");
const app = require("../server");
const User = require("../Models/userModel");
const Order = require("../Models/Order");
const PurchasedCoin = require("../Models/PurchasedCoin");
const Transaction = require("../Models/Transaction");
const { processOrderExecution } = require("../services/orderExecutionService");
const { startDb, stopDb, clearDb, createUser, mockPrices } = require("./helpers");

beforeAll(startDb);
afterAll(stopDb);
afterEach(async () => {
  jest.restoreAllMocks();
  await clearDb();
});

const btc = { coin_id: "bitcoin", coin_name: "Bitcoin", coin_symbol: "btc" };
const balanceOf = async (userId) => (await User.findOne({ id: userId })).virtualBalance;

let alice;
let auth;
beforeEach(async () => {
  mockPrices({ btcusdt: 50000 });
  alice = await createUser();
  auth = { Authorization: `Bearer ${alice.token}` };
});

const placeOrder = (body) => request(app).post("/api/orders/create").set(auth).send({ ...btc, ...body });
const placeOCO = (body) => request(app).post("/api/orders/create-oco").set(auth).send({ ...btc, ...body });
const buyMarket = (quantity) => request(app).post("/api/purchases/buy").set(auth).send({ ...btc, quantity });
const sellMarket = (quantity) => request(app).post("/api/purchases/sell").set(auth).send({ coin_id: "bitcoin", quantity });

describe("atomic balances", () => {
  it("concurrent market buys can never spend more than the balance", async () => {
    // 10,000 balance, each buy costs 4,000: at most two can succeed
    const results = await Promise.all([1, 2, 3, 4].map(() => buyMarket(0.08)));
    const ok = results.filter((r) => r.status === 201).length;

    expect(ok).toBe(2);
    expect(await balanceOf(alice.user.id)).toBeCloseTo(2000);
    const holding = await PurchasedCoin.findOne({ user_id: alice.user.id });
    expect(holding.quantity).toBeCloseTo(0.16);
  });

  it("concurrent buy orders can never lock more than the balance", async () => {
    const results = await Promise.all(
      [1, 2, 3].map(() => placeOrder({ type: "buy", category: "limit", limit_price: 40000, quantity: 0.1 })),
    );
    expect(results.filter((r) => r.status === 201).length).toBe(2);
    expect(await balanceOf(alice.user.id)).toBeCloseTo(2000);
  });
});

describe("single fills", () => {
  it("an order processed five times at once fills exactly once", async () => {
    const { body } = await placeOrder({ type: "buy", category: "limit", limit_price: 40000, quantity: 0.1 });
    const order = await Order.findById(body.order._id);

    const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => processOrderExecution(order, 39000)));

    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await Transaction.countDocuments({ user_id: alice.user.id })).toBe(1);
    expect((await PurchasedCoin.findOne({ user_id: alice.user.id })).quantity).toBeCloseTo(0.1);
    // 4,000 locked, filled for 3,900, 100 refunded once
    expect(await balanceOf(alice.user.id)).toBeCloseTo(6100);
  });

  it("the user execute endpoint and the engine can't both fill an order", async () => {
    mockPrices({ btcusdt: 39000 });
    const { body } = await placeOrder({ type: "buy", category: "limit", limit_price: 40000, quantity: 0.1 });
    const order = await Order.findById(body.order._id);

    await Promise.allSettled([
      request(app).post("/api/orders/execute").set(auth).send({ orderId: order._id }),
      processOrderExecution(order, 39000),
    ]);
    expect(await Transaction.countDocuments({ user_id: alice.user.id })).toBe(1);
  });
});

describe("buy OCO reservations", () => {
  const buyOCO = { type: "buy", quantity: 0.1, tp_limit_price: 40000, sl_stop_price: 60000 };

  it("reserves the larger leg once", async () => {
    const res = await placeOCO(buyOCO);
    expect(res.status).toBe(201);
    expect(await balanceOf(alice.user.id)).toBeCloseTo(4000); // 10,000 - 6,000
  });

  it("cancelling one leg cancels the group and refunds once", async () => {
    const { body } = await placeOCO(buyOCO);
    const [tp, sl] = body.orders;

    const first = await request(app).put(`/api/orders/cancel/${sl._id}`).set(auth);
    expect(first.status).toBe(200);
    expect(first.body.cancelledOrderIds).toHaveLength(2);

    const second = await request(app).put(`/api/orders/cancel/${tp._id}`).set(auth);
    expect(second.status).toBe(400);
    expect(await balanceOf(alice.user.id)).toBeCloseTo(10000);
  });

  it("filling one leg cancels the sibling and refunds the unused reservation", async () => {
    const { body } = await placeOCO(buyOCO);
    const tp = await Order.findById(body.orders[0]._id);

    await processOrderExecution(tp, 40000);

    const legs = await Order.find({ oco_group_id: tp.oco_group_id });
    expect(legs.map((l) => l.status).sort()).toEqual(["cancelled", "filled"]);
    expect(await balanceOf(alice.user.id)).toBeCloseTo(6000); // paid 4,000 of the 6,000 reserved
  });

  it("both legs processed at once fill only one", async () => {
    const { body } = await placeOCO({ ...buyOCO, sl_stop_price: 40000, tp_limit_price: 40000 });
    const legs = await Order.find({ oco_group_id: body.orders[0].oco_group_id });

    await Promise.allSettled(legs.map((leg) => processOrderExecution(leg, 40000)));

    expect(await Transaction.countDocuments({ user_id: alice.user.id })).toBe(1);
    expect((await PurchasedCoin.findOne({ user_id: alice.user.id })).quantity).toBeCloseTo(0.1);
  });

  it("legacy OCO legs without locked_amount refund the larger leg once", async () => {
    await User.updateOne({ id: alice.user.id }, { virtualBalance: 4000 });
    const base = { user_id: alice.user.id, coin_id: "bitcoin", coin_symbol: "btc", coin_name: "Bitcoin", type: "buy", quantity: 0.1, oco_group_id: "legacy" };
    const [tp] = await Order.create([
      { ...base, category: "limit", limit_price: 40000, total_value: 4000 },
      { ...base, category: "stop_market", stop_price: 60000, total_value: 6000 },
    ]);

    await request(app).put(`/api/orders/cancel/${tp._id}`).set(auth);
    expect(await balanceOf(alice.user.id)).toBeCloseTo(10000);
  });

  it("OCO legs can't be edited", async () => {
    const { body } = await placeOCO(buyOCO);
    const res = await request(app).put(`/api/orders/update/${body.orders[0]._id}`).set(auth).send({ quantity: 0.2 });
    expect(res.status).toBe(400);
  });
});

describe("sell reservations", () => {
  beforeEach(async () => {
    await buyMarket(0.1);
  });

  it("coins reserved by an open sell order can't be market-sold", async () => {
    await placeOrder({ type: "sell", category: "limit", limit_price: 70000, quantity: 0.08 });
    const res = await sellMarket(0.05);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reserved by open sell orders/);
    expect((await sellMarket(0.02)).status).toBe(200);
  });

  it("concurrent sell orders can't reserve the same coins twice", async () => {
    const results = await Promise.all(
      [1, 2].map(() => placeOrder({ type: "sell", category: "limit", limit_price: 70000, quantity: 0.1 })),
    );
    expect(results.filter((r) => r.status === 201).length).toBe(1);
  });

  it("a sell OCO fills one leg only, even if both are processed at once", async () => {
    const { body } = await placeOCO({ type: "sell", quantity: 0.1, tp_limit_price: 50000, sl_stop_price: 50000 });
    const legs = await Order.find({ oco_group_id: body.orders[0].oco_group_id });

    await Promise.allSettled(legs.map((leg) => processOrderExecution(leg, 50000)));

    expect(await Transaction.countDocuments({ user_id: alice.user.id, type: "sell" })).toBe(1);
    expect(await PurchasedCoin.countDocuments({ user_id: alice.user.id })).toBe(0);
  });

  it("an order whose coins are gone is marked failed instead of retried forever", async () => {
    const { body } = await placeOrder({ type: "sell", category: "limit", limit_price: 50000, quantity: 0.1 });
    await PurchasedCoin.deleteMany({ user_id: alice.user.id }); // e.g. removed by an admin

    const order = await Order.findById(body.order._id);
    await expect(processOrderExecution(order, 60000)).rejects.toThrow("No holdings found");

    const failed = await Order.findById(order._id);
    expect(failed.status).toBe("failed");
    expect(failed.failure_reason).toMatch(/No holdings/);
  });
});

describe("stop-market buys", () => {
  it("charges the difference when filling above the reserved stop price", async () => {
    const { body } = await placeOrder({ type: "buy", category: "stop_market", stop_price: 50000, quantity: 0.1 });
    expect(await balanceOf(alice.user.id)).toBeCloseTo(5000);

    await processOrderExecution(await Order.findById(body.order._id), 52000);
    expect(await balanceOf(alice.user.id)).toBeCloseTo(4800); // paid 5,200 in total
  });

  it("fails and refunds when the balance can't cover the gap", async () => {
    await User.updateOne({ id: alice.user.id }, { virtualBalance: 5000 });
    const { body } = await placeOrder({ type: "buy", category: "stop_market", stop_price: 50000, quantity: 0.1 });
    expect(await balanceOf(alice.user.id)).toBeCloseTo(0);

    await expect(processOrderExecution(await Order.findById(body.order._id), 60000)).rejects.toThrow("Insufficient balance");
    expect((await Order.findById(body.order._id)).status).toBe("failed");
    expect(await balanceOf(alice.user.id)).toBeCloseTo(5000);
    expect(await PurchasedCoin.countDocuments({ user_id: alice.user.id })).toBe(0);
  });
});

describe("editing orders", () => {
  it("charges or refunds only the difference", async () => {
    const { body } = await placeOrder({ type: "buy", category: "limit", limit_price: 40000, quantity: 0.1 });
    const up = await request(app).put(`/api/orders/update/${body.order._id}`).set(auth).send({ limit_price: 45000 });
    expect(up.status).toBe(200);
    expect(await balanceOf(alice.user.id)).toBeCloseTo(5500);

    await request(app).put(`/api/orders/update/${body.order._id}`).set(auth).send({ quantity: 0.05 });
    expect(await balanceOf(alice.user.id)).toBeCloseTo(7750);

    await request(app).put(`/api/orders/cancel/${body.order._id}`).set(auth);
    expect(await balanceOf(alice.user.id)).toBeCloseTo(10000);
  });
});

describe("account reset", () => {
  it("clears holdings and open orders, then enforces a 24h cooldown", async () => {
    await buyMarket(0.1);
    await placeOrder({ type: "buy", category: "limit", limit_price: 40000, quantity: 0.05 });

    const reset = await request(app).post("/api/purchases/reset-balance").set(auth);
    expect(reset.status).toBe(200);
    expect(reset.body.newBalance).toBe(10000);
    expect(await PurchasedCoin.countDocuments({ user_id: alice.user.id })).toBe(0);
    expect(await Order.countDocuments({ user_id: alice.user.id, status: "pending" })).toBe(0);

    const again = await request(app).post("/api/purchases/reset-balance").set(auth);
    expect(again.status).toBe(429);
  });
});

describe("leaderboard", () => {
  it("ranks by equity and hides accounts reset in the last 24h", async () => {
    const bob = await createUser();
    const carol = await createUser({ lastResetAt: new Date() });
    // Alice: 5,000 cash + 0.1 BTC (5,000) = 10,000. Bob: 9,000 cash, no coins.
    await buyMarket(0.1);
    await User.updateOne({ id: bob.user.id }, { virtualBalance: 9000 });
    await Transaction.create(
      [bob, carol].map(({ user }) => ({
        user_id: user.id, coin_id: "bitcoin", coinName: "Bitcoin", coinSymbol: "btc",
        type: "buy", quantity: 0.01, price: 50000, totalValue: 500,
      })),
    );

    const res = await request(app).get("/api/users/leaderboard").set(auth);
    expect(res.body.map((u) => u.id)).toEqual([alice.user.id, bob.user.id]);
    expect(res.body[0].equity).toBeCloseTo(10000);
  });
});

const request = require("supertest");
const app = require("../server");
const User = require("../Models/userModel");
const Order = require("../Models/Order");
const { processOrderExecution } = require("../services/orderExecutionService");
const { startDb, stopDb, clearDb, createUser, mockPrices } = require("./helpers");

beforeAll(startDb);
afterAll(stopDb);
afterEach(async () => {
  jest.restoreAllMocks();
  await clearDb();
});

const btc = { coin_id: "bitcoin", coin_name: "Bitcoin", coin_symbol: "btc" };

describe("market buy and sell", () => {
  it("buys at the server price and deducts the balance", async () => {
    mockPrices({ btcusdt: 50000 });
    const { user, token } = await createUser();

    const res = await request(app)
      .post("/api/purchases/buy")
      .set("Authorization", `Bearer ${token}`)
      .send({ user_id: user.id, ...btc, quantity: 0.1 });

    expect(res.status).toBe(201);
    expect(res.body.newBalance).toBeCloseTo(5000);
    expect(res.body.purchase.coinPriceUSD).toBe(50000);
  });

  it("rejects a buy larger than the balance", async () => {
    mockPrices({ btcusdt: 50000 });
    const { user, token } = await createUser();

    const res = await request(app)
      .post("/api/purchases/buy")
      .set("Authorization", `Bearer ${token}`)
      .send({ user_id: user.id, ...btc, quantity: 1 });

    expect(res.status).toBe(400);
    expect((await User.findOne({ id: user.id })).virtualBalance).toBe(10000);
  });

  it("sells holdings and credits the balance", async () => {
    mockPrices({ btcusdt: 50000 });
    const { user, token } = await createUser();
    const auth = { Authorization: `Bearer ${token}` };

    await request(app).post("/api/purchases/buy").set(auth).send({ user_id: user.id, ...btc, quantity: 0.1 });
    mockPrices({ btcusdt: 60000 });
    const res = await request(app)
      .post("/api/purchases/sell")
      .set(auth)
      .send({ user_id: user.id, coin_id: "bitcoin", coin_symbol: "btc", quantity: 0.1 });

    expect(res.status).toBe(200);
    expect(res.body.newBalance).toBeCloseTo(11000);
  });
});

describe("limit orders", () => {
  it("locks funds on create and fills when the price is reached", async () => {
    const { user, token } = await createUser();

    const create = await request(app)
      .post("/api/orders/create")
      .set("Authorization", `Bearer ${token}`)
      .send({ user_id: user.id, ...btc, type: "buy", category: "limit", limit_price: 40000, quantity: 0.1 });

    expect(create.status).toBe(201);
    expect(create.body.newBalance).toBeCloseTo(6000);

    const order = await Order.findById(create.body.order._id);
    await expect(processOrderExecution(order, 45000)).rejects.toThrow("Price condition not met");

    await processOrderExecution(order, 39000);
    const filled = await Order.findById(order._id);
    expect(filled.status).toBe("filled");
    // Filled below the limit, so the difference is refunded
    expect((await User.findOne({ id: user.id })).virtualBalance).toBeCloseTo(6100);
  });

  it("refunds the locked amount when cancelled", async () => {
    const { user, token } = await createUser();
    const auth = { Authorization: `Bearer ${token}` };

    const create = await request(app)
      .post("/api/orders/create")
      .set(auth)
      .send({ user_id: user.id, ...btc, type: "buy", category: "limit", limit_price: 40000, quantity: 0.1 });

    const cancel = await request(app).put(`/api/orders/cancel/${create.body.order._id}`).set(auth);
    expect(cancel.status).toBe(200);
    expect((await User.findOne({ id: user.id })).virtualBalance).toBeCloseTo(10000);
  });
});

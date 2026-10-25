// Attack replays for the Phase 1 audit findings (S1–S7, S11, S14, S18).
// Every request here used to succeed; each must now be refused.
const request = require("supertest");
const app = require("../server");
const User = require("../Models/userModel");
const Order = require("../Models/Order");
const Alert = require("../Models/Alert");
const Feedback = require("../Models/Feedback");
const FrozenCoin = require("../Models/frozenCoinModel");
const PurchasedCoin = require("../Models/PurchasedCoin");
const { startDb, stopDb, clearDb, createUser, mockPrices } = require("./helpers");

beforeAll(startDb);
afterAll(stopDb);
afterEach(async () => {
  jest.restoreAllMocks();
  await clearDb();
});

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const btcBuy = { coin_id: "bitcoin", coin_name: "Bitcoin", coin_symbol: "btc" };
const watchItem = { id: "bitcoin", name: "Bitcoin", symbol: "btc", image: "x.png", current_price: 50000 };

let alice;
let bob;
let admin;
beforeEach(async () => {
  mockPrices({ btcusdt: 50000, shibusdt: 0.00001 });
  alice = await createUser();
  bob = await createUser();
  admin = await createUser({ role: "admin" });
});

describe("S1 trades and reads act only on the logged-in user", () => {
  it("a buy with someone else's user_id is booked to the caller", async () => {
    const res = await request(app)
      .post("/api/purchases/buy")
      .set(bearer(alice.token))
      .send({ ...btcBuy, user_id: bob.user.id, quantity: 0.01 });

    expect(res.status).toBe(201);
    expect((await User.findOne({ id: bob.user.id })).virtualBalance).toBe(10000);
    expect((await User.findOne({ id: alice.user.id })).virtualBalance).toBeCloseTo(9500);
  });

  it("a reset with someone else's user_id resets only the caller", async () => {
    await User.updateOne({ id: bob.user.id }, { virtualBalance: 1 });
    await request(app)
      .post("/api/purchases/reset-balance")
      .set(bearer(alice.token))
      .send({ user_id: bob.user.id });
    expect((await User.findOne({ id: bob.user.id })).virtualBalance).toBe(1);
  });

  it.each([
    "/api/purchases/balance/:id",
    "/api/purchases/holdings/:id",
    "/api/purchases/transactions/:id",
    "/api/purchases/:id",
    "/api/orders/:id",
    "/api/alerts/:id",
    "/api/kyc/status/:id",
  ])("GET %s for another user is forbidden, allowed for self and admin", async (path) => {
    const other = await request(app).get(path.replace(":id", bob.user.id)).set(bearer(alice.token));
    expect(other.status).toBe(403);

    const self = await request(app).get(path.replace(":id", alice.user.id)).set(bearer(alice.token));
    expect(self.status).toBe(200);

    const asAdmin = await request(app).get(path.replace(":id", bob.user.id)).set(bearer(admin.token));
    expect(asAdmin.status).toBe(200);
  });

  it("orders and alerts can't be cancelled, updated, executed or deleted by another user", async () => {
    const order = await Order.create({
      user_id: bob.user.id, coin_id: "bitcoin", coin_symbol: "btc", coin_name: "Bitcoin",
      type: "buy", category: "limit", limit_price: 40000, quantity: 0.1, total_value: 4000,
    });
    const alert = await Alert.create({
      user_id: bob.user.id, coin_id: "bitcoin", coin_symbol: "btc", coin_name: "Bitcoin",
      target_price: 1, condition: "above",
    });

    const auth = bearer(alice.token);
    expect((await request(app).put(`/api/orders/cancel/${order._id}`).set(auth)).status).toBe(404);
    expect((await request(app).put(`/api/orders/update/${order._id}`).set(auth).send({ quantity: 1 })).status).toBe(404);
    expect((await request(app).post("/api/orders/execute").set(auth).send({ orderId: order._id })).status).toBe(404);
    expect((await request(app).delete(`/api/alerts/${alert._id}`).set(auth)).status).toBe(404);

    expect((await Order.findById(order._id)).status).toBe("pending");
    expect(await Alert.findById(alert._id)).not.toBeNull();
  });

  it("watchlist ignores a user_id query", async () => {
    const added = await request(app).post("/api/watchlist/add").set(bearer(bob.token)).send(watchItem);
    expect(added.status).toBe(201);
    const res = await request(app).get(`/api/watchlist?user_id=${bob.user.id}`).set(bearer(alice.token));
    expect(res.body).toEqual([]);
  });
});

describe("S2 negative, zero and non-numeric amounts are rejected", () => {
  it.each([-100, 0, "abc", null, 1e20])("buy quantity %p", async (quantity) => {
    const res = await request(app).post("/api/purchases/buy").set(bearer(alice.token)).send({ ...btcBuy, quantity });
    expect(res.status).toBe(400);
    expect((await User.findOne({ id: alice.user.id })).virtualBalance).toBe(10000);
  });

  it("buy limit order with a negative price", async () => {
    const res = await request(app)
      .post("/api/orders/create")
      .set(bearer(alice.token))
      .send({ ...btcBuy, type: "buy", category: "limit", limit_price: -1000000, quantity: 1 });
    expect(res.status).toBe(400);
    expect((await User.findOne({ id: alice.user.id })).virtualBalance).toBe(10000);
  });

  it("a numeric string quantity is converted, not string-concatenated", async () => {
    const res = await request(app).post("/api/purchases/buy").set(bearer(alice.token)).send({ ...btcBuy, quantity: "0.01" });
    expect(res.status).toBe(201);
    await request(app).post("/api/purchases/buy").set(bearer(alice.token)).send({ ...btcBuy, quantity: "0.01" });
    const holding = await PurchasedCoin.findOne({ user_id: alice.user.id, coin_id: "bitcoin" });
    expect(holding.quantity).toBeCloseTo(0.02);
  });
});

describe("S3 price symbol comes from coin_id, not the client", () => {
  it("buying bitcoin while claiming the SHIB symbol still pays the BTC price", async () => {
    const res = await request(app)
      .post("/api/purchases/buy")
      .set(bearer(alice.token))
      .send({ coin_id: "bitcoin", coin_symbol: "shib", quantity: 0.01 });

    expect(res.status).toBe(201);
    expect(res.body.purchase.coinPriceUSD).toBe(50000);
    expect(res.body.purchase.coinSymbol).toBe("btc");
  });

  it("orders store the server-derived symbol", async () => {
    const res = await request(app)
      .post("/api/orders/create")
      .set(bearer(alice.token))
      .send({ coin_id: "bitcoin", coin_symbol: "shib", type: "buy", category: "limit", limit_price: 40000, quantity: 0.1 });
    expect(res.status).toBe(201);
    expect(res.body.order.coin_symbol).toBe("btc");
  });
});

describe("S4/S5 user profiles", () => {
  it("anonymous users can't read profiles", async () => {
    expect((await request(app).get(`/api/users/${bob.user.id}`)).status).toBe(401);
  });

  it("another user only sees public fields, never the password hash", async () => {
    const res = await request(app).get(`/api/users/${bob.user.id}`).set(bearer(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.user_name).toBe(bob.user.user_name);
    expect(res.body).not.toHaveProperty("password");
    expect(res.body).not.toHaveProperty("email");
    expect(res.body).not.toHaveProperty("virtualBalance");
  });

  it("own profile and the admin user list never include the password hash", async () => {
    const own = await request(app).get(`/api/users/${alice.user.id}`).set(bearer(alice.token));
    expect(own.body.email).toBe(alice.user.email);
    expect(own.body).not.toHaveProperty("password");

    const list = await request(app).get("/api/users").set(bearer(admin.token));
    expect(list.body.every((u) => !("password" in u))).toBe(true);
  });

  it("a user can't edit another user's profile or image", async () => {
    const res = await request(app)
      .put(`/api/users/${bob.user.id}`)
      .set(bearer(alice.token))
      .send({ email: "attacker@evil.com" });
    expect(res.status).toBe(403);
    expect((await User.findOne({ id: bob.user.id })).email).toBe(bob.user.email);

    const img = await request(app).put(`/api/users/profile-image/${bob.user.id}`).set(bearer(alice.token));
    expect(img.status).toBe(403);
  });

  it("changing your own email requires the current password", async () => {
    const auth = bearer(alice.token);
    const denied = await request(app).put(`/api/users/${alice.user.id}`).set(auth).send({ email: "new@test.com" });
    expect(denied.status).toBe(400);

    const ok = await request(app)
      .put(`/api/users/${alice.user.id}`)
      .set(auth)
      .send({ email: "new@test.com", currentPassword: alice.password });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe("new@test.com");
  });

  it("saving the profile with the unchanged email needs no password", async () => {
    const res = await request(app)
      .put(`/api/users/${alice.user.id}`)
      .set(bearer(alice.token))
      .send({ name: "Alice Renamed", email: alice.user.email.toUpperCase() });
    expect(res.status).toBe(200);
  });

  it("a user can't grant themselves admin", async () => {
    await request(app).put(`/api/users/${alice.user.id}`).set(bearer(alice.token)).send({ role: "admin" });
    expect((await User.findOne({ id: alice.user.id })).role).toBe("user");
  });
});

describe("S6/S7/S11 admin-only endpoints", () => {
  it("feedback can be submitted publicly but only admins can read, edit or delete it", async () => {
    const fb = await Feedback.create({ type: "bug", message: "Something broke here", userEmail: "x@test.com" });

    expect((await request(app).get("/api/feedback")).status).toBe(401);
    expect((await request(app).get("/api/feedback").set(bearer(alice.token))).status).toBe(403);
    expect((await request(app).delete(`/api/feedback/${fb._id}`).set(bearer(alice.token))).status).toBe(403);
    expect((await request(app).get("/api/feedback").set(bearer(admin.token))).status).toBe(200);
  });

  it("users can't approve KYC", async () => {
    await User.updateOne({ id: alice.user.id }, { kycStatus: "pending" });
    const res = await request(app)
      .post("/api/kyc/verify")
      .set(bearer(alice.token))
      .send({ user_id: alice.user.id, status: "verified" });
    expect(res.status).toBe(403);
    expect((await User.findOne({ id: alice.user.id })).kycStatus).toBe("pending");

    const asAdmin = await request(app)
      .post("/api/kyc/verify")
      .set(bearer(admin.token))
      .send({ user_id: alice.user.id, status: "verified" });
    expect(asAdmin.status).toBe(200);
  });

  it.each(["/api/purchases/platform-stats", "/api/purchases/today-transactions"])(
    "%s is admin-only",
    async (path) => {
      expect((await request(app).get(path).set(bearer(alice.token))).status).toBe(403);
      expect((await request(app).get(path).set(bearer(admin.token))).status).toBe(200);
    },
  );

  it("users can't push notifications to other users", async () => {
    const res = await request(app)
      .post("/api/notifications")
      .set(bearer(alice.token))
      .send({ userId: bob.user._id, title: "Hi", message: "Click this link" });
    expect(res.status).toBe(403);
  });
});

describe("S14 frozen coins are enforced by the server", () => {
  it("buys and buy orders are refused, sells still work", async () => {
    await request(app).post("/api/purchases/buy").set(bearer(alice.token)).send({ ...btcBuy, quantity: 0.01 });
    await FrozenCoin.create({ coinId: "bitcoin", symbol: "btc", name: "Bitcoin" });

    const buy = await request(app).post("/api/purchases/buy").set(bearer(alice.token)).send({ ...btcBuy, quantity: 0.01 });
    expect(buy.status).toBe(403);

    const order = await request(app)
      .post("/api/orders/create")
      .set(bearer(alice.token))
      .send({ ...btcBuy, type: "buy", category: "limit", limit_price: 40000, quantity: 0.01 });
    expect(order.status).toBe(403);

    const sell = await request(app).post("/api/purchases/sell").set(bearer(alice.token)).send({ coin_id: "bitcoin", quantity: 0.01 });
    expect(sell.status).toBe(200);
  });
});

describe("S18 query operators are stripped", () => {
  it("a $ne operator in the query string does not leak other users' watchlists", async () => {
    await request(app).post("/api/watchlist/add").set(bearer(bob.token)).send(watchItem);
    const res = await request(app).get("/api/watchlist?id[$ne]=x").set(bearer(alice.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("health check", () => {
  it("is public and reports database status", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", db: { ok: true } });
  });
});

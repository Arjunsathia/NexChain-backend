// One-click demo accounts: sandboxed, locked settings, purged after expiry
const request = require("supertest");
const app = require("../server");
const User = require("../Models/userModel");
const Transaction = require("../Models/Transaction");
const PurchasedCoin = require("../Models/PurchasedCoin");
const { purgeExpiredDemos } = require("../services/demoService");
const { startDb, stopDb, clearDb, createUser, mockPrices } = require("./helpers");

beforeAll(startDb);
afterAll(stopDb);
afterEach(async () => {
  jest.restoreAllMocks();
  delete process.env.DEMO_ENABLED;
  await clearDb();
});

const btc = { coin_id: "bitcoin", coin_name: "Bitcoin", coin_symbol: "btc" };

const startDemo = async () => {
  const res = await request(app).post("/api/auth/demo");
  expect(res.status).toBe(201);
  return { res, auth: { Authorization: `Bearer ${res.body.accessToken}` }, user: res.body.user };
};

describe("POST /api/auth/demo", () => {
  it("creates a fresh sandbox user with the starting balance and signs in", async () => {
    const { res, user } = await startDemo();

    expect(res.body.accessToken).toBeTruthy();
    expect(res.headers["set-cookie"].join(";")).toMatch(/refreshToken=/);
    expect(user.isDemo).toBe(true);
    expect(user.role).toBe("user");

    const stored = await User.findOne({ id: user.id });
    expect(stored.virtualBalance).toBe(10000);
    expect(stored.password).toBeUndefined();
    expect(stored.demoExpiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
  });

  it("gives every visitor a separate account", async () => {
    const a = await startDemo();
    const b = await startDemo();
    expect(a.user.id).not.toBe(b.user.id);
  });

  it("can be turned off", async () => {
    process.env.DEMO_ENABLED = "false";
    const res = await request(app).post("/api/auth/demo");
    expect(res.status).toBe(404);
  });

  it("can't be reached through password login", async () => {
    const { user } = await startDemo();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.user_name, password: "Password123" });
    expect(res.status).toBe(401);
  });
});

describe("demo account limits", () => {
  it("can trade", async () => {
    mockPrices({ btcusdt: 50000 });
    const { auth, user } = await startDemo();
    const res = await request(app)
      .post("/api/purchases/buy")
      .set(auth)
      .send({ user_id: user.id, ...btc, quantity: 0.1 });
    expect(res.status).toBe(201);
    expect(res.body.newBalance).toBeCloseTo(5000);
  });

  it("can rename itself but not change email, username or password", async () => {
    const { auth, user } = await startDemo();

    const rename = await request(app).put(`/api/users/${user.id}`).set(auth).send({ name: "Demo Dana" });
    expect(rename.status).toBe(200);

    for (const body of [
      { email: "taken@example.com" },
      { user_name: "realname" },
      { currentPassword: "x", newPassword: "Password123", confirmPassword: "Password123" },
    ]) {
      const res = await request(app).put(`/api/users/${user.id}`).set(auth).send(body);
      expect(res.status).toBe(403);
      expect(res.body.demo).toBe(true);
    }
    expect((await User.findOne({ id: user.id })).email).toBe(user.email);
  });

  it("can't enable 2FA, submit KYC or email support", async () => {
    const { auth } = await startDemo();
    expect((await request(app).post("/api/2fa/setup").set(auth)).status).toBe(403);
    expect((await request(app).get("/api/auth/setup-totp").set(auth)).status).toBe(403);
    expect((await request(app).post("/api/kyc/submit").set(auth)).status).toBe(403);
    expect((await request(app).post("/api/users/contact-support").set(auth)).status).toBe(403);
  });

  it("is hidden from the leaderboard", async () => {
    mockPrices({ btcusdt: 50000 });
    const { auth, user } = await startDemo();
    await request(app).post("/api/purchases/buy").set(auth).send({ user_id: user.id, ...btc, quantity: 0.01 });

    const real = await createUser();
    const res = await request(app)
      .get("/api/users/leaderboard")
      .set("Authorization", `Bearer ${real.token}`);
    expect(res.status).toBe(200);
    expect(res.body.map((u) => u.id)).not.toContain(user.id);
  });
});

describe("expiry", () => {
  it("ends the session and the purge removes the user and their data", async () => {
    mockPrices({ btcusdt: 50000 });
    const { auth, user } = await startDemo();
    await request(app).post("/api/purchases/buy").set(auth).send({ user_id: user.id, ...btc, quantity: 0.1 });
    const real = await createUser();

    await User.updateOne({ id: user.id }, { demoExpiresAt: new Date(Date.now() - 1000) });
    expect((await request(app).get(`/api/users/${user.id}`).set(auth)).status).toBe(401);

    expect(await purgeExpiredDemos()).toBe(1);
    expect(await User.findOne({ id: user.id })).toBeNull();
    expect(await Transaction.countDocuments({ user_id: user.id })).toBe(0);
    expect(await PurchasedCoin.countDocuments({ user_id: user.id })).toBe(0);
    // Real accounts are never touched
    expect(await User.findOne({ id: real.user.id })).not.toBeNull();
  });

  it("leaves unexpired demo accounts alone", async () => {
    await startDemo();
    expect(await purgeExpiredDemos()).toBe(0);
  });
});

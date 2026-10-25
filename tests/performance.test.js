// Portfolio performance history (real snapshots instead of a random series)
const request = require("supertest");
const app = require("../server");
const PortfolioSnapshot = require("../Models/PortfolioSnapshot");
const { snapshotAll } = require("../services/equityService");
const { startDb, stopDb, clearDb, createUser, mockPrices } = require("./helpers");

beforeAll(startDb);
afterAll(stopDb);
afterEach(async () => {
  jest.restoreAllMocks();
  await clearDb();
});

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

it("records hourly snapshots and serves them with a live point", async () => {
  mockPrices({ btcusdt: 50000 });
  const alice = await createUser();
  await request(app)
    .post("/api/purchases/buy")
    .set(bearer(alice.token))
    .send({ coin_id: "bitcoin", quantity: 0.1 });

  expect(await snapshotAll()).toBe(1);
  expect(await snapshotAll()).toBe(1); // same hour: upserted, not duplicated
  expect(await PortfolioSnapshot.countDocuments({ user_id: alice.user.id })).toBe(1);

  // An older day, to check daily grouping
  await PortfolioSnapshot.create({
    user_id: alice.user.id,
    at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    holdingsValue: 4000,
    invested: 5000,
    cash: 5000,
  });

  const res = await request(app)
    .get(`/api/purchases/performance/${alice.user.id}?range=7d`)
    .set(bearer(alice.token));

  expect(res.status).toBe(200);
  expect(res.body.points).toHaveLength(3); // old day, today, live
  expect(res.body.points[0].holdingsValue).toBe(4000);
  expect(res.body.points.at(-1)).toMatchObject({ live: true, invested: 5000 });
  expect(res.body.historySince).toBeTruthy();
});

it("is private to the user (and admins)", async () => {
  const alice = await createUser();
  const bob = await createUser();
  const res = await request(app)
    .get(`/api/purchases/performance/${alice.user.id}`)
    .set(bearer(bob.token));
  expect(res.status).toBe(403);
});

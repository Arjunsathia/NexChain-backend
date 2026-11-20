const db = require("../config/db");
const Alert = require("../Models/Alert");
const Notification = require("../Models/Notification");
const alertService = require("../services/alertService");
const emailService = require("../utils/emailService");
const socketService = require("../services/socketService");
const { startDb, stopDb, clearDb, createUser } = require("./helpers");

beforeAll(startDb);
afterAll(stopDb);
beforeEach(() => {
  alertService.lastChecked = {};
  alertService.inFlight.clear();
  jest.spyOn(emailService, "sendEmail").mockResolvedValue();
  jest.spyOn(socketService, "sendToUser").mockImplementation(() => {});
});
afterEach(async () => {
  jest.restoreAllMocks();
  await clearDb();
});

const makeAlert = (user, overrides = {}) =>
  Alert.create({
    user_id: user.id,
    coin_id: "bitcoin",
    coin_symbol: "btc",
    coin_name: "Bitcoin",
    target_price: 50000,
    condition: "above",
    ...overrides,
  });

describe("alert service", () => {
  it("skips the database entirely while it is disconnected", async () => {
    const find = jest.spyOn(Alert, "find");
    jest.spyOn(db, "isDbReady").mockReturnValue(false);

    await alertService.processPriceUpdate("btcusdt", 60000);

    expect(find).not.toHaveBeenCalled();
  });

  it("triggers an alert once even when two checks race", async () => {
    const { user } = await createUser();
    const alert = await makeAlert(user);
    const stale = await Alert.find({ _id: alert._id });

    // Two checks that both loaded the alert while it was still active
    await Promise.all([
      alertService.handleTriggeredAlerts(stale, 60000),
      alertService.handleTriggeredAlerts(await Alert.find({ _id: alert._id }), 60000),
    ]);

    expect(await Notification.countDocuments({ user: user._id })).toBe(1);
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    expect((await Alert.findById(alert._id)).status).toBe("triggered");
  });

  it("does not stack a second check for a symbol that is still being checked", async () => {
    const find = jest.spyOn(Alert, "find");
    alertService.inFlight.add("btcusdt");

    await alertService.processPriceUpdate("btcusdt", 60000);

    expect(find).not.toHaveBeenCalled();
  });
});

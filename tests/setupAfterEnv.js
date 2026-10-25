// Never open real Binance sockets from tests; mockPrices() supplies prices
const tradingEngine = require("../services/tradingEngine");

beforeEach(() => {
  jest.spyOn(tradingEngine, "ensureTracking").mockImplementation(() => {});
});

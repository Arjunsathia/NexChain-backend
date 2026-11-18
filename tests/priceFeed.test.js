// The price feed must survive a blocked host: Render runs in the US, where
// stream.binance.com refuses connections, so the engine moves to the next host.
const { EventEmitter } = require("events");

const mockSockets = [];
const sockets = mockSockets;
jest.mock("ws", () => {
  const { EventEmitter: Emitter } = require("events");
  return class FakeWebSocket extends Emitter {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 0;
      mockSockets.push(this);
    }
    terminate() {
      this.readyState = 3;
    }
  };
});

// setupAfterEnv already loaded the engine with the real ws; load a fresh copy
// that uses the fake, so no real Binance connection is ever opened here
jest.resetModules();
const engine = require("../services/tradingEngine");
const { priceStreamHosts } = engine;

const host = (ws) => ws.url.split("/stream?")[0];
const closeSocket = (ws) => {
  ws.readyState = 3;
  ws.emit("close");
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, "log").mockImplementation(() => {});
  delete process.env.BINANCE_WS_URL;
  sockets.length = 0;
  engine.ws = null;
  engine.wsHostIndex = 0;
  engine.reconnectAttempts = 0;
  engine.activeSymbols = new Set(["btcusdt"]);
});

afterEach(() => {
  engine.ws = null;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("priceStreamHosts", () => {
  it("defaults to the US-reachable mirror, then binance.com", () => {
    expect(priceStreamHosts(undefined)).toEqual([
      "wss://data-stream.binance.vision",
      "wss://stream.binance.com:9443",
    ]);
  });

  it("tries BINANCE_WS_URL first without listing a host twice", () => {
    expect(priceStreamHosts("wss://stream.binance.com:9443/")).toEqual([
      "wss://stream.binance.com:9443",
      "wss://data-stream.binance.vision",
    ]);
  });
});

describe("price feed reconnects", () => {
  it("moves to the next host when one closes without sending prices", () => {
    engine.connectWebSocket();
    expect(host(sockets[0])).toBe("wss://data-stream.binance.vision");

    closeSocket(sockets[0]); // blocked: no data
    jest.runOnlyPendingTimers();
    expect(host(sockets[1])).toBe("wss://stream.binance.com:9443");

    closeSocket(sockets[1]); // also blocked: wrap around
    jest.runOnlyPendingTimers();
    expect(host(sockets[2])).toBe("wss://data-stream.binance.vision");
  });

  it("stays on a host that delivered prices when its connection drops", () => {
    engine.connectWebSocket();
    sockets[0].emit("message", Buffer.from("{}"));

    closeSocket(sockets[0]);
    jest.runOnlyPendingTimers();
    expect(host(sockets[1])).toBe("wss://data-stream.binance.vision");
  });

  it("keeps the stream format the engine parses", () => {
    engine.activeSymbols = new Set(["btcusdt", "ethusdt"]);
    engine.connectWebSocket();
    expect(sockets[0].url).toBe(
      "wss://data-stream.binance.vision/stream?streams=btcusdt@ticker/ethusdt@ticker",
    );
    expect(sockets[0]).toBeInstanceOf(EventEmitter);
  });
});

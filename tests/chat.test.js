// AI assistant: history clean-up and the error responses users see
const request = require("supertest");
const app = require("../server");
const chatService = require("../services/chatService");
const { startDb, stopDb, clearDb, createUser } = require("./helpers");

beforeAll(startDb);
afterAll(stopDb);
afterEach(async () => {
  jest.restoreAllMocks();
  await clearDb();
});

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

describe("chat history", () => {
  const toHistory = chatService._toHistory;

  it("drops the greeting, merges repeated roles and ends on the model", () => {
    const turns = toHistory([
      { role: "model", content: "Hi! I'm the assistant." },
      { role: "user", content: "What is BTC?" },
      { role: "model", content: "Bitcoin is…" },
      { role: "model", content: "Error bubble" },
      { role: "user", content: "And ETH?" },
    ]);
    expect(turns.map((t) => t.role)).toEqual(["user", "model"]);
    expect(turns[1].parts[0].text).toContain("Error bubble");
  });

  it("ignores junk entries", () => {
    expect(toHistory("nope")).toEqual([]);
    expect(toHistory([{ role: "user", content: 42 }, null])).toEqual([]);
  });
});

describe("POST /api/chat", () => {
  it("answers with a disclaimer when trading comes up", async () => {
    jest.spyOn(chatService, "generateResponse").mockResolvedValue("A limit order sets the price you trade at.");
    const { token } = await createUser();
    const res = await request(app).post("/api/chat").set(bearer(token)).send({ message: "How do I trade?" });
    expect(res.status).toBe(200);
    expect(res.body.response).toMatch(/limit order/);
    expect(res.body.disclaimer).toMatch(/educational/);
  });

  it("explains an unconfigured assistant without leaking internals", async () => {
    jest
      .spyOn(chatService, "generateResponse")
      .mockRejectedValue(Object.assign(new Error("GEMINI_API_KEY is not set"), { code: "AI_NOT_CONFIGURED" }));
    const { token } = await createUser();
    const res = await request(app).post("/api/chat").set(bearer(token)).send({ message: "hi" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("AI_NOT_CONFIGURED");
    expect(res.body.message).not.toMatch(/GEMINI|key|server logs/i);
  });

  it("maps an overloaded provider to 503 and rejects long messages", async () => {
    jest.spyOn(chatService, "generateResponse").mockRejectedValue(Object.assign(new Error("high demand"), { code: "AI_BUSY" }));
    const { token } = await createUser();
    expect((await request(app).post("/api/chat").set(bearer(token)).send({ message: "hi" })).status).toBe(503);
    expect((await request(app).post("/api/chat").set(bearer(token)).send({ message: "x".repeat(501) })).status).toBe(400);
  });

  it("reports availability", async () => {
    const { token } = await createUser();
    const res = await request(app).get("/api/chat/status").set(bearer(token));
    expect(res.status).toBe(200);
    expect(typeof res.body.available).toBe("boolean");
  });
});

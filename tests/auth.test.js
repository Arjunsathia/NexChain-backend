jest.mock("../utils/emailService", () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  sendOTPEmail: jest.fn().mockResolvedValue(undefined),
}));

const request = require("supertest");
const app = require("../server");
const { sendOTPEmail } = require("../utils/emailService");
const { startDb, stopDb, clearDb } = require("./helpers");

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

describe("register → verify → login", () => {
  const signup = {
    name: "Alice",
    email: "Alice@Example.com",
    phone: "5550001",
    user_name: "alice",
    password: "Password123",
    confirm_password: "Password123",
  };

  it("creates an unverified account, verifies it by OTP, then logs in", async () => {
    const reg = await request(app).post("/api/auth/register").send(signup);
    expect(reg.status).toBe(201);
    expect(reg.body.email).toBe("alice@example.com");

    const blocked = await request(app)
      .post("/api/auth/login")
      .send({ email: "alice@example.com", password: "Password123" });
    expect(blocked.status).toBe(403);

    const otp = sendOTPEmail.mock.calls.at(-1)[1];
    const verify = await request(app)
      .post("/api/auth/verify-email-otp")
      .send({ email: "alice@example.com", otp });
    expect(verify.status).toBe(200);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "alice", password: "Password123" });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toEqual(expect.any(String));
    expect(login.body.user.role).toBe("user");
    expect(login.headers["set-cookie"].join(";")).toMatch(/refreshToken=/);
  });

  it("ignores a role sent at registration", async () => {
    await request(app).post("/api/auth/register").send({ ...signup, role: "admin" });
    const User = require("../Models/userModel");
    const user = await User.findOne({ email: "alice@example.com" });
    expect(user.role).toBe("user");
  });

  it("rejects a wrong password", async () => {
    await request(app).post("/api/auth/register").send(signup);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "alice@example.com", password: "nope" });
    expect(res.status).toBe(401);
  });
});

// Authentication & session hardening (Phase 3)
jest.mock("../utils/emailService", () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  sendOTPEmail: jest.fn().mockResolvedValue(undefined),
}));

const http = require("http");
const WebSocket = require("ws");
const speakeasy = require("speakeasy");
const request = require("supertest");
const app = require("../server");
const User = require("../Models/userModel");
const socketService = require("../services/socketService");
const { sendEmail } = require("../utils/emailService");
const { signAccessToken } = require("../utils/tokens");
const { startDb, stopDb, clearDb, createUser } = require("./helpers");

beforeAll(startDb);
afterAll(stopDb);
afterEach(async () => {
  jest.restoreAllMocks();
  await clearDb();
});

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const loginAgent = async (user, password, extra = {}) => {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email: user.email, password, ...extra });
  return { agent, res };
};
const refreshCookie = (res) =>
  res.headers["set-cookie"].find((c) => c.startsWith("refreshToken=")).split(";")[0];

describe("refresh tokens", () => {
  it("issues a new access token and rotates the refresh cookie", async () => {
    const { user, password } = await createUser();
    const { agent, res } = await loginAgent(user, password);

    const refreshed = await agent.post("/api/auth/refresh");
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.user.id).toBe(user.id);
    expect(refreshed.body.user).not.toHaveProperty("password");
    expect(refreshCookie(refreshed)).toEqual(expect.stringMatching(/^refreshToken=.+/));

    const me = await request(app).get(`/api/users/${user.id}`).set(bearer(refreshed.body.accessToken));
    expect(me.status).toBe(200);
    expect(res.status).toBe(200);
  });

  it.each([
    ["logout", (agent) => agent.post("/api/auth/logout")],
    ["password reset", async (agent, user) => {
      await agent.post("/api/auth/forgot-password").send({ email: user.email });
      const link = sendEmail.mock.calls.at(-1)[2].match(/token=([a-f0-9]+)&id=([\w-]+)/);
      await agent.post("/api/auth/reset-password").send({
        token: link[1], id: link[2], password: "NewPassword1", confirmPassword: "NewPassword1",
      });
    }],
    ["freeze by an admin", async (agent, user) => {
      const admin = await createUser({ role: "admin" });
      await request(app).put(`/api/users/${user.id}`).set(bearer(admin.token)).send({ isFrozen: true });
    }],
  ])("is revoked by %s, along with existing access tokens", async (_, action) => {
    const { user, password } = await createUser();
    const { agent, res } = await loginAgent(user, password);
    const accessToken = res.body.accessToken;

    await action(agent, user);

    expect((await agent.post("/api/auth/refresh")).status).toBe(401);
    expect((await request(app).get(`/api/users/${user.id}`).set(bearer(accessToken))).status).toBe(401);
  });

  it("a refresh token can't be used as an access token, or vice versa", async () => {
    const { user, password } = await createUser();
    const { res } = await loginAgent(user, password);
    const refreshJwt = refreshCookie(res).replace("refreshToken=", "");

    expect((await request(app).get(`/api/users/${user.id}`).set(bearer(refreshJwt))).status).toBe(401);
    const asRefresh = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", `refreshToken=${res.body.accessToken}`);
    expect(asRefresh.status).toBe(401);
  });

  it("a demoted admin loses admin access immediately", async () => {
    const superadmin = await createUser({ role: "superadmin" });
    const admin = await createUser({ role: "admin" });
    expect((await request(app).get("/api/users").set(bearer(admin.token))).status).toBe(200);

    await request(app).put(`/api/users/${admin.user.id}`).set(bearer(superadmin.token)).send({ role: "user" });
    expect((await request(app).get("/api/users").set(bearer(admin.token))).status).toBe(401);
  });

  it("changing your own password keeps you signed in with new tokens", async () => {
    const { user, password, token } = await createUser();
    const res = await request(app)
      .put(`/api/users/${user.id}`)
      .set(bearer(token))
      .send({ currentPassword: password, newPassword: "Another1pass", confirmPassword: "Another1pass" });

    expect(res.status).toBe(200);
    expect((await request(app).get(`/api/users/${user.id}`).set(bearer(token))).status).toBe(401);
    expect((await request(app).get(`/api/users/${user.id}`).set(bearer(res.body.accessToken))).status).toBe(200);
  });

  it("soft-deleted users can't log in", async () => {
    const { user, password } = await createUser({ isDeleted: true });
    const { res } = await loginAgent(user, password);
    expect(res.status).toBe(401);
  });
});

describe("two-factor authentication", () => {
  const codeFor = (secret) => speakeasy.totp({ secret, encoding: "base32" });

  const enroll = async (token) => {
    const setup = await request(app).post("/api/2fa/setup").set(bearer(token));
    expect(setup.status).toBe(200);
    expect(setup.body.qrCode).toMatch(/^data:image\/png;base64,/);
    const verify = await request(app).post("/api/2fa/verify").set(bearer(token)).send({ token: codeFor(setup.body.secret) });
    expect(verify.status).toBe(200);
    return setup.body.secret;
  };

  it("enrolls, then requires a valid code at login", async () => {
    const { user, password, token } = await createUser();
    const secret = await enroll(token);

    const stored = await User.findOne({ id: user.id }).select("+twoFactorSecret");
    expect(stored.twoFactorEnabled).toBe(true);
    expect(stored.twoFactorSecret).not.toContain(secret); // encrypted at rest

    const noCode = await loginAgent(user, password);
    expect(noCode.res.body).toMatchObject({ require2FA: true });
    expect(noCode.res.body.accessToken).toBeUndefined();

    expect((await loginAgent(user, password, { totp: "000000" })).res.status).toBe(401);

    const ok = await loginAgent(user, password, { totp: codeFor(secret) });
    expect(ok.res.status).toBe(200);
    expect(ok.res.body.user.twoFactorEnabled).toBe(true);
  });

  it("replacing or disabling 2FA requires a current code", async () => {
    const { token } = await createUser();
    const secret = await enroll(token);

    expect((await request(app).post("/api/2fa/setup").set(bearer(token))).status).toBe(400);
    expect((await request(app).post("/api/2fa/disable").set(bearer(token)).send({ token: "123456" })).status).toBe(400);

    const disabled = await request(app).post("/api/2fa/disable").set(bearer(token)).send({ token: codeFor(secret) });
    expect(disabled.status).toBe(200);
  });

  it("legacy plaintext admin secrets still satisfy the admin 2FA check", async () => {
    const secret = speakeasy.generateSecret().base32;
    const superadmin = await createUser({ role: "superadmin", adminTotpSecret: { base32: secret } });
    const target = await createUser();

    const noCode = await request(app).delete(`/api/users/${target.user.id}`).set(bearer(superadmin.token));
    expect(noCode.body.require2FA).toBe(true);

    const ok = await request(app)
      .delete(`/api/users/${target.user.id}`)
      .set(bearer(superadmin.token))
      .set("X-Admin-2FA-Code", codeFor(secret));
    expect(ok.status).toBe(200);
  });
});

describe("Google sign-in", () => {
  it("rejects an access token issued to another app", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ aud: "some-other-app", sub: "1", email: "victim@test.com", email_verified: "true" }),
    });
    await createUser({ email: "victim@test.com" });

    const res = await request(app).post("/api/auth/google").send({ googleAccessToken: "stolen" });
    expect(res.status).toBe(401);
    expect(res.body.accessToken).toBeUndefined();
  });

  it("accepts a token issued to this app", async () => {
    jest.spyOn(global, "fetch").mockImplementation(async (url) => ({
      ok: true,
      json: async () =>
        String(url).includes("tokeninfo")
          ? { aud: process.env.GOOGLE_CLIENT_ID, sub: "42" }
          : { sub: "42", email: "New.Person@Gmail.com", email_verified: true, name: "New Person" },
    }));

    const res = await request(app).post("/api/auth/google").send({ googleAccessToken: "valid" });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("new.person@gmail.com");
  });
});

describe("input and output hardening", () => {
  it("rejects weak passwords at registration with a readable message", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "Weak", email: "weak@test.com", phone: "1", user_name: "weakling",
      password: "abcdefgh", confirm_password: "abcdefgh",
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/letter and one number/);
  });

  it("escapes user text in support emails", async () => {
    const { token } = await createUser({ name: "<b>Eve</b>" });
    await request(app)
      .post("/api/users/contact-support")
      .set(bearer(token))
      .send({ subject: "Help", message: '<a href="https://evil.example">Reset your password</a>' });

    const html = sendEmail.mock.calls.at(-1)[2];
    expect(html).not.toContain("<a href=");
    expect(html).toContain("&lt;a href=");
    expect(html).toContain("&lt;b&gt;Eve&lt;/b&gt;");
  });

  it("superadmins can't be modified or deleted by other admins", async () => {
    const superadmin = await createUser({ role: "superadmin" });
    const otherSuper = await createUser({ role: "superadmin" });
    const admin = await createUser({ role: "admin" });

    const freeze = await request(app).put(`/api/users/${superadmin.user.id}`).set(bearer(otherSuper.token)).send({ isFrozen: true });
    expect(freeze.status).toBe(403);

    const del = await request(app)
      .delete(`/api/users/${superadmin.user.id}`)
      .set(bearer(admin.token))
      .set("X-Admin-2FA-Code", "000000");
    expect(del.status).toBeGreaterThanOrEqual(400);
    expect((await User.findOne({ id: superadmin.user.id })).isDeleted).toBe(false);
  });

  it("the chatbot requires login", async () => {
    expect((await request(app).post("/api/chat").send({ message: "hi" })).status).toBe(401);
  });
});

describe("WebSocket authentication", () => {
  let server;
  let url;
  beforeAll((done) => {
    server = http.createServer(app);
    socketService.init(server);
    server.listen(0, () => {
      url = `ws://127.0.0.1:${server.address().port}`;
      done();
    });
  });
  afterAll((done) => {
    socketService.close();
    server.close(done);
  });

  const connect = (token) =>
    new Promise((resolve) => {
      const ws = new WebSocket(url);
      ws.on("open", () => ws.send(JSON.stringify({ type: "AUTH", token })));
      ws.on("message", (data) => {
        ws.close();
        resolve({ type: JSON.parse(data.toString()).type });
      });
      ws.on("close", (code) => resolve({ code }));
    });

  it("accepts a valid access token sent as the first message", async () => {
    const { token } = await createUser();
    expect(await connect(token)).toEqual({ type: "AUTH_OK" });
  });

  it("rejects revoked or wrong-type tokens", async () => {
    const { user } = await createUser();
    const stale = signAccessToken(user);
    await User.updateOne({ id: user.id }, { $inc: { tokenVersion: 1 } });
    expect(await connect(stale)).toEqual({ code: 4401 });
    expect(await connect("not-a-token")).toEqual({ code: 4401 });
  });
});

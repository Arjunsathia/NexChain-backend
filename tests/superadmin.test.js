// Super Admin accounts can't be deleted, demoted, frozen or archived by anyone
jest.mock("../utils/emailService", () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  sendOTPEmail: jest.fn().mockResolvedValue(undefined),
}));

const speakeasy = require("speakeasy");
const request = require("supertest");
const app = require("../server");
const User = require("../Models/userModel");
const { startDb, stopDb, clearDb, createUser } = require("./helpers");

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const codeFor = (secret) => speakeasy.totp({ secret, encoding: "base32" });

// Admin deletes need a 2FA code, so the acting admins get an authenticator secret
const adminWith2FA = async (role) => {
  const secret = speakeasy.generateSecret().base32;
  const { user, token } = await createUser({ role, adminTotpSecret: { base32: secret } });
  return { user, token, code: () => codeFor(secret) };
};

describe("Super Admin protection", () => {
  it("can't be deleted, even by another Super Admin", async () => {
    const target = await createUser({ role: "superadmin" });
    for (const role of ["superadmin", "admin"]) {
      const actor = await adminWith2FA(role);
      const res = await request(app)
        .delete(`/api/users/${target.user.id}`)
        .set(bearer(actor.token))
        .set("X-Admin-2FA-Code", actor.code());
      expect(res.status).toBe(403);
    }
    const stored = await User.findOne({ id: target.user.id });
    expect(stored.isDeleted).not.toBe(true);
  });

  it("can't be demoted, frozen or archived by another admin", async () => {
    const target = await createUser({ role: "superadmin" });
    for (const role of ["superadmin", "admin"]) {
      const actor = await createUser({ role });
      for (const change of [{ role: "user" }, { isFrozen: true }, { isDeleted: true }]) {
        const res = await request(app).put(`/api/users/${target.user.id}`).set(bearer(actor.token)).send(change);
        expect(res.status).toBe(403);
      }
    }
    const stored = await User.findOne({ id: target.user.id });
    expect(stored.role).toBe("superadmin");
    expect(stored.isFrozen).not.toBe(true);
    expect(stored.isDeleted).not.toBe(true);
  });

  it("can't demote, freeze or archive itself", async () => {
    const self = await createUser({ role: "superadmin" });
    for (const change of [{ role: "user" }, { isFrozen: true }, { isDeleted: true }]) {
      const res = await request(app).put(`/api/users/${self.user.id}`).set(bearer(self.token)).send(change);
      expect(res.status).toBe(403);
    }
    expect((await User.findOne({ id: self.user.id })).role).toBe("superadmin");
  });

  it("can't be promoted to by a regular admin", async () => {
    const admin = await createUser({ role: "admin" });
    const target = await createUser();
    const res = await request(app).put(`/api/users/${target.user.id}`).set(bearer(admin.token)).send({ role: "superadmin" });
    expect(res.status).toBe(403);
    expect((await User.findOne({ id: target.user.id })).role).toBe("user");
  });
});

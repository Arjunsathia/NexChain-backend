// KYC & file storage (Phase 4)
jest.mock("../utils/emailService", () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  sendOTPEmail: jest.fn().mockResolvedValue(undefined),
}));

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const User = require("../Models/userModel");
const AuditLog = require("../Models/AuditLog");
const Notification = require("../Models/Notification");
const { sendEmail } = require("../utils/emailService");
const { startDb, stopDb, clearDb, createUser } = require("./helpers");

beforeAll(startDb);
afterAll(async () => {
  await stopDb();
  fs.rmSync(path.join(__dirname, "..", "private_uploads", "kyc"), { recursive: true, force: true });
});
afterEach(async () => {
  jest.restoreAllMocks();
  await clearDb();
});

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const HTML_AS_PNG = Buffer.from("<html><script>alert(1)</script></html>");
const fields = { fullName: "Alice Example", dob: "1990-01-01", address: "1 Main St", idType: "passport", idNumber: "X1234567" };

const submit = (token, file = PNG, filename = "id.png") => {
  const req = request(app).post("/api/kyc/submit").set(bearer(token));
  Object.entries(fields).forEach(([k, v]) => req.field(k, v));
  return file ? req.attach("document", file, filename) : req;
};

describe("KYC submission", () => {
  it("stores the document privately and masks the id number", async () => {
    const { user, token } = await createUser();
    const res = await submit(token);
    expect(res.status).toBe(200);
    expect(res.body.kycStatus).toBe("pending");

    const stored = await User.findOne({ id: user.id });
    expect(stored.kycData.documentImage).toMatch(/^local:kyc\/[0-9a-f-]+\.png$/);

    // Not reachable through the public uploads folder
    const file = stored.kycData.documentImage.split("/")[1];
    expect((await request(app).get(`/uploads/${file}`)).status).toBe(404);

    const status = await request(app).get(`/api/kyc/status/${user.id}`).set(bearer(token));
    expect(status.body.kycData.idNumber).toBe("••••4567");
    expect(status.body.kycData.hasDocument).toBe(true);
    expect(status.body.kycData).not.toHaveProperty("documentImage");
  });

  it("requires a real image or PDF", async () => {
    const { token } = await createUser();
    expect((await submit(token, null)).status).toBe(400);
    expect((await submit(token, HTML_AS_PNG, "id.png")).status).toBe(400);
  });

  it("can't be resubmitted while under review", async () => {
    const { token } = await createUser();
    await submit(token);
    expect((await submit(token)).status).toBe(400);
  });
});

describe("KYC review", () => {
  it("admins see the full submission and the document; users can't", async () => {
    const { user, token } = await createUser();
    const admin = await createUser({ role: "admin" });
    await submit(token);

    expect((await request(app).get(`/api/kyc/review/${user.id}`).set(bearer(token))).status).toBe(403);
    expect((await request(app).get(`/api/kyc/review/${user.id}/document`).set(bearer(token))).status).toBe(403);

    const review = await request(app).get(`/api/kyc/review/${user.id}`).set(bearer(admin.token));
    expect(review.body.kycData.idNumber).toBe("X1234567");

    const doc = await request(app).get(`/api/kyc/review/${user.id}/document`).set(bearer(admin.token));
    expect(doc.status).toBe(200);
    expect(doc.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(doc.body, PNG)).toBe(0);
  });

  it("a decision notifies the user, is audited, and a rejection allows resubmitting", async () => {
    const { user, token } = await createUser();
    const admin = await createUser({ role: "admin" });
    await submit(token);

    const res = await request(app)
      .post("/api/kyc/verify")
      .set(bearer(admin.token))
      .send({ user_id: user.id, status: "rejected", rejectionReason: "Blurry photo" });
    expect(res.status).toBe(200);

    expect((await User.findOne({ id: user.id })).kycData.rejectionReason).toBe("Blurry photo");
    expect(await AuditLog.countDocuments({ action: "KYC_REJECT" })).toBe(1);
    expect(await Notification.countDocuments({ user: user._id })).toBe(1);

    expect((await submit(token)).status).toBe(200);
  });
});

describe("audit log", () => {
  it("records role changes (previously dropped by the schema)", async () => {
    const superadmin = await createUser({ role: "superadmin" });
    const target = await createUser();
    await request(app).put(`/api/users/${target.user.id}`).set(bearer(superadmin.token)).send({ role: "admin" });
    expect(await AuditLog.countDocuments({})).toBe(1);
  });
});

describe("support attachments", () => {
  it("are emailed from memory and not written to disk", async () => {
    const { token } = await createUser();
    const before = fs.readdirSync(path.join(__dirname, "..", "uploads")).length;

    const res = await request(app)
      .post("/api/users/contact-support")
      .set(bearer(token))
      .field("subject", "Help")
      .field("message", "See attached")
      .attach("attachment", PNG, "screenshot.png");

    expect(res.status).toBe(200);
    const [attachment] = sendEmail.mock.calls.at(-1)[3];
    expect(attachment.content.equals(PNG)).toBe(true);
    expect(fs.readdirSync(path.join(__dirname, "..", "uploads")).length).toBe(before);
  });
});

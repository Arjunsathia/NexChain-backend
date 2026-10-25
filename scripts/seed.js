// Creates local dev accounts. Usage: npm run seed
// Refuses to run against production. Existing accounts are left untouched.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");
const User = require("../Models/userModel");

const ACCOUNTS = [
  { name: "Super Admin", email: "superadmin@nexchain.local", user_name: "superadmin", role: "superadmin" },
  { name: "Admin", email: "admin@nexchain.local", user_name: "admin", role: "admin" },
  { name: "Test User", email: "user@nexchain.local", user_name: "testuser", role: "user" },
];
const PASSWORD = "Password123";

const seed = async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production database");
  }
  await mongoose.connect(process.env.MONGO_URI);

  for (const account of ACCOUNTS) {
    if (await User.findOne({ email: account.email })) {
      console.log(`exists   ${account.email}`);
      continue;
    }
    await User.create({
      ...account,
      id: uuidv4(),
      password: await bcrypt.hash(PASSWORD, 10),
      emailVerified: true,
    });
    console.log(`created  ${account.email} (${account.role})`);
  }
  console.log(`\nPassword for new accounts: ${PASSWORD}`);
};

seed()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

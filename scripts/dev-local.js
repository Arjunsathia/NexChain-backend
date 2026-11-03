// Local review mode. Usage: npm run dev:local
// Runs the API against a private MongoDB replica set started on this machine
// (data kept in .local-db/), with the dev accounts seeded. Cloudinary and email
// keys are blanked so nothing reaches real third-party accounts. The CryptoCompare
// key stays (read-only market data), and so does the Gemini key, so the AI
// assistant works: it only answers questions and touches no user data.
// Run with LOCAL_AI=off to start the assistant offline instead.
const path = require("path");
const fs = require("fs");
const { spawn, execFileSync } = require("child_process");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const ROOT = path.join(__dirname, "..");
const DB_PATH = path.join(ROOT, ".local-db");
const DB_PORT = 27027; // fixed so the stored replica set config stays valid across restarts
const PID_FILE = path.join(DB_PATH, ".pids.json");

const processName = (pid) => {
  try {
    process.kill(pid, 0);
  } catch {
    return null; // not running
  }
  return process.platform === "win32"
    ? execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"]).toString()
    : execFileSync("ps", ["-p", String(pid), "-o", "comm="]).toString();
};

// If another launcher is still running, stop here rather than touch its
// processes. Otherwise, clear what an unclean exit left behind: on Windows,
// killing the launcher without Ctrl+C (closing the terminal, a task manager kill)
// leaves the API and mongod holding their ports. Process names are checked so a
// reused PID is never hit.
const checkPreviousRun = () => {
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
  } catch {
    return;
  }
  const { launcher, children = [] } = Array.isArray(saved) ? { children: saved } : saved;

  if (launcher && /node/i.test(processName(launcher) || "")) {
    console.error(`[LOCAL   ] ❌ Local mode is already running (process ${launcher}).`);
    console.error("[LOCAL   ]    Use that one, or stop it with Ctrl+C in its terminal first.");
    process.exit(1);
  }

  for (const pid of children) {
    if (/node|mongod/i.test(processName(pid) || "")) {
      process.kill(pid);
      console.log(`[LOCAL   ] Stopped leftover process ${pid} from a previous run`);
    }
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const start = async () => {
  fs.mkdirSync(DB_PATH, { recursive: true });
  checkPreviousRun();
  await sleep(1000); // let the OS release the ports
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: DB_PORT, dbPath: DB_PATH, storageEngine: "wiredTiger" }],
  });

  // dotenv never overrides variables that are already set, so these win over .env
  const env = {
    ...process.env,
    NODE_ENV: "development",
    MONGO_URI: replSet.getUri("nexchain_local"),
    CLOUDINARY_CLOUD_NAME: "",
    CLOUDINARY_API_KEY: "",
    CLOUDINARY_API_SECRET: "",
    EMAIL_USER: "",
    EMAIL_PASS: "",
    ...(process.env.LOCAL_AI === "off" ? { GEMINI_API_KEY: "" } : {}),
  };

  console.log(`[LOCAL   ] Database: ${env.MONGO_URI} (data in .local-db/)`);
  console.log(`[LOCAL   ] AI assistant: ${process.env.LOCAL_AI === "off" ? "off (LOCAL_AI=off)" : "on, using GEMINI_API_KEY from .env"}`);
  execFileSync(process.execPath, [path.join(__dirname, "seed.js")], { cwd: ROOT, env, stdio: "inherit" });

  const server = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "inherit" });
  const mongodPid = replSet.servers[0].instanceInfo?.instance?.mongodProcess?.pid;
  fs.writeFileSync(
    PID_FILE,
    JSON.stringify({ launcher: process.pid, children: [server.pid, mongodPid].filter(Boolean) }),
  );

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    server.kill("SIGINT");
    await replSet.stop({ doCleanup: false }); // keep .local-db/ for next time
    fs.rmSync(PID_FILE, { force: true });
    process.exit(0);
  };
  server.on("exit", stop);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
};

start().catch((err) => {
  console.error("[LOCAL   ] ❌", err.message);
  process.exit(1);
});

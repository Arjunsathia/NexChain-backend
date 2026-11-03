// Local development. Usage: npm run dev (alias: npm run dev:local)
// Runs the API with auto-reload (nodemon) against a private MongoDB replica set
// started on this machine (data kept in .local-db/), with the dev accounts
// seeded. Cloudinary and email keys are blanked so nothing reaches real
// third-party accounts. The CryptoCompare key stays (read-only market data), and
// so does the Gemini key, so the AI assistant works: it only answers questions
// and touches no user data. Run with LOCAL_AI=off to start the assistant offline.
//
// To use your own MONGO_URI (Atlas, or your own MongoDB) run `npm run dev:own-db`.
const path = require("path");
const fs = require("fs");
const net = require("net");
const { spawn, execFileSync } = require("child_process");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const ROOT = path.join(__dirname, "..");
const DB_PATH = path.join(ROOT, ".local-db");
const DB_PORT = 27027; // fixed so the stored replica set config stays valid across restarts
const API_PORT = Number(process.env.PORT) || 4001;
const PID_FILE = path.join(DB_PATH, ".pids.json");
const IS_WINDOWS = process.platform === "win32";
const log = (msg) => console.log(`[LOCAL   ] ${msg}`);
const fail = (...lines) => {
  lines.forEach((line, i) => console.error(`[LOCAL   ] ${i === 0 ? "❌ " : "   "}${line}`));
  process.exit(1);
};

const isRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Full command line of a process, or "" if it isn't running */
const commandLine = (pid) => {
  if (!pid || !isRunning(pid)) return "";
  try {
    return IS_WINDOWS
      ? execFileSync(
          "powershell.exe",
          ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`],
          { stdio: ["ignore", "pipe", "ignore"] },
        ).toString().trim()
      : execFileSync("ps", ["-p", String(pid), "-o", "args="]).toString().trim();
  } catch {
    return "";
  }
};

/**
 * Kills a process and everything it started. On Windows a parent can die
 * without its children (that's how a stale API ends up holding the port), so
 * taskkill /T is used to take the whole tree.
 */
const killTree = (pid) => {
  if (!pid || !isRunning(pid)) return;
  try {
    if (IS_WINDOWS) execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  }
};

// Leftovers are only killed when their command line proves they're ours, so a
// reused PID (another Node app, say) is never touched: it mentions this project
// folder (nodemon, mongod's .local-db) or is the API itself (`node server.js`).
const normalize = (s) => s.replace(/\\/g, "/").toLowerCase();
const isOurs = (cmd) =>
  !!cmd && (normalize(cmd).includes(normalize(ROOT)) || /node(\.exe)?"?\s+server\.js\b/i.test(cmd));

// If another launcher is still running, stop here rather than touch its
// processes. Otherwise, clear what an unclean exit left behind (a closed
// terminal, a task manager kill), which would otherwise hold the ports.
const checkPreviousRun = () => {
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
  } catch {
    return;
  }
  const { launcher, children = [] } = Array.isArray(saved) ? { children: saved } : saved;

  if (launcher && /dev-local\.js/.test(commandLine(launcher))) {
    fail(
      `Local mode is already running (process ${launcher}).`,
      "Use that one, or stop it with Ctrl+C in its terminal first.",
    );
  }

  for (const pid of children) {
    if (isOurs(commandLine(pid))) {
      killTree(pid);
      log(`Stopped leftover process ${pid} from a previous run`);
    }
  }
  fs.rmSync(PID_FILE, { force: true });
};

const portIsFree = (port) =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port);
  });

/** "PID 1234 (node.exe)" for whatever is listening on a port, when the OS will say */
const portOwner = (port) => {
  try {
    if (IS_WINDOWS) {
      // No -p filter: Node listens on IPv6 ([::]:4001), which `-p TCP` would hide
      const line = execFileSync("netstat", ["-ano"]).toString().split(/\r?\n/)
        .find((l) => /^\s*TCP/.test(l) && /LISTENING/.test(l) && new RegExp(`:${port}\\s`).test(l));
      const pid = line?.trim().split(/\s+/).pop();
      if (!pid) return null;
      const name = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"]).toString().split(",")[0].replace(/"/g, "");
      return { pid, label: `PID ${pid} (${name})` };
    }
    const pid = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]).toString().trim().split("\n")[0];
    return pid ? { pid, label: `PID ${pid}` } : null;
  } catch {
    return null;
  }
};

const requireFreePort = async (port, what) => {
  if (await portIsFree(port)) return;
  const owner = portOwner(port);
  fail(
    `Port ${port} (${what}) is already in use${owner ? ` by ${owner.label}` : ""}.`,
    "Another copy of the API is probably still running in some terminal: stop it with Ctrl+C there.",
    owner
      ? `Or end it: ${IS_WINDOWS ? `taskkill /PID ${owner.pid} /T /F` : `kill ${owner.pid}`}`
      : "Or pick another port with PORT=... in .env.",
  );
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const start = async () => {
  fs.mkdirSync(DB_PATH, { recursive: true });
  checkPreviousRun();
  await sleep(1000); // let the OS release the ports
  await requireFreePort(API_PORT, "API");
  await requireFreePort(DB_PORT, "local database");

  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: DB_PORT, dbPath: DB_PATH, storageEngine: "wiredTiger" }],
  });

  // dotenv never overrides variables that are already set, so these win over .env
  const env = {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(API_PORT),
    MONGO_URI: replSet.getUri("nexchain_local"),
    CLOUDINARY_CLOUD_NAME: "",
    CLOUDINARY_API_KEY: "",
    CLOUDINARY_API_SECRET: "",
    EMAIL_USER: "",
    EMAIL_PASS: "",
    ...(process.env.LOCAL_AI === "off" ? { GEMINI_API_KEY: "" } : {}),
  };

  log(`Database: ${env.MONGO_URI} (data in .local-db/)`);
  log(`AI assistant: ${process.env.LOCAL_AI === "off" ? "off (LOCAL_AI=off)" : "on, using GEMINI_API_KEY from .env"}`);
  execFileSync(process.execPath, [path.join(__dirname, "seed.js")], { cwd: ROOT, env, stdio: "inherit" });

  // nodemon restarts the API when code changes (see nodemon.json for what's watched)
  const nodemonBin = require.resolve("nodemon/bin/nodemon.js");
  const api = spawn(process.execPath, [nodemonBin, "server.js"], {
    cwd: ROOT,
    env,
    stdio: "inherit",
    detached: !IS_WINDOWS, // own process group, so killTree can signal it on macOS/Linux
  });
  const mongodPid = replSet.servers[0].instanceInfo?.instance?.mongodProcess?.pid;
  fs.writeFileSync(
    PID_FILE,
    JSON.stringify({ launcher: process.pid, children: [api.pid, mongodPid].filter(Boolean) }),
  );
  log(`API with auto-reload on http://localhost:${API_PORT} (Ctrl+C stops everything)`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    killTree(api.pid); // nodemon and the API it started
    await replSet.stop({ doCleanup: false }); // keep .local-db/ for next time
    fs.rmSync(PID_FILE, { force: true });
    process.exit(0);
  };
  api.on("exit", stop);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
};

start().catch((err) => {
  console.error("[LOCAL   ] ❌", err.message);
  process.exit(1);
});

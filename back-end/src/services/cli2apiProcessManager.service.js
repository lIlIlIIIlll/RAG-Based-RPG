// src/services/cli2apiProcessManager.service.js
// Manages per-user CLI2API child processes for credential isolation.
// Each user gets a dedicated CLI2API instance with its own auth-dir, port, and config.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ========================
// Configuration
// ========================

const CLI2API_BINARY_PATH = process.env.CLI2API_BINARY_PATH || "cli-proxy-api";
const CLI2API_BASE_PORT = parseInt(process.env.CLI2API_BASE_PORT || "8320", 10);
const CLI2API_MAX_PORTS = parseInt(process.env.CLI2API_MAX_PORTS || "200", 10);
const CLI2API_MANAGEMENT_KEY =
  process.env.CLI2API_MANAGEMENT_KEY || "mgmt-secret-default";
const CLI2API_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CLI2API_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const CLI2API_STARTUP_WAIT_MS = 2000; // Wait for process to bind port
const INSTANCES_DIR = path.join(process.cwd(), "data", "cli2api-instances");

// ========================
// Process Registry
// ========================

/** @type {Map<string, ProcessEntry>} */
const processes = new Map();

/** @type {Set<number>} */
const usedPorts = new Set();

/**
 * @typedef {Object} ProcessEntry
 * @property {import("child_process").ChildProcess} process
 * @property {number} port
 * @property {string} apiKey
 * @property {string} configPath
 * @property {string} authDir
 * @property {number} lastActivity
 * @property {boolean} ready
 */

// ========================
// Port Allocation
// ========================

/**
 * Allocates a unique port for a user based on a hash of their userId.
 * Uses linear probing for collision resolution.
 * @param {string} userId
 * @returns {number}
 */
function allocatePort(userId) {
  const hash = crypto.createHash("md5").update(userId).digest("hex");
  let offset = parseInt(hash.substring(0, 8), 16) % CLI2API_MAX_PORTS;

  for (let i = 0; i < CLI2API_MAX_PORTS; i++) {
    const port = CLI2API_BASE_PORT + ((offset + i) % CLI2API_MAX_PORTS);
    if (!usedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  }

  throw new Error(
    "[CLI2API-PM] No available ports. All ports in range are occupied.",
  );
}

/**
 * Releases a previously allocated port.
 * @param {number} port
 */
function releasePort(port) {
  usedPorts.delete(port);
}

// ========================
// Config Generation
// ========================

/**
 * Generates a minimal config.yaml for a user's CLI2API instance.
 * @param {number} port
 * @param {string} authDir
 * @param {string} apiKey
 * @returns {string}
 */
function generateConfig(port, authDir, apiKey) {
  // Normalize path separators for YAML (use forward slashes)
  const normalizedAuthDir = authDir.replace(/\\/g, "/");

  return `# Auto-generated config for CLI2API per-user instance
host: "127.0.0.1"
port: ${port}
auth-dir: "${normalizedAuthDir}"

api-keys:
  - "${apiKey}"

remote-management:
  allow-remote: false
  secret-key: "${CLI2API_MANAGEMENT_KEY}"

request-retry-count: 2
max-retry-interval: 5

gemini:
  safety-settings: "BLOCK_NONE"
`;
}

// ========================
// Process Lifecycle
// ========================

/**
 * Ensures a CLI2API process is running for the given user.
 * If one exists and is alive, returns its info with updated lastActivity.
 * If none exists, spawns a new one.
 *
 * @param {string} userId
 * @returns {Promise<{ port: number, baseUrl: string, apiKey: string, managementKey: string }>}
 */
async function ensureProcess(userId) {
  const existing = processes.get(userId);

  if (existing && existing.ready && !existing.process.killed) {
    existing.lastActivity = Date.now();
    return {
      port: existing.port,
      baseUrl: `http://127.0.0.1:${existing.port}`,
      apiKey: existing.apiKey,
      managementKey: CLI2API_MANAGEMENT_KEY,
    };
  }

  // If process exists but is dead, clean it up first
  if (existing) {
    await stopProcess(userId);
  }

  return await spawnProcess(userId);
}

/**
 * Spawns a new CLI2API child process for the given user.
 * @param {string} userId
 * @returns {Promise<{ port: number, baseUrl: string, apiKey: string, managementKey: string }>}
 */
async function spawnProcess(userId) {
  // 1. Setup directories
  const instanceDir = path.join(INSTANCES_DIR, userId);
  const authDir = path.join(instanceDir, "auths");
  const configPath = path.join(instanceDir, "config.yaml");

  fs.mkdirSync(authDir, { recursive: true });

  // 2. Allocate port and generate API key
  const port = allocatePort(userId);
  const apiKey = crypto.randomBytes(16).toString("hex");

  // 3. Write config file
  const configContent = generateConfig(port, authDir, apiKey);
  fs.writeFileSync(configPath, configContent, "utf8");

  console.log(
    `[CLI2API-PM] Spawning process for user ${userId} on port ${port}`,
  );

  // 4. Spawn the process
  const child = spawn(CLI2API_BINARY_PATH, ["-config", configPath], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const entry = {
    process: child,
    port,
    apiKey,
    configPath,
    authDir,
    lastActivity: Date.now(),
    ready: false,
  };

  processes.set(userId, entry);

  // 5. Handle stdout/stderr for logging
  child.stdout.on("data", (data) => {
    const line = data.toString().trim();
    if (line) {
      console.log(`[CLI2API:${userId.substring(0, 8)}] ${line}`);
    }
  });

  child.stderr.on("data", (data) => {
    const line = data.toString().trim();
    if (line) {
      console.error(`[CLI2API:${userId.substring(0, 8)}] ${line}`);
    }
  });

  // 6. Handle process exit
  child.on("exit", (code, signal) => {
    console.log(
      `[CLI2API-PM] Process for user ${userId.substring(0, 8)} exited (code=${code}, signal=${signal})`,
    );
    releasePort(port);
    const currentEntry = processes.get(userId);
    if (currentEntry && currentEntry.process === child) {
      processes.delete(userId);
    }
  });

  child.on("error", (err) => {
    console.error(
      `[CLI2API-PM] Failed to spawn process for user ${userId.substring(0, 8)}: ${err.message}`,
    );
    releasePort(port);
    processes.delete(userId);
  });

  // 7. Wait for the process to start and bind its port
  await waitForProcessReady(port);
  entry.ready = true;

  console.log(
    `[CLI2API-PM] Process ready for user ${userId.substring(0, 8)} on port ${port}`,
  );

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    apiKey,
    managementKey: CLI2API_MANAGEMENT_KEY,
  };
}

/**
 * Waits for a CLI2API process to become ready by polling its port.
 * @param {number} port
 * @param {number} maxWaitMs
 */
async function waitForProcessReady(port, maxWaitMs = CLI2API_STARTUP_WAIT_MS) {
  const startTime = Date.now();
  const pollInterval = 200;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok || response.status === 401) {
        // 401 is fine — means the server is up but needs auth
        return;
      }
    } catch {
      // Process not ready yet, retry
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // If we get here, might still work — some cold starts are slow
  console.warn(
    `[CLI2API-PM] Process on port ${port} did not respond within ${maxWaitMs}ms, proceeding anyway`,
  );
}

/**
 * Returns the process info for a user, or null.
 * @param {string} userId
 * @returns {ProcessEntry | null}
 */
function getProcess(userId) {
  const entry = processes.get(userId);
  if (entry && !entry.process.killed) {
    entry.lastActivity = Date.now();
    return entry;
  }
  return null;
}

/**
 * Gracefully stops a user's CLI2API process.
 * @param {string} userId
 */
async function stopProcess(userId) {
  const entry = processes.get(userId);
  if (!entry) return;

  console.log(
    `[CLI2API-PM] Stopping process for user ${userId.substring(0, 8)} (port ${entry.port})`,
  );

  try {
    entry.process.kill("SIGTERM");

    // Give it 3 seconds to shut down gracefully
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!entry.process.killed) {
          entry.process.kill("SIGKILL");
        }
        resolve();
      }, 3000);

      entry.process.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  } catch (err) {
    console.error(`[CLI2API-PM] Error stopping process: ${err.message}`);
  }

  releasePort(entry.port);
  processes.delete(userId);
}

/**
 * Stops all CLI2API processes (used during graceful shutdown).
 */
async function stopAll() {
  console.log(
    `[CLI2API-PM] Stopping all ${processes.size} CLI2API processes...`,
  );
  const stopPromises = [];
  for (const userId of processes.keys()) {
    stopPromises.push(stopProcess(userId));
  }
  await Promise.all(stopPromises);
  console.log("[CLI2API-PM] All processes stopped.");
}

// ========================
// Idle Cleanup
// ========================

/**
 * Periodically checks for and kills idle CLI2API processes.
 */
function startIdleCleanup() {
  setInterval(() => {
    const now = Date.now();
    for (const [userId, entry] of processes.entries()) {
      const idleTime = now - entry.lastActivity;
      if (idleTime > CLI2API_IDLE_TIMEOUT_MS) {
        console.log(
          `[CLI2API-PM] User ${userId.substring(0, 8)} idle for ${Math.round(idleTime / 60000)}min, stopping process`,
        );
        stopProcess(userId);
      }
    }
  }, CLI2API_CLEANUP_INTERVAL_MS);
}

// ========================
// Status / Debug
// ========================

/**
 * Returns a status overview of all active processes.
 * @returns {Array<{ userId: string, port: number, ready: boolean, idleMinutes: number }>}
 */
function getStatus() {
  const now = Date.now();
  const result = [];
  for (const [userId, entry] of processes.entries()) {
    result.push({
      userId: userId.substring(0, 8) + "...",
      port: entry.port,
      ready: entry.ready,
      idleMinutes: Math.round((now - entry.lastActivity) / 60000),
    });
  }
  return result;
}

// ========================
// Graceful Shutdown Hooks
// ========================

process.on("SIGTERM", async () => {
  await stopAll();
});

process.on("SIGINT", async () => {
  await stopAll();
});

// Start the idle cleanup loop
startIdleCleanup();

// ========================
// Exports
// ========================

module.exports = {
  ensureProcess,
  getProcess,
  stopProcess,
  stopAll,
  getStatus,
};

// src/api/controllers/cli2apiAuth.controller.js
// Proxies Antigravity OAuth requests to the user's dedicated CLI2API instance.

const processManager = require("../../services/cli2apiProcessManager.service");

/**
 * Starts an Antigravity OAuth login flow for the current user.
 * Spawns a CLI2API process if needed, then initiates the OAuth URL.
 *
 * POST /api/cli2api-auth/login
 */
async function startLogin(req, res) {
  try {
    const userId = req.user.id;
    const { port, managementKey } = await processManager.ensureProcess(userId);

    const response = await fetch(
      `http://127.0.0.1:${port}/v0/management/antigravity-auth-url?is_webui=true`,
      {
        headers: { Authorization: `Bearer ${managementKey}` },
      },
    );

    const data = await response.json();

    if (data.status === "ok") {
      // OVERRIDE: Rewrite redirect_uri to point to our production backend callback
      // The CLI2API process generates a URL with redirect_uri=http://localhost:51121/oauth-callback
      // We must change this to https://<production-domain>/cli2api-auth/callback so the browser can reach it.

      const productionHost = "n8n-backenddungeonmaster.r954jc.easypanel.host";
      const publicCallbackUrl = `https://${productionHost}/cli2api-auth/callback`;

      // Replace the encoded localhost redirect_uri with our public one
      // The param is usually: redirect_uri=http%3A%2F%2Flocalhost%3A51121%2Foauth-callback
      const localhostRedirect = encodeURIComponent(
        "http://localhost:51121/oauth-callback",
      );
      const paramPattern = new RegExp(`redirect_uri=${localhostRedirect}`, "g");

      let publicUrl = data.url;
      if (publicUrl.includes(localhostRedirect)) {
        publicUrl = publicUrl.replace(
          paramPattern,
          `redirect_uri=${encodeURIComponent(publicCallbackUrl)}`,
        );
      } else {
        // Fallback: try to replace just the host/port if the path is different
        // This is risky if the path is mandated by the provider, but worth a shot if the above fails
        publicUrl = publicUrl.replace(
          /localhost%3A51121/,
          encodeURIComponent(productionHost + "/api/cli2api-auth/callback"),
        );
      }

      return res.json({
        success: true,
        url: publicUrl,
        state: data.state,
      });
    }

    return res.status(502).json({
      success: false,
      error: data.error || "Failed to initiate Antigravity login",
    });
  } catch (error) {
    console.error("[CLI2API-Auth] startLogin error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Internal error starting Antigravity login",
    });
  }
}

/**
 * Handles the OAuth callback from the provider.
 * Receives code/state and forwards it to the local CLI2API process.
 *
 * GET /api/cli2api-auth/callback
 */
async function handleCallback(req, res) {
  try {
    const { code, state, scope, authuser, prompt } = req.query;

    if (!code || !state) {
      return res.status(400).send("Missing code or state parameter.");
    }

    // Forward the callback to the internal CLI2API process
    // The process listens on 127.0.0.1:51121 for these callbacks
    const internalCallbackUrl = new URL(
      "http://127.0.0.1:51121/oauth-callback",
    );
    internalCallbackUrl.searchParams.set("code", code);
    internalCallbackUrl.searchParams.set("state", state);
    if (scope) internalCallbackUrl.searchParams.set("scope", scope);
    if (authuser) internalCallbackUrl.searchParams.set("authuser", authuser);
    if (prompt) internalCallbackUrl.searchParams.set("prompt", prompt);

    // We make a request to the local process to "complete" the flow
    const response = await fetch(internalCallbackUrl.toString());

    // The CLI2API usually returns a simple HTML page or text
    const text = await response.text();

    // Return a nice success page to the user
    return res.send(`
      <html>
        <head><title>Authentication Successful</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: green;">Authentication Successful!</h1>
          <p>The CLI2API process has received your credentials.</p>
          <p>You can now close this window and return to the application.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("[CLI2API-Auth] handleCallback error:", error.message);
    return res.status(500).send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: red;">Authentication Failed</h1>
          <p>Could not forward credentials to the local process.</p>
          <p>Error: ${error.message}</p>
        </body>
      </html>
    `);
  }
}

/**
 * Polls the OAuth flow status using the state token.
 *
 * GET /api/cli2api-auth/status?state=<state>
 */
async function pollStatus(req, res) {
  try {
    const userId = req.user.id;
    const { state } = req.query;

    if (!state) {
      return res.status(400).json({
        success: false,
        error: "Missing 'state' query parameter",
      });
    }

    const processInfo = processManager.getProcess(userId);
    if (!processInfo) {
      return res.status(404).json({
        success: false,
        error: "No CLI2API process running for this user",
      });
    }

    const response = await fetch(
      `http://127.0.0.1:${processInfo.port}/v0/management/get-auth-status?state=${encodeURIComponent(state)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.CLI2API_MANAGEMENT_KEY || "mgmt-secret-default"}`,
        },
      },
    );

    const data = await response.json();

    return res.json({
      success: true,
      status: data.status,
      error: data.error || null,
    });
  } catch (error) {
    console.error("[CLI2API-Auth] pollStatus error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Internal error polling auth status",
    });
  }
}

/**
 * Lists all Antigravity auth files for the current user's CLI2API instance.
 *
 * GET /api/cli2api-auth/accounts
 */
async function listAccounts(req, res) {
  try {
    const userId = req.user.id;
    const processInfo = processManager.getProcess(userId);

    if (!processInfo) {
      // No process running = no accounts
      return res.json({ success: true, accounts: [] });
    }

    const response = await fetch(
      `http://127.0.0.1:${processInfo.port}/v0/management/auth-files`,
      {
        headers: {
          Authorization: `Bearer ${process.env.CLI2API_MANAGEMENT_KEY || "mgmt-secret-default"}`,
        },
      },
    );

    const data = await response.json();
    const files = data.files || [];

    // Filter to only Antigravity-related credentials
    const antigravityAccounts = files.map((f) => ({
      name: f.name,
      email: f.email || f.name,
      provider: f.provider || "unknown",
      status: f.status || "unknown",
      statusMessage: f.status_message || "",
      disabled: f.disabled || false,
      lastRefresh: f.last_refresh || null,
    }));

    return res.json({ success: true, accounts: antigravityAccounts });
  } catch (error) {
    console.error("[CLI2API-Auth] listAccounts error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Internal error listing accounts",
    });
  }
}

/**
 * Deletes an Antigravity auth file (logout).
 *
 * DELETE /api/cli2api-auth/logout?name=<filename>
 */
async function logout(req, res) {
  try {
    const userId = req.user.id;
    const { name } = req.query;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Missing 'name' query parameter",
      });
    }

    const processInfo = processManager.getProcess(userId);
    if (!processInfo) {
      return res.status(404).json({
        success: false,
        error: "No CLI2API process running for this user",
      });
    }

    const response = await fetch(
      `http://127.0.0.1:${processInfo.port}/v0/management/auth-files?name=${encodeURIComponent(name)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${process.env.CLI2API_MANAGEMENT_KEY || "mgmt-secret-default"}`,
        },
      },
    );

    const data = await response.json();

    if (data.status === "ok") {
      return res.json({ success: true });
    }

    return res.status(502).json({
      success: false,
      error: data.error || "Failed to delete auth file",
    });
  } catch (error) {
    console.error("[CLI2API-Auth] logout error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Internal error during logout",
    });
  }
}

/**
 * Returns the status of all active CLI2API processes (debug endpoint).
 *
 * GET /api/cli2api-auth/debug/processes
 */
async function debugProcesses(req, res) {
  try {
    const status = processManager.getStatus();
    return res.json({ success: true, processes: status });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

module.exports = {
  startLogin,
  handleCallback,
  pollStatus,
  listAccounts,
  logout,
  debugProcesses,
};

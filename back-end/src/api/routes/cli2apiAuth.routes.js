// src/api/routes/cli2apiAuth.routes.js
// Routes for managing Antigravity OAuth authentication per user.

const { Router } = require("express");
const cli2apiAuthController = require("../controllers/cli2apiAuth.controller");

const router = Router();

// Start Antigravity OAuth login flow
router.post("/login", cli2apiAuthController.startLogin);

// Poll OAuth flow status
router.get("/status", cli2apiAuthController.pollStatus);

// Handle OAuth callback from provider
router.get("/callback", cli2apiAuthController.handleCallback);

// List connected Antigravity accounts
router.get("/accounts", cli2apiAuthController.listAccounts);

// Logout (delete an auth file)
router.delete("/logout", cli2apiAuthController.logout);

// Debug: list all active CLI2API processes
router.get("/debug/processes", cli2apiAuthController.debugProcesses);

module.exports = router;

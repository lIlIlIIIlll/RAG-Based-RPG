// src/api/routes/main.routes.js
const { Router } = require("express");
const chatRoutes = require("./chat.routes");
const authRoutes = require("./auth.routes");
const cli2apiAuthRoutes = require("./cli2apiAuth.routes");
const authMiddleware = require("../middlewares/auth.middleware");

const router = Router();

// Rotas de autenticação (públicas)
router.use("/auth", authRoutes);

// Rotas de chat (protegidas)
router.use("/chat", authMiddleware, chatRoutes);

// Rotas de autenticação CLI2API (protegidas)
router.use("/cli2api-auth", authMiddleware, cli2apiAuthRoutes);

module.exports = router;

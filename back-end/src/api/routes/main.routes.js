// src/api/routes/main.routes.js
const { Router } = require("express");
const chatRoutes = require("./chat.routes");
const authRoutes = require("./auth.routes");
const authMiddleware = require("../middlewares/auth.middleware");

const router = Router();

// Rotas de autenticação (públicas)
router.use("/auth", authRoutes);

// Rotas de chat (protegidas)
router.use("/chat", authMiddleware, chatRoutes);

module.exports = router;

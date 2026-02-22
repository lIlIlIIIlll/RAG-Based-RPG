// src/app.js
const express = require("express");
const cors = require("cors");
const path = require("path");
const mainRouter = require("./api/routes/main.routes"); // Importa o roteador principal
const errorHandler = require("./api/middlewares/errorHandler");

// Cria a instância do Express
const app = express();

// --- Middlewares Essenciais ---

// Habilita CORS para permitir requisições de diferentes origens
app.use(
  cors({
    origin: "*", // Permitir todas as origens (para desenvolvimento/ngrok)
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "ngrok-skip-browser-warning",
    ],
  }),
);

// Habilita o parsing de JSON no corpo das requisições
// Habilita o parsing de JSON no corpo das requisições com limite aumentado
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

// Middleware simples para logar requisições no console
app.use((req, res, next) => {
  console.log(`[Request] ${req.method} ${req.originalUrl}`);
  next();
});

// --- Rotas da API ---

// Monta o roteador principal sob o prefixo /api
// Agora todas as rotas definidas em 'src/api/routes' estarão disponíveis em /api/...
// Ex: /api/chat/create, /api/chat/search/...
app.use("/api", mainRouter);

// Servir arquivos estáticos da pasta uploads
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// --- Tratamento de Erros ---

// Middleware para rotas não encontradas (404)
// Se nenhuma rota anterior corresponder, esta será acionada
app.use((req, res, next) => {
  res.status(404).json({ error: "Endpoint não encontrado." });
});

// Middleware de tratamento de erros. Deve ser o ÚLTIMO middleware a ser adicionado.
app.use(errorHandler);

module.exports = app;

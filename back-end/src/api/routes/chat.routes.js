// src/api/routes/chat.routes.js
const { Router } = require("express");
const chatController = require("../controllers/chat.controller");
const multer = require("multer");

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// --- Rotas de Gerenciamento de Chat ---

// Listar todos os chats
// GET /api/chat/list
router.get("/list", chatController.getAllChats);

// Criar novo chat
// POST /api/chat/create
router.post("/create", chatController.createChat);

// Importar chat de arquivo JSON
// POST /api/chat/import
router.post("/import", chatController.importChat);

// Obter histórico completo de mensagens
// GET /api/chat/:chatToken/history
router.get("/:chatToken/history", chatController.getChatHistory);

// Obter detalhes/metadados de um chat específico
// GET /api/chat/:chatToken
router.get("/:chatToken", chatController.getChatDetails);

// Deletar chat
// DELETE /api/chat/:chatToken
router.delete("/:chatToken", chatController.deleteChat);

// Atualizar configuração do chat
// PUT /api/chat/:chatToken/config
router.put("/:chatToken/config", chatController.updateChatConfig);

// Renomear chat
// PUT /api/chat/:chatToken/rename
router.put("/:chatToken/rename", chatController.renameChat);

// --- Gerenciamento de Mensagens/Memória ---

// Gerar resposta da IA
// POST /api/chat/generate/:chatToken
router.post("/generate/:chatToken", upload.array("files"), chatController.generateChatResponse);

// Inserir mensagem manual
// POST /api/chat/insert/:chatToken/:collectionName
router.post("/insert/:chatToken/:collectionName", chatController.addMessage);

// Editar mensagem
// PUT /api/chat/edit/:chatToken/:messageid
router.put("/edit/:chatToken/:messageid", chatController.editMessage);

// Deletar mensagem específica
// DELETE /api/chat/message/:chatToken/:messageid
router.delete("/message/:chatToken/:messageid", chatController.deleteMessage);

// Buscar mensagens
// POST /api/chat/search/:chatToken/:collectionName
router.post(
  "/search/:chatToken/:collectionName",
  chatController.searchMessages
);

module.exports = router;
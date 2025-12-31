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

// Busca global em todos os chats do usuário (RAG)
// POST /api/chat/search-global
router.post("/search-global", chatController.searchGlobal);

// Obter histórico completo de mensagens
// GET /api/chat/:chatToken/history
router.get("/:chatToken/history", chatController.getChatHistory);

// Editar mensagem
// PUT /api/chat/edit/:chatToken/:messageid
router.put("/edit/:chatToken/:messageid", chatController.editMessage);

// Deletar mensagem específica
// DELETE /api/chat/message/:chatToken/:messageid
router.delete("/message/:chatToken/:messageid", chatController.deleteMessage);

// Deletar múltiplas memórias (confirmado pelo usuário)
// POST /api/chat/:chatToken/memories/delete
router.post("/:chatToken/memories/delete", chatController.deleteMemories);

// Obter estatísticas de memórias
// GET /api/chat/:chatToken/memories/stats
router.get("/:chatToken/memories/stats", chatController.getMemoryStats);

// Exportar memórias
// GET /api/chat/:chatToken/memories/export?collections=fatos,conceitos
router.get("/:chatToken/memories/export", chatController.exportMemories);

// Importar memórias (SSE para progresso)
// POST /api/chat/:chatToken/memories/import
router.post("/:chatToken/memories/import", chatController.importMemories);

// Buscar mensagens
// POST /api/chat/search/:chatToken/:collectionName
router.post(
  "/search/:chatToken/:collectionName",
  chatController.searchMessages
);

// Inserir mensagem/memória
// POST /api/chat/insert/:chatToken/:collectionName
router.post(
  "/insert/:chatToken/:collectionName",
  chatController.addMessage
);

// Branch Chat
// POST /api/chat/:chatToken/message/:messageId/branch
router.post("/:chatToken/message/:messageId/branch", chatController.branchChat);

// Gerar resposta do chat (RAG + Gemini)
// POST /api/chat/generate/:chatToken
router.post(
  "/generate/:chatToken",
  upload.array("files"),
  chatController.generateChatResponse
);

// --- Rotas de Chat (Detalhes/Config/Histórico) ---

// Obter detalhes do chat (config)
// GET /api/chat/:chatToken
router.get("/:chatToken", chatController.getChatDetails);

// Atualizar configuração do chat
// PUT /api/chat/:chatToken/config
router.put("/:chatToken/config", chatController.updateChatConfig);

// Renomear chat
// PUT /api/chat/:chatToken/rename
router.put("/:chatToken/rename", chatController.renameChat);

// Deletar chat
// DELETE /api/chat/:chatToken
router.delete("/:chatToken", chatController.deleteChat);

// --- Rotas de Vetorização de PDFs ---

// Vetorizar PDF (SSE para progresso)
// POST /api/chat/:chatToken/vectorize-pdf
router.post("/:chatToken/vectorize-pdf", chatController.vectorizePDF);

// Listar documentos vetorizados em uma collection
// GET /api/chat/:chatToken/documents/:collection
router.get("/:chatToken/documents/:collection", chatController.listVectorizedDocuments);

// Deletar documento vetorizado (todos os chunks)
// DELETE /api/chat/:chatToken/documents/:collection/:documentId
router.delete("/:chatToken/documents/:collection/:documentId", chatController.deleteVectorizedDocument);

// Verificar embeddings zerados (conta quantos precisam de reparo)
// GET /api/chat/:chatToken/check-embeddings
router.get("/:chatToken/check-embeddings", chatController.checkEmbeddings);

// Reparar embeddings zerados (regenera vetores que falharam na criação)
// POST /api/chat/:chatToken/repair-embeddings
router.post("/:chatToken/repair-embeddings", chatController.repairEmbeddings);

module.exports = router;
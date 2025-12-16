// src/api/controllers/chat.controller.js
const chatService = require("../../services/chat.service");

// --- Gerenciamento de Chat (CRUD) ---

// [GET] /api/chat/list
async function getAllChats(req, res, next) {
  try {
    const userId = req.user ? req.user.id : null;
    const chats = await chatService.getAllChats(userId);
    res.status(200).json(chats);
  } catch (error) {
    next(error);
  }
}

// [GET] /api/chat/:chatToken
async function getChatDetails(req, res, next) {
  try {
    const { chatToken } = req.params;
    const details = await chatService.getChatDetails(chatToken);
    if (!details) {
      return res.status(404).json({ error: "Chat não encontrado." });
    }
    res.status(200).json(details);
  } catch (error) {
    next(error);
  }
}

// [PUT] /api/chat/:chatToken/rename
async function renameChat(req, res, next) {
  try {
    const { chatToken } = req.params;
    const { newTitle } = req.body;

    if (!newTitle) {
      return res.status(400).json({ error: "O campo 'newTitle' é obrigatório." });
    }

    const updatedMetadata = await chatService.renameChat(chatToken, newTitle);
    res.status(200).json({ message: "Chat renomeado com sucesso.", data: updatedMetadata });
  } catch (error) {
    next(error);
  }
}

// [POST] /api/chat/:chatToken/message/:messageId/branch
async function branchChat(req, res, next) {
  try {
    const { chatToken, messageId } = req.params;
    const userId = req.user ? req.user.id : null;

    const newChatToken = await chatService.branchChat(chatToken, messageId, userId);
    res.status(201).json({ message: "Chat bifurcado com sucesso!", chatToken: newChatToken });
  } catch (error) {
    next(error);
  }
}

// --- Gerenciamento de Mensagens/Memória ---

// [POST] /api/chat/generate/:chatToken
async function generateChatResponse(req, res, next) {
  try {
    const { chatToken } = req.params;
    let { message, previousVectorMemory } = req.body;
    const files = req.files || [];

    if (typeof previousVectorMemory === 'string') {
      try {
        previousVectorMemory = JSON.parse(previousVectorMemory);
      } catch (e) {
        previousVectorMemory = [];
      }
    }

    if (!message && files.length === 0) {
      return res.status(400).json({ error: "O campo 'message' ou um arquivo é obrigatório." });
    }

    const generationResult = await chatService.handleChatGeneration(
      chatToken,
      message || "",
      previousVectorMemory,
      files
    );

    // Se houver pendências de deleção, o frontend receberá no generationResult
    res.status(200).json(generationResult);
  } catch (error) {
    next(error);
  }
}

// [POST] /api/chat/:chatToken/memories/delete
async function deleteMemories(req, res, next) {
  try {
    const { chatToken } = req.params;
    const { messageids } = req.body;

    if (!messageids || !Array.isArray(messageids)) {
      return res.status(400).json({ error: "O campo 'messageids' deve ser um array de strings." });
    }

    const results = [];
    for (const id of messageids) {
      const wasDeleted = await chatService.deleteMessage(chatToken, id);
      results.push({ id, deleted: wasDeleted });
    }

    res.status(200).json({ message: "Memórias deletadas com sucesso.", results });
  } catch (error) {
    next(error);
  }
}

// [POST] /api/chat/insert/:chatToken/:collectionName
async function addMessage(req, res, next) {
  try {
    const { chatToken, collectionName } = req.params;
    const { text, role } = req.body;

    if (!text) {
      return res.status(400).json({ error: "O campo 'text' é obrigatório." });
    }

    const messageid = await chatService.addMessage(
      chatToken,
      collectionName,
      text,
      role || "user"
    );
    res.status(201).json({
      message: `Dados inseridos com sucesso na coleção '${collectionName}'.`,
      messageid,
    });
  } catch (error) {
    next(error);
  }
}

// [PUT] /api/chat/edit/:chatToken/:messageid
async function editMessage(req, res, next) {
  try {
    const { chatToken, messageid } = req.params;
    const { newContent } = req.body;

    if (!newContent) {
      return res.status(400).json({ error: "O campo 'newContent' é obrigatório." });
    }

    const wasUpdated = await chatService.editMessage(
      chatToken,
      messageid,
      newContent
    );

    if (wasUpdated) {
      res.status(200).json({ message: "Mensagem editada com sucesso." });
    } else {
      res.status(404).json({ message: "Mensagem não encontrada para edição." });
    }
  } catch (error) {
    next(error);
  }
}

// [DELETE] /api/chat/message/:chatToken/:messageid
async function deleteMessage(req, res, next) {
  try {
    const { chatToken, messageid } = req.params;

    const wasDeleted = await chatService.deleteMessage(chatToken, messageid);

    if (wasDeleted) {
      res.status(200).json({ message: "Mensagem deletada com sucesso." });
    } else {
      res.status(200).json({ message: "Operação de delete concluída (nada encontrado ou já deletado)." });
    }
  } catch (error) {
    next(error);
  }
}

// [POST] /api/chat/search/:chatToken/:collectionName
async function searchMessages(req, res, next) {
  try {
    const { chatToken, collectionName } = req.params;
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "O campo 'text' é obrigatório." });
    }

    // Busca a API Key dos metadados do chat
    const chatMetadata = await chatService.getChatDetails(chatToken);
    const apiKey = chatMetadata?.config?.geminiApiKey;

    console.log(`[Controller] searchMessages - chatToken: ${chatToken}, hasMetadata: ${!!chatMetadata}, hasConfig: ${!!chatMetadata?.config}, hasApiKey: ${!!apiKey}`);

    const results = await chatService.searchMessages(
      chatToken,
      collectionName,
      text,
      5, // limit padrão
      apiKey
    );
    res.status(200).json(results);
  } catch (error) {
    next(error);
  }
}

// [POST] /api/chat/create
async function createChat(req, res, next) {
  try {
    const userId = req.user ? req.user.id : null;
    const chatToken = await chatService.createChat(userId);
    res.status(201).json({ chatToken });
  } catch (error) {
    next(error);
  }
}

// [GET] /api/chat/:chatToken/history
async function getChatHistory(req, res, next) {
  try {
    const { chatToken } = req.params;
    const history = await chatService.getChatHistory(chatToken);
    res.status(200).json(history);
  } catch (error) {
    next(error);
  }
}

// [DELETE] /api/chat/:chatToken
async function deleteChat(req, res, next) {
  try {
    const { chatToken } = req.params;
    const userId = req.user ? req.user.id : null;
    await chatService.deleteChat(chatToken, userId);
    res.status(200).json({ message: "Chat deletado com sucesso." });
  } catch (error) {
    next(error);
  }
}

// [PUT] /api/chat/:chatToken/config
async function updateChatConfig(req, res, next) {
  try {
    const { chatToken } = req.params;
    const config = req.body;
    const updated = await chatService.updateChatConfig(chatToken, config);
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
}

// [POST] /api/chat/import
async function importChat(req, res, next) {
  try {
    const { messages, apiKey } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "O campo 'messages' é obrigatório e deve ser um array." });
    }

    const userId = req.user ? req.user.id : null;

    // Configura SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const onProgress = (current, total) => {
      res.write(`data: ${JSON.stringify({ type: "progress", current, total })}\n\n`);
    };

    try {
      const chatToken = await chatService.importChat(userId, messages, apiKey, onProgress);
      res.write(`data: ${JSON.stringify({ type: "complete", chatToken })}\n\n`);
    } catch (err) {
      console.error("Erro durante importação:", err);
      res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
    } finally {
      res.end();
    }
  } catch (error) {
    // Se headers já foram enviados (SSE), não pode chamar next(error) padrão
    if (res.headersSent) {
      res.end();
    } else {
      next(error);
    }
  }
}

// --- Import/Export de Memórias ---

// [GET] /api/chat/:chatToken/memories/stats
async function getMemoryStats(req, res, next) {
  try {
    const { chatToken } = req.params;
    const stats = await chatService.getMemoryStats(chatToken);
    res.status(200).json(stats);
  } catch (error) {
    next(error);
  }
}

// [GET] /api/chat/:chatToken/memories/export
async function exportMemories(req, res, next) {
  try {
    const { chatToken } = req.params;
    let { collections } = req.query;

    // Converte string "fatos,conceitos" para array
    if (typeof collections === "string") {
      collections = collections.split(",").map(c => c.trim()).filter(c => c);
    }

    if (!collections || collections.length === 0) {
      collections = ["fatos", "conceitos"]; // Default
    }

    const exportData = await chatService.exportMemories(chatToken, collections);

    // Define headers para download
    const filename = `memories_${chatToken.substring(0, 8)}_${Date.now()}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    res.status(200).json(exportData);
  } catch (error) {
    next(error);
  }
}

// [POST] /api/chat/:chatToken/memories/import
async function importMemories(req, res, next) {
  try {
    const { chatToken } = req.params;
    const { data, collections } = req.body;

    if (!data) {
      return res.status(400).json({ error: "O campo 'data' é obrigatório." });
    }

    if (!collections || !Array.isArray(collections) || collections.length === 0) {
      return res.status(400).json({ error: "O campo 'collections' é obrigatório e deve ser um array." });
    }

    // Configura SSE para progresso
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const onProgress = (current, total) => {
      res.write(`data: ${JSON.stringify({ type: "progress", current, total })}\n\n`);
    };

    try {
      const stats = await chatService.importMemories(chatToken, data, collections, onProgress);
      res.write(`data: ${JSON.stringify({ type: "complete", stats })}\n\n`);
    } catch (err) {
      console.error("Erro durante importação de memórias:", err);
      res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
    } finally {
      res.end();
    }
  } catch (error) {
    if (res.headersSent) {
      res.end();
    } else {
      next(error);
    }
  }
}

// [POST] /api/chat/search-global
async function searchGlobal(req, res, next) {
  try {
    const userId = req.user?.id;
    const { query, apiKey } = req.body;

    if (!query) {
      return res.status(400).json({ error: "O campo 'query' é obrigatório." });
    }
    if (!apiKey) {
      return res.status(400).json({ error: "API Key é necessária para busca semântica." });
    }

    const results = await chatService.searchAllUserChats(userId, query, apiKey);
    res.status(200).json(results);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllChats,
  getChatDetails,
  getChatHistory,
  createChat,
  deleteChat,
  updateChatConfig,
  renameChat,
  generateChatResponse,
  addMessage,
  editMessage,
  deleteMessage,
  searchMessages,
  importChat,
  deleteMemories,
  branchChat,
  getMemoryStats,
  exportMemories,
  importMemories,
  searchGlobal
};
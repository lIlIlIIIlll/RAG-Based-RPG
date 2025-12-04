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

    const results = await chatService.searchMessages(
      chatToken,
      collectionName,
      text
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

    const results = await chatService.searchMessages(
      chatToken,
      collectionName,
      text
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
  branchChat
};
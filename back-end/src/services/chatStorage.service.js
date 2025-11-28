// src/services/chatStorage.service.js
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const config = require("../config");

// Define o caminho onde os metadados (JSONs) serão salvos.
// Se config.metadataPath não existir ainda, usamos um padrão 'data/metadata'
const METADATA_DIR = path.join(process.cwd(), config.metadataPath || "data/metadata");

// Garante que o diretório exista na inicialização
if (!fsSync.existsSync(METADATA_DIR)) {
  fsSync.mkdirSync(METADATA_DIR, { recursive: true });
  console.log(`[SISTEMA] | [STORAGE] -> Diretório de metadados criado em: ${METADATA_DIR}`);
}

/**
 * Salva ou sobrescreve os metadados de um chat.
 * @param {string} chatToken - O ID único do chat.
 * @param {object} data - Objeto contendo { title, createdAt, modelConfig, etc }.
 * @param {string} userId - ID do usuário dono do chat (opcional para retrocompatibilidade).
 */
async function saveChatMetadata(chatToken, data, userId = null) {
  const filePath = path.join(METADATA_DIR, `${chatToken}.json`);
  try {
    if (userId) {
      data.userId = userId;
    }
    const content = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, content, "utf-8");
    console.log(`[${new Date().toLocaleTimeString()}] | [STORAGE] -> Metadados salvos para o chat: ${chatToken} (User: ${userId})`);
  } catch (error) {
    console.error(`[${new Date().toLocaleTimeString()}] | [STORAGE] -> ERRO ao salvar metadados:`, error);
    throw error;
  }
}

/**
 * Recupera os metadados de um chat específico.
 * @param {string} chatToken 
 * @returns {Promise<object|null>}
 */
async function getChatMetadata(chatToken) {
  const filePath = path.join(METADATA_DIR, `${chatToken}.json`);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(`[${new Date().toLocaleTimeString()}] | [STORAGE] -> Chat não encontrado: ${chatToken}`);
      return null;
    }
    console.error(`[${new Date().toLocaleTimeString()}] | [STORAGE] -> ERRO ao ler chat:`, error);
    throw error;
  }
}

/**
 * Retorna uma lista com o resumo de todos os chats existentes.
 * @param {string} userId - ID do usuário para filtrar os chats.
 * @returns {Promise<Array>}
 */
async function getAllChats(userId) {
  try {
    const files = await fs.readdir(METADATA_DIR);
    const jsonFiles = files.filter(file => file.endsWith(".json"));

    const chats = [];
    for (const file of jsonFiles) {
      const content = await fs.readFile(path.join(METADATA_DIR, file), "utf-8");
      try {
        const data = JSON.parse(content);
        // Filter by userId if provided
        if (userId) {
          if (data.userId === userId) {
            chats.push(data);
          }
        } else {
          // If no userId provided (e.g. admin or legacy), maybe return all? 
          // For now, let's return all if no userId is passed, or maybe empty?
          // Let's assume strict mode: if userId is passed, filter. If not, return all (legacy behavior).
          chats.push(data);
        }
      } catch (parseError) {
        console.error(`[STORAGE] Erro ao parsear arquivo ${file}:`, parseError);
      }
    }

    // Ordena do mais recente para o mais antigo
    return chats.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (error) {
    console.error(`[${new Date().toLocaleTimeString()}] | [STORAGE] -> ERRO ao listar chats:`, error);
    return [];
  }
}

/**
 * Atualiza apenas as configurações de um chat existente.
 * @param {string} chatToken 
 * @param {object} newConfig - { temperature, modelName, systemInstruction, etc }
 */
async function updateChatConfig(chatToken, newConfig) {
  const currentData = await getChatMetadata(chatToken);
  if (!currentData) {
    throw new Error("Chat não encontrado para atualização.");
  }

  // Mescla a config antiga com a nova
  currentData.config = {
    ...currentData.config,
    ...newConfig
  };

  // Atualiza timestamp de modificação se desejar (opcional)
  currentData.updatedAt = new Date().toISOString();

  await saveChatMetadata(chatToken, currentData, currentData.userId);
  console.log(`[${new Date().toLocaleTimeString()}] | [STORAGE] -> Configurações atualizadas para: ${chatToken}`);
  return currentData;
}

/**
 * Deleta o arquivo de metadados de um chat.
 * @param {string} chatToken 
 */
async function deleteChatMetadata(chatToken) {
  const filePath = path.join(METADATA_DIR, `${chatToken}.json`);
  try {
    await fs.unlink(filePath);
    console.log(`[${new Date().toLocaleTimeString()}] | [STORAGE] -> Arquivo de metadados deletado: ${chatToken}`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`[${new Date().toLocaleTimeString()}] | [STORAGE] -> ERRO ao deletar arquivo:`, error);
      throw error;
    }
  }
}

/**
 * Atualiza o título de um chat.
 * @param {string} chatToken 
 * @param {string} newTitle 
 */
async function updateChatTitle(chatToken, newTitle) {
  const currentData = await getChatMetadata(chatToken);
  if (!currentData) {
    throw new Error("Chat não encontrado para renomear.");
  }

  currentData.title = newTitle;
  currentData.updatedAt = new Date().toISOString();

  await saveChatMetadata(chatToken, currentData, currentData.userId);
  console.log(`[${new Date().toLocaleTimeString()}] | [STORAGE] -> Título atualizado para: ${chatToken}`);
  return currentData;
}

module.exports = {
  saveChatMetadata,
  getChatMetadata,
  getAllChats,
  updateChatConfig,
  updateChatTitle,
  deleteChatMetadata
};
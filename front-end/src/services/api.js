// src/services/api.js
import axios from "axios";
import log from "./logger";

const API_BASE_URL = "https://n8n-dungeon-master-69-api.r954jc.easypanel.host/api";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Interceptor para adicionar o token em todas as requisições
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// --- Autenticação ---

export const login = async (email, password) => {
  const CONTEXT = "API:LOGIN";
  try {
    const response = await apiClient.post("/auth/login", { email, password });
    return response.data;
  } catch (error) {
    log(CONTEXT, "ERRO: Falha no login.", "error", error);
    throw error;
  }
};

export const register = async (name, email, password) => {
  const CONTEXT = "API:REGISTER";
  try {
    const response = await apiClient.post("/auth/register", { name, email, password });
    return response.data;
  } catch (error) {
    log(CONTEXT, "ERRO: Falha no registro.", "error", error);
    throw error;
  }
};

// --- Gerenciamento de Chats ---

/**
 * Cria um novo chat no back-end.
 * @returns {Promise<string>} O chatToken do novo chat.
 */
export const createChat = async () => {
  const CONTEXT = "API:CREATE_CHAT";
  try {
    log(CONTEXT, "Iniciando requisição para criar novo chat...");
    const response = await apiClient.post("/chat/create");
    const { chatToken } = response.data;
    log(CONTEXT, `SUCESSO: Chat criado com token: ${chatToken}`);
    return chatToken;
  } catch (error) {
    log(CONTEXT, "ERRO: Falha ao criar novo chat.", "error", error);
    throw error;
  }
};

/**
 * Importa um chat a partir de uma lista de mensagens.
 * @param {Array} messages - Lista de mensagens { role, text }.
 * @param {string} apiKey - Chave da API Gemini.
 * @returns {Promise<string>} O chatToken do novo chat.
 */
export const importChat = async (messages, apiKey) => {
  const CONTEXT = "API:IMPORT_CHAT";
  try {
    log(CONTEXT, "Iniciando importação de chat...");
    const response = await apiClient.post("/chat/import", { messages, apiKey });
    const { chatToken } = response.data;
    log(CONTEXT, `SUCESSO: Chat importado com token: ${chatToken}`);
    return chatToken;
  } catch (error) {
    log(CONTEXT, "ERRO: Falha ao importar chat.", "error", error);
    throw error;
  }
};

/**
 * Retorna a lista de todos os chats.
 */
export const getAllChats = async () => {
  const CONTEXT = "API:LIST_CHATS";
  try {
    const response = await apiClient.get("/chat/list");
    return response.data;
  } catch (error) {
    log(CONTEXT, "ERRO: Falha ao listar chats.", "error", error);
    throw error;
  }
};

/**
 * Deleta um chat permanentemente.
 */
export const deleteChat = async (chatToken) => {
  const CONTEXT = "API:DELETE_CHAT";
  try {
    await apiClient.delete(`/chat/${chatToken}`);
    log(CONTEXT, `SUCESSO: Chat ${chatToken} deletado.`);
  } catch (error) {
    log(CONTEXT, "ERRO: Falha ao deletar chat.", "error", error);
    throw error;
  }
};

/**
 * Busca o histórico completo de mensagens de um chat.
 */
export const getChatHistory = async (chatToken) => {
  const CONTEXT = "API:GET_HISTORY";
  try {
    const response = await apiClient.get(`/chat/${chatToken}/history`);
    return response.data;
  } catch (error) {
    log(CONTEXT, "ERRO: Falha ao buscar histórico.", "error", error);
    throw error;
  }
};

/**
 * Atualiza configurações do chat.
 */
export const updateChatConfig = async (chatToken, config) => {
  const CONTEXT = "API:UPDATE_CONFIG";
  try {
    const response = await apiClient.put(`/chat/${chatToken}/config`, config);
    return response.data;
  } catch (error) {
    log(CONTEXT, "ERRO: Falha ao atualizar config.", "error", error);
    throw error;
  }
};

// --- Mensagens e IA ---

/**
 * Envia uma mensagem para a IA e obtém a resposta.
 */
export const generateChatResponse = async (
  chatToken,
  message,
  previousVectorMemory,
  files = []
) => {
  const CONTEXT = "API:GENERATE";
  try {
    let response;
    if (files.length > 0) {
      const formData = new FormData();
      formData.append("message", message);
      formData.append("previousVectorMemory", JSON.stringify(previousVectorMemory));
      files.forEach((file) => formData.append("files", file));

      response = await apiClient.post(`/chat/generate/${chatToken}`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
    } else {
      response = await apiClient.post(`/chat/generate/${chatToken}`, {
        message,
        previousVectorMemory,
      });
    }
    return response.data;
  } catch (error) {
    log(CONTEXT, "ERRO: Falha ao gerar resposta da IA.", "error", error);
    throw error;
  }
};

/**
 * Insere um novo dado de memória (fato, conceito, etc.) manualmente.
 */
export const addMemory = async (chatToken, collectionName, text) => {
  const CONTEXT = "API:ADD_MEMORY";
  try {
    const response = await apiClient.post(
      `/chat/insert/${chatToken}/${collectionName}`,
      { text }
    );
    return response.data;
  } catch (error) {
    log(CONTEXT, "ERRO: Falha ao inserir dado.", "error", error);
    throw error;
  }
};

/**
 * Edita uma memória existente pelo messageid.
 */
export const editMemory = async (chatToken, messageid, newContent) => {
  const CONTEXT = "API:EDIT_MEMORY";
  try {
    const response = await apiClient.put(
      `/chat/edit/${chatToken}/${messageid}`,
      { newContent }
    );
    return response.data;
  } catch (error) {
    log(CONTEXT, "ERRO: Falha ao editar mensagem.", "error", error);
    throw error;
  }
};

export const deleteMessage = async (chatToken, messageid) => {
  const CONTEXT = "API:DELETE_MESSAGE";
  try {
    await apiClient.delete(`/chat/message/${chatToken}/${messageid}`);
  } catch (error) {
    log(CONTEXT, "ERRO: Falha ao deletar mensagem.", "error", error);
    throw error;
  }
};

export const searchMemory = async (chatToken, collectionName, text) => {
  const CONTEXT = "API:SEARCH_MEMORY";
  try {
    const response = await apiClient.post(
      `/chat/search/${chatToken}/${collectionName}`,
      { text }
    );
    return response.data;
  } catch (error) {
    log(CONTEXT, "ERRO: Falha ao buscar memórias.", "error", error);
    throw error;
  }
};

export const renameChat = async (chatToken, newTitle) => {
  const CONTEXT = "API:RENAME_CHAT";
  try {
    const response = await apiClient.put(`/chat/${chatToken}/rename`, { newTitle });
    return response.data;
  } catch (error) {
    log(CONTEXT, "ERRO: Falha ao renomear chat.", "error", error);
    throw error;
  }
};

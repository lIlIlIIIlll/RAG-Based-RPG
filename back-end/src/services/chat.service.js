// src/services/chat.service.js
const { v4: uuidv4 } = require("uuid");
const lanceDBService = require("./lancedb.service");
const chatStorage = require("./chatStorage.service");
const geminiService = require("./gemini.service");
const config = require("../config");

// Função auxiliar para contar palavras
function wordCounter(text) {
  return text ? text.split(/\s+/).length : 0;
}

/**
 * Cria um novo chat.
 * @param {string} userId - ID do usuário dono do chat.
 * @returns {Promise<string>} - Token do novo chat.
 */
async function createChat(userId) {
  const chatToken = uuidv4();
  console.log(`[Service] Criando novo chat com token: ${chatToken} para user: ${userId}`);

  // 1. Inicializa LanceDB
  await lanceDBService.initializeCollections(chatToken);

  // 2. Cria Metadados Iniciais
  const initialMetadata = {
    id: chatToken,
    title: "Novo Chat",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userId: userId, // Salva o userId nos metadados
    config: {
      modelName: "gemini-2.5-flash",
      temperature: 0.7,
      systemInstruction: config.systemInstructionTemplate,
      apiKey: "", // Inicializa vazio
    },
  };

  await chatStorage.saveChatMetadata(chatToken, initialMetadata, userId);

  return chatToken;
}

/**
 * Lista todos os chats de um usuário.
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function getAllChats(userId) {
  console.log(`[Service] Listando todos os chats para user: ${userId}...`);
  return await chatStorage.getAllChats(userId);
}

/**
 * Obtém detalhes de um chat específico.
 * @param {string} chatToken
 * @returns {Promise<Object>}
 */
async function getChatDetails(chatToken) {
  return await chatStorage.getChatMetadata(chatToken);
}

/**
 * Obtém histórico completo de mensagens de um chat.
 * @param {string} chatToken
 * @returns {Promise<Array>}
 */
async function getChatHistory(chatToken) {
  console.log(`[Service] Recuperando histórico completo para: ${chatToken}`);
  return await lanceDBService.getAllRecordsFromCollection(chatToken, "historico");
}

/**
 * Deleta um chat completamente (LanceDB + Metadados).
 * @param {string} chatToken
 * @param {string} userId
 */
async function deleteChat(chatToken, userId) {
  console.log(`[Service] Deletando chat: ${chatToken}`);

  // 1. Remove tabelas do LanceDB
  await lanceDBService.deleteChatTables(chatToken);

  // 2. Remove arquivo de metadados
  await chatStorage.deleteChatMetadata(chatToken, userId);
}

/**
 * Atualiza configurações do chat.
 * @param {string} chatToken
 * @param {Object} newConfig
 */
async function updateChatConfig(chatToken, newConfig) {
  console.log(`[Service] Atualizando config do chat: ${chatToken}`, newConfig);
  const metadata = await chatStorage.getChatMetadata(chatToken);
  if (!metadata) throw new Error("Chat não encontrado");

  metadata.config = { ...metadata.config, ...newConfig };
  metadata.updatedAt = new Date().toISOString();

  await chatStorage.saveChatMetadata(chatToken, metadata, metadata.userId);
  return metadata;
}

/**
 * Adiciona uma mensagem ao histórico (ou outra coleção).
 * @param {string} chatToken
 * @param {string} collectionName
 * @param {string} text
 * @param {string} role
 * @param {Array} attachments
 * @param {string} apiKey
 */
async function addMessage(chatToken, collectionName, text, role, attachments = [], apiKey) {
  // Gera embedding apenas se tiver API Key
  let vector = null;
  if (apiKey) {
    try {
      // Se houver anexos, o embedding deve considerar o texto + contexto dos anexos?
      // Por enquanto, geramos embedding apenas do texto para simplificar a busca semântica.
      // Futuramente, poderíamos descrever as imagens e embedar a descrição.
      if (text && text.trim().length > 0) {
        vector = await geminiService.generateEmbedding(text, apiKey);
      }
    } catch (error) {
      console.error("[Service] Falha ao gerar embedding para mensagem:", error);
      // Prossegue sem vetor
    }
  }

  const record = {
    text,
    vector,
    messageid: uuidv4(),
    role,
    createdAt: Date.now(),
    attachments: JSON.stringify(attachments) // Salva anexos como string JSON
  };

  await lanceDBService.insertRecord(chatToken, collectionName, record);
  return record.messageid;
}

/**
 * Edita uma mensagem existente.
 * @param {string} chatToken
 * @param {string} messageid
 * @param {string} newText
 */
async function editMessage(chatToken, messageid, newText) {
  // Precisa regenerar embedding se tiver API Key configurada no chat
  const metadata = await chatStorage.getChatMetadata(chatToken);
  const apiKey = metadata.config.apiKey;

  let newVector = null;
  if (apiKey && newText && newText.trim().length > 0) {
    try {
      newVector = await geminiService.generateEmbedding(newText, apiKey);
    } catch (e) {
      console.error("[Service] Erro ao regenerar embedding na edição:", e);
    }
  }

  // Usa o serviço do LanceDB para atualizar
  const wasUpdated = await lanceDBService.updateRecordByMessageId(chatToken, messageid, newText, newVector);

  if (wasUpdated) {
    console.log(`[Service] Mensagem ${messageid} editada com sucesso.`);
  } else {
    console.warn(`[Service] Falha ao editar mensagem ${messageid} (não encontrada?).`);
  }

  return wasUpdated;
}

/**
 * Deleta uma mensagem específica.
 * @param {string} chatToken
 * @param {string} messageid
 */
async function deleteMessage(chatToken, messageid) {
  return await lanceDBService.deleteRecordByMessageId(chatToken, messageid);
}

/**
 * Busca mensagens semanticamente.
 * @param {string} chatToken
 * @param {string} collectionName
 * @param {string} queryText
 * @param {number} limit
 * @param {string} apiKey
 */
async function searchMessages(chatToken, collectionName, queryText, limit = 5, apiKey) {
  if (!apiKey) throw new Error("API Key necessária para busca semântica.");

  const queryVector = await geminiService.generateEmbedding(queryText, apiKey);

  // Usa o serviço do LanceDB para buscar
  const results = await lanceDBService.searchByVector(chatToken, collectionName, queryVector);
  return results.slice(0, limit);
}

/**
 * Lógica principal de geração de resposta (RAG + Chat).
 */
async function handleChatGeneration(chatToken, userMessage, clientVectorMemory, files = []) {
  // 1. Carrega metadados e valida API Key
  const chatMetadata = await chatStorage.getChatMetadata(chatToken);
  if (!chatMetadata) throw new Error("Chat não encontrado.");

  const { apiKey, modelName, temperature, systemInstruction } = chatMetadata.config;
  if (!apiKey) throw new Error("API Key não configurada neste chat.");

  // 2. Salva mensagem do usuário no histórico
  // Processa anexos se houver
  const attachments = files.map(f => ({
    name: f.originalname,
    mimeType: f.mimetype,
    data: f.buffer.toString("base64")
  }));

  await addMessage(chatToken, "historico", userMessage, "user", attachments, apiKey);

  // 3. Recupera Memória (RAG)
  // Busca em 'fatos' e 'conceitos' usando o vetor da mensagem do usuário (se tiver texto)
  let contextText = "";
  let displayMemory = [];
  let uniqueResults = []; // Para uso nas tools

  if (userMessage && userMessage.trim().length > 0) {
    const facts = await searchMessages(chatToken, "fatos", userMessage, 3, apiKey);
    const concepts = await searchMessages(chatToken, "conceitos", userMessage, 3, apiKey);

    // Combina e formata
    const allMemories = [...facts, ...concepts];

    // Remove duplicatas baseadas no ID e filtra score baixo se necessário
    const seenIds = new Set();
    uniqueResults = allMemories.filter(m => {
      if (seenIds.has(m.messageid)) return false;
      seenIds.add(m.messageid);
      return true; // m.score < 1.5? (LanceDB score é distância, menor é melhor? Verificar métrica. Default L2. Menor = mais perto)
    });

    if (uniqueResults.length > 0) {
      contextText = "Memórias Relevantes recuperadas do banco de dados:\n" +
        uniqueResults.map(m => `- ${m.text}`).join("\n");

      displayMemory = uniqueResults.map(m => ({
        messageid: m.messageid,
        text: m.text,
        score: m._distance, // LanceDB retorna _distance
        category: facts.includes(m) ? "fatos" : "conceitos" // Simplificação
      }));
    }
  }

  // 4. Monta Prompt com Histórico Recente
  // Carrega histórico recente para contexto conversacional
  const historyRecords = await lanceDBService.getAllRecordsFromCollection(chatToken, "historico");
  // Ordena por data
  historyRecords.sort((a, b) => a.createdAt - b.createdAt);

  // Pega últimas N mensagens para não estourar contexto (simplificado)
  const recentHistory = historyRecords.slice(-20);

  // Converte para formato do Gemini
  const conversationHistory = recentHistory.map(r => {
    const parts = [{ text: r.text }];
    // Se tiver anexos (imagens), adiciona
    if (r.attachments) {
      try {
        const atts = JSON.parse(r.attachments);
        atts.forEach(a => {
          if (a.mimeType.startsWith("image/")) {
            parts.push({
              inlineData: {
                mimeType: a.mimeType,
                data: a.data
              }
            });
          }
        });
      } catch (e) { console.error("Erro ao parsear anexos:", e); }
    }
    return {
      role: r.role === "user" ? "user" : "model",
      parts: parts
    };
  });

  // Insere contexto RAG no início ou como mensagem de sistema adicional?
  // Vamos inserir como uma mensagem de sistema "injetada" ou user message oculta.
  // Melhor: Adicionar ao systemInstruction ou como primeira mensagem user.
  // Aqui, vamos anexar à última mensagem do usuário ou criar uma mensagem de contexto.
  // Estratégia: System Instruction Dinâmico.

  let finalSystemInstruction = systemInstruction;
  if (contextText) {
    finalSystemInstruction += "\n\n" + contextText;
  }

  // 5. Chama Gemini com Tools
  const tools = [
    {
      function_declarations: [
        {
          name: "insert_fact",
          description: "Salva um fato importante, regra de mundo ou acontecimento na memória de longo prazo (coleção 'fatos'). Use isso para coisas concretas que aconteceram.",
          parameters: {
            type: "OBJECT",
            properties: {
              text: { type: "STRING", description: "O conteúdo do fato a ser memorizado." }
            },
            required: ["text"]
          }
        },
        {
          name: "insert_concept",
          description: "Salva um conceito, explicação abstrata, traço de personalidade ou lore na memória de longo prazo (coleção 'conceitos').",
          parameters: {
            type: "OBJECT",
            properties: {
              text: { type: "STRING", description: "O conteúdo do conceito a ser memorizado." }
            },
            required: ["text"]
          }
        },
        {
          name: "roll_dice",
          description: "Realiza uma rolagem de dados de RPG (ex: 1d20, 2d6+3, 4dF). Retorna o resultado.",
          parameters: {
            type: "OBJECT",
            properties: {
              count: { type: "INTEGER", description: "Número de dados." },
              type: { type: "STRING", description: "Tipo do dado (20, 6, 100, F para Fudge/Fate)." },
              modifier: { type: "INTEGER", description: "Modificador a ser somado ao total (opcional)." }
            },
            required: ["count", "type"]
          }
        },
        {
          name: "generate_image",
          description: "Gera uma imagem baseada em uma descrição (prompt) usando IA. Use quando o usuário pedir para 'desenhar', 'criar imagem', 'mostrar como é', etc.",
          parameters: {
            type: "OBJECT",
            properties: {
              prompt: { type: "STRING", description: "Descrição detalhada da imagem a ser gerada." }
            },
            required: ["prompt"]
          }
        },
        {
          name: "edit_memory",
          description: "Edita o texto de uma memória existente (fato ou conceito) ou mensagem do histórico. Use quando o usuário corrigir uma informação ou quando um fato mudar.",
          parameters: {
            type: "OBJECT",
            properties: {
              messageid: { type: "STRING", description: "O ID da mensagem/memória a ser editada." },
              new_text: { type: "STRING", description: "O novo texto atualizado." }
            },
            required: ["messageid", "new_text"]
          }
        },
        {
          name: "delete_memories",
          description: "Remove memórias (fatos ou conceitos) ou mensagens que não são mais verdadeiras ou relevantes. Use APENAS quando tiver certeza que a informação deve ser esquecida.",
          parameters: {
            type: "OBJECT",
            properties: {
              messageids: {
                type: "ARRAY",
                items: { type: "STRING" },
                description: "Lista de IDs das mensagens/memórias a serem deletadas."
              }
            },
            required: ["messageids"]
          }
        }
      ]
    }
  ];

  // Inicia Chat Session via wrapper do serviço
  const generationOptions = {
    modelName,
    temperature,
    tools,
    apiKey
  };

  let loopCount = 0;
  let finalModelResponseText = "";
  let generatedMessages = [];
  let pendingDeletionsForResponse = null;

  // Primeira chamada
  let currentResponse = await geminiService.generateChatResponse(conversationHistory, finalSystemInstruction, generationOptions);

  while (loopCount < 5) {
    const { text, functionCalls, parts } = currentResponse;

    if (!functionCalls || functionCalls.length === 0) {
      // Texto final
      finalModelResponseText = text;
      break;
    }

    // Executa Tools
    const functionResponseParts = [];
    for (const call of functionCalls) {
      const name = call.name;
      const args = call.args;
      let toolResult = {};

      console.log(`[Service] Executing tool: ${name} with args:`, args);

      try {
        if (name === "insert_fact") {
          const msgId = await addMessage(chatToken, "fatos", args.text, "model", [], apiKey);
          toolResult = { status: "success", message: "Fato inserido com sucesso." };

          // Adiciona à memória de exibição para atualização imediata na UI
          displayMemory.push({
            messageid: msgId,
            text: args.text,
            score: 0, // Score 0 para indicar que é novo/relevante
            category: "fatos"
          });

        } else if (name === "insert_concept") {
          const msgId = await addMessage(chatToken, "conceitos", args.text, "model", [], apiKey);
          toolResult = { status: "success", message: "Conceito inserido com sucesso." };

          // Adiciona à memória de exibição para atualização imediata na UI
          displayMemory.push({
            messageid: msgId,
            text: args.text,
            score: 0,
            category: "conceitos"
          });

        } else if (name === "roll_dice") {
          const count = args.count;
          const type = args.type;
          const modifier = args.modifier || 0;

          let total = 0;
          let rolls = [];

          for (let i = 0; i < count; i++) {
            let val;
            let display;
            if (type.toUpperCase() === 'F') {
              val = Math.floor(Math.random() * 3) - 1;
              display = val === -1 ? '-' : val === 1 ? '+' : ' ';
            } else {
              const sides = parseInt(type, 10);
              val = Math.floor(Math.random() * sides) + 1;
              display = val;
            }
            total += val;
            rolls.push(display);
          }

          const finalTotal = total + modifier;
          const rollString = rolls.join(', ');
          const modString = modifier ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : '';
          const resultText = `${count}d${type}${modString} = ${finalTotal} { ${rollString} }`;

          const rollMsgId = await addMessage(chatToken, "historico", resultText, "model", [], apiKey);

          generatedMessages.push({
            text: resultText,
            role: "model",
            messageid: rollMsgId,
            createdAt: Date.now()
          });

          toolResult = { result: resultText };
        } else if (name === "generate_image") {
          const base64Image = await geminiService.generateImage(args.prompt, apiKey);
          const attachments = [{
            mimeType: "image/png",
            data: base64Image
          }];

          const imgMsgId = await addMessage(chatToken, "historico", `Imagem gerada: ${args.prompt}`, "model", attachments, apiKey);

          generatedMessages.push({
            text: `Imagem gerada: ${args.prompt}`,
            role: "model",
            messageid: imgMsgId,
            createdAt: Date.now(),
            attachments: JSON.stringify(attachments)
          });

          toolResult = { status: "success", message: "Imagem gerada e enviada ao usuário." };
        } else if (name === "edit_memory") {
          const wasUpdated = await editMessage(chatToken, args.messageid, args.new_text);
          if (wasUpdated) {
            toolResult = { status: "success", message: "Memória atualizada com sucesso." };
          } else {
            toolResult = { status: "error", message: "Memória não encontrada ou erro ao atualizar." };
          }
        } else if (name === "delete_memories") {
          const ids = args.messageids || [];
          const memoriesToDelete = [];

          for (const id of ids) {
            let memory = uniqueResults.find(m => m.messageid === id);
            if (memory) {
              memoriesToDelete.push({ messageid: id, text: memory.text, category: memory.category });
            } else {
              memoriesToDelete.push({ messageid: id, text: "(Memória não encontrada no contexto recente)", category: "?" });
            }
          }

          toolResult = {
            status: "pending_confirmation",
            message: "Aguardando confirmação do usuário para deletar memórias.",
            pendingDeletions: memoriesToDelete
          };
          pendingDeletionsForResponse = memoriesToDelete;
        } else {
          toolResult = { error: "Function not found" };
        }
      } catch (err) {
        console.error(`[Service] Error executing tool ${name}:`, err);
        toolResult = { error: err.message };
      }

      functionResponseParts.push({
        functionResponse: {
          name: name,
          response: toolResult
        }
      });
    }

    // Adiciona a chamada da função (model turn)
    conversationHistory.push({
      role: "model",
      parts: parts // Parts originais da resposta do modelo
    });

    // Adiciona a resposta da função (function response)
    conversationHistory.push({
      role: "function",
      parts: functionResponseParts
    });

    // Chama o modelo novamente com o histórico atualizado
    currentResponse = await geminiService.generateChatResponse(conversationHistory, finalSystemInstruction, generationOptions);

    loopCount++;
  }

  // Salva resposta final
  const modelResponse = finalModelResponseText || "Desculpe, não consegui processar sua solicitação.";
  const modelMessageId = await addMessage(chatToken, "historico", modelResponse, "model", [], apiKey);

  generatedMessages.push({
    text: modelResponse,
    role: "model",
    messageid: modelMessageId,
    createdAt: Date.now()
  });

  // Atualiza metadados
  if (chatMetadata) {
    chatMetadata.updatedAt = new Date().toISOString();
    if (chatMetadata.title === "Novo Chat" && userMessage.length > 2) {
      chatMetadata.title = userMessage.substring(0, 30) + "...";
    }
    await chatStorage.saveChatMetadata(chatToken, chatMetadata, chatMetadata.userId);
  }

  // Recarrega histórico do banco para garantir ordem e consistência
  const finalHistory = await lanceDBService.getAllRecordsFromCollection(chatToken, "historico");
  finalHistory.sort((a, b) => a.createdAt - b.createdAt);

  return {
    modelResponse,
    history: finalHistory,
    wordCount: wordCounter(modelResponse),
    newVectorMemory: displayMemory,
    pendingDeletions: pendingDeletionsForResponse
  };
}

/**
 * Renomeia um chat.
 * @param {string} chatToken 
 * @param {string} newTitle 
 */
async function renameChat(chatToken, newTitle) {
  console.log(`[Service] Renomeando chat ${chatToken} para "${newTitle}"...`);
  return await chatStorage.updateChatTitle(chatToken, newTitle);
}

/**
 * Importa um chat a partir de uma lista de mensagens.
 * @param {string} userId
 * @param {Array} messages
 * @param {string} apiKey
 */
async function importChat(userId, messages, apiKey) {
  console.log(`[Service] Importando chat para user: ${userId} com ${messages.length} mensagens.`);

  // 1. Cria novo chat
  const chatToken = await createChat(userId);

  // 2. Atualiza API Key se fornecida
  if (apiKey) {
    await updateChatConfig(chatToken, { apiKey });
  }

  // 3. Insere mensagens no histórico
  for (const msg of messages) {
    // Tenta processar anexos se existirem
    let attachments = [];
    if (msg.attachments) {
      try {
        attachments = typeof msg.attachments === 'string' ? JSON.parse(msg.attachments) : msg.attachments;
      } catch (e) {
        console.warn("[Service] Erro ao processar anexos na importação:", e);
      }
    }

    // Adiciona mensagem (gera embedding se tiver API Key)
    await addMessage(chatToken, "historico", msg.text, msg.role, attachments, apiKey);
  }

  return chatToken;
}

/**
 * Cria uma branch (bifurcação) de um chat existente a partir de uma mensagem específica.
 * @param {string} originalChatToken 
 * @param {string} targetMessageId 
 * @param {string} userId 
 */
async function branchChat(originalChatToken, targetMessageId, userId) {
  console.log(`[Service] Criando branch do chat ${originalChatToken} a partir da mensagem ${targetMessageId}`);

  // 1. Recupera metadados do chat original
  const originalMetadata = await chatStorage.getChatMetadata(originalChatToken);
  if (!originalMetadata) {
    throw new Error("Chat original não encontrado.");
  }

  // 2. Recupera histórico completo para encontrar a mensagem alvo e definir o cutoffTime
  const fullHistory = await lanceDBService.getAllRecordsFromCollection(originalChatToken, "historico");
  const targetMessage = fullHistory.find(m => m.messageid === targetMessageId);

  if (!targetMessage) {
    throw new Error("Mensagem alvo não encontrada no histórico.");
  }

  const cutoffTime = targetMessage.createdAt;
  console.log(`[Service] Cutoff time definido: ${cutoffTime} (Msg ID: ${targetMessageId})`);

  // 3. Cria o novo chat
  const newChatToken = await createChat(userId);

  // 4. Copia e salva as configurações do chat original
  const newMetadata = await chatStorage.getChatMetadata(newChatToken);
  newMetadata.title = `${originalMetadata.title} (Branch)`;
  newMetadata.config = { ...originalMetadata.config }; // Copia profunda simples das configs
  await chatStorage.saveChatMetadata(newChatToken, newMetadata, userId);

  // 5. Filtra e copia dados das coleções (historico, fatos, conceitos)
  // Apenas registros criados ANTES ou NO MESMO MOMENTO da mensagem alvo.
  for (const collectionName of config.collectionNames) {
    const originalRecords = await lanceDBService.getAllRecordsFromCollection(originalChatToken, collectionName);

    const filteredRecords = originalRecords.filter(record => {
      // Se tiver createdAt, usa. Se não, assume que deve manter (ou descartar? melhor manter por segurança se for antigo)
      // Mas nosso sistema sempre põe createdAt.
      return record.createdAt <= cutoffTime;
    });

    console.log(`[Service] Copiando ${filteredRecords.length} registros da coleção '${collectionName}' para o novo chat.`);

    for (const record of filteredRecords) {
      // Sanitiza o registro antes de inserir
      const cleanRecord = {
        text: record.text,
        role: record.role,
        messageid: record.messageid,
        createdAt: record.createdAt,
        // Garante que o vetor seja um array simples de números, se existir
        vector: record.vector ? Array.from(record.vector) : null,
        attachments: record.attachments // Mantém anexos
      };

      await lanceDBService.insertRecord(newChatToken, collectionName, cleanRecord);
    }
  }

  return newChatToken;
}

module.exports = {
  createChat,
  getAllChats,
  getChatDetails,
  getChatHistory,
  deleteChat,
  updateChatConfig,
  renameChat,
  addMessage,
  editMessage,
  deleteMessage,
  searchMessages,
  handleChatGeneration,
  importChat,
  branchChat
};
// src/services/chat.service.js
const { v4: uuidv4 } = require("uuid");
const lanceDBService = require("./lancedb.service");
const chatStorage = require("./chatStorage.service");
const geminiService = require("./gemini.service");
const openrouterService = require("./openrouter.service");
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
      modelName: "google/gemini-2.5-pro-preview",
      temperature: 1.0,
      systemInstruction: config.systemInstructionTemplate,
      geminiApiKey: "", // API Key do Gemini (usado APENAS para embeddings)
      openrouterApiKey: "", // API Key do OpenRouter (usado para LLM)
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
 * Adiciona uma mensagem ao histórico (ou outra coleção).
 * @param {string} chatToken
 * @param {string} collectionName
 * @param {string} text
 * @param {string} role
 * @param {Array} attachments
 * @param {string} apiKey
 * @param {string} thoughtSignature
 */
async function addMessage(chatToken, collectionName, text, role, attachments = [], apiKey, thoughtSignature = null) {
  // Gera embedding apenas se tiver API Key
  // Inicializa com vetor zerado para garantir que não seja null (LanceDB exige non-nullable)
  let vector = new Array(config.embeddingDimension).fill(0);
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
      // Mantém o vetor zerado em caso de erro
    }
  }

  const record = {
    text,
    vector,
    messageid: uuidv4(),
    role,
    createdAt: Date.now(),
    attachments: JSON.stringify(attachments), // Salva anexos como string JSON
    thoughtSignature: thoughtSignature
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
  const geminiApiKey = metadata.config.geminiApiKey;

  let newVector = null;
  if (geminiApiKey && newText && newText.trim().length > 0) {
    try {
      newVector = await geminiService.generateEmbedding(newText, geminiApiKey);
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
  const results = await lanceDBService.searchByVector(chatToken, collectionName, queryVector, limit);
  return results.slice(0, limit);
}

/**
 * Lógica principal de geração de resposta (RAG + Chat).
 */
async function handleChatGeneration(chatToken, userMessage, clientVectorMemory, files = []) {
  // 1. Carrega metadados e valida API Keys
  const chatMetadata = await chatStorage.getChatMetadata(chatToken);
  if (!chatMetadata) throw new Error("Chat não encontrado.");

  const { geminiApiKey, openrouterApiKey, modelName, temperature, systemInstruction } = chatMetadata.config;
  if (!geminiApiKey) throw new Error("API Key do Gemini não configurada (necessária para embeddings).");
  if (!openrouterApiKey) throw new Error("API Key do OpenRouter não configurada.");

  // 2. Salva mensagem do usuário no histórico
  // Processa anexos se houver
  const attachments = files.map(f => ({
    name: f.originalname,
    mimeType: f.mimetype,
    data: f.buffer.toString("base64")
  }));

  await addMessage(chatToken, "historico", userMessage, "user", attachments, geminiApiKey);

  // 3. Recupera Histórico Recente (Necessário para gerar a query de busca e para o contexto do chat)
  const historyRecords = await lanceDBService.getAllRecordsFromCollection(chatToken, "historico");
  // Ordena por data
  historyRecords.sort((a, b) => a.createdAt - b.createdAt);

  // Pega últimas N mensagens para não estourar contexto (simplificado)
  let startIndex = Math.max(0, historyRecords.length - 20);
  // Tenta garantir que começa com mensagem do usuário voltando um índice se necessário
  if (startIndex > 0 && historyRecords[startIndex].role === 'model') {
    startIndex = Math.max(0, startIndex - 1);
  }
  const recentHistory = historyRecords.slice(startIndex);

  // 4. Gera Query de Busca Otimizada (RAG)
  // Usa o histórico recente para entender o que o usuário quer dizer
  let searchQuery = userMessage; // Default: usa a mensagem do usuário

  // Constrói contexto de texto para a IA gerar a query
  const historyContextText = recentHistory.map(r => `${r.role}: ${r.text}`).join("\n");

  if (geminiApiKey) {
    try {
      searchQuery = await geminiService.generateSearchQuery(historyContextText, geminiApiKey);
    } catch (e) {
      console.warn("[Service] Falha ao gerar query de busca, usando mensagem original:", e);
    }
  }

  // 5. Recupera Memória (RAG) usando a Query Gerada
  // Busca em TODAS as coleções, mistura, ordena por relevância e limita por palavras (15k)
  let contextText = "";
  let displayMemory = [];
  let uniqueResults = []; // Para uso nas tools

  if (searchQuery && searchQuery.trim().length > 0) {
    console.log(`[Service] Buscando memórias com query: "${searchQuery}"`);

    let allMemories = [];
    // Busca em todas as coleções configuradas
    // Fallback para garantir que collectionNames exista
    const collectionsToSearch = config.collectionNames || ["historico", "fatos", "conceitos"];

    for (const collectionName of collectionsToSearch) {
      try {
        // Busca um número maior de candidatos para filtrar depois (100 por tabela)
        const results = await searchMessages(chatToken, collectionName, searchQuery, 100, geminiApiKey);
        // Adiciona a categoria ao objeto para referência futura
        const resultsWithCategory = results.map(r => ({ ...r, category: collectionName }));
        allMemories = allMemories.concat(resultsWithCategory);
      } catch (err) {
        console.warn(`[Service] Erro ao buscar em ${collectionName}:`, err);
      }
    }

    // Aplica viés (bias) para Fatos e Conceitos
    const BIAS_MULTIPLIER = 0.70; // 10% de desconto na distância
    allMemories.forEach(memory => {
      if (memory.category === 'fatos' || memory.category === 'conceitos') {
        memory._distance = memory._distance * BIAS_MULTIPLIER;
      }
    });

    // Ordena por similaridade (menor distância = mais similar)
    allMemories.sort((a, b) => a._distance - b._distance);

    // Conjunto de IDs já presentes no histórico recente para evitar duplicação
    const recentHistoryIds = new Set(recentHistory.map(r => r.messageid));
    const seenIds = new Set();

    let currentWordCount = 0;
    const WORD_LIMIT = 5000;

    for (const memory of allMemories) {
      // 1. Deduplicação de IDs (caso a mesma memória venha de múltiplas buscas - improvável mas seguro)
      if (seenIds.has(memory.messageid)) continue;

      // 2. Evita duplicar o que já está no histórico recente do chat
      if (recentHistoryIds.has(memory.messageid)) continue;

      // 3. Verifica limite de palavras
      const wordCount = wordCounter(memory.text);
      if (currentWordCount + wordCount > WORD_LIMIT) {
        break; // Atingiu o limite
      }

      seenIds.add(memory.messageid);
      uniqueResults.push(memory);
      currentWordCount += wordCount;
    }

    if (uniqueResults.length > 0) {
      contextText = "Memórias Relevantes recuperadas do banco de dados:\n" +
        uniqueResults.map(m => `- [${m.role ? m.role.toUpperCase() : 'INFO'}] [ID: ${m.messageid}] ${m.text}`).join("\n");

      displayMemory = uniqueResults.map(m => ({
        messageid: m.messageid,
        text: m.text,
        score: m._distance, // LanceDB retorna _distance
        category: m.category
      }));

      console.log(`[Service] Contexto RAG construído com ${uniqueResults.length} memórias (~${currentWordCount} palavras).`);
    }
  }

  // 6. Monta Histórico para o Gemini
  const conversationHistory = recentHistory.map(r => {
    const parts = [{ text: r.text }];

    // Se tiver thoughtSignature, adiciona
    if (r.thoughtSignature) {
      parts[0].thoughtSignature = r.thoughtSignature;
    }
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

  // Safety Check: Gemini exige que a primeira mensagem seja do usuário
  if (conversationHistory.length > 0 && conversationHistory[0].role === 'model') {
    console.warn("[Service] Histórico começa com 'model', inserindo placeholder 'user'.");
    conversationHistory.unshift({
      role: "user",
      parts: [{ text: "..." }] // Placeholder neutro
    });
  }

  // 7. System Instruction Dinâmico
  let finalSystemInstruction = systemInstruction;

  // Verifica se o template tem o placeholder. Se não tiver, faz append como fallback.
  if (contextText) {
    if (finalSystemInstruction.includes("{vector_memory}")) {
      finalSystemInstruction = finalSystemInstruction.replace("{vector_memory}", contextText);
    } else {
      // Fallback para templates antigos que não tenham a tag
      finalSystemInstruction += "\n\n<retrieved_context>\n" + contextText + "\n</retrieved_context>";
    }
  } else {
    // Limpa o placeholder se não houver memória
    finalSystemInstruction = finalSystemInstruction.replace("{vector_memory}", "Nenhuma memória relevante encontrada.");
  }

  // 8. Chama Gemini com Tools
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

  // 8. Chama OpenRouter com Tools
  const generationOptions = {
    modelName,
    temperature,
    tools,
    apiKey: openrouterApiKey
  };

  // Função auxiliar para chamar OpenRouter
  const generateResponse = async (history, systemInst, options) => {
    return await openrouterService.generateChatResponse(history, systemInst, options);
  };

  let loopCount = 0;
  let finalModelResponseText = "";
  let generatedMessages = [];
  let pendingDeletionsForResponse = null;

  // Primeira chamada
  let currentResponse = await generateResponse(conversationHistory, finalSystemInstruction, generationOptions);

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
          const msgId = await addMessage(chatToken, "fatos", args.text, "model", [], geminiApiKey);
          toolResult = { status: "success", message: "Fato inserido com sucesso." };

          // Adiciona à memória de exibição para atualização imediata na UI
          displayMemory.push({
            messageid: msgId,
            text: args.text,
            score: 0, // Score 0 para indicar que é novo/relevante
            category: "fatos"
          });

        } else if (name === "insert_concept") {
          const msgId = await addMessage(chatToken, "conceitos", args.text, "model", [], geminiApiKey);
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

          const rollMsgId = await addMessage(chatToken, "historico", resultText, "model", [], geminiApiKey);

          generatedMessages.push({
            text: resultText,
            role: "model",
            messageid: rollMsgId,
            createdAt: Date.now()
          });

          toolResult = { result: resultText };
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
    currentResponse = await generateResponse(conversationHistory, finalSystemInstruction, generationOptions);

    loopCount++;
  }

  // Helper para verificar se o texto é conteúdo real (não placeholder)
  const isValidContent = (text) => {
    if (!text) return false;
    const trimmed = text.trim();
    // Rejeita respostas vazias ou que são apenas "..." ou pontuação
    if (trimmed.length < 5) return false;
    if (/^[.\s]+$/.test(trimmed)) return false; // Apenas pontos e espaços
    if (trimmed === "...") return false;
    return true;
  };

  // Se o loop terminou por limite mas a última resposta tem texto válido, usa ele
  if (!isValidContent(finalModelResponseText) && currentResponse && isValidContent(currentResponse.text)) {
    finalModelResponseText = currentResponse.text;
  }

  // Se ainda não temos conteúdo válido, tenta mais uma vez sem tools (para forçar resposta de texto)
  if (!isValidContent(finalModelResponseText) && isAnthropicProvider) {
    console.log("[Service] Resposta final vazia ou placeholder, tentando forçar resposta de texto...");
    try {
      const finalAttempt = await generateResponse(conversationHistory, finalSystemInstruction, {
        ...generationOptions,
        tools: [] // Remove tools para forçar resposta de texto
      });
      if (isValidContent(finalAttempt.text)) {
        finalModelResponseText = finalAttempt.text;
        currentResponse = finalAttempt;
      }
    } catch (err) {
      console.warn("[Service] Erro na tentativa final:", err.message);
    }
  }

  // Salva resposta final
  const modelResponse = isValidContent(finalModelResponseText) ? finalModelResponseText : "Desculpe, não consegui processar sua solicitação.";

  // Tenta extrair thoughtSignature da resposta final
  let finalThoughtSignature = null;
  if (currentResponse.parts && currentResponse.parts.length > 0) {
    // Procura em qualquer parte, mas geralmente está na primeira ou associada ao texto
    const partWithSig = currentResponse.parts.find(p => p.thoughtSignature);
    if (partWithSig) {
      finalThoughtSignature = partWithSig.thoughtSignature;
    }
  }

  const modelMessageId = await addMessage(chatToken, "historico", modelResponse, "model", [], geminiApiKey, finalThoughtSignature);

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
 * Atualiza as configurações de um chat.
 * @param {string} chatToken 
 * @param {Object} config 
 */
async function updateChatConfig(chatToken, config) {
  const metadata = await chatStorage.getChatMetadata(chatToken);
  if (!metadata) throw new Error("Chat não encontrado.");

  // Atualiza apenas os campos permitidos ou faz merge
  metadata.config = { ...metadata.config, ...config };
  metadata.updatedAt = new Date().toISOString();

  await chatStorage.saveChatMetadata(chatToken, metadata, metadata.userId);
  return metadata;
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
 * @param {string} userId - ID do usuário dono do chat.
 * @param {Array} messages - Lista de mensagens a serem importadas.
 * @param {string} apiKey - Chave de API para o novo chat.
 * @param {Function} onProgress - Callback para reportar progresso (current, total).
 * @returns {Promise<string>} - Token do novo chat.
 */
async function importChat(userId, messages, apiKey, onProgress) {
  console.log(`[Service] Importando chat para user: ${userId} com ${messages.length} mensagens.`);

  // 1. Cria um novo chat
  const chatToken = await createChat(userId);

  // 2. Atualiza a API Key do chat
  await updateChatConfig(chatToken, { apiKey });

  // 3. Processa as mensagens
  let processedCount = 0;
  const totalMessages = messages.length;

  for (const msg of messages) {
    // Mapeia os campos do JSON para o formato esperado
    const text = msg.content || msg.text || "";
    const role = msg.role === "model" ? "model" : "user";

    // Adiciona a mensagem
    await addMessage(chatToken, "historico", text, role, [], apiKey);

    processedCount++;

    // Reporta progresso se o callback existir
    if (onProgress) {
      onProgress(processedCount, totalMessages);
    }

    // Pequeno delay para evitar rate limit do Gemini na geração de embeddings
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return chatToken;
}

/**
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
        attachments: record.attachments, // Mantém anexos
        thoughtSignature: record.thoughtSignature
      };

      await lanceDBService.insertRecord(newChatToken, collectionName, cleanRecord);
    }
  }

  return newChatToken;
}

/**
 * Exporta memórias de um chat para JSON.
 * @param {string} chatToken - Token do chat.
 * @param {Array<string>} collections - Coleções a exportar (ex: ["fatos", "conceitos", "historico"]).
 * @returns {Promise<Object>} - Objeto JSON com as memórias exportadas.
 */
async function exportMemories(chatToken, collections = ["fatos", "conceitos"]) {
  console.log(`[Service] Exportando memórias do chat ${chatToken}. Coleções: ${collections.join(", ")}`);

  // Carrega metadados do chat
  const chatMetadata = await chatStorage.getChatMetadata(chatToken);
  if (!chatMetadata) throw new Error("Chat não encontrado.");

  const exportData = {
    version: "1.1", // Versão atualizada com suporte a embeddings
    exportedAt: new Date().toISOString(),
    source: {
      chatId: chatToken,
      chatTitle: chatMetadata.title || "Chat sem título"
    },
    embeddingDimension: config.embeddingDimension, // Dimensão dos embeddings para validação
    statistics: {},
    collections: {}
  };

  // Exporta cada coleção solicitada
  for (const collectionName of collections) {
    try {
      const records = await lanceDBService.getAllRecordsFromCollection(chatToken, collectionName);

      // Inclui vetores para reimportação rápida
      const exportedRecords = records.map(record => ({
        text: record.text,
        role: record.role,
        createdAt: record.createdAt,
        // Inclui o vetor de embedding (converte para array simples)
        vector: record.vector ? Array.from(record.vector) : null,
        // Mantém flag de attachments para histórico
        ...(record.attachments && collectionName === "historico" ? {
          hasAttachments: true
        } : {})
      }));

      exportData.collections[collectionName] = exportedRecords;
      exportData.statistics[collectionName] = exportedRecords.length;

      console.log(`[Service] Exportados ${exportedRecords.length} registros de '${collectionName}' (com embeddings).`);
    } catch (err) {
      console.warn(`[Service] Erro ao exportar coleção '${collectionName}':`, err.message);
      exportData.collections[collectionName] = [];
      exportData.statistics[collectionName] = 0;
    }
  }

  return exportData;
}

/**
 * Importa memórias de um JSON para um chat existente.
 * @param {string} chatToken - Token do chat destino.
 * @param {Object} data - Dados JSON a importar.
 * @param {Array<string>} collections - Coleções a importar.
 * @param {Function} onProgress - Callback de progresso (current, total).
 * @returns {Promise<Object>} - Estatísticas da importação.
 */
async function importMemories(chatToken, data, collections, onProgress) {
  console.log(`[Service] Importando memórias para chat ${chatToken}. Coleções: ${collections.join(", ")}`);

  // Valida versão (aceita 1.0 e 1.1)
  if (!["1.0", "1.1"].includes(data.version)) {
    throw new Error(`Versão do arquivo não suportada: ${data.version}`);
  }

  // Carrega metadados do chat para obter API Key (pode ser necessária)
  const chatMetadata = await chatStorage.getChatMetadata(chatToken);
  if (!chatMetadata) throw new Error("Chat não encontrado.");

  const apiKey = chatMetadata.config?.apiKey;

  // Verifica se os embeddings no arquivo são compatíveis
  const hasEmbeddings = data.version === "1.1" && data.embeddingDimension === config.embeddingDimension;

  if (hasEmbeddings) {
    console.log(`[Service] Arquivo contém embeddings compatíveis (${data.embeddingDimension}D). Importação rápida ativada.`);
  } else {
    console.log(`[Service] Arquivo sem embeddings ou incompatível. Será necessário gerar embeddings.`);
    if (!apiKey) {
      throw new Error("API Key do Gemini não configurada (necessária para gerar embeddings).");
    }
  }

  const stats = {
    imported: {},
    total: 0,
    errors: 0,
    embeddingsReused: 0,
    embeddingsGenerated: 0
  };

  // Calcula total para progresso
  let totalItems = 0;
  for (const collectionName of collections) {
    if (data.collections && data.collections[collectionName]) {
      totalItems += data.collections[collectionName].length;
    }
  }

  let processedItems = 0;

  // Importa cada coleção solicitada
  for (const collectionName of collections) {
    if (!data.collections || !data.collections[collectionName]) {
      console.warn(`[Service] Coleção '${collectionName}' não encontrada no arquivo.`);
      continue;
    }

    const records = data.collections[collectionName];
    stats.imported[collectionName] = 0;

    for (const record of records) {
      try {
        // Verifica se temos um embedding válido
        const hasValidVector = hasEmbeddings && record.vector && Array.isArray(record.vector) && record.vector.length === config.embeddingDimension;

        if (hasValidVector) {
          // Importação rápida: usa o embedding existente
          const messageid = `${uuidv4()}`;
          const insertRecord = {
            text: record.text,
            role: record.role || "model",
            messageid,
            createdAt: record.createdAt || Date.now(),
            vector: record.vector
          };

          await lanceDBService.insertRecord(chatToken, collectionName, insertRecord);
          stats.embeddingsReused++;
        } else {
          // Importação lenta: gera novo embedding
          await addMessage(
            chatToken,
            collectionName,
            record.text,
            record.role || "model",
            [], // Sem anexos na importação
            apiKey
          );
          stats.embeddingsGenerated++;

          // Pequeno delay para evitar rate limit apenas quando gerando embeddings
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        stats.imported[collectionName]++;
        stats.total++;
        processedItems++;

        // Reporta progresso
        if (onProgress) {
          onProgress(processedItems, totalItems);
        }
      } catch (err) {
        console.error(`[Service] Erro ao importar registro:`, err.message);
        stats.errors++;
        processedItems++;

        if (onProgress) {
          onProgress(processedItems, totalItems);
        }
      }
    }

    console.log(`[Service] Importados ${stats.imported[collectionName]} registros para '${collectionName}'.`);
  }

  console.log(`[Service] Importação concluída. Embeddings reutilizados: ${stats.embeddingsReused}, Gerados: ${stats.embeddingsGenerated}`);
  return stats;
}

/**
 * Obtém estatísticas das memórias de um chat (para exibir contagem antes de exportar).
 * @param {string} chatToken - Token do chat.
 * @returns {Promise<Object>} - Estatísticas por coleção.
 */
async function getMemoryStats(chatToken) {
  const stats = {};

  for (const collectionName of config.collectionNames) {
    try {
      const records = await lanceDBService.getAllRecordsFromCollection(chatToken, collectionName);
      stats[collectionName] = records.length;
    } catch (err) {
      stats[collectionName] = 0;
    }
  }

  return stats;
}

/**
 * Busca semântica em todos os chats de um usuário.
 * @param {string} userId - ID do usuário
 * @param {string} queryText - Texto da busca
 * @param {string} apiKey - API Key para gerar embedding
 * @returns {Promise<object[]>} - Lista de chats ranqueados por relevância
 */
async function searchAllUserChats(userId, queryText, apiKey) {
  console.log(`[Service] Iniciando busca global para user ${userId}: "${queryText.substring(0, 30)}..."`);
  const startTime = Date.now();

  // 1. Lista todos os chats do usuário
  const chats = await chatStorage.getAllChats(userId);
  if (chats.length === 0) {
    return [];
  }

  // 2. Gera embedding da query
  const queryVector = await geminiService.generateEmbedding(queryText, apiKey);

  // 3. Busca em batches paralelos
  const BATCH_SIZE = 50;
  const allResults = [];
  const chatTokens = chats.map(c => c.id);

  for (let i = 0; i < chatTokens.length; i += BATCH_SIZE) {
    const batchTokens = chatTokens.slice(i, i + BATCH_SIZE);
    const batchResults = await lanceDBService.searchAcrossChats(
      batchTokens,
      ['fatos', 'conceitos', 'historico'],
      queryVector,
      5 // Limite por coleção
    );
    allResults.push(...batchResults);
  }

  // 4. Agrupa resultados por chat e calcula score médio
  const chatScores = {};
  const chatMatches = {};

  for (const result of allResults) {
    const token = result.chatToken;
    if (!chatScores[token]) {
      chatScores[token] = [];
      chatMatches[token] = [];
    }
    chatScores[token].push(result.relevanceScore || 0);
    chatMatches[token].push({
      text: result.text?.substring(0, 100) + '...',
      collection: result.collection,
      score: result.relevanceScore
    });
  }

  // 5. Cria lista ranqueada
  const rankedChats = Object.entries(chatScores).map(([token, scores]) => {
    const chat = chats.find(c => c.id === token);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const maxScore = Math.max(...scores);

    return {
      chatToken: token,
      title: chat?.title || 'Chat',
      updatedAt: chat?.updatedAt,
      relevanceScore: avgScore,
      bestMatch: maxScore,
      matchCount: scores.length,
      topMatches: chatMatches[token]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
    };
  });

  // 6. Ordena por melhor match (não média, para evitar diluição)
  rankedChats.sort((a, b) => b.bestMatch - a.bestMatch);

  const elapsed = Date.now() - startTime;
  console.log(`[Service] Busca global concluída em ${elapsed}ms. ${rankedChats.length} chats encontrados.`);

  // 7. Retorna top 10
  return rankedChats.slice(0, 10);
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
  branchChat,
  exportMemories,
  importMemories,
  getMemoryStats,
  searchAllUserChats
};
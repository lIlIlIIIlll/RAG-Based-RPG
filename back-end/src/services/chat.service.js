// src/services/chat.service.js
const { v4: uuidv4 } = require("uuid");
const geminiService = require("./gemini.service");
const lanceDBService = require("./lancedb.service");
const chatStorage = require("./chatStorage.service");
const { getHistoryWithWordLimit } = require("../utils/historyHelper");
const config = require("../config");
const fs = require("fs");
const path = require("path");

// --- Definição de Ferramentas (Function Calling) ---
const tools = [
  {
    functionDeclarations: [
      {
        name: "insert_fact",
        description: "Insere um novo fato na base de conhecimento (coleção 'fatos'). Use isso quando o usuário fornecer uma informação factual nova que deve ser lembrada.",
        parameters: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "O conteúdo do fato a ser armazenado."
            }
          },
          required: ["text"]
        }
      },
      {
        name: "insert_concept",
        description: "Insere um novo conceito na base de conhecimento (coleção 'conceitos'). Use isso para definições, teorias ou ideias abstratas.",
        parameters: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "A definição ou explicação do conceito."
            }
          },
          required: ["text"]
        }
      },
      {
        name: "roll_dice",
        description: "Rola dados de RPG. Use isso quando precisar determinar um resultado aleatório, como um ataque, teste de habilidade ou dano. O sistema retornará o resultado da rolagem.",
        parameters: {
          type: "object",
          properties: {
            count: {
              type: "integer",
              description: "Número de dados a rolar (ex: 1, 2, 4)."
            },
            type: {
              type: "string",
              description: "Tipo de dado (ex: '20' para d20, '6' para d6, 'F' para Fudge)."
            },
            modifier: {
              type: "integer",
              description: "Modificador a ser somado ao total (opcional, padrão 0)."
            }
          },
          required: ["count", "type"]
        }
      },
      {
        name: "generate_image",
        description: "Gera uma imagem baseada em uma descrição. Use isso para criar representações visuais de cenas, personagens, itens ou qualquer coisa que o usuário pedir.",
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "A descrição detalhada da imagem a ser gerada."
            }
          },
          required: ["prompt"]
        }
      }
    ]
  }
];

/**
 * Cria um novo chat, gerando token, tabelas no DB e arquivo de metadados.
 * @param {string} userId - ID do usuário dono do chat.
 * @returns {Promise<string>} O chatToken gerado.
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
 * Importa um chat a partir de uma lista de mensagens.
 * @param {string} userId - ID do usuário.
 * @param {Array} messages - Lista de mensagens { role, text }.
 * @param {string} apiKey - Chave da API Gemini (opcional, mas recomendada).
 * @returns {Promise<string>} O chatToken do novo chat.
 */
async function importChat(userId, messages, apiKey = "") {
  console.log(`[Service] Importando chat para user: ${userId} com ${messages.length} mensagens.`);

  // 1. Cria o chat
  const chatToken = await createChat(userId);

  // 2. Se houver API Key, salva nas configurações
  if (apiKey) {
    const metadata = await chatStorage.getChatMetadata(chatToken);
    if (metadata) {
      metadata.config.apiKey = apiKey;
      await chatStorage.saveChatMetadata(chatToken, metadata, userId);
    }
  }

  // 3. Adiciona as mensagens sequencialmente
  for (const msg of messages) {
    if (msg.role && msg.text) {
      try {
        // Passa a apiKey para addMessage, que agora pode gerar embeddings
        await addMessage(chatToken, "historico", msg.text, msg.role, [], apiKey);
      } catch (e) {
        console.warn(`[Service] Falha ao adicionar mensagem na importação: ${e.message}`);
      }
    }
  }

  // 4. Atualiza o título com base na primeira mensagem do usuário (se houver)
  const firstUserMsg = messages.find(m => m.role === 'user');
  if (firstUserMsg) {
    const newTitle = firstUserMsg.text.substring(0, 30) + "...";
    await chatStorage.updateChatTitle(chatToken, newTitle);
  }

  return chatToken;
}

/**
 * Retorna a lista de todos os chats criados.
 * @param {string} userId - ID do usuário para filtrar.
 */
async function getAllChats(userId) {
  console.log(`[Service] Listando todos os chats para user: ${userId}...`);
  return await chatStorage.getAllChats(userId);
}

/**
 * Deleta um chat completo (Tabelas + Metadados).
 * @param {string} chatToken 
 */
async function deleteChat(chatToken) {
  console.log(`[Service] Deletando chat: ${chatToken}`);
  // 1. Remove do disco
  await chatStorage.deleteChatMetadata(chatToken);
  // 2. Remove do LanceDB
  await lanceDBService.deleteChatTables(chatToken);
}

/**
 * Atualiza as configurações de um chat.
 * @param {string} chatToken 
 * @param {object} newConfig 
 */
async function updateChatConfig(chatToken, newConfig) {
  console.log(`[Service] Atualizando config do chat ${chatToken}...`);
  return await chatStorage.updateChatConfig(chatToken, newConfig);
}

/**
 * Retorna os metadados de um chat específico.
 */
async function getChatDetails(chatToken) {
  return await chatStorage.getChatMetadata(chatToken);
}

/**
 * Recupera o histórico completo de mensagens de um chat.
 * @param {string} chatToken 
 * @returns {Promise<Array>}
 */
async function getChatHistory(chatToken) {
  console.log(`[Service] Recuperando histórico completo para: ${chatToken}`);
  const history = await lanceDBService.getAllRecordsFromCollection(chatToken, "historico");
  return history;
}

/**
 * Helper para obter API Key do chat
 */
async function getChatApiKey(chatToken) {
  const meta = await chatStorage.getChatMetadata(chatToken);
  return meta?.config?.apiKey;
}

/**
 * Adiciona uma mensagem a uma coleção.
 */
async function addMessage(chatToken, collectionName, text, role = "user", attachments = [], apiKey = null) {
  console.log(
    `[Service] Adicionando mensagem à coleção '${collectionName}' com role=${role}.`
  );

  if (!apiKey) {
    apiKey = await getChatApiKey(chatToken);
  }

  if (!apiKey) {
    console.warn("[Service] API Key não encontrada para gerar embedding. Tentando inserir sem vetor (pode falhar se DB exigir).");
    // Se não tiver key, não gera embedding. O LanceDB pode reclamar se o schema exigir vetor.
    // Assumindo que o schema exige, vamos lançar erro para forçar o usuário a configurar.
    throw new Error("API Key necessária para salvar mensagem (geração de embedding). Configure no chat.");
  }

  const vector = await geminiService.generateEmbedding(text, apiKey);
  const messageid = uuidv4();

  const record = {
    text,
    vector,
    messageid,
    role,
    createdAt: Date.now(),
    attachments: JSON.stringify(attachments)
  };
  await lanceDBService.insertRecord(chatToken, collectionName, record);
  return messageid;
}

/**
 * Edita uma mensagem existente.
 */
async function editMessage(chatToken, messageid, newContent) {
  console.log(`[Service] Editando mensagem com id: ${messageid} `);

  const apiKey = await getChatApiKey(chatToken);
  if (!apiKey) {
    throw new Error("API Key necessária para editar mensagem.");
  }

  const newVector = await geminiService.generateEmbedding(newContent, apiKey);
  const wasUpdated = await lanceDBService.updateRecordByMessageId(
    chatToken,
    messageid,
    newContent,
    newVector
  );
  return wasUpdated;
}

/**
 * Deleta uma mensagem específica.
 */
async function deleteMessage(chatToken, messageid) {
  console.log(`[Service] Deletando mensagem ID: ${messageid} `);
  return await lanceDBService.deleteRecordByMessageId(chatToken, messageid);
}

/**
 * Busca por mensagens semanticamente similares.
 */
async function searchMessages(chatToken, collectionName, queryVector) {
  console.log(
    `[Service] Buscando na coleção '${collectionName}' usando vetor direto.`
  );
  const results = await lanceDBService.searchByVector(
    chatToken,
    collectionName,
    queryVector
  );

  // Injeta a categoria (nome da coleção) nos resultados
  return results.map(item => ({ ...item, category: collectionName }));
}

/**
 * Orquestra a geração de uma resposta de IA usando RAG.
 * Agora suporta configurações dinâmicas por chat e Function Calling.
 */
async function handleChatGeneration(
  chatToken,
  userMessage,
  previousVectorMemory = [],
  files = []
) {
  // --- ETAPA 0: Carregar Configurações do Chat ---
  const chatMetadata = await chatStorage.getChatMetadata(chatToken);

  // Fallback para configs globais se não encontrar metadados
  const chatConfig = chatMetadata?.config || {
    modelName: "gemini-2.5-flash",
    temperature: 0.7,
    systemInstruction: config.systemInstructionTemplate,
    apiKey: ""
  };

  const apiKey = chatConfig.apiKey;
  if (!apiKey) {
    throw new Error("API Key não configurada para este chat. Por favor, adicione nas configurações.");
  }

  // --- ETAPA 1: Salvar mensagem do usuário no histórico ---
  const attachments = files.map(file => {
    // Salvar arquivo no disco para preview
    try {
      const uploadDir = path.join(__dirname, "../../uploads");
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      const filePath = path.join(uploadDir, file.originalname);
      fs.writeFileSync(filePath, file.buffer);
      console.log(`[Service] Arquivo salvo em: ${filePath}`);
    } catch (err) {
      console.error("[Service] Erro ao salvar arquivo no disco:", err);
    }

    return {
      mimeType: file.mimetype,
      data: file.buffer.toString("base64")
    };
  });

  await addMessage(chatToken, "historico", userMessage, "user", attachments, apiKey);

  const fullHistoryRecords = await lanceDBService.getAllRecordsFromCollection(
    chatToken,
    "historico"
  );

  const {
    limitedHistory: conversationHistory,
    wordCount: conversationWordCount,
  } = getHistoryWithWordLimit(fullHistoryRecords, config.historyWordLimit);

  const historyText = conversationHistory.map((msg) => msg.text).join("\n");
  const shortHistoryIds = new Set(conversationHistory.map((msg) => msg.messageid));

  // --- ETAPA 2: Embedding do contexto ---
  const previousMemoryText = previousVectorMemory.map((mem) => mem.text).join("\n");
  const contextForVectorQuery = previousMemoryText + "\n\n" + historyText;

  console.log("[Service] Gerando embedding para busca vetorial...");
  const vectorQuery = await geminiService.generateEmbedding(contextForVectorQuery, apiKey);

  // --- ETAPA 3: Busca vetorial ---
  const searchPromises = config.collectionNames.map((collectionName) =>
    searchMessages(chatToken, collectionName, vectorQuery)
  );

  const searchResultsArrays = await Promise.all(searchPromises);
  let combinedResults = [].concat(...searchResultsArrays);

  // Remove itens que já estão no histórico curto
  combinedResults = combinedResults.filter(
    (item) => !shortHistoryIds.has(item.messageid)
  );

  // --- ETAPA 4: Construir Memória Vetorial ---
  combinedResults.sort((a, b) => b._score - a._score);
  const uniqueResults = Array.from(
    new Map(combinedResults.map((item) => [item.text, item])).values()
  );

  let newVectorMemory = [];
  let newVectorMemoryText = "";
  let memoryWordCount = 0;
  const wordCounter = (text) => (text ? text.trim().split(/\s+/).length : 0);

  for (const result of uniqueResults) {
    const wordsInResult = wordCounter(result.text);
    if (memoryWordCount + wordsInResult <= config.vectorMemoryWordLimit) {
      newVectorMemory.push(result);
      newVectorMemoryText += `${result.text} \n-- -\n`;
      memoryWordCount += wordsInResult;
    } else {
      break;
    }
  }

  // --- ETAPA 5: Preparar System Instruction Dinâmica ---
  const template = chatConfig.systemInstruction || config.systemInstructionTemplate;
  const systemInstruction = template.replace(
    "{vector_memory}",
    newVectorMemoryText || "Nenhuma informação contextual encontrada."
  );

  // Prepara o histórico inicial para o modelo
  const formattedHistory = conversationHistory.map((record) => {
    const parts = [{ text: record.text }];
    if (record.attachments) {
      try {
        const parsedAttachments = JSON.parse(record.attachments);
        for (const att of parsedAttachments) {
          parts.push({
            inlineData: {
              mimeType: att.mimeType,
              data: att.data
            }
          });
        }
      } catch (e) {
        console.error("Error parsing attachments:", e);
      }
    }
    return {
      role: record.role || "user",
      parts: parts,
      // parts: [{ text: record.text }], // Simplificação se não houver anexos
    };
  });

  // --- ETAPA 6: Loop de Geração (Suporte a Function Calling) ---
  const generationConfig = {
    modelName: chatConfig.modelName,
    temperature: chatConfig.temperature,
    tools: tools, // Injeta as ferramentas
    apiKey: apiKey // Passa a API Key
  };

  let finalModelResponseText = "";
  let loopCount = 0;
  const MAX_LOOPS = 5; // Evita loops infinitos

  // Array para armazenar todas as mensagens geradas neste ciclo (ferramentas + resposta final)
  const generatedMessages = [];

  while (loopCount < MAX_LOOPS) {
    const response = await geminiService.generateChatResponse(
      formattedHistory,
      systemInstruction,
      generationConfig
    );

    const { text, functionCalls } = response;

    // Se não houver chamadas de função, terminamos
    if (!functionCalls || functionCalls.length === 0) {
      finalModelResponseText = text;
      break;
    }

    // Se houver texto junto com a function call, adicionamos ao histórico
    const modelTurnParts = [];
    if (text) modelTurnParts.push({ text });

    for (const call of functionCalls) {
      modelTurnParts.push({ functionCall: call });
    }

    formattedHistory.push({ role: "model", parts: modelTurnParts });

    // Executa as funções
    const functionResponseParts = [];
    for (const call of functionCalls) {
      const { name, args } = call;
      let result = {};

      console.log(`[Service] Executing tool: ${name} with args:`, args);

      try {
        if (name === "insert_fact") {
          await addMessage(chatToken, "fatos", args.text, "model", [], apiKey);
          result = { status: "success", message: "Fato inserido com sucesso." };
        } else if (name === "insert_concept") {
          await addMessage(chatToken, "conceitos", args.text, "model", [], apiKey);
          result = { status: "success", message: "Conceito inserido com sucesso." };
        } else if (name === "roll_dice") {
          // Lógica de rolagem no backend
          const count = args.count;
          const type = args.type; // '20', '6', 'F'
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

          // Formato: "1d20 = 20 { 20 }"
          const resultText = `${count}d${type}${modString} = ${finalTotal} { ${rollString} }`;

          // PERSISTE O RESULTADO COMO MENSAGEM VISÍVEL
          const rollMsgId = await addMessage(chatToken, "historico", resultText, "model", [], apiKey);

          generatedMessages.push({
            text: resultText,
            role: "model",
            messageid: rollMsgId,
            createdAt: Date.now()
          });

          result = { result: resultText };
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

          result = { status: "success", message: "Imagem gerada e enviada ao usuário." };
        } else {
          result = { error: "Function not found" };
        }
      } catch (err) {
        console.error(`[Service] Error executing tool ${name}:`, err);
        result = { error: err.message };
      }

      functionResponseParts.push({
        functionResponse: {
          name: name,
          response: result
        }
      });
    }

    // Adiciona a resposta da função ao histórico
    formattedHistory.push({ role: "function", parts: functionResponseParts });

    loopCount++;
  }

  // --- ETAPA 7: Salvar resposta final ---
  const modelResponse = finalModelResponseText || "Desculpe, não consegui processar sua solicitação.";

  const modelMessageId = await addMessage(chatToken, "historico", modelResponse, "model", [], apiKey);

  generatedMessages.push({
    text: modelResponse,
    role: "model",
    messageid: modelMessageId,
    createdAt: Date.now()
  });

  // Atualiza timestamp e título se necessário
  if (chatMetadata) {
    chatMetadata.updatedAt = new Date().toISOString();
    if (chatMetadata.title === "Novo Chat" && userMessage.length > 2) {
      chatMetadata.title = userMessage.substring(0, 30) + "...";
    }
    await chatStorage.saveChatMetadata(chatToken, chatMetadata, chatMetadata.userId);
  }

  return {
    modelResponse, // Mantém compatibilidade, mas o frontend deve olhar o history
    history: conversationHistory.concat(generatedMessages),
    wordCount: conversationWordCount + wordCounter(modelResponse), // Aproximado
    newVectorMemory,
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
};
// src/services/chat.service.js
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const lanceDBService = require("./lancedb.service");
const chatStorage = require("./chatStorage.service");
const geminiService = require("./gemini.service");
const openrouterService = require("./openrouter.service");
const googleProvider = require("./google.provider");
const config = require("../config");

// Funﾃｧﾃ｣o auxiliar para contar palavras
function wordCounter(text) {
    return text ? text.split(/\s+/).length : 0;
}

// ============================================
// SISTEMA DE FILA PERSISTENTE PARA EMBEDDINGS
// ============================================

// Fila em memória para embeddings pendentes
const pendingEmbeddingsQueue = [];

// Path para fila persistente em disco
const PENDING_QUEUE_PATH = path.join(process.cwd(), 'data', 'pending_embeddings.json');

// Flag para evitar processamento concorrente
let isProcessingQueue = false;

/**
 * Carrega fila persistente do disco (chamado na inicialização).
 */
function loadPendingQueue() {
    try {
        if (fs.existsSync(PENDING_QUEUE_PATH)) {
            const data = fs.readFileSync(PENDING_QUEUE_PATH, 'utf8');
            const items = JSON.parse(data);
            pendingEmbeddingsQueue.push(...items);
            console.log(`[EmbeddingQueue] Carregadas ${items.length} inserções pendentes do disco.`);
        }
    } catch (e) {
        console.error('[EmbeddingQueue] Erro ao carregar fila persistente:', e.message);
    }
}

/**
 * Salva fila persistente em disco.
 */
function savePendingQueue() {
    try {
        // Garante que o diretório existe
        const dir = path.dirname(PENDING_QUEUE_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(PENDING_QUEUE_PATH, JSON.stringify(pendingEmbeddingsQueue, null, 2));
    } catch (e) {
        console.error('[EmbeddingQueue] Erro ao salvar fila persistente:', e.message);
    }
}

/**
 * Adiciona item à fila de embeddings pendentes.
 * @param {Object} item - { chatToken, collectionName, messageid, text, apiKeys, retryCount }
 */
function addToPendingQueue(item) {
    pendingEmbeddingsQueue.push({
        ...item,
        addedAt: Date.now(),
        retryCount: item.retryCount || 0
    });
    savePendingQueue();
    console.log(`[EmbeddingQueue] Adicionado à fila: ${item.messageid} (${pendingEmbeddingsQueue.length} na fila)`);

    // Agenda processamento em background
    scheduleQueueProcessing();
}

/**
 * Agenda processamento da fila com delay exponencial.
 */
function scheduleQueueProcessing() {
    if (isProcessingQueue) return;

    // Delay base de 5 segundos, aumenta com tamanho da fila
    const delay = Math.min(5000 + (pendingEmbeddingsQueue.length * 1000), 60000);

    setTimeout(() => {
        processEmbeddingQueue();
    }, delay);
}

/**
 * Processa a fila de embeddings pendentes.
 */
async function processEmbeddingQueue() {
    if (isProcessingQueue || pendingEmbeddingsQueue.length === 0) return;

    isProcessingQueue = true;
    console.log(`[EmbeddingQueue] Processando ${pendingEmbeddingsQueue.length} itens pendentes...`);

    const MAX_RETRIES = 5;
    const itemsToRemove = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < pendingEmbeddingsQueue.length; i++) {
        const item = pendingEmbeddingsQueue[i];

        try {
            // Tenta gerar embedding
            const vector = await geminiService.generateEmbedding(item.text, item.apiKeys);

            // Verifica se o vetor é válido
            const isZeroVector = !vector || vector.reduce((a, b) => a + Math.abs(b), 0) < 0.001;
            if (isZeroVector) {
                throw new Error('Embedding gerado é vetor zerado');
            }

            // Atualiza o registro no LanceDB
            const wasUpdated = await lanceDBService.updateRecordByMessageId(
                item.chatToken,
                item.messageid,
                item.text,
                vector
            );

            if (wasUpdated) {
                console.log(`[EmbeddingQueue] ✓ Embedding atualizado: ${item.messageid}`);
                itemsToRemove.push(i);
                successCount++;
            } else {
                // Registro não encontrado (pode ter sido deletado)
                console.warn(`[EmbeddingQueue] Registro não encontrado: ${item.messageid}`);
                itemsToRemove.push(i);
            }

            // Rate limiting entre processamentos
            await new Promise(r => setTimeout(r, 1500));

        } catch (error) {
            item.retryCount++;
            item.lastError = error.message;

            if (item.retryCount >= MAX_RETRIES) {
                console.error(`[EmbeddingQueue] ✗ Máximo de retries atingido para ${item.messageid}: ${error.message}`);
                itemsToRemove.push(i);
                failCount++;
            } else if (error.allKeysExhausted) {
                // Todas as keys em cooldown - para o processamento e agenda para depois
                console.log(`[EmbeddingQueue] Todas as keys em cooldown. Pausando processamento.`);
                break;
            } else {
                console.warn(`[EmbeddingQueue] Retry ${item.retryCount}/${MAX_RETRIES} para ${item.messageid}: ${error.message}`);
            }
        }
    }

    // Remove itens processados (do final para o início para não bagunçar índices)
    itemsToRemove.sort((a, b) => b - a).forEach(i => {
        pendingEmbeddingsQueue.splice(i, 1);
    });

    savePendingQueue();
    isProcessingQueue = false;

    console.log(`[EmbeddingQueue] Processamento concluído: ${successCount} sucesso, ${failCount} falhas, ${pendingEmbeddingsQueue.length} restantes`);

    // Se ainda há itens, agenda próximo processamento
    if (pendingEmbeddingsQueue.length > 0) {
        scheduleQueueProcessing();
    }
}

/**
 * Retorna status da fila para diagnóstico.
 */
function getPendingQueueStatus() {
    return {
        count: pendingEmbeddingsQueue.length,
        isProcessing: isProcessingQueue,
        items: pendingEmbeddingsQueue.map(item => ({
            messageid: item.messageid,
            text: item.text?.substring(0, 50) + '...',
            retryCount: item.retryCount,
            addedAt: new Date(item.addedAt).toISOString()
        }))
    };
}

// Carrega fila persistente na inicialização
loadPendingQueue();

/**
 * Cria um novo chat.
 * @param {string} userId - ID do usuﾃ｡rio dono do chat.
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
            openrouterApiKey: "", // API Key do OpenRouter (usado para LLM)
            // Google Provider config
            provider: "openrouter", // "openrouter" | "google"
            googleApiKeys: [], // Array of Google API keys (rotates on quota, also used for embeddings)
            googleModelName: "gemini-2.5-flash", // Model name for Google provider
            rateLimits: { rpm: 5, tpm: 250000, rpd: 20 }, // User-configurable rate limits
        },
    };

    await chatStorage.saveChatMetadata(chatToken, initialMetadata, userId);

    return chatToken;
}

/**
 * Lista todos os chats de um usuﾃ｡rio.
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function getAllChats(userId) {
    console.log(`[Service] Listando todos os chats para user: ${userId}...`);
    return await chatStorage.getAllChats(userId);
}

/**
 * Obtﾃｩm detalhes de um chat especﾃｭfico.
 * @param {string} chatToken
 * @returns {Promise<Object>}
 */
async function getChatDetails(chatToken) {
    return await chatStorage.getChatMetadata(chatToken);
}

/**
 * Obtﾃｩm histﾃｳrico completo de mensagens de um chat.
 * @param {string} chatToken
 * @returns {Promise<Array>}
 */
async function getChatHistory(chatToken) {
    console.log(`[Service] Recuperando histﾃｳrico completo para: ${chatToken}`);
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
 * @param {string|string[]} apiKey - API key ou array de keys para rotação
 * @param {string} thoughtSignature
 * @param {Object} options - { failOnEmbeddingError: boolean }
 * @returns {Promise<{messageid: string, embeddingStatus: 'success'|'pending'|'failed'}>}
 */
async function addMessage(chatToken, collectionName, text, role, attachments = [], apiKey, thoughtSignature = null, options = {}) {
    const { failOnEmbeddingError = false } = options;

    // Inicializa com vetor zerado (fallback)
    let vector = new Array(config.embeddingDimension).fill(0);
    let embeddingStatus = 'success';
    let embeddingError = null;

    // Processa anexos: gera descrições de mídia para torná-los buscáveis via RAG
    let mediaDescriptions = [];
    if (apiKey && attachments.length > 0) {
        for (const att of attachments) {
            // Gera descrição apenas para tipos multimodais suportados
            if (att.mimeType && (att.mimeType.startsWith("image/") || att.mimeType === "application/pdf")) {
                try {
                    console.log(`[Service] Gerando descrição RAG para anexo: ${att.name} (${att.mimeType})`);
                    const description = await geminiService.describeMediaForRAG(att.data, att.mimeType, apiKey);

                    // Salva a descrição junto com o anexo para referência futura
                    att._ragDescription = description;
                    mediaDescriptions.push(description);
                } catch (error) {
                    console.error(`[Service] Falha ao gerar descrição para ${att.name}: `, error.message);
                    // Continua sem descrição - o anexo ainda será salvo
                }
            }
        }
    }

    // Constrói texto para embedding
    let textForEmbedding = text || "";
    if (mediaDescriptions.length > 0) {
        const mediaContext = mediaDescriptions.join("\n---\n");
        textForEmbedding = textForEmbedding
            ? `${textForEmbedding} \n\n[Conteúdo visual anexado: ${mediaContext}]`
            : `[Conteúdo visual: ${mediaContext}]`;
        console.log(`[Service] Embedding enriquecido com ${mediaDescriptions.length} descrição(ões) de mídia.`);
    }

    // Gera embedding se tiver API Key e texto válido
    if (apiKey && textForEmbedding.trim().length > 0) {
        try {
            vector = await geminiService.generateEmbedding(textForEmbedding, apiKey);

            // Verifica se o vetor é válido (não zerado)
            const isZeroVector = vector.reduce((a, b) => a + Math.abs(b), 0) < 0.001;
            if (isZeroVector) {
                throw new Error('Embedding gerado é vetor zerado');
            }

            embeddingStatus = 'success';
        } catch (error) {
            embeddingError = error;
            console.error("[Service] Falha ao gerar embedding para mensagem:", error.message);

            // Para coleções críticas (fatos, conceitos), podemos lançar erro
            const isCriticalCollection = collectionName === 'fatos' || collectionName === 'conceitos';

            if (failOnEmbeddingError && isCriticalCollection) {
                // FAIL-FAST: Lança erro para o chamador tratar
                const err = new Error(`Falha ao gerar embedding: ${error.message}. A memória não será buscável até que o embedding seja gerado.`);
                err.embeddingFailed = true;
                err.allKeysExhausted = error.allKeysExhausted;
                throw err;
            }

            // GRACEFUL DEGRADATION: Insere com vetor zerado mas agenda retry
            embeddingStatus = 'pending';
        }
    }

    // Gera messageid antes de inserir (para usar na fila)
    const messageid = uuidv4();

    const record = {
        text,
        vector,
        messageid,
        role,
        createdAt: Date.now(),
        attachments: JSON.stringify(attachments),
        thoughtSignature: thoughtSignature
    };

    // Insere no LanceDB
    await lanceDBService.insertRecord(chatToken, collectionName, record);

    // Se embedding falhou, adiciona à fila para retry em background
    if (embeddingStatus === 'pending' && textForEmbedding.trim().length > 0) {
        addToPendingQueue({
            chatToken,
            collectionName,
            messageid,
            text: textForEmbedding,
            apiKeys: Array.isArray(apiKey) ? apiKey : [apiKey]
        });

        console.warn(`[Service] Memória ${messageid} inserida com vetor zerado.Será reprocessada em background.`);
    }

    return { messageid, embeddingStatus };
}

/**
 * Edita uma mensagem existente.
 * @param {string} chatToken
 * @param {string} messageid
 * @param {string} newText
 */
async function editMessage(chatToken, messageid, newText) {
    // Precisa regenerar embedding se tiver API Keys configuradas no chat
    const metadata = await chatStorage.getChatMetadata(chatToken);
    const googleApiKeys = metadata.config.googleApiKeys || [];

    let newVector = null;
    if (googleApiKeys.length > 0 && newText && newText.trim().length > 0) {
        try {
            newVector = await geminiService.generateEmbedding(newText, googleApiKeys);
        } catch (e) {
            console.error("[Service] Erro ao regenerar embedding na ediﾃｧﾃ｣o:", e);
        }
    }

    // Usa o serviﾃｧo do LanceDB para atualizar
    const wasUpdated = await lanceDBService.updateRecordByMessageId(chatToken, messageid, newText, newVector);

    if (wasUpdated) {
        console.log(`[Service] Mensagem ${messageid} editada com sucesso.`);
    } else {
        console.warn(`[Service] Falha ao editar mensagem ${messageid} (nﾃ｣o encontrada ?).`);
    }

    return wasUpdated;
}

/**
 * Deleta uma mensagem especﾃｭfica.
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
    if (!apiKey) throw new Error("API Key necessﾃ｡ria para busca semﾃ｢ntica.");

    const queryVector = await geminiService.generateEmbedding(queryText, apiKey);

    // Usa o serviﾃｧo do LanceDB para buscar
    const results = await lanceDBService.searchByVector(chatToken, collectionName, queryVector, limit);
    return results.slice(0, limit);
}

/**
 * Lﾃｳgica principal de geraﾃｧﾃ｣o de resposta (RAG + Chat).
 */
async function handleChatGeneration(chatToken, userMessage, clientVectorMemory, files = []) {
    // 1. Carrega metadados e valida API Keys
    const chatMetadata = await chatStorage.getChatMetadata(chatToken);
    if (!chatMetadata) throw new Error("Chat nﾃ｣o encontrado.");

    const {
        openrouterApiKey, modelName, temperature, systemInstruction,
        provider, googleApiKeys, googleModelName, rateLimits
    } = chatMetadata.config;

    // Valida que hﾃ｡ pelo menos uma key do Google para embeddings
    if (!googleApiKeys || googleApiKeys.length === 0) {
        throw new Error("API Key do Google nﾃ｣o configurada (necessﾃ｡ria para embeddings).");
    }

    // Validate provider-specific keys
    const useGoogleProvider = provider === "google";
    if (!useGoogleProvider && !openrouterApiKey) {
        throw new Error("API Key do OpenRouter nﾃ｣o configurada.");
    }

    // AUTO-REPAIR: Verifica e repara embeddings zerados em background
    // Usa cooldown para nﾃ｣o verificar a cada mensagem (a cada 10 mensagens ou 5 minutos)
    const lastRepairKey = `lastRepair_${chatToken} `;
    const now = Date.now();
    const lastRepair = global[lastRepairKey] || 0;
    const REPAIR_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos

    if (now - lastRepair > REPAIR_COOLDOWN_MS) {
        global[lastRepairKey] = now;
        // Executa em background sem bloquear a resposta
        (async () => {
            try {
                const result = await lanceDBService.repairZeroEmbeddings(
                    chatToken,
                    geminiService.generateEmbedding,
                    googleApiKeys,
                    ['conceitos', 'fatos'] // Nﾃ｣o repara historico automaticamente (muito grande)
                );
                if (result.repaired > 0) {
                    console.log(`[Service] AUTO - REPAIR: ${result.repaired} embeddings reparados em background.`);
                }
            } catch (err) {
                console.warn(`[Service] AUTO - REPAIR falhou: `, err.message);
            }
        })();
    }

    // 2. Salva mensagem do usuﾃ｡rio no histﾃｳrico
    // Processa anexos se houver
    const attachments = files.map(f => ({
        name: f.originalname,
        mimeType: f.mimetype,
        data: f.buffer.toString("base64")
    }));

    // Validaﾃｧﾃ｣o de tamanho total (limite de 20MB para inline data conforme docs Gemini)
    const MAX_INLINE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
    const totalAttachmentSize = files.reduce((sum, f) => sum + f.buffer.length, 0);
    if (totalAttachmentSize > MAX_INLINE_SIZE_BYTES) {
        throw new Error(`Arquivos anexados excedem o limite de 20MB(${(totalAttachmentSize / 1024 / 1024).toFixed(2)}MB enviados).`);
    }

    await addMessage(chatToken, "historico", userMessage, "user", attachments, googleApiKeys);

    // 3. Recupera Histﾃｳrico Recente (Necessﾃ｡rio para gerar a query de busca e para o contexto do chat)
    const historyRecords = await lanceDBService.getAllRecordsFromCollection(chatToken, "historico");
    // Ordena por data
    historyRecords.sort((a, b) => a.createdAt - b.createdAt);

    // Pega ﾃｺltimas N mensagens para nﾃ｣o estourar contexto (simplificado)
    let startIndex = Math.max(0, historyRecords.length - 20);
    // Tenta garantir que comeﾃｧa com mensagem do usuﾃ｡rio voltando um ﾃｭndice se necessﾃ｡rio
    if (startIndex > 0 && historyRecords[startIndex].role === 'model') {
        startIndex = Math.max(0, startIndex - 1);
    }
    const recentHistory = historyRecords.slice(startIndex);

    // 4. Gera Queries de Busca Otimizadas (RAG - Dual Query: DIRETA + NARRATIVA)
    // Usa o histﾃｳrico recente para entender o que o usuﾃ｡rio quer dizer
    let searchQueries = { direct: userMessage, narrative: '' }; // Default: usa a mensagem do usuﾃ｡rio

    // Constrﾃｳi contexto de texto para a IA gerar as queries
    const historyContextText = recentHistory.map(r => `${r.role}: ${r.text} `).join("\n");

    if (googleApiKeys && googleApiKeys.length > 0) {
        try {
            searchQueries = await geminiService.generateSearchQuery(historyContextText, googleApiKeys);
        } catch (e) {
            console.warn("[Service] Falha ao gerar queries de busca, usando mensagem original:", e);
        }
    }

    // 5. Recupera Memﾃｳria (RAG) usando as Queries Geradas (DIRETA + NARRATIVA)
    // Busca em TODAS as coleﾃｧﾃｵes, mistura, ordena por relevﾃ｢ncia e limita por palavras
    let contextText = "";
    let displayMemory = [];
    let uniqueResults = []; // Para uso nas tools

    // Fallback para garantir que collectionNames exista
    const collectionsToSearch = config.collectionNames || ["historico", "fatos", "conceitos"];
    let allMemories = [];

    // === BUSCA COM QUERY DIRETA (peso maior - elementos da cena) ===
    if (searchQueries.direct && searchQueries.direct.trim().length > 0) {
        console.log(`[Service] Buscando com QUERY DIRETA: "${searchQueries.direct}"`);

        for (const collectionName of collectionsToSearch) {
            try {
                // Busca um nﾃｺmero maior de candidatos para filtrar depois
                const results = await searchMessages(chatToken, collectionName, searchQueries.direct, 80, googleApiKeys);
                // Adiciona a categoria e tipo de query ao objeto
                const resultsWithMeta = results.map(r => ({
                    ...r,
                    category: collectionName,
                    _queryType: 'direct'
                }));
                allMemories = allMemories.concat(resultsWithMeta);
            } catch (err) {
                console.warn(`[Service] Erro ao buscar em ${collectionName} (DIRETA): `, err);
            }
        }
    }

    // === BUSCA COM QUERY NARRATIVA (foreshadowing/lore com quota garantida) ===
    if (searchQueries.narrative && searchQueries.narrative.trim().length > 0) {
        console.log(`[Service] Buscando com QUERY NARRATIVA: "${searchQueries.narrative}"`);

        // Foca em conceitos e fatos (lore, world building) - pula histﾃｳrico
        const narrativeCollections = ['conceitos', 'fatos'];

        for (const collectionName of narrativeCollections) {
            try {
                const results = await searchMessages(chatToken, collectionName, searchQueries.narrative, 50, googleApiKeys);
                // Marca como narrativa para o sistema de quotas (sem penalidade de distﾃ｢ncia)
                const resultsWithMeta = results.map(r => ({
                    ...r,
                    category: collectionName,
                    _queryType: 'narrative'
                }));
                allMemories = allMemories.concat(resultsWithMeta);
            } catch (err) {
                console.warn(`[Service] Erro ao buscar em ${collectionName} (NARRATIVA): `, err);
            }
        }
    }

    // Log de estatﾃｭsticas das buscas
    const directCount = allMemories.filter(m => m._queryType === 'direct').length;
    const narrativeCount = allMemories.filter(m => m._queryType === 'narrative').length;
    console.log(`[Service] Buscas concluﾃｭdas: ${directCount} resultados DIRETOS, ${narrativeCount} resultados NARRATIVOS`);

    if (allMemories.length > 0) {

        // === BIAS ADAPTATIVO PARA FATOS E CONCEITOS ===
        // RELEVANCE_THRESHOLD: Memﾃｳrias com distﾃ｢ncia abaixo desse valor recebem boost
        //   - Maior = mais memﾃｳrias recebem boost (inclusive menos relevantes)
        //   - Menor = apenas memﾃｳrias muito relevantes recebem boost
        const RELEVANCE_THRESHOLD = 0.7;

        // MAX_BOOST: Quanto menor a distﾃ｢ncia, maior o boost (atﾃｩ esse mﾃ｡ximo)
        //   - 1.0 = pode reduzir distﾃ｢ncia a zero (muito agressivo)
        //   - 0.5 = reduz no mﾃ｡ximo 50% da distﾃ｢ncia
        const MAX_BOOST = 0.62; // 60% de reduﾃｧﾃ｣o mﾃ｡xima

        // HISTORICO_PENALTY: Multiplica a distﾃ｢ncia do histﾃｳrico
        //   - 1.5 = aumenta 50% (histﾃｳrico 0.5 vira 0.75)
        //   - 2.0 = duplica (histﾃｳrico 0.5 vira 1.0 - muito agressivo)
        const HISTORICO_PENALTY = 1.016; // 0.6% de penalidade

        allMemories.forEach(memory => {
            // Guarda distﾃ｢ncia original para debug
            memory._originalDistance = memory._distance;

            if (memory.category === 'historico') {
                // PENALIZA histﾃｳrico - aumenta distﾃ｢ncia
                memory._distance = memory._distance * HISTORICO_PENALTY;
            } else if (memory.category === 'fatos' || memory.category === 'conceitos') {
                if (memory._distance < RELEVANCE_THRESHOLD) {
                    // Quanto menor a distﾃ｢ncia, maior o boost (QUADRﾃゝICO - favorece muito os muito relevantes)
                    const relevanceFactor = Math.pow(1 - (memory._distance / RELEVANCE_THRESHOLD), 2);
                    const boost = relevanceFactor * MAX_BOOST;
                    memory._distance = memory._distance * (1 - boost);
                    memory._adaptiveBoost = boost;
                }
            }
        });

        // Ordena por similaridade (menor distﾃ｢ncia = mais similar)
        allMemories.sort((a, b) => a._distance - b._distance);

        // Conjunto de IDs jﾃ｡ presentes no histﾃｳrico recente para evitar duplicaﾃｧﾃ｣o
        const recentHistoryIds = new Set(recentHistory.map(r => r.messageid));
        const seenIds = new Set();

        // === QUOTA-BASED FUSION ===
        // Garante diversidade reservando espaﾃｧo para resultados narrativos
        const WORD_LIMIT = 5000;
        const NARRATIVE_QUOTA_WORDS = 1500; // Reserva ~30% do espaﾃｧo para narrativa

        let currentWordCount = 0;
        let narrativeWordCount = 0;

        // Separa resultados por tipo
        const directResults = allMemories.filter(m => m._queryType === 'direct');
        const narrativeResults = allMemories.filter(m => m._queryType === 'narrative');

        // Primeiro: preenche quota narrativa (foreshadowing garantido)
        for (const memory of narrativeResults) {
            if (seenIds.has(memory.messageid)) continue;
            if (recentHistoryIds.has(memory.messageid)) continue;

            const wordCount = wordCounter(memory.text);
            if (narrativeWordCount + wordCount > NARRATIVE_QUOTA_WORDS) continue;

            seenIds.add(memory.messageid);
            uniqueResults.push(memory);
            narrativeWordCount += wordCount;
            currentWordCount += wordCount;
        }

        // Segundo: preenche o resto com resultados diretos (ordenados por distﾃ｢ncia)
        for (const memory of directResults) {
            if (seenIds.has(memory.messageid)) continue;
            if (recentHistoryIds.has(memory.messageid)) continue;

            const wordCount = wordCounter(memory.text);
            if (currentWordCount + wordCount > WORD_LIMIT) break;

            seenIds.add(memory.messageid);
            uniqueResults.push(memory);
            currentWordCount += wordCount;
        }

        // Log de diversidade
        const finalDirect = uniqueResults.filter(m => m._queryType === 'direct').length;
        const finalNarrative = uniqueResults.filter(m => m._queryType === 'narrative').length;
        console.log(`[Service] Fusﾃ｣o com quotas: ${finalDirect} DIRETOS(~${currentWordCount - narrativeWordCount} palavras), ${finalNarrative} NARRATIVOS(~${narrativeWordCount} palavras)`);

        if (uniqueResults.length > 0) {
            // Coleta mﾃｭdia recuperada do RAG para injeﾃｧﾃ｣o no contexto
            const ragMediaParts = [];
            const MAX_RAG_IMAGES = 3; // Limita quantidade de imagens para nﾃ｣o estourar tokens

            // Monta contexto textual incluindo descriﾃｧﾃｵes de mﾃｭdia
            const memoryLines = uniqueResults.map(m => {
                let line = `- [${m.role ? m.role.toUpperCase() : 'INFO'}][ID: ${m.messageid}] ${m.text} `;

                // Se tem anexo com mﾃｭdia, adiciona descriﾃｧﾃ｣o e coleta para injeﾃｧﾃ｣o
                if (m.attachments) {
                    try {
                        const atts = JSON.parse(m.attachments);
                        for (const att of atts) {
                            if (att._ragDescription) {
                                line += `\n[Mﾃｭdia anexada: ${att._ragDescription}]`;
                            }

                            // Coleta imagens para injeﾃｧﾃ｣o direta (atﾃｩ o limite)
                            if (ragMediaParts.length < MAX_RAG_IMAGES &&
                                att.mimeType &&
                                (att.mimeType.startsWith("image/") || att.mimeType === "application/pdf")) {
                                ragMediaParts.push({
                                    inlineData: {
                                        mimeType: att.mimeType,
                                        data: att.data
                                    },
                                    _filename: att.name,
                                    _fromRag: true, // Marca como vindo do RAG
                                    _ragDescription: att._ragDescription
                                });
                            }
                        }
                    } catch (e) { /* ignora erros de parse */ }
                }

                return line;
            });

            contextText = "Memﾃｳrias Relevantes recuperadas do banco de dados:\n" + memoryLines.join("\n");

            // Adiciona nota sobre imagens recuperadas se houver
            if (ragMediaParts.length > 0) {
                contextText += `\n\n[${ragMediaParts.length} arquivo(s) visual(is) recuperado(s) e disponﾃｭvel(is) para anﾃ｡lise]`;

                // Salva as partes de mﾃｭdia para injeﾃｧﾃ｣o no histﾃｳrico (serﾃ｡ usado abaixo)
                // Armazena temporariamente em uma variﾃ｡vel que serﾃ｡ usada ao montar o histﾃｳrico
                uniqueResults._ragMediaParts = ragMediaParts;
                console.log(`[Service] ${ragMediaParts.length} mﾃｭdia(s) recuperada(s) do RAG para injeﾃｧﾃ｣o no contexto.`);
            }

            displayMemory = uniqueResults.map(m => {
                let mediaData = null;

                // Extrai dados de mﾃｭdia para exibiﾃｧﾃ｣o no frontend
                if (m.attachments) {
                    try {
                        const atts = JSON.parse(m.attachments);
                        const mediaAtt = atts.find(a =>
                            a.mimeType?.startsWith("image/") || a.mimeType === "application/pdf"
                        );
                        if (mediaAtt) {
                            mediaData = {
                                mimeType: mediaAtt.mimeType,
                                data: mediaAtt.data, // base64 para thumbnail
                                name: mediaAtt.name,
                                description: mediaAtt._ragDescription || null
                            };
                        }
                    } catch (e) { /* ignora */ }
                }

                return {
                    messageid: m.messageid,
                    text: m.text,
                    score: m._distance,
                    category: m.category,
                    hasMedia: !!mediaData,
                    media: mediaData,
                    // Debug info para calibraﾃｧﾃ｣o do RAG
                    debug: {
                        originalDistance: m._originalDistance || m._distance,
                        finalDistance: m._distance,
                        adaptiveBoost: m._adaptiveBoost || 0,
                        hasPenalty: m.category === 'historico',
                        queryType: m._queryType || 'direct' // 'direct' ou 'narrative'
                    }
                };
            });

            console.log(`[Service] Contexto RAG construﾃｭdo com ${uniqueResults.length} memﾃｳrias(~${currentWordCount} palavras).`);
        }
    }

    // 6. Monta Histﾃｳrico para o Gemini
    // IMPORTANTE: Para melhor qualidade, imagens/PDFs devem vir ANTES do texto
    // conforme documentaﾃｧﾃ｣o do Gemini
    const conversationHistory = recentHistory.map(r => {
        const parts = [];

        // Primeiro: adiciona anexos (imagens e PDFs)
        // Ordem recomendada pelo Gemini: mﾃｭdia antes do texto
        if (r.attachments) {
            try {
                const atts = JSON.parse(r.attachments);
                atts.forEach(a => {
                    // Suporta imagens E PDFs para multimodal
                    if (a.mimeType.startsWith("image/") || a.mimeType === "application/pdf") {
                        parts.push({
                            inlineData: {
                                mimeType: a.mimeType,
                                data: a.data
                            },
                            // Preserva nome do arquivo para referﾃｪncia (usado pelo OpenRouter)
                            _filename: a.name
                        });
                    }
                });
            } catch (e) { console.error("Erro ao parsear anexos:", e); }
        }

        // Depois: adiciona o texto
        if (r.text) {
            const textPart = { text: r.text };
            // Se tiver thoughtSignature, adiciona ao part de texto
            if (r.thoughtSignature) {
                textPart.thoughtSignature = r.thoughtSignature;
            }
            parts.push(textPart);
        }

        // Fallback: se nﾃ｣o tem nenhum part, adiciona texto vazio
        if (parts.length === 0) {
            parts.push({ text: "" });
        }

        return {
            role: r.role === "user" ? "user" : "model",
            parts: parts
        };
    });

    // 6.1 Injeta imagens recuperadas do RAG no histﾃｳrico
    // Isso permite que o modelo "veja" imagens antigas que foram recuperadas por busca semﾃ｢ntica
    if (uniqueResults._ragMediaParts && uniqueResults._ragMediaParts.length > 0) {
        const ragMediaParts = uniqueResults._ragMediaParts;

        // Cria um turno especial de "contexto visual recuperado"
        // Inserido como mensagem do usuﾃ｡rio logo antes da mensagem atual
        const ragContextParts = [
            { text: "[Contexto Visual Recuperado - Imagens/documentos relevantes de conversas anteriores:]" },
            ...ragMediaParts.map(p => ({
                inlineData: p.inlineData,
                _filename: p._filename
            }))
        ];

        // Adiciona descriﾃｧﾃｵes se disponﾃｭveis
        const descriptions = ragMediaParts
            .filter(p => p._ragDescription)
            .map((p, i) => `${i + 1}. ${p._ragDescription} `)
            .join("\n");

        if (descriptions) {
            ragContextParts.push({ text: `\nDescriﾃｧﾃｵes das mﾃｭdias recuperadas: \n${descriptions} ` });
        }

        // Insere antes da ﾃｺltima mensagem (que ﾃｩ a mensagem atual do usuﾃ｡rio)
        const insertPosition = Math.max(0, conversationHistory.length - 1);
        conversationHistory.splice(insertPosition, 0, {
            role: "user",
            parts: ragContextParts
        });

        console.log(`[Service] ${ragMediaParts.length} mﾃｭdia(s) do RAG injetada(s) no histﾃｳrico na posiﾃｧﾃ｣o ${insertPosition}.`);
    }

    // Safety Check: Gemini exige que a primeira mensagem seja do usuﾃ｡rio
    if (conversationHistory.length > 0 && conversationHistory[0].role === 'model') {
        console.warn("[Service] Histﾃｳrico comeﾃｧa com 'model', inserindo placeholder 'user'.");
        conversationHistory.unshift({
            role: "user",
            parts: [{ text: "..." }] // Placeholder neutro
        });
    }

    // 7. System Instruction Dinﾃ｢mico
    let finalSystemInstruction = systemInstruction;

    // Verifica se o template tem o placeholder. Se nﾃ｣o tiver, faz append como fallback.
    if (contextText) {
        if (finalSystemInstruction.includes("{vector_memory}")) {
            finalSystemInstruction = finalSystemInstruction.replace("{vector_memory}", contextText);
        } else {
            // Fallback para templates antigos que nﾃ｣o tenham a tag
            finalSystemInstruction += "\n\n<retrieved_context>\n" + contextText + "\n</retrieved_context>";
        }
    } else {
        // Limpa o placeholder se nﾃ｣o houver memﾃｳria
        finalSystemInstruction = finalSystemInstruction.replace("{vector_memory}", "Nenhuma memﾃｳria relevante encontrada.");
    }

    // 8. Chama Gemini com Tools
    const tools = [
        {
            function_declarations: [
                {
                    name: "insert_fact",
                    description: "Salva um fato importante, regra de mundo ou acontecimento na memﾃｳria de longo prazo (coleﾃｧﾃ｣o 'fatos'). Use isso para coisas concretas que aconteceram.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            text: { type: "STRING", description: "O conteﾃｺdo do fato a ser memorizado." }
                        },
                        required: ["text"]
                    }
                },
                {
                    name: "insert_concept",
                    description: "Salva um conceito, explicaﾃｧﾃ｣o abstrata, traﾃｧo de personalidade ou lore na memﾃｳria de longo prazo (coleﾃｧﾃ｣o 'conceitos').",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            text: { type: "STRING", description: "O conteﾃｺdo do conceito a ser memorizado." }
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
                            count: { type: "INTEGER", description: "Nﾃｺmero de dados." },
                            type: { type: "STRING", description: "Tipo do dado (20, 6, 100, F para Fudge/Fate)." },
                            modifier: { type: "INTEGER", description: "Modificador a ser somado ao total (opcional)." }
                        },
                        required: ["count", "type"]
                    }
                },
                {
                    name: "edit_memory",
                    description: "Edita o texto de uma memﾃｳria existente (fato ou conceito) ou mensagem do histﾃｳrico. Use quando o usuﾃ｡rio corrigir uma informaﾃｧﾃ｣o ou quando um fato mudar.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            messageid: { type: "STRING", description: "O ID da mensagem/memﾃｳria a ser editada." },
                            new_text: { type: "STRING", description: "O novo texto atualizado." }
                        },
                        required: ["messageid", "new_text"]
                    }
                },
                {
                    name: "delete_memories",
                    description: "Remove memﾃｳrias (fatos ou conceitos) ou mensagens que nﾃ｣o sﾃ｣o mais verdadeiras ou relevantes. Use APENAS quando tiver certeza que a informaﾃｧﾃ｣o deve ser esquecida.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            messageids: {
                                type: "ARRAY",
                                items: { type: "STRING" },
                                description: "Lista de IDs das mensagens/memﾃｳrias a serem deletadas."
                            }
                        },
                        required: ["messageids"]
                    }
                }
            ]
        }
    ];

    // 8. Chama Provider com Tools
    const generationOptions = useGoogleProvider ? {
        modelName: googleModelName || "gemini-2.5-flash",
        temperature,
        tools,
        apiKeys: googleApiKeys,
        rateLimits: rateLimits || { rpm: 5, tpm: 250000, rpd: 20 }
    } : {
        modelName,
        temperature,
        tools,
        apiKey: openrouterApiKey
    };

    // Funﾃｧﾃ｣o auxiliar para chamar o provider correto
    const generateResponse = async (history, systemInst, options) => {
        if (useGoogleProvider) {
            return await googleProvider.generateChatResponse(history, systemInst, options);
        }
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

        // Se jﾃ｡ temos texto vﾃ｡lido E function calls, capturamos o texto
        // (alguns modelos enviam narraﾃｧﾃ｣o + tool call na mesma resposta)
        const hasValidTextWithTools = text && text.trim().length > 10 && !text.trim().startsWith("...");
        if (hasValidTextWithTools && !finalModelResponseText) {
            console.log(`[Service] Modelo retornou texto junto com tools.Capturando narraﾃｧﾃ｣o: "${text.substring(0, 50)}..."`);
            finalModelResponseText = text;
        }

        // Executa Tools
        const functionResponseParts = [];
        let needsFollowUp = false; // Flag para indicar se precisamos de resposta adicional
        let memoryInsertCount = 0; // Contador para aplicar delay entre inserﾃｧﾃｵes de memﾃｳria
        const MEMORY_INSERT_DELAY = 1500; // 1.5s entre inserﾃｧﾃｵes para evitar rate limiting no embedding API

        for (const call of functionCalls) {
            const name = call.name;
            const args = call.args;
            let toolResult = {};

            console.log(`[Service] Executing tool: ${name} with args: `, args);

            try {
                if (name === "insert_fact") {
                    // Aplica delay entre inserﾃｧﾃｵes para evitar rate limiting no embedding API
                    if (memoryInsertCount > 0) {
                        console.log(`[Service] Aguardando ${MEMORY_INSERT_DELAY}ms antes de inserir memﾃｳria(rate limit protection)...`);
                        await new Promise(r => setTimeout(r, MEMORY_INSERT_DELAY));
                    }
                    memoryInsertCount++;

                    const msgId = await addMessage(chatToken, "fatos", args.text, "model", [], googleApiKeys);
                    toolResult = { status: "success", message: "Fato inserido com sucesso." };

                    // Adiciona ﾃ memﾃｳria de exibiﾃｧﾃ｣o para atualizaﾃｧﾃ｣o imediata na UI
                    displayMemory.push({
                        messageid: msgId,
                        text: args.text,
                        score: 0, // Score 0 para indicar que ﾃｩ novo/relevante
                        category: "fatos"
                    });

                } else if (name === "insert_concept") {
                    // Aplica delay entre inserﾃｧﾃｵes para evitar rate limiting no embedding API
                    if (memoryInsertCount > 0) {
                        console.log(`[Service] Aguardando ${MEMORY_INSERT_DELAY}ms antes de inserir memﾃｳria(rate limit protection)...`);
                        await new Promise(r => setTimeout(r, MEMORY_INSERT_DELAY));
                    }
                    memoryInsertCount++;

                    const msgId = await addMessage(chatToken, "conceitos", args.text, "model", [], googleApiKeys);
                    toolResult = { status: "success", message: "Conceito inserido com sucesso." };

                    // Adiciona ﾃ memﾃｳria de exibiﾃｧﾃ｣o para atualizaﾃｧﾃ｣o imediata na UI
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
                    const modString = modifier ? (modifier > 0 ? `+ ${modifier} ` : `${modifier} `) : '';
                    const resultText = `${count}d${type}${modString} = ${finalTotal} { ${rollString} } `;

                    const rollMsgId = await addMessage(chatToken, "historico", resultText, "model", [], googleApiKeys);

                    generatedMessages.push({
                        text: resultText,
                        role: "model",
                        messageid: rollMsgId,
                        createdAt: Date.now()
                    });

                    toolResult = { result: resultText };
                    needsFollowUp = true; // Rolagem de dados pode precisar de resposta narrativa
                } else if (name === "edit_memory") {
                    const wasUpdated = await editMessage(chatToken, args.messageid, args.new_text);
                    if (wasUpdated) {
                        toolResult = { status: "success", message: "Memﾃｳria atualizada com sucesso." };
                    } else {
                        toolResult = { status: "error", message: "Memﾃｳria nﾃ｣o encontrada ou erro ao atualizar." };
                    }
                } else if (name === "delete_memories") {
                    const ids = args.messageids || [];
                    const memoriesToDelete = [];

                    for (const id of ids) {
                        let memory = uniqueResults.find(m => m.messageid === id);
                        if (memory) {
                            memoriesToDelete.push({ messageid: id, text: memory.text, category: memory.category });
                        } else {
                            memoriesToDelete.push({ messageid: id, text: "(Memﾃｳria nﾃ｣o encontrada no contexto recente)", category: "?" });
                        }
                    }

                    toolResult = {
                        status: "pending_confirmation",
                        message: "Aguardando confirmaﾃｧﾃ｣o do usuﾃ｡rio para deletar memﾃｳrias.",
                        pendingDeletions: memoriesToDelete
                    };
                    pendingDeletionsForResponse = memoriesToDelete;
                } else {
                    toolResult = { error: "Function not found" };
                }
            } catch (err) {
                console.error(`[Service] Error executing tool ${name}: `, err);
                toolResult = { error: err.message };
            }

            functionResponseParts.push({
                functionResponse: {
                    name: name,
                    response: toolResult
                }
            });
        }

        // Se jﾃ｡ temos texto vﾃ｡lido e nﾃ｣o precisamos de follow-up, podemos sair do loop
        if (finalModelResponseText && !needsFollowUp) {
            console.log(`[Service] Texto jﾃ｡ capturado, pulando requisiﾃｧﾃ｣o adicional.`);
            break;
        }

        // Adiciona a chamada da funﾃｧﾃ｣o (model turn)
        conversationHistory.push({
            role: "model",
            parts: parts // Parts originais da resposta do modelo
        });

        // Adiciona a resposta da funﾃｧﾃ｣o (function response)
        conversationHistory.push({
            role: "function",
            parts: functionResponseParts
        });

        // Chama o modelo novamente com o histﾃｳrico atualizado
        currentResponse = await generateResponse(conversationHistory, finalSystemInstruction, generationOptions);

        loopCount++;
    }

    // Helper para verificar se o texto ﾃｩ conteﾃｺdo real (nﾃ｣o placeholder)
    const isValidContent = (text) => {
        if (!text) return false;
        const trimmed = text.trim();
        // Rejeita respostas vazias ou que sﾃ｣o apenas "..." ou pontuaﾃｧﾃ｣o
        if (trimmed.length < 5) return false;
        if (/^[.\s]+$/.test(trimmed)) return false; // Apenas pontos e espaﾃｧos
        if (trimmed === "...") return false;
        return true;
    };

    // Se o loop terminou por limite mas a ﾃｺltima resposta tem texto vﾃ｡lido, usa ele
    if (!isValidContent(finalModelResponseText) && currentResponse && isValidContent(currentResponse.text)) {
        finalModelResponseText = currentResponse.text;
    }

    // Se ainda nﾃ｣o temos conteﾃｺdo vﾃ｡lido, tenta mais uma vez sem tools (para forﾃｧar resposta de texto)
    // Nota: Removido isAnthropicProvider que nﾃ｣o existia - agora faz para qualquer provider
    if (!isValidContent(finalModelResponseText)) {
        console.log("[Service] Resposta final vazia ou placeholder, tentando forﾃｧar resposta de texto...");
        try {
            const finalAttempt = await generateResponse(conversationHistory, finalSystemInstruction, {
                ...generationOptions,
                tools: [] // Remove tools para forﾃｧar resposta de texto
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
    const modelResponse = isValidContent(finalModelResponseText) ? finalModelResponseText : "Desculpe, nﾃ｣o consegui processar sua solicitaﾃｧﾃ｣o.";

    // Tenta extrair thoughtSignature da resposta final
    let finalThoughtSignature = null;
    if (currentResponse.parts && currentResponse.parts.length > 0) {
        // Procura em qualquer parte, mas geralmente estﾃ｡ na primeira ou associada ao texto
        const partWithSig = currentResponse.parts.find(p => p.thoughtSignature);
        if (partWithSig) {
            finalThoughtSignature = partWithSig.thoughtSignature;
        }
    }

    const modelMessageId = await addMessage(chatToken, "historico", modelResponse, "model", [], googleApiKeys, finalThoughtSignature);

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

    // Recarrega histﾃｳrico do banco para garantir ordem e consistﾃｪncia
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
 * Atualiza as configuraﾃｧﾃｵes de um chat.
 * @param {string} chatToken 
 * @param {Object} config 
 */
async function updateChatConfig(chatToken, config) {
    const metadata = await chatStorage.getChatMetadata(chatToken);
    if (!metadata) throw new Error("Chat nﾃ｣o encontrado.");

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
 * @param {string} userId - ID do usuﾃ｡rio dono do chat.
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

        // Pequeno delay para evitar rate limit do Gemini na geraﾃｧﾃ｣o de embeddings
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return chatToken;
}

/**
 * @param {string} userId 
 */
async function branchChat(originalChatToken, targetMessageId, userId) {
    console.log(`[Service] Criando branch do chat ${originalChatToken} a partir da mensagem ${targetMessageId} `);

    // 1. Recupera metadados do chat original
    const originalMetadata = await chatStorage.getChatMetadata(originalChatToken);
    if (!originalMetadata) {
        throw new Error("Chat original nﾃ｣o encontrado.");
    }

    // 2. Recupera histﾃｳrico completo para encontrar a mensagem alvo e definir o cutoffTime
    const fullHistory = await lanceDBService.getAllRecordsFromCollection(originalChatToken, "historico");
    const targetMessage = fullHistory.find(m => m.messageid === targetMessageId);

    if (!targetMessage) {
        throw new Error("Mensagem alvo nﾃ｣o encontrada no histﾃｳrico.");
    }

    const cutoffTime = targetMessage.createdAt;
    console.log(`[Service] Cutoff time definido: ${cutoffTime} (Msg ID: ${targetMessageId})`);

    // 3. Cria o novo chat
    const newChatToken = await createChat(userId);

    // 4. Copia e salva as configuraﾃｧﾃｵes do chat original
    const newMetadata = await chatStorage.getChatMetadata(newChatToken);
    newMetadata.title = `${originalMetadata.title} (Branch)`;
    newMetadata.config = { ...originalMetadata.config }; // Copia profunda simples das configs
    await chatStorage.saveChatMetadata(newChatToken, newMetadata, userId);

    // 5. Filtra e copia dados das coleﾃｧﾃｵes (historico, fatos, conceitos)
    // Apenas registros criados ANTES ou NO MESMO MOMENTO da mensagem alvo.
    for (const collectionName of config.collectionNames) {
        const originalRecords = await lanceDBService.getAllRecordsFromCollection(originalChatToken, collectionName);

        const filteredRecords = originalRecords.filter(record => {
            // Se tiver createdAt, usa. Se nﾃ｣o, assume que deve manter (ou descartar? melhor manter por seguranﾃｧa se for antigo)
            // Mas nosso sistema sempre pﾃｵe createdAt.
            return record.createdAt <= cutoffTime;
        });

        console.log(`[Service] Copiando ${filteredRecords.length} registros da coleﾃｧﾃ｣o '${collectionName}' para o novo chat.`);

        for (const record of filteredRecords) {
            // Sanitiza o registro antes de inserir
            const cleanRecord = {
                text: record.text,
                role: record.role,
                messageid: record.messageid,
                createdAt: record.createdAt,
                // Garante que o vetor seja um array simples de nﾃｺmeros, se existir
                vector: record.vector ? Array.from(record.vector) : null,
                attachments: record.attachments, // Mantﾃｩm anexos
                thoughtSignature: record.thoughtSignature
            };

            await lanceDBService.insertRecord(newChatToken, collectionName, cleanRecord);
        }
    }

    return newChatToken;
}

/**
 * Exporta memﾃｳrias de um chat para JSON.
 * @param {string} chatToken - Token do chat.
 * @param {Array<string>} collections - Coleﾃｧﾃｵes a exportar (ex: ["fatos", "conceitos", "historico"]).
 * @returns {Promise<Object>} - Objeto JSON com as memﾃｳrias exportadas.
 */
async function exportMemories(chatToken, collections = ["fatos", "conceitos"]) {
    console.log(`[Service] Exportando memﾃｳrias do chat ${chatToken}.Coleﾃｧﾃｵes: ${collections.join(", ")} `);

    // Carrega metadados do chat
    const chatMetadata = await chatStorage.getChatMetadata(chatToken);
    if (!chatMetadata) throw new Error("Chat nﾃ｣o encontrado.");

    const exportData = {
        version: "1.1", // Versﾃ｣o atualizada com suporte a embeddings
        exportedAt: new Date().toISOString(),
        source: {
            chatId: chatToken,
            chatTitle: chatMetadata.title || "Chat sem tﾃｭtulo"
        },
        embeddingDimension: config.embeddingDimension, // Dimensﾃ｣o dos embeddings para validaﾃｧﾃ｣o
        statistics: {},
        collections: {}
    };

    // Exporta cada coleﾃｧﾃ｣o solicitada
    for (const collectionName of collections) {
        try {
            const records = await lanceDBService.getAllRecordsFromCollection(chatToken, collectionName);

            // Inclui vetores para reimportaﾃｧﾃ｣o rﾃ｡pida
            const exportedRecords = records.map(record => ({
                text: record.text,
                role: record.role,
                createdAt: record.createdAt,
                // Inclui o vetor de embedding (converte para array simples)
                vector: record.vector ? Array.from(record.vector) : null,
                // Mantﾃｩm flag de attachments para histﾃｳrico
                ...(record.attachments && collectionName === "historico" ? {
                    hasAttachments: true
                } : {})
            }));

            exportData.collections[collectionName] = exportedRecords;
            exportData.statistics[collectionName] = exportedRecords.length;

            console.log(`[Service] Exportados ${exportedRecords.length} registros de '${collectionName}'(com embeddings).`);
        } catch (err) {
            console.warn(`[Service] Erro ao exportar coleﾃｧﾃ｣o '${collectionName}': `, err.message);
            exportData.collections[collectionName] = [];
            exportData.statistics[collectionName] = 0;
        }
    }

    return exportData;
}

/**
 * Importa memﾃｳrias de um JSON para um chat existente.
 * @param {string} chatToken - Token do chat destino.
 * @param {Object} data - Dados JSON a importar.
 * @param {Array<string>} collections - Coleﾃｧﾃｵes a importar.
 * @param {Function} onProgress - Callback de progresso (current, total).
 * @returns {Promise<Object>} - Estatﾃｭsticas da importaﾃｧﾃ｣o.
 */
async function importMemories(chatToken, data, collections, onProgress) {
    console.log(`[Service] Importando memﾃｳrias para chat ${chatToken}.Coleﾃｧﾃｵes: ${collections.join(", ")} `);

    // Valida versﾃ｣o (aceita 1.0 e 1.1)
    if (!["1.0", "1.1"].includes(data.version)) {
        throw new Error(`Versﾃ｣o do arquivo nﾃ｣o suportada: ${data.version} `);
    }

    // Carrega metadados do chat para obter API Key (pode ser necessﾃ｡ria)
    const chatMetadata = await chatStorage.getChatMetadata(chatToken);
    if (!chatMetadata) throw new Error("Chat nﾃ｣o encontrado.");

    const apiKey = chatMetadata.config?.googleApiKeys?.[0];

    // Verifica se os embeddings no arquivo sﾃ｣o compatﾃｭveis
    const hasEmbeddings = data.version === "1.1" && data.embeddingDimension === config.embeddingDimension;

    if (hasEmbeddings) {
        console.log(`[Service] Arquivo contﾃｩm embeddings compatﾃｭveis(${data.embeddingDimension}D).Importaﾃｧﾃ｣o rﾃ｡pida ativada.`);
    } else {
        console.log(`[Service] Arquivo sem embeddings ou incompatﾃｭvel.Serﾃ｡ necessﾃ｡rio gerar embeddings.`);
        if (!apiKey) {
            throw new Error("API Key do Google nﾃ｣o configurada (necessﾃ｡ria para gerar embeddings).");
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

    // Importa cada coleﾃｧﾃ｣o solicitada
    for (const collectionName of collections) {
        if (!data.collections || !data.collections[collectionName]) {
            console.warn(`[Service] Coleﾃｧﾃ｣o '${collectionName}' nﾃ｣o encontrada no arquivo.`);
            continue;
        }

        const records = data.collections[collectionName];
        stats.imported[collectionName] = 0;

        for (const record of records) {
            try {
                // Verifica se temos um embedding vﾃ｡lido
                const hasValidVector = hasEmbeddings && record.vector && Array.isArray(record.vector) && record.vector.length === config.embeddingDimension;

                if (hasValidVector) {
                    // Importaﾃｧﾃ｣o rﾃ｡pida: usa o embedding existente
                    const messageid = `${uuidv4()} `;
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
                    // Importaﾃｧﾃ｣o lenta: gera novo embedding
                    await addMessage(
                        chatToken,
                        collectionName,
                        record.text,
                        record.role || "model",
                        [], // Sem anexos na importaﾃｧﾃ｣o
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
                console.error(`[Service] Erro ao importar registro: `, err.message);
                stats.errors++;
                processedItems++;

                if (onProgress) {
                    onProgress(processedItems, totalItems);
                }
            }
        }

        console.log(`[Service] Importados ${stats.imported[collectionName]} registros para '${collectionName}'.`);
    }

    console.log(`[Service] Importaﾃｧﾃ｣o concluﾃｭda.Embeddings reutilizados: ${stats.embeddingsReused}, Gerados: ${stats.embeddingsGenerated} `);
    return stats;
}

/**
 * Obtﾃｩm estatﾃｭsticas das memﾃｳrias de um chat (para exibir contagem antes de exportar).
 * @param {string} chatToken - Token do chat.
 * @returns {Promise<Object>} - Estatﾃｭsticas por coleﾃｧﾃ｣o.
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
 * Busca semﾃ｢ntica em todos os chats de um usuﾃ｡rio.
 * @param {string} userId - ID do usuﾃ｡rio
 * @param {string} queryText - Texto da busca
 * @param {string} apiKey - API Key para gerar embedding
 * @returns {Promise<object[]>} - Lista de chats ranqueados por relevﾃ｢ncia
 */
async function searchAllUserChats(userId, queryText, apiKey) {
    console.log(`[Service] Iniciando busca global para user ${userId}: "${queryText.substring(0, 30)}..."`);
    const startTime = Date.now();

    // 1. Lista todos os chats do usuﾃ｡rio
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
            5 // Limite por coleﾃｧﾃ｣o
        );
        allResults.push(...batchResults);
    }

    // 4. Agrupa resultados por chat e calcula score mﾃｩdio
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

    // 6. Ordena por melhor match (nﾃ｣o mﾃｩdia, para evitar diluiﾃｧﾃ｣o)
    rankedChats.sort((a, b) => b.bestMatch - a.bestMatch);

    const elapsed = Date.now() - startTime;
    console.log(`[Service] Busca global concluﾃｭda em ${elapsed} ms.${rankedChats.length} chats encontrados.`);

    // 7. Retorna top 10
    return rankedChats.slice(0, 10);
}

/**
 * Repara embeddings zerados em um chat especﾃｭfico.
 * @param {string} chatToken - Token do chat
 * @returns {Promise<object>} - Resultado do reparo
 */
async function repairEmbeddings(chatToken) {
    const chatMetadata = await chatStorage.getChatMetadata(chatToken);
    if (!chatMetadata) throw new Error("Chat não encontrado.");

    const googleApiKeys = chatMetadata.config.googleApiKeys || [];
    if (googleApiKeys.length === 0) throw new Error("API Key do Google não configurada.");

    console.log(`[Service] Iniciando reparo de embeddings para chat ${chatToken}...`);

    const result = await lanceDBService.repairZeroEmbeddings(
        chatToken,
        geminiService.generateEmbedding,
        googleApiKeys,
        ['conceitos', 'fatos', 'historico'] // Repara todas as coleções
    );

    return result;
}

/**
 * Verifica quantos embeddings zerados existem em um chat.
 * @param {string} chatToken - Token do chat
 * @returns {Promise<object>} - { total, byCollection }
 */
async function checkZeroEmbeddings(chatToken) {
    return await lanceDBService.countZeroEmbeddings(chatToken, ['conceitos', 'fatos', 'historico']);
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
    searchAllUserChats,
    repairEmbeddings,
    checkZeroEmbeddings,
    getPendingQueueStatus
};

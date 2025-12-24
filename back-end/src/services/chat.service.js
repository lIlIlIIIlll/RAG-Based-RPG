// src/services/chat.service.js
const { v4: uuidv4 } = require("uuid");
const lanceDBService = require("./lancedb.service");
const chatStorage = require("./chatStorage.service");
const geminiService = require("./gemini.service");
const openrouterService = require("./openrouter.service");
const googleProvider = require("./google.provider");
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
            // Google Provider config
            provider: "openrouter", // "openrouter" | "google"
            googleApiKeys: [], // Array of Google API keys for LLM (rotates on quota)
            googleModelName: "gemini-2.5-flash", // Model name for Google provider
            rateLimits: { rpm: 5, tpm: 250000, rpd: 20 }, // User-configurable rate limits
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
                    console.error(`[Service] Falha ao gerar descrição para ${att.name}:`, error.message);
                    // Continua sem descrição - o anexo ainda será salvo
                }
            }
        }
    }

    if (apiKey) {
        try {
            // Combina texto da mensagem + descrições de mídia para embedding mais rico
            let textForEmbedding = text || "";

            if (mediaDescriptions.length > 0) {
                // Adiciona descrições ao texto para embedding
                const mediaContext = mediaDescriptions.join("\n---\n");
                textForEmbedding = textForEmbedding
                    ? `${textForEmbedding}\n\n[Conteúdo visual anexado: ${mediaContext}]`
                    : `[Conteúdo visual: ${mediaContext}]`;

                console.log(`[Service] Embedding enriquecido com ${mediaDescriptions.length} descrição(ões) de mídia.`);
            }

            if (textForEmbedding.trim().length > 0) {
                vector = await geminiService.generateEmbedding(textForEmbedding, apiKey);
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
        attachments: JSON.stringify(attachments), // Salva anexos com _ragDescription
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

    const {
        geminiApiKey, openrouterApiKey, modelName, temperature, systemInstruction,
        provider, googleApiKeys, googleModelName, rateLimits
    } = chatMetadata.config;

    if (!geminiApiKey) throw new Error("API Key do Gemini não configurada (necessária para embeddings).");

    // Validate provider-specific keys
    const useGoogleProvider = provider === "google";
    if (useGoogleProvider) {
        if (!googleApiKeys || googleApiKeys.length === 0) {
            throw new Error("Nenhuma API Key do Google configurada para o provider Google.");
        }
    } else {
        if (!openrouterApiKey) throw new Error("API Key do OpenRouter não configurada.");
    }

    // AUTO-REPAIR: Verifica e repara embeddings zerados em background
    // Usa cooldown para não verificar a cada mensagem (a cada 10 mensagens ou 5 minutos)
    const lastRepairKey = `lastRepair_${chatToken}`;
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
                    geminiApiKey,
                    ['conceitos', 'fatos'] // Não repara historico automaticamente (muito grande)
                );
                if (result.repaired > 0) {
                    console.log(`[Service] AUTO-REPAIR: ${result.repaired} embeddings reparados em background.`);
                }
            } catch (err) {
                console.warn(`[Service] AUTO-REPAIR falhou:`, err.message);
            }
        })();
    }

    // 2. Salva mensagem do usuário no histórico
    // Processa anexos se houver
    const attachments = files.map(f => ({
        name: f.originalname,
        mimeType: f.mimetype,
        data: f.buffer.toString("base64")
    }));

    // Validação de tamanho total (limite de 20MB para inline data conforme docs Gemini)
    const MAX_INLINE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
    const totalAttachmentSize = files.reduce((sum, f) => sum + f.buffer.length, 0);
    if (totalAttachmentSize > MAX_INLINE_SIZE_BYTES) {
        throw new Error(`Arquivos anexados excedem o limite de 20MB (${(totalAttachmentSize / 1024 / 1024).toFixed(2)}MB enviados).`);
    }

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

    // 4. Gera Queries de Busca Otimizadas (RAG - Dual Query: DIRETA + NARRATIVA)
    // Usa o histórico recente para entender o que o usuário quer dizer
    let searchQueries = { direct: userMessage, narrative: '' }; // Default: usa a mensagem do usuário

    // Constrói contexto de texto para a IA gerar as queries
    const historyContextText = recentHistory.map(r => `${r.role}: ${r.text}`).join("\n");

    if (geminiApiKey) {
        try {
            searchQueries = await geminiService.generateSearchQuery(historyContextText, geminiApiKey);
        } catch (e) {
            console.warn("[Service] Falha ao gerar queries de busca, usando mensagem original:", e);
        }
    }

    // 5. Recupera Memória (RAG) usando as Queries Geradas (DIRETA + NARRATIVA)
    // Busca em TODAS as coleções, mistura, ordena por relevância e limita por palavras
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
                // Busca um número maior de candidatos para filtrar depois
                const results = await searchMessages(chatToken, collectionName, searchQueries.direct, 80, geminiApiKey);
                // Adiciona a categoria e tipo de query ao objeto
                const resultsWithMeta = results.map(r => ({
                    ...r,
                    category: collectionName,
                    _queryType: 'direct'
                }));
                allMemories = allMemories.concat(resultsWithMeta);
            } catch (err) {
                console.warn(`[Service] Erro ao buscar em ${collectionName} (DIRETA):`, err);
            }
        }
    }

    // === BUSCA COM QUERY NARRATIVA (foreshadowing/lore com quota garantida) ===
    if (searchQueries.narrative && searchQueries.narrative.trim().length > 0) {
        console.log(`[Service] Buscando com QUERY NARRATIVA: "${searchQueries.narrative}"`);

        // Foca em conceitos e fatos (lore, world building) - pula histórico
        const narrativeCollections = ['conceitos', 'fatos'];

        for (const collectionName of narrativeCollections) {
            try {
                const results = await searchMessages(chatToken, collectionName, searchQueries.narrative, 50, geminiApiKey);
                // Marca como narrativa para o sistema de quotas (sem penalidade de distância)
                const resultsWithMeta = results.map(r => ({
                    ...r,
                    category: collectionName,
                    _queryType: 'narrative'
                }));
                allMemories = allMemories.concat(resultsWithMeta);
            } catch (err) {
                console.warn(`[Service] Erro ao buscar em ${collectionName} (NARRATIVA):`, err);
            }
        }
    }

    // Log de estatísticas das buscas
    const directCount = allMemories.filter(m => m._queryType === 'direct').length;
    const narrativeCount = allMemories.filter(m => m._queryType === 'narrative').length;
    console.log(`[Service] Buscas concluídas: ${directCount} resultados DIRETOS, ${narrativeCount} resultados NARRATIVOS`);

    if (allMemories.length > 0) {

        // === BIAS ADAPTATIVO PARA FATOS E CONCEITOS ===
        // RELEVANCE_THRESHOLD: Memórias com distância abaixo desse valor recebem boost
        //   - Maior = mais memórias recebem boost (inclusive menos relevantes)
        //   - Menor = apenas memórias muito relevantes recebem boost
        const RELEVANCE_THRESHOLD = 0.7;

        // MAX_BOOST: Quanto menor a distância, maior o boost (até esse máximo)
        //   - 1.0 = pode reduzir distância a zero (muito agressivo)
        //   - 0.5 = reduz no máximo 50% da distância
        const MAX_BOOST = 0.62; // 60% de redução máxima

        // HISTORICO_PENALTY: Multiplica a distância do histórico
        //   - 1.5 = aumenta 50% (histórico 0.5 vira 0.75)
        //   - 2.0 = duplica (histórico 0.5 vira 1.0 - muito agressivo)
        const HISTORICO_PENALTY = 1.016; // 0.6% de penalidade

        allMemories.forEach(memory => {
            // Guarda distância original para debug
            memory._originalDistance = memory._distance;

            if (memory.category === 'historico') {
                // PENALIZA histórico - aumenta distância
                memory._distance = memory._distance * HISTORICO_PENALTY;
            } else if (memory.category === 'fatos' || memory.category === 'conceitos') {
                if (memory._distance < RELEVANCE_THRESHOLD) {
                    // Quanto menor a distância, maior o boost (QUADRÁTICO - favorece muito os muito relevantes)
                    const relevanceFactor = Math.pow(1 - (memory._distance / RELEVANCE_THRESHOLD), 2);
                    const boost = relevanceFactor * MAX_BOOST;
                    memory._distance = memory._distance * (1 - boost);
                    memory._adaptiveBoost = boost;
                }
            }
        });

        // Ordena por similaridade (menor distância = mais similar)
        allMemories.sort((a, b) => a._distance - b._distance);

        // Conjunto de IDs já presentes no histórico recente para evitar duplicação
        const recentHistoryIds = new Set(recentHistory.map(r => r.messageid));
        const seenIds = new Set();

        // === QUOTA-BASED FUSION ===
        // Garante diversidade reservando espaço para resultados narrativos
        const WORD_LIMIT = 5000;
        const NARRATIVE_QUOTA_WORDS = 1500; // Reserva ~30% do espaço para narrativa

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

        // Segundo: preenche o resto com resultados diretos (ordenados por distância)
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
        console.log(`[Service] Fusão com quotas: ${finalDirect} DIRETOS (~${currentWordCount - narrativeWordCount} palavras), ${finalNarrative} NARRATIVOS (~${narrativeWordCount} palavras)`);

        if (uniqueResults.length > 0) {
            // Coleta mídia recuperada do RAG para injeção no contexto
            const ragMediaParts = [];
            const MAX_RAG_IMAGES = 3; // Limita quantidade de imagens para não estourar tokens

            // Monta contexto textual incluindo descrições de mídia
            const memoryLines = uniqueResults.map(m => {
                let line = `- [${m.role ? m.role.toUpperCase() : 'INFO'}] [ID: ${m.messageid}] ${m.text}`;

                // Se tem anexo com mídia, adiciona descrição e coleta para injeção
                if (m.attachments) {
                    try {
                        const atts = JSON.parse(m.attachments);
                        for (const att of atts) {
                            if (att._ragDescription) {
                                line += `\n  [Mídia anexada: ${att._ragDescription}]`;
                            }

                            // Coleta imagens para injeção direta (até o limite)
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

            contextText = "Memórias Relevantes recuperadas do banco de dados:\n" + memoryLines.join("\n");

            // Adiciona nota sobre imagens recuperadas se houver
            if (ragMediaParts.length > 0) {
                contextText += `\n\n[${ragMediaParts.length} arquivo(s) visual(is) recuperado(s) e disponível(is) para análise]`;

                // Salva as partes de mídia para injeção no histórico (será usado abaixo)
                // Armazena temporariamente em uma variável que será usada ao montar o histórico
                uniqueResults._ragMediaParts = ragMediaParts;
                console.log(`[Service] ${ragMediaParts.length} mídia(s) recuperada(s) do RAG para injeção no contexto.`);
            }

            displayMemory = uniqueResults.map(m => {
                let mediaData = null;

                // Extrai dados de mídia para exibição no frontend
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
                    // Debug info para calibração do RAG
                    debug: {
                        originalDistance: m._originalDistance || m._distance,
                        finalDistance: m._distance,
                        adaptiveBoost: m._adaptiveBoost || 0,
                        hasPenalty: m.category === 'historico',
                        queryType: m._queryType || 'direct' // 'direct' ou 'narrative'
                    }
                };
            });

            console.log(`[Service] Contexto RAG construído com ${uniqueResults.length} memórias (~${currentWordCount} palavras).`);
        }
    }

    // 6. Monta Histórico para o Gemini
    // IMPORTANTE: Para melhor qualidade, imagens/PDFs devem vir ANTES do texto
    // conforme documentação do Gemini
    const conversationHistory = recentHistory.map(r => {
        const parts = [];

        // Primeiro: adiciona anexos (imagens e PDFs)
        // Ordem recomendada pelo Gemini: mídia antes do texto
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
                            // Preserva nome do arquivo para referência (usado pelo OpenRouter)
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

        // Fallback: se não tem nenhum part, adiciona texto vazio
        if (parts.length === 0) {
            parts.push({ text: "" });
        }

        return {
            role: r.role === "user" ? "user" : "model",
            parts: parts
        };
    });

    // 6.1 Injeta imagens recuperadas do RAG no histórico
    // Isso permite que o modelo "veja" imagens antigas que foram recuperadas por busca semântica
    if (uniqueResults._ragMediaParts && uniqueResults._ragMediaParts.length > 0) {
        const ragMediaParts = uniqueResults._ragMediaParts;

        // Cria um turno especial de "contexto visual recuperado"
        // Inserido como mensagem do usuário logo antes da mensagem atual
        const ragContextParts = [
            { text: "[Contexto Visual Recuperado - Imagens/documentos relevantes de conversas anteriores:]" },
            ...ragMediaParts.map(p => ({
                inlineData: p.inlineData,
                _filename: p._filename
            }))
        ];

        // Adiciona descrições se disponíveis
        const descriptions = ragMediaParts
            .filter(p => p._ragDescription)
            .map((p, i) => `${i + 1}. ${p._ragDescription}`)
            .join("\n");

        if (descriptions) {
            ragContextParts.push({ text: `\nDescrições das mídias recuperadas:\n${descriptions}` });
        }

        // Insere antes da última mensagem (que é a mensagem atual do usuário)
        const insertPosition = Math.max(0, conversationHistory.length - 1);
        conversationHistory.splice(insertPosition, 0, {
            role: "user",
            parts: ragContextParts
        });

        console.log(`[Service] ${ragMediaParts.length} mídia(s) do RAG injetada(s) no histórico na posição ${insertPosition}.`);
    }

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

    // Função auxiliar para chamar o provider correto
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

        // Se já temos texto válido E function calls, capturamos o texto
        // (alguns modelos enviam narração + tool call na mesma resposta)
        const hasValidTextWithTools = text && text.trim().length > 10 && !text.trim().startsWith("...");
        if (hasValidTextWithTools && !finalModelResponseText) {
            console.log(`[Service] Modelo retornou texto junto com tools. Capturando narração: "${text.substring(0, 50)}..."`);
            finalModelResponseText = text;
        }

        // Executa Tools
        const functionResponseParts = [];
        let needsFollowUp = false; // Flag para indicar se precisamos de resposta adicional

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
                    needsFollowUp = true; // Rolagem de dados pode precisar de resposta narrativa
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

        // Se já temos texto válido e não precisamos de follow-up, podemos sair do loop
        if (finalModelResponseText && !needsFollowUp) {
            console.log(`[Service] Texto já capturado, pulando requisição adicional.`);
            break;
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
    // Nota: Removido isAnthropicProvider que não existia - agora faz para qualquer provider
    if (!isValidContent(finalModelResponseText)) {
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

    const apiKey = chatMetadata.config?.geminiApiKey;

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

/**
 * Repara embeddings zerados em um chat específico.
 * @param {string} chatToken - Token do chat
 * @returns {Promise<object>} - Resultado do reparo
 */
async function repairEmbeddings(chatToken) {
    const chatMetadata = await chatStorage.getChatMetadata(chatToken);
    if (!chatMetadata) throw new Error("Chat não encontrado.");

    const { geminiApiKey } = chatMetadata.config;
    if (!geminiApiKey) throw new Error("API Key do Gemini não configurada.");

    console.log(`[Service] Iniciando reparo de embeddings para chat ${chatToken}...`);

    const result = await lanceDBService.repairZeroEmbeddings(
        chatToken,
        geminiService.generateEmbedding,
        geminiApiKey,
        ['conceitos', 'fatos', 'historico'] // Repara todas as coleções
    );

    return result;
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
    repairEmbeddings
};
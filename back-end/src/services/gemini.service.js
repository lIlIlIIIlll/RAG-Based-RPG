// src/services/gemini.service.js
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const config = require("../config");

// --- Helper de Retry e Timeout ---

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, ms) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`Operation timed out after ${ms}ms`));
        }, ms);
    });

    return Promise.race([
        promise,
        timeoutPromise
    ]).finally(() => clearTimeout(timeoutId));
};

/**
 * Executa uma operação com retry exponencial.
 * @param {Function} operation - A função a ser executada.
 * @param {string} operationName - Nome da operação para logs.
 * @param {number} maxRetries - Número máximo de tentativas.
 * @returns {Promise<any>} O resultado da operação.
 */
async function retryOperation(operation, operationName, maxRetries = 5) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            return await operation();
        } catch (error) {
            attempt++;
            if (attempt >= maxRetries) {
                throw error;
            }

            const isRateLimit = error.message.includes("429") || error.message.includes("Too Many Requests");
            const delay = isRateLimit ? Math.pow(2, attempt) * 2000 : 1000; // Backoff exponencial agressivo para rate limit (base 2s)

            console.warn(`[Gemini] Erro em ${operationName} (Tentativa ${attempt}/${maxRetries}): ${error.message}. Retentando em ${delay}ms...`);
            await sleep(delay);
        }
    }
}

/**
 * Obtém uma instância do cliente Gemini com a chave fornecida.
 * @param {string} apiKey 
 * @returns {GoogleGenerativeAI}
 */
function getClient(apiKey) {
    if (!apiKey) {
        throw new Error("API Key do Gemini não fornecida.");
    }
    return new GoogleGenerativeAI(apiKey);
}

// --- API Key State Management for Embeddings ---
// Format: { [key]: { cooldownUntil: timestamp } }
const embeddingKeyStates = new Map();

/**
 * Get key state for embeddings.
 * @param {string} key 
 * @returns {Object}
 */
function getEmbeddingKeyState(key) {
    if (!embeddingKeyStates.has(key)) {
        embeddingKeyStates.set(key, { cooldownUntil: 0 });
    }
    return embeddingKeyStates.get(key);
}

/**
 * Check if a key is available for embeddings.
 * @param {string} key 
 * @returns {boolean}
 */
function isEmbeddingKeyAvailable(key) {
    const state = getEmbeddingKeyState(key);
    return Date.now() >= state.cooldownUntil;
}

/**
 * Mark a key as in cooldown for embeddings.
 * @param {string} key 
 * @param {number} durationMs 
 */
function markEmbeddingKeyInCooldown(key, durationMs) {
    const state = getEmbeddingKeyState(key);
    state.cooldownUntil = Date.now() + durationMs;
    console.log(`[Gemini] Embedding API Key ${key.substring(0, 10)}... em cooldown por ${durationMs / 1000 / 60} min.`);
}

/**
 * Detect if error is a quota/rate limit error.
 * @param {Error} error 
 * @returns {boolean}
 */
function isQuotaError(error) {
    const message = error.message || "";
    return (
        message.includes("RESOURCE_EXHAUSTED") ||
        message.includes("429") ||
        message.includes("quota") ||
        message.includes("Too Many Requests")
    );
}

/**
 * @param {string} text - O texto a ser convertido em embedding.
 * @param {string|string[]} apiKeyOrKeys - Uma chave de API ou array de chaves (para rotação).
 * @returns {Promise<number[]>} O vetor de embedding.
 */
async function generateEmbedding(text, apiKeyOrKeys) {
    // Normalize to array
    const apiKeys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys : [apiKeyOrKeys];

    if (apiKeys.length === 0 || !apiKeys[0]) {
        throw new Error("API Key do Gemini não fornecida.");
    }

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const ONE_MINUTE_MS = 60 * 1000;
    let lastError = null;
    let attemptedKeys = [];

    // Try each available key
    for (const currentKey of apiKeys) {
        if (!isEmbeddingKeyAvailable(currentKey)) {
            continue; // Skip keys in cooldown
        }

        if (attemptedKeys.includes(currentKey)) {
            continue; // Already tried this key
        }

        attemptedKeys.push(currentKey);

        try {
            // Use retry with this specific key
            return await retryOperation(async () => {
                const genAI = getClient(currentKey);
                const embeddingModel = genAI.getGenerativeModel({
                    model: "gemini-embedding-001",
                });

                const result = await withTimeout(embeddingModel.embedContent({
                    content: { parts: [{ text }] },
                    outputDimensionality: config.embeddingDimension,
                }), 30000); // 30s timeout

                return result.embedding.values;
            }, `generateEmbedding(${currentKey.substring(0, 10)}...)`, 3); // Menos retries por key

        } catch (error) {
            lastError = error;
            console.error(`[Gemini] Erro com API Key ${currentKey.substring(0, 10)}...:`, error.message);

            if (isQuotaError(error)) {
                // Daily quota = 24h cooldown, RPM limit = 1 min cooldown
                const isDailyQuota = error.message.includes("daily") || error.message.includes("day");
                const cooldown = isDailyQuota ? ONE_DAY_MS : ONE_MINUTE_MS;
                markEmbeddingKeyInCooldown(currentKey, cooldown);
                // Continue to next key
            } else {
                // For non-quota errors, throw immediately
                throw error;
            }
        }
    }

    // All keys exhausted
    if (lastError) {
        const error = new Error(`Todas as API Keys de embedding estão em cooldown ou falharam. Último erro: ${lastError.message}`);
        error.allKeysExhausted = true;
        throw error;
    }

    throw new Error("Nenhuma API Key disponível para embeddings.");
}

/**
 * (Opcional) Gera uma query de busca textual otimizada.
 * Usa o modelo padrão leve para essa tarefa auxiliar.
 * @param {string} contextText
 * @param {string|string[]} apiKeyOrKeys - Uma chave de API ou array de chaves (para rotação).
 */
async function generateSearchQuery(contextText, apiKeyOrKeys) {
    // Normalize to array
    const apiKeys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys : [apiKeyOrKeys];

    if (apiKeys.length === 0 || !apiKeys[0]) {
        throw new Error("API Key do Gemini não fornecida.");
    }

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const ONE_MINUTE_MS = 60 * 1000;
    let lastError = null;

    // Try each available key
    for (const currentKey of apiKeys) {
        if (!isEmbeddingKeyAvailable(currentKey)) {
            continue; // Skip keys in cooldown (shares state with embeddings)
        }

        try {
            return await retryOperation(async () => {
                console.log(`[Gemini] Gerando queries de busca (DIRETA + NARRATIVA)...`);

                const genAI = getClient(currentKey);

                const safetySettings = [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                ];

                // Usa um modelo leve para tarefas auxiliares
                const auxModel = genAI.getGenerativeModel({
                    model: "gemini-2.5-flash",
                    safetySettings: safetySettings
                });

                const prompt = config.queryGenerationPrompt.replace(
                    "{context}",
                    contextText
                );

                const result = await withTimeout(auxModel.generateContent(prompt), 30000); // 30s timeout
                const response = result.response;
                const rawOutput = response.text().trim();

                // Parse das duas queries (DIRETA e NARRATIVA)
                const queries = { direct: '', narrative: '' };
                const lines = rawOutput.split('\n').map(l => l.trim()).filter(l => l.length > 0);

                for (const line of lines) {
                    if (line.toUpperCase().startsWith('DIRETA:')) {
                        queries.direct = line.substring(7).trim();
                    } else if (line.toUpperCase().startsWith('NARRATIVA:')) {
                        queries.narrative = line.substring(10).trim();
                    }
                }

                // Fallback: se não conseguiu parsear, usa a resposta inteira como query direta
                if (!queries.direct && !queries.narrative) {
                    console.warn(`[Gemini] Formato inesperado, usando resposta como query direta: "${rawOutput.substring(0, 50)}..."`);
                    queries.direct = rawOutput.substring(0, 100);
                }

                console.log(`[Gemini] Queries geradas:`);
                console.log(`  DIRETA: "${queries.direct}"`);
                console.log(`  NARRATIVA: "${queries.narrative}"`);

                return queries;
            }, `generateSearchQuery(${currentKey.substring(0, 10)}...)`, 3);

        } catch (error) {
            lastError = error;
            console.error(`[Gemini] Erro com API Key ${currentKey.substring(0, 10)}...:`, error.message);

            if (isQuotaError(error)) {
                const isDailyQuota = error.message.includes("daily") || error.message.includes("day");
                const cooldown = isDailyQuota ? ONE_DAY_MS : ONE_MINUTE_MS;
                markEmbeddingKeyInCooldown(currentKey, cooldown);
                // Continue to next key
            } else {
                throw error;
            }
        }
    }

    // All keys exhausted - fallback
    console.error("[Gemini] Erro ao gerar queries de busca após tentar todas as keys:", lastError?.message);
    const lastUserMessage = contextText.split('\n').reverse().find(line => line.startsWith('user:'));
    const fallbackQuery = lastUserMessage ? lastUserMessage.replace('user: ', '') : contextText.substring(0, 100);
    return { direct: fallbackQuery, narrative: '' };
}

/**
 * Gera uma descrição otimizada para RAG de uma imagem ou PDF.
 * Esta descrição será usada para gerar embeddings e permitir busca semântica.
 * @param {string} base64Data - Dados do arquivo em base64.
 * @param {string} mimeType - Tipo do arquivo (image/*, application/pdf).
 * @param {string} apiKey - Chave de API do Gemini.
 * @returns {Promise<string>} Descrição textual do conteúdo visual.
 */
async function describeMediaForRAG(base64Data, mimeType, apiKey) {
    return retryOperation(async () => {
        console.log(`[Gemini] Gerando descrição para RAG de mídia: ${mimeType}`);

        const genAI = getClient(apiKey);

        const safetySettings = [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ];

        // Usa modelo rápido e econômico para descrições
        const visionModel = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            safetySettings: safetySettings,
            generationConfig: {
                temperature: 0.2, // Baixa temperatura para descrições objetivas
                maxOutputTokens: 500, // Limita resposta para ser concisa
            }
        });

        // Prompt otimizado para gerar descrições indexáveis
        const prompt = mimeType === "application/pdf"
            ? `Analise este documento PDF e gere uma descrição concisa mas completa do seu conteúdo.
Inclua: título/assunto principal, tópicos abordados, informações-chave, nomes mencionados.
Formato: texto corrido, objetivo, sem introdução. Use palavras-chave relevantes para busca.
Máximo 3 parágrafos.`
            : `Descreva esta imagem de forma objetiva e detalhada para indexação em banco de dados.
Inclua: objetos principais, cores predominantes, ações/poses, cenário/fundo, texto visível, estilo artístico.
Formato: texto corrido, sem introdução. Use palavras-chave relevantes para busca.
Se for personagem de RPG/jogo: descreva raça, classe aparente, equipamentos, características físicas.`;

        const result = await withTimeout(visionModel.generateContent([
            { text: prompt },
            {
                inlineData: {
                    mimeType: mimeType,
                    data: base64Data
                }
            }
        ]), 60000); // 60s timeout para imagens/PDFs

        const description = result.response.text().trim();
        console.log(`[Gemini] Descrição gerada (${description.length} chars): "${description.substring(0, 80)}..."`);

        return description;
    }, "describeMediaForRAG", 3); // Menos retries para não atrasar muito
}

module.exports = {
    generateEmbedding,
    generateSearchQuery,
    describeMediaForRAG,
}; 
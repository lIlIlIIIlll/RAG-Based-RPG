// src/services/google.provider.js
// Google Gemini API direct integration with multi-API key rotation and rate limiting.

const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const config = require("../config");

// --- In-Memory API Key State Management ---
// Format: { [key_modelName]: { cooldownUntil: timestamp, requestCount: number, lastRequestMinute: timestamp } }
// Cooldown is now per-model, so a key in cooldown for one model can still be used for another
const apiKeyStates = new Map();

// --- Helper Functions ---
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, ms) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`Operation timed out after ${ms}ms`));
        }, ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() =>
        clearTimeout(timeoutId)
    );
};

/**
 * Generates a composite key for per-model cooldown tracking.
 * @param {string} key - API key
 * @param {string} modelName - Model name
 * @returns {string}
 */
function getCompositeKey(key, modelName) {
    return `${key}_${modelName}`;
}

/**
 * Initializes or gets the state for an API key + model combination.
 * @param {string} key - API key
 * @param {string} modelName - Model name
 * @returns {Object}
 */
function getKeyState(key, modelName) {
    const compositeKey = getCompositeKey(key, modelName);
    if (!apiKeyStates.has(compositeKey)) {
        apiKeyStates.set(compositeKey, {
            cooldownUntil: 0,
            requestCount: 0,
            lastRequestMinute: 0
        });
    }
    return apiKeyStates.get(compositeKey);
}

/**
 * Checks if a key is available for a specific model (not in cooldown).
 * @param {string} key - API key
 * @param {string} modelName - Model name
 * @returns {boolean}
 */
function isKeyAvailable(key, modelName) {
    const state = getKeyState(key, modelName);
    return Date.now() >= state.cooldownUntil;
}

/**
 * Marks a key as in cooldown for a specific model.
 * @param {string} key - API key
 * @param {string} modelName - Model name
 * @param {number} durationMs - Cooldown duration in milliseconds
 */
function markKeyInCooldown(key, modelName, durationMs) {
    const state = getKeyState(key, modelName);
    state.cooldownUntil = Date.now() + durationMs;
    console.log(`[GoogleProvider] API Key ${key.substring(0, 10)}... marked in cooldown for ${durationMs / 1000 / 60} minutes (model: ${modelName}).`);
}

/**
 * Selects the next available API key from the list for a specific model.
 * @param {string[]} apiKeys - List of API keys
 * @param {string} modelName - Model name
 * @returns {string|null}
 */
function selectAvailableKey(apiKeys, modelName) {
    for (const key of apiKeys) {
        if (isKeyAvailable(key, modelName)) {
            return key;
        }
    }
    return null;
}

/**
 * Gets all keys status for debugging/display for a specific model.
 * @param {string[]} apiKeys - List of API keys
 * @param {string} modelName - Model name
 * @returns {Array}
 */
function getKeysStatus(apiKeys, modelName) {
    return apiKeys.map((key, index) => {
        const state = getKeyState(key, modelName);
        const isAvailable = isKeyAvailable(key, modelName);
        return {
            index: index + 1,
            keyPrefix: key.substring(0, 10) + "...",
            isAvailable,
            cooldownRemaining: isAvailable ? 0 : Math.max(0, state.cooldownUntil - Date.now()),
            modelName
        };
    });
}

/**
 * Converts history from internal format to Gemini format.
 * @param {Array} history - History in internal format.
 * @returns {Array} History in Gemini format.
 */
function convertHistoryToGemini(history) {
    return history.map(turn => {
        // Sanitiza parts removendo propriedades auxiliares internas
        const sanitizedParts = (turn.parts || []).map(part => {
            // Remove propriedades auxiliares que começam com "_"
            const cleanPart = {};
            for (const [key, value] of Object.entries(part)) {
                if (!key.startsWith("_")) {
                    cleanPart[key] = value;
                }
            }
            return cleanPart;
        });

        // Handle function response turns (role = "function")
        // Gemini API expects functionResponse parts to have role "function", not "user"
        if (turn.role === "function") {
            return {
                role: "function",
                parts: sanitizedParts
            };
        }

        return {
            role: turn.role === "user" ? "user" : "model",
            parts: sanitizedParts
        };
    });
}

/**
 * Converts tools from internal format to Gemini format.
 * Already in correct format for function_declarations.
 * @param {Array} tools 
 * @returns {Array}
 */
function convertToolsToGemini(tools) {
    // Tools are already in Gemini format (function_declarations)
    return tools;
}

/**
 * Detects if an error is a daily quota exceeded error (20 RPD).
 * @param {Error} error 
 * @returns {boolean}
 */
function isDailyQuotaError(error) {
    const message = error.message || "";
    return (
        message.includes("RESOURCE_EXHAUSTED") ||
        message.includes("429") ||
        message.includes("quota") ||
        message.includes("Quota exceeded") ||
        message.includes("too many requests")
    );
}

/**
 * Detects if an error is a rate limit error (RPM/TPM, not daily).
 * @param {Error} error 
 * @returns {boolean}
 */
function isRateLimitError(error) {
    const message = error.message || "";
    return (
        (message.includes("429") || message.includes("Too Many Requests")) &&
        !message.includes("daily") &&
        !message.includes("day")
    );
}

/**
 * Gera uma resposta de chat usando a API do Google Gemini.
 *
 * @param {object[]} history - Histórico no formato interno.
 * @param {string} systemInstruction - Instrução de sistema.
 * @param {object} generationOptions - { modelName, temperature, tools, apiKeys, rateLimits }
 * @returns {Promise<{text: string, functionCalls: object[], parts: object[]}>}
 */
async function generateChatResponse(
    history,
    systemInstruction,
    generationOptions = {}
) {
    const modelName = generationOptions.modelName || "gemini-2.5-flash";
    const temperature = generationOptions.temperature ?? 1.0;
    const tools = generationOptions.tools || [];
    const apiKeys = generationOptions.apiKeys || [];
    const rateLimits = generationOptions.rateLimits || {
        rpm: 5,
        tpm: 250000,
        rpd: 20
    };

    if (!apiKeys || apiKeys.length === 0) {
        throw new Error("Nenhuma API Key do Google fornecida.");
    }

    // Try each available key
    let lastError = null;
    let attemptedKeys = [];
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    while (true) {
        const currentKey = selectAvailableKey(apiKeys, modelName);

        if (!currentKey) {
            // All keys exhausted
            const keysStatus = getKeysStatus(apiKeys, modelName);
            const statusText = keysStatus.map(k =>
                `Key ${k.index}: ${k.isAvailable ? 'disponível' : `cooldown por ${Math.round(k.cooldownRemaining / 1000 / 60)} min`}`
            ).join(", ");

            const error = new Error(`Todas as API Keys do Google estão em cooldown para o modelo ${modelName}. Status: ${statusText}`);
            error.errorType = "all_keys_exhausted";
            error.userMessage = `Todas as ${apiKeys.length} API Keys atingiram o limite para o modelo ${modelName}. Tente outro modelo ou aguarde.`;
            error.keysStatus = keysStatus;
            throw error;
        }

        if (attemptedKeys.includes(currentKey)) {
            // Already tried this key in this request cycle
            const error = new Error("Ciclo de retry detectado - todas as keys disponíveis falharam.");
            error.errorType = "retry_cycle";
            error.userMessage = "Erro temporário. Tente novamente em alguns segundos.";
            throw error;
        }

        attemptedKeys.push(currentKey);

        try {
            console.log(`[GoogleProvider] Usando API Key ${currentKey.substring(0, 10)}... | Modelo: ${modelName} | Temp: ${temperature}`);

            const genAI = new GoogleGenerativeAI(currentKey);

            // Safety settings - allow all content for RPG narratives
            const safetySettings = [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ];

            // Model configuration
            const modelConfig = {
                model: modelName,
                safetySettings,
                generationConfig: {
                    temperature,
                }
            };

            // Add system instruction if provided
            if (systemInstruction) {
                modelConfig.systemInstruction = systemInstruction;
            }

            // Add tools if provided
            if (tools && tools.length > 0) {
                modelConfig.tools = convertToolsToGemini(tools);
            }

            const model = genAI.getGenerativeModel(modelConfig);

            // Convert and send history
            const geminiHistory = convertHistoryToGemini(history);

            // Start chat with history (excluding last message)
            const chatHistory = geminiHistory.slice(0, -1);
            const lastMessage = geminiHistory[geminiHistory.length - 1];

            const chat = model.startChat({
                history: chatHistory
            });

            // Send the last message
            const result = await withTimeout(
                chat.sendMessage(lastMessage.parts),
                120000 // 120s timeout
            );

            const response = result.response;
            const candidate = response.candidates?.[0];

            if (!candidate) {
                throw new Error("Google AI retornou resposta vazia.");
            }

            // Process response parts
            const parts = candidate.content?.parts || [];
            let text = "";
            let functionCalls = [];
            let responseParts = [];

            for (const part of parts) {
                if (part.text) {
                    text += part.text;
                    const partObj = { text: part.text };
                    // Preserve thoughtSignature if present
                    if (part.thoughtSignature) {
                        partObj.thoughtSignature = part.thoughtSignature;
                    }
                    responseParts.push(partObj);
                } else if (part.functionCall) {
                    functionCalls.push({
                        name: part.functionCall.name,
                        args: part.functionCall.args || {}
                    });
                    const partObj = {
                        functionCall: {
                            name: part.functionCall.name,
                            args: part.functionCall.args || {}
                        }
                    };
                    // Preserve thoughtSignature if present (critical for Gemini 3)
                    if (part.thoughtSignature) {
                        partObj.thoughtSignature = part.thoughtSignature;
                    }
                    responseParts.push(partObj);
                }
            }

            console.log(
                `[GoogleProvider] Resposta recebida. Texto: "${text.substring(0, 50)}..." | FuncCalls: ${functionCalls.length}`
            );

            return { text, functionCalls, parts: responseParts };

        } catch (error) {
            lastError = error;
            console.error(`[GoogleProvider] Erro com API Key ${currentKey.substring(0, 10)}...:`, error.message);

            // Check if this is a daily quota error (should rotate key)
            if (isDailyQuotaError(error)) {
                console.warn(`[GoogleProvider] Quota diária excedida para key ${currentKey.substring(0, 10)}... Marcando em cooldown de 24h.`);
                markKeyInCooldown(currentKey, modelName, ONE_DAY_MS);
                // Continue to try next key
                continue;
            }

            // Check if this is a temporary rate limit (RPM/TPM)
            if (isRateLimitError(error)) {
                console.warn(`[GoogleProvider] Rate limit temporário. Aguardando 2 segundos...`);
                await sleep(2000);
                // Retry same key
                attemptedKeys.pop(); // Remove from attempted to allow retry
                continue;
            }

            // For other errors (auth, invalid key, etc), throw immediately
            const structuredError = new Error(`Google AI error: ${error.message}`);
            structuredError.statusCode = error.status || 500;

            if (error.message.includes("API_KEY_INVALID") || error.message.includes("401")) {
                structuredError.errorType = "auth";
                structuredError.userMessage = "API Key do Google inválida. Verifique suas chaves nas configurações.";
            } else if (error.message.includes("403")) {
                structuredError.errorType = "forbidden";
                structuredError.userMessage = "Acesso negado pela API do Google. Verifique se a API está habilitada.";
            } else {
                structuredError.errorType = "unknown";
                structuredError.userMessage = "Erro ao gerar resposta com Google AI. Tente novamente.";
            }

            throw structuredError;
        }
    }
}

module.exports = {
    generateChatResponse,
    getKeysStatus,
    convertHistoryToGemini,
    convertToolsToGemini,
};

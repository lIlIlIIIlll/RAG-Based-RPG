// src/services/anthropic.service.js
const Anthropic = require("@anthropic-ai/sdk");

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

            const isRateLimit = error.status === 429 || error.message.includes("rate_limit");
            const delay = isRateLimit ? Math.pow(2, attempt) * 2000 : 1000;

            console.warn(`[Anthropic] Erro em ${operationName} (Tentativa ${attempt}/${maxRetries}): ${error.message}. Retentando em ${delay}ms...`);
            await sleep(delay);
        }
    }
}

/**
 * Obtém uma instância do cliente Anthropic com a chave fornecida.
 * @param {string} apiKey 
 * @returns {Anthropic}
 */
function getClient(apiKey) {
    if (!apiKey) {
        throw new Error("API Key do Anthropic não fornecida.");
    }
    return new Anthropic({ apiKey });
}

/**
 * Converte tools do formato Gemini para o formato Anthropic.
 * @param {Array} geminiTools - Tools no formato Gemini.
 * @returns {Array} Tools no formato Anthropic.
 */
function convertToolsToAnthropic(geminiTools) {
    if (!geminiTools || geminiTools.length === 0) return [];

    const anthropicTools = [];

    for (const toolGroup of geminiTools) {
        if (toolGroup.function_declarations) {
            for (const func of toolGroup.function_declarations) {
                // Converte os tipos do Gemini (OBJECT, STRING, INTEGER, ARRAY) para JSON Schema (object, string, integer, array)
                const convertType = (geminiType) => {
                    if (!geminiType) return "string";
                    return geminiType.toLowerCase();
                };

                const convertProperties = (props) => {
                    if (!props) return {};
                    const result = {};
                    for (const [key, value] of Object.entries(props)) {
                        result[key] = {
                            type: convertType(value.type),
                            description: value.description || ""
                        };
                        // Handle array items
                        if (value.items) {
                            result[key].items = { type: convertType(value.items.type) };
                        }
                    }
                    return result;
                };

                anthropicTools.push({
                    name: func.name,
                    description: func.description,
                    input_schema: {
                        type: "object",
                        properties: convertProperties(func.parameters?.properties),
                        required: func.parameters?.required || []
                    }
                });
            }
        }
    }

    return anthropicTools;
}

/**
 * Converte histórico do formato Gemini para o formato Anthropic.
 * Tool calls do Claude (com toolUseId) são mantidos no formato nativo.
 * Tool calls antigos do Gemini (sem toolUseId) são convertidos em texto narrativo
 * para compatibilidade cross-provider.
 * @param {Array} geminiHistory - Histórico no formato Gemini.
 * @returns {Array} Histórico no formato Anthropic.
 */
function convertHistoryToAnthropic(geminiHistory) {
    if (!geminiHistory || geminiHistory.length === 0) return [];

    const anthropicMessages = [];

    // Rastreia quais tool_use_ids já foram consumidos por um tool_result
    // Isso evita que múltiplos tool_results usem o mesmo ID
    const consumedToolUseIds = new Set();

    for (const msg of geminiHistory) {
        const role = msg.role === "model" ? "assistant" : msg.role === "function" ? "user" : "user";
        const content = [];

        if (msg.parts) {
            for (const part of msg.parts) {
                if (part.text) {
                    content.push({ type: "text", text: part.text });
                } else if (part.inlineData) {
                    // Imagem inline
                    content.push({
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: part.inlineData.mimeType,
                            data: part.inlineData.data
                        }
                    });
                } else if (part.functionCall) {
                    // Verifica se tem toolUseId (veio do Claude) ou não (veio do Gemini)
                    if (part.toolUseId) {
                        // Tool call do Claude - mantém formato nativo
                        content.push({
                            type: "tool_use",
                            id: part.toolUseId,
                            name: part.functionCall.name,
                            input: part.functionCall.args || {}
                        });
                    } else {
                        // Tool call do Gemini - converte em texto narrativo
                        // Isso garante compatibilidade quando o usuário troca de provider mid-conversation
                        const toolName = part.functionCall.name;
                        const toolArgs = JSON.stringify(part.functionCall.args || {}, null, 2);
                        content.push({
                            type: "text",
                            text: `[Sistema executou ferramenta "${toolName}"]`
                        });
                    }
                } else if (part.functionResponse) {
                    // Verifica se a mensagem anterior do assistant tem o toolUseId correspondente
                    // Se tiver, usa tool_result nativo; se não, converte para narrativa
                    const toolName = part.functionResponse.name;

                    // Procura o toolUseId correspondente nas mensagens anteriores
                    // que ainda NÃO foi consumido por outro tool_result
                    let matchingToolUseId = null;
                    for (let i = anthropicMessages.length - 1; i >= 0; i--) {
                        const prevMsg = anthropicMessages[i];
                        if (prevMsg.role === "assistant") {
                            // Procura um tool_use com o mesmo nome que ainda não foi consumido
                            const toolUse = prevMsg.content.find(c =>
                                c.type === "tool_use" &&
                                c.name === toolName &&
                                !consumedToolUseIds.has(c.id)
                            );
                            if (toolUse) {
                                matchingToolUseId = toolUse.id;
                                // Marca este ID como consumido para não reusar
                                consumedToolUseIds.add(toolUse.id);
                                break;
                            }
                        }
                    }

                    if (matchingToolUseId) {
                        // Resposta para tool do Claude - usa formato nativo
                        content.push({
                            type: "tool_result",
                            tool_use_id: matchingToolUseId,
                            content: JSON.stringify(part.functionResponse.response || {})
                        });
                    } else {
                        // Resposta para tool do Gemini - converte para narrativa
                        const toolResult = part.functionResponse.response;
                        const statusMsg = toolResult?.status === "success" ? "✓" : "";
                        content.push({
                            type: "text",
                            text: `[Resultado: ${statusMsg} ${toolResult?.message || JSON.stringify(toolResult)}]`
                        });
                    }
                }
            }
        }

        // Agrupa mensagens consecutivas do mesmo role
        if (anthropicMessages.length > 0 && anthropicMessages[anthropicMessages.length - 1].role === role) {
            anthropicMessages[anthropicMessages.length - 1].content.push(...content);
        } else if (content.length > 0) {
            anthropicMessages.push({ role, content });
        }
    }

    // Anthropic exige que a primeira mensagem seja do usuário
    if (anthropicMessages.length > 0 && anthropicMessages[0].role !== "user") {
        anthropicMessages.unshift({
            role: "user",
            content: [{ type: "text", text: "..." }]
        });
    }

    // Anthropic exige alternância de roles, então precisamos garantir isso
    const validatedMessages = [];
    for (let i = 0; i < anthropicMessages.length; i++) {
        const msg = anthropicMessages[i];
        if (i === 0) {
            validatedMessages.push(msg);
        } else {
            const lastRole = validatedMessages[validatedMessages.length - 1].role;
            if (msg.role === lastRole) {
                // Merge com a mensagem anterior
                validatedMessages[validatedMessages.length - 1].content.push(...msg.content);
            } else {
                validatedMessages.push(msg);
            }
        }
    }

    // DEDUPLICAÇÃO FINAL: Remove tool_results duplicados (mesmo tool_use_id)
    // Isso pode acontecer quando mensagens são merged ou quando o histórico
    // contém duplicatas de processamentos anteriores
    const seenToolResultIds = new Set();
    for (const msg of validatedMessages) {
        if (msg.content && Array.isArray(msg.content)) {
            msg.content = msg.content.filter(block => {
                if (block.type === "tool_result") {
                    if (seenToolResultIds.has(block.tool_use_id)) {
                        console.warn(`[Anthropic] Removendo tool_result duplicado: ${block.tool_use_id}`);
                        return false; // Remove duplicata
                    }
                    seenToolResultIds.add(block.tool_use_id);
                }
                return true;
            });
        }
    }

    return validatedMessages;
}

/**
 * Gera uma resposta de chat usando a API do Anthropic.
 * 
 * @param {object[]} history - Histórico no formato Gemini (será convertido).
 * @param {string} systemInstruction - Instrução de sistema.
 * @param {object} generationOptions - { modelName, temperature, tools, apiKey }
 * @returns {Promise<{text: string, functionCalls: object[], parts: object[]}>} 
 */
async function generateChatResponse(history, systemInstruction, generationOptions = {}) {
    return retryOperation(async () => {
        try {
            const modelName = generationOptions.modelName || "claude-sonnet-4-20250514";
            const temperature = generationOptions.temperature ?? 0.7;
            const tools = generationOptions.tools || [];
            const apiKey = generationOptions.apiKey;

            const client = getClient(apiKey);

            console.log(
                `[Anthropic] Gerando resposta. Modelo: ${modelName} | Temp: ${temperature} | Msgs: ${history.length} | Tools: ${tools.length}`
            );

            // Converte histórico e tools para formato Anthropic
            const anthropicHistory = convertHistoryToAnthropic(history);
            const anthropicTools = convertToolsToAnthropic(tools);

            const requestParams = {
                model: modelName,
                max_tokens: 8192,
                temperature: temperature,
                system: systemInstruction,
                messages: anthropicHistory
            };

            // Adiciona tools apenas se houver
            if (anthropicTools.length > 0) {
                requestParams.tools = anthropicTools;
            }

            const response = await withTimeout(
                client.messages.create(requestParams),
                120000 // 120s timeout
            );

            // Processa resposta do Anthropic
            let text = "";
            const functionCalls = [];
            const parts = [];

            for (const block of response.content) {
                if (block.type === "text") {
                    text += block.text;
                    parts.push({ text: block.text });
                } else if (block.type === "tool_use") {
                    functionCalls.push({
                        name: block.name,
                        args: block.input,
                        id: block.id // Anthropic usa ID para rastrear tool calls
                    });
                    parts.push({
                        functionCall: {
                            name: block.name,
                            args: block.input
                        },
                        toolUseId: block.id
                    });
                }
            }

            console.log(`[Anthropic] Resposta recebida. Texto: "${text.substring(0, 50)}..." | FuncCalls: ${functionCalls.length}`);

            return {
                text,
                functionCalls,
                parts,
                stopReason: response.stop_reason,
                toolUseIds: functionCalls.map(f => f.id) // Mantém os IDs para respostas de tool
            };
        } catch (error) {
            console.error("[Anthropic] Erro ao gerar resposta de chat:", error.message);
            throw error;
        }
    }, "generateChatResponse");
}

/**
 * Gera resposta de continuação para tool calls.
 * @param {Array} history - Histórico atual.
 * @param {string} systemInstruction - Instrução de sistema.
 * @param {Array} toolResults - Resultados das tools executadas.
 * @param {object} generationOptions - Opções de geração.
 * @returns {Promise<object>} Resposta do modelo.
 */
async function continueWithToolResults(history, systemInstruction, toolResults, generationOptions = {}) {
    return retryOperation(async () => {
        try {
            const modelName = generationOptions.modelName || "claude-sonnet-4-20250514";
            const temperature = generationOptions.temperature ?? 0.7;
            const tools = generationOptions.tools || [];
            const apiKey = generationOptions.apiKey;

            const client = getClient(apiKey);

            // Converte histórico base
            const anthropicHistory = convertHistoryToAnthropic(history);
            const anthropicTools = convertToolsToAnthropic(tools);

            // Adiciona os resultados das tools como mensagem do usuário
            const toolResultContent = toolResults.map(tr => ({
                type: "tool_result",
                tool_use_id: tr.toolUseId,
                content: JSON.stringify(tr.result)
            }));

            anthropicHistory.push({
                role: "user",
                content: toolResultContent
            });

            const requestParams = {
                model: modelName,
                max_tokens: 8192,
                temperature: temperature,
                system: systemInstruction,
                messages: anthropicHistory
            };

            if (anthropicTools.length > 0) {
                requestParams.tools = anthropicTools;
            }

            const response = await withTimeout(
                client.messages.create(requestParams),
                120000
            );

            // Processa resposta
            let text = "";
            const functionCalls = [];
            const parts = [];

            for (const block of response.content) {
                if (block.type === "text") {
                    text += block.text;
                    parts.push({ text: block.text });
                } else if (block.type === "tool_use") {
                    functionCalls.push({
                        name: block.name,
                        args: block.input,
                        id: block.id
                    });
                    parts.push({
                        functionCall: {
                            name: block.name,
                            args: block.input
                        },
                        toolUseId: block.id
                    });
                }
            }

            return {
                text,
                functionCalls,
                parts,
                stopReason: response.stop_reason,
                toolUseIds: functionCalls.map(f => f.id)
            };
        } catch (error) {
            console.error("[Anthropic] Erro ao continuar com tool results:", error.message);
            throw error;
        }
    }, "continueWithToolResults");
}

module.exports = {
    generateChatResponse,
    continueWithToolResults,
    convertToolsToAnthropic,
    convertHistoryToAnthropic
};

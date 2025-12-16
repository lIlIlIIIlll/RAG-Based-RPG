// src/services/openrouter.service.js
// OpenRouter API integration for chat generation with tool calling support.

const config = require("../config");

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// --- Helper de Retry e Timeout ---

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

            const isRateLimit =
                error.message.includes("429") ||
                error.message.includes("Too Many Requests");
            const delay = isRateLimit ? Math.pow(2, attempt) * 2000 : 1000;

            console.warn(
                `[OpenRouter] Erro em ${operationName} (Tentativa ${attempt}/${maxRetries}): ${error.message}. Retentando em ${delay}ms...`
            );
            await sleep(delay);
        }
    }
}

/**
 * Converte histórico do formato Gemini para formato OpenAI/OpenRouter.
 * @param {Array} geminiHistory - Histórico no formato Gemini.
 * @returns {Array} Histórico no formato OpenAI.
 */
function convertHistoryToOpenAI(geminiHistory) {
    const messages = [];

    for (const turn of geminiHistory) {
        // Determina o role correto
        let role;
        if (turn.role === "user") {
            role = "user";
        } else if (turn.role === "model") {
            role = "assistant";
        } else if (turn.role === "function") {
            // Function responses são tratadas como tool results
            for (const part of turn.parts || []) {
                if (part.functionResponse) {
                    messages.push({
                        role: "tool",
                        tool_call_id: part.functionResponse.name, // Usamos o nome como ID temporário
                        content: JSON.stringify(part.functionResponse.response),
                    });
                }
            }
            continue;
        } else {
            role = "user"; // fallback
        }

        // Processa as parts
        const content = [];
        const toolCalls = [];

        for (const part of turn.parts || []) {
            if (part.text) {
                content.push({ type: "text", text: part.text });
            } else if (part.inlineData) {
                // Imagem inline
                content.push({
                    type: "image_url",
                    image_url: {
                        url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                    },
                });
            } else if (part.functionCall) {
                // Tool call do modelo
                toolCalls.push({
                    id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    type: "function",
                    function: {
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args || {}),
                    },
                });
            }
        }

        // Monta a mensagem
        if (toolCalls.length > 0) {
            // Assistant message com tool calls
            messages.push({
                role: "assistant",
                content: content.length === 1 && content[0].type === "text" ? content[0].text : null,
                tool_calls: toolCalls,
            });
        } else if (content.length > 0) {
            // Mensagem normal
            if (content.length === 1 && content[0].type === "text") {
                messages.push({ role, content: content[0].text });
            } else {
                messages.push({ role, content });
            }
        }
    }

    return messages;
}

/**
 * Converte tools do formato Gemini para formato OpenAI/OpenRouter.
 * @param {Array} geminiTools - Tools no formato Gemini.
 * @returns {Array} Tools no formato OpenAI.
 */
function convertToolsToOpenAI(geminiTools) {
    const tools = [];

    for (const toolGroup of geminiTools) {
        if (toolGroup.function_declarations) {
            for (const func of toolGroup.function_declarations) {
                // Converte tipos do Gemini (OBJECT, STRING) para JSON Schema (object, string)
                const convertType = (type) => (type ? type.toLowerCase() : "string");

                const convertProperties = (props) => {
                    if (!props) return {};
                    const result = {};
                    for (const [key, value] of Object.entries(props)) {
                        result[key] = {
                            type: convertType(value.type),
                            description: value.description || "",
                        };
                        if (value.items) {
                            result[key].items = { type: convertType(value.items.type) };
                        }
                    }
                    return result;
                };

                tools.push({
                    type: "function",
                    function: {
                        name: func.name,
                        description: func.description || "",
                        parameters: {
                            type: "object",
                            properties: convertProperties(func.parameters?.properties),
                            required: func.parameters?.required || [],
                        },
                    },
                });
            }
        }
    }

    return tools;
}

/**
 * Gera uma resposta de chat usando a API do OpenRouter.
 *
 * @param {object[]} history - Histórico no formato Gemini (será convertido).
 * @param {string} systemInstruction - Instrução de sistema.
 * @param {object} generationOptions - { modelName, temperature, tools, apiKey }
 * @returns {Promise<{text: string, functionCalls: object[], parts: object[]}>}
 */
async function generateChatResponse(
    history,
    systemInstruction,
    generationOptions = {}
) {
    return retryOperation(async () => {
        const modelName = generationOptions.modelName || "google/gemini-2.5-pro-preview";
        const temperature = generationOptions.temperature ?? 0.7;
        const geminiTools = generationOptions.tools || [];
        const apiKey = generationOptions.apiKey;

        if (!apiKey) {
            throw new Error("API Key do OpenRouter não fornecida.");
        }

        console.log(
            `[OpenRouter] Gerando resposta. Modelo: ${modelName} | Temp: ${temperature} | Msgs: ${history.length} | Tools: ${geminiTools.length}`
        );

        // Converte histórico e tools para formato OpenAI
        const messages = convertHistoryToOpenAI(history);
        const tools = geminiTools.length > 0 ? convertToolsToOpenAI(geminiTools) : undefined;

        // Adiciona system instruction no início
        if (systemInstruction) {
            messages.unshift({ role: "system", content: systemInstruction });
        }

        // Monta o body da requisição
        const requestBody = {
            model: modelName,
            messages,
            temperature,
        };

        if (tools && tools.length > 0) {
            requestBody.tools = tools;
        }

        // Função interna para fazer a requisição
        const makeRequest = async (body) => {
            const response = await withTimeout(
                fetch(OPENROUTER_API_URL, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                        "HTTP-Referer": config.appUrl || "http://localhost:3000",
                        "X-Title": "RAG-Based-RPG",
                    },
                    body: JSON.stringify(body),
                }),
                120000 // 120s timeout
            );
            return response;
        };

        // Faz a requisição para o OpenRouter
        let response = await makeRequest(requestBody);

        // Fallback: Se o modelo não suporta tools, refaz sem tools
        if (!response.ok) {
            const errorData = await response.text();

            // Detecta erro específico de "no endpoints support tool use"
            if (
                response.status === 404 &&
                errorData.includes("No endpoints found that support tool use") &&
                requestBody.tools
            ) {
                console.warn(
                    `[OpenRouter] Modelo ${modelName} não suporta tools. Refazendo requisição sem tools...`
                );

                // Remove tools e refaz a requisição
                delete requestBody.tools;
                response = await makeRequest(requestBody);

                if (!response.ok) {
                    const retryErrorData = await response.text();
                    throw new Error(`OpenRouter API error (${response.status}): ${retryErrorData}`);
                }
            } else {
                throw new Error(`OpenRouter API error (${response.status}): ${errorData}`);
            }
        }

        const data = await response.json();

        // Processa a resposta
        const choice = data.choices?.[0];
        if (!choice) {
            throw new Error("OpenRouter retornou resposta vazia.");
        }

        const message = choice.message;
        let text = message.content || "";
        let functionCalls = [];
        let parts = [];

        // Processa tool calls se houver
        if (message.tool_calls && message.tool_calls.length > 0) {
            functionCalls = message.tool_calls.map((tc) => ({
                name: tc.function.name,
                args: JSON.parse(tc.function.arguments || "{}"),
                toolUseId: tc.id, // Mantemos o ID para referência
            }));

            // Monta parts no formato Gemini para compatibilidade
            parts = message.tool_calls.map((tc) => ({
                functionCall: {
                    name: tc.function.name,
                    args: JSON.parse(tc.function.arguments || "{}"),
                },
            }));

            if (text) {
                parts.unshift({ text });
            }
        } else {
            parts = [{ text }];
        }

        console.log(
            `[OpenRouter] Resposta recebida. Texto: "${text.substring(0, 50)}..." | FuncCalls: ${functionCalls.length}`
        );

        return { text, functionCalls, parts };
    }, "generateChatResponse");
}

module.exports = {
    generateChatResponse,
    convertHistoryToOpenAI,
    convertToolsToOpenAI,
};

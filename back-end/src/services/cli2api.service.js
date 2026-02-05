// src/services/cli2api.service.js
// CLI2API Proxy integration for chat generation with tool calling support.
// This service communicates with a local CLI2API proxy running at localhost:8317

const { convertHistoryToOpenAI, convertToolsToOpenAI } = require("./openrouter.service");

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
async function retryOperation(operation, operationName, maxRetries = 3) {
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
                `[CLI2API] Erro em ${operationName} (Tentativa ${attempt}/${maxRetries}): ${error.message}. Retentando em ${delay}ms...`
            );
            await sleep(delay);
        }
    }
}

/**
 * Gera uma resposta de chat usando a API do CLI2API (OpenAI-compatible).
 *
 * @param {object[]} history - Histórico no formato Gemini (será convertido).
 * @param {string} systemInstruction - Instrução de sistema.
 * @param {object} generationOptions - { modelName, temperature, tools, apiKey, baseUrl }
 * @returns {Promise<{text: string, functionCalls: object[], parts: object[]}>}
 */
async function generateChatResponse(
    history,
    systemInstruction,
    generationOptions = {}
) {
    return retryOperation(async () => {
        const modelName = generationOptions.modelName || "gemini-2.5-pro";
        const temperature = generationOptions.temperature ?? 0.7;
        const geminiTools = generationOptions.tools || [];
        const apiKey = generationOptions.apiKey || "batata";
        const baseUrl = generationOptions.baseUrl || "http://localhost:8317";

        const apiUrl = `${baseUrl}/v1/chat/completions`;

        console.log(
            `[CLI2API] Gerando resposta. URL: ${apiUrl} | Modelo: ${modelName} | Temp: ${temperature} | Msgs: ${history.length} | Tools: ${geminiTools.length}`
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
                fetch(apiUrl, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(body),
                }),
                120000 // 120s timeout
            );
            return response;
        };

        // Faz a requisição para o CLI2API
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
                    `[CLI2API] Modelo ${modelName} não suporta tools. Refazendo requisição sem tools...`
                );

                // Remove tools e refaz a requisição
                delete requestBody.tools;
                response = await makeRequest(requestBody);

                if (!response.ok) {
                    const retryErrorData = await response.text();
                    throw new Error(`CLI2API error (${response.status}): ${retryErrorData}`);
                }
            } else {
                // Tenta parsear erro para extrair detalhes
                let errorDetails = {};
                try {
                    errorDetails = JSON.parse(errorData);
                } catch (e) {
                    // Erro não é JSON
                }

                // Cria erro estruturado para o frontend
                const error = new Error(`CLI2API error (${response.status}): ${errorData}`);
                error.statusCode = response.status;

                // Detecta tipos específicos de erro
                if (response.status === 403 && errorDetails.error?.metadata?.reasons) {
                    error.errorType = "moderation";
                    error.reasons = errorDetails.error.metadata.reasons;
                    error.userMessage = `Conteúdo bloqueado pela moderação: ${error.reasons.join(", ")}. Tente reformular sua mensagem ou usar outro modelo.`;
                } else if (response.status === 429) {
                    error.errorType = "rate_limit";
                    error.userMessage = "Limite de requisições atingido. Aguarde alguns segundos e tente novamente.";
                } else if (response.status === 401 || response.status === 403) {
                    error.errorType = "auth";
                    error.userMessage = "Erro de autenticação com o CLI2API. Verifique sua API Key.";
                } else if (response.status === 502 || response.status === 503) {
                    error.errorType = "proxy_error";
                    error.userMessage = "CLI2API indisponível. Verifique se o proxy está rodando.";
                } else {
                    error.errorType = "unknown";
                    error.userMessage = "Erro ao gerar resposta. Tente novamente ou verifique o CLI2API.";
                }

                throw error;
            }
        }

        const data = await response.json();

        // Processa a resposta
        const choice = data.choices?.[0];
        if (!choice) {
            throw new Error("CLI2API retornou resposta vazia.");
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
            `[CLI2API] Resposta recebida. Texto: "${text.substring(0, 50)}..." | FuncCalls: ${functionCalls.length}`
        );

        return { text, functionCalls, parts };
    }, "generateChatResponse");
}

module.exports = {
    generateChatResponse,
};
